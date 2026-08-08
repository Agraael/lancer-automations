/* global canvas, game, PIXI, Hooks */
// Movement-reach overlay: per-token weighted reach painted in the ruler's speed-tier
// colors, shrinking live while a drag spends movement. Returns a destroy() fn. style:ignore

import {
    addGraphicsBelowTokens, destroyGraphics, paintCellRegion, createFadeInOut,
} from "./canvas-helpers.js";
import { computeMovementReach } from "../movement/reachability.js";
import { liveDragState } from "../movement/token-ruler.js";
import { getSpeedRanges, tokenSpeed } from "../combat/speed-provider.js";

const MODULE_ID = 'lancer-automations';

// Knockback (forced) preview: 2x the unit's speed, flat, purple, not speed-limited.
const FORCED_MOVES = 2;

function forceReachColor()
{
    try
    {
        const hex = game.settings.get(MODULE_ID, 'speedProvider.colorForceMovement') || '#8B5CF6';
        return Number.parseInt(hex.replace('#', ''), 16);
    }
    catch
    {
        return 0x8B5CF6;
    }
}

// The ruler mixes its spent sources: distance-based `regular` while dragging,
// cost-based history otherwise. Follow it verbatim so bands equal ruler colors.
function spentFor(tokenDoc, dragging)
{
    const api = game.modules.get(MODULE_ID)?.api;
    const intentional = api?.getMovementHistory?.(tokenDoc.id)?.intentional;
    return Number((dragging ? intentional?.regular : intentional?.regularCost) ?? 0);
}

// While dragging, the movement type is the drag override (cycled mid-drag), else the token's set one.
function effectiveAction(token)
{
    const doc = token.document;
    const layer = /** @type {any} */ (canvas.tokens);
    if (layer?._draggedToken?.document?.id && layer._draggedToken.document.id === doc?.id)
        return layer._dragMovementAction ?? doc.movementAction ?? 'walk';
    return doc?.movementAction ?? 'walk';
}

function buildTokenReach(token)
{
    const doc = token.document;
    const action = effectiveAction(token);
    const actionCfg = globalThis.CONFIG?.Token?.movement?.actions?.[action];
    const teleport = !!actionCfg?.teleport;
    const forced = action === 'forced';
    const drag = liveDragState.get(doc.id);
    const dragDelta = Number(drag?.dragDelta ?? 0);

    let tiers, spent, budget;
    const flat = teleport || forced;
    if (forced)
    {
        // knockback: one flat purple band = 2x the unit's speed; not tiered, not speed-limited, no spend
        const range = FORCED_MOVES * tokenSpeed(token);
        tiers = [{ name: 'forced', color: forceReachColor(), max: range }];
        spent = 0;
        budget = range;
    }
    else
    {
        tiers = getSpeedRanges(token);
        if (!tiers.length)
            return null;
        // already-committed turn movement only counts in combat; the drag/waypoint cost always applies
        const historySpent = game.combat?.active ? spentFor(doc, !!drag) : 0;
        spent = historySpent + dragDelta;
        budget = tiers[tiers.length - 1].max - spent;
    }

    const result = { tiers, budget, cells: new Map(), reach: new Map() };
    if (budget <= 0)
        return result;
    const origin = drag ? drag.end : null;
    const footprints = new Map();
    const occupied = new Set();
    result.reach = computeMovementReach(token, budget, { action, origin, footprintsOut: footprints, occupiedOut: occupied, flat });
    for (const [key, cost] of result.reach)
    {
        if (cost <= 0)
            continue;
        const total = spent + cost;
        let tier = -1;
        for (let tierIdx = 0; tierIdx < tiers.length; tierIdx++)
        {
            if (total <= tiers[tierIdx].max + 1e-9)
            {
                tier = tierIdx;
                break;
            }
        }
        if (tier < 0)
            continue;
        // Paint the whole footprint at that position, not just the center cell (multi-hex tokens).
        const footprintCells = footprints.get(key);
        const cellsHere = footprintCells?.length ? footprintCells : [key];
        // Lancer: can't end where the footprint covers another character; drop the position.
        if (occupied.size && cellsHere.some(cellKey => occupied.has(cellKey)))
            continue;
        for (const footprintKey of cellsHere)
        {
            const existing = result.cells.get(footprintKey);
            if (existing === undefined || tier < existing)
                result.cells.set(footprintKey, tier);
        }
    }
    // The cells under the token itself are never painted (same as size 1's own hex).
    for (const [key, cost] of result.reach)
    {
        if (cost > 0)
            continue;
        for (const footprintKey of footprints.get(key) ?? [key])
            result.cells.delete(footprintKey);
    }
    return result;
}

export function createMovementReachHighlight(tokens)
{
    const staticGfx = new PIXI.Graphics();
    addGraphicsBelowTokens(staticGfx);

    const rebuild = () =>
    {
        const bestByCell = new Map();
        const tierColors = [];
        for (const token of tokens)
        {
            const data = buildTokenReach(token);
            if (!data)
                continue;
            for (let tierIdx = 0; tierIdx < data.tiers.length; tierIdx++)
            {
                if (tierColors[tierIdx] === undefined)
                    tierColors[tierIdx] = data.tiers[tierIdx].color;
            }
            for (const [key, tierIdx] of data.cells)
            {
                const existing = bestByCell.get(key);
                if (existing === undefined || tierIdx < existing)
                    bestByCell.set(key, tierIdx);
            }
        }

        staticGfx.clear();
        const bandCells = [];
        for (const [key, tierIdx] of bestByCell)
            (bandCells[tierIdx] ??= []).push(key);
        // outer tiers first so the inner (cheaper) band paints on top of shared outlines
        for (let tierIdx = bandCells.length - 1; tierIdx >= 0; tierIdx--)
        {
            if (!bandCells[tierIdx]?.length)
                continue;
            paintCellRegion(staticGfx, bandCells[tierIdx], { color: tierColors[tierIdx] ?? 0x1e88e5, alpha: 0.14, lineAlpha: 0, lineWidth: 0 });
        }
    };
    rebuild();

    const posKey = () => tokens.map(token => `${token.document?.x},${token.document?.y},${token.document?.elevation},${effectiveAction(token)}`).join('|');
    let lastKey = posKey();
    const followTick = () =>
    {
        if (staticGfx.destroyed)
        {
            canvas.app.ticker.remove(followTick);
            return;
        }
        const key = posKey();
        if (key !== lastKey)
        {
            lastKey = key;
            rebuild();
        }
    };
    canvas.app.ticker.add(followTick);

    const tokenIds = new Set(tokens.map(token => token.document?.id));
    const onDragChanged = (tokenId) =>
    {
        if (tokenIds.has(tokenId) && !staticGfx.destroyed)
            rebuild();
    };
    Hooks.on('lancer-automations.dragMoveChanged', onDragChanged);

    const fadeDestroy = createFadeInOut([staticGfx], { fadeInMs: 180, fadeOutMs: 180 }, () =>
    {
        canvas.app.ticker.remove(followTick);
        destroyGraphics(staticGfx);
    });
    // Off synchronously: on canvasTearDown the graphic dies before the fade ends, so the
    // fade's onDestroyed never runs and the listener would leak if removed only there.
    return () =>
    {
        Hooks.off('lancer-automations.dragMoveChanged', onDragChanged);
        fadeDestroy();
    };
}
