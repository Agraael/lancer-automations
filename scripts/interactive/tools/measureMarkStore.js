import { addGraphicsBelowTokens, addGraphicsAboveTokens, destroyGraphics, gridLineWidth, TG, paintDashedFootprint } from "../canvas-helpers.js";
import { isHexGrid, getHexCenter, drawHexAt, getOccupiedOffsets } from "../../combat/grid-helpers.js";
import { isTokenVisible } from "../../utils/lancer-token.js";

// Marks reuse the gold breathing visual of placed attack-roll targets (target-shapes.js).
function createSingleMarkStore(colorFn = () => TG.placed, above = false, haloFn = () => false, drawTokens = true, dashed = false)
{
    const marks = [];
    const gfx = new PIXI.Graphics();
    if (above)
        addGraphicsAboveTokens(gfx);
    else
        addGraphicsBelowTokens(gfx);
    const keyOf = (mark) => mark.tokenId ?? `${mark.col},${mark.row}`;
    const indexOf = (mark) => marks.findIndex(existing => keyOf(existing) === keyOf(mark));
    const liveToken = (id) =>
    {
        for (const preview of canvas.tokens?.preview?.children ?? [])
        {
            if (preview?.document?.id === id)
                return preview;
        }
        return canvas.tokens.get(id);
    };
    const drawGeom = (mark) =>
    {
        if (mark.tokenId)
        {
            if (!drawTokens)
                return;
            const token = liveToken(mark.tokenId);
            if (!token || !isTokenVisible(token))
                return;
            if (isHexGrid())
            {
                for (const offset of getOccupiedOffsets(token))
                    drawHexAt(gfx, offset.col, offset.row);
            }
            else
                gfx.drawRect(token.document.x, token.document.y, token.document.width * canvas.grid.size, token.document.height * canvas.grid.size);
        }
        else if (isHexGrid())
            drawHexAt(gfx, mark.col, mark.row);
        else
        {
            const center = getHexCenter(mark.col, mark.row);
            gfx.drawRect(center.x - canvas.grid.size / 2, center.y - canvas.grid.size / 2, canvas.grid.size, canvas.grid.size);
        }
    };
    const markCells = (mark) =>
    {
        if (!mark.tokenId)
            return [[mark.col, mark.row]];
        if (!drawTokens)
            return [];
        const token = liveToken(mark.tokenId);
        return token && isTokenVisible(token) ? getOccupiedOffsets(token).map(offset => [offset.col, offset.row]) : [];
    };
    const drawDashed = () =>
    {
        const seen = new Set();
        const cells = [];
        for (const mark of marks)
        {
            for (const [col, row] of markCells(mark))
            {
                const key = `${col},${row}`;
                if (!seen.has(key))
                {
                    seen.add(key);
                    cells.push([col, row]);
                }
            }
        }
        paintDashedFootprint(gfx, cells, colorFn(marks[0]), { halo: haloFn(marks[0]) });
    };
    let drawn = false;
    const tick = () =>
    {
        if (gfx.destroyed)
        {
            canvas.app.ticker.remove(tick);
            return;
        }
        if (!marks.length || !gfx.visible)
        {
            if (drawn)
                gfx.clear();
            drawn = false;
            return;
        }
        drawn = true;
        gfx.alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
        gfx.clear();
        if (dashed)
        {
            drawDashed();
            return;
        }
        gfx.lineStyle(gridLineWidth(7), 0x000000, 0.6);
        for (const mark of marks)
        {
            if (haloFn(mark))
                drawGeom(mark);
        }
        for (const mark of marks)
        {
            const color = colorFn(mark);
            gfx.lineStyle(gridLineWidth(4), color, 0.85);
            gfx.beginFill(color, 0.22);
            drawGeom(mark);
            gfx.endFill();
        }
    };
    canvas.app.ticker.add(tick);
    return {
        marks,
        has(mark)
        {
            return indexOf(mark) >= 0;
        },
        toggle(mark)
        {
            const index = indexOf(mark);
            if (index >= 0)
                marks.splice(index, 1);
            else
                marks.push(mark);
        },
        remove(mark)
        {
            const index = indexOf(mark);
            if (index >= 0)
                marks.splice(index, 1);
        },
        clear()
        {
            marks.length = 0;
        },
        setVisible(visible)
        {
            gfx.visible = visible;
        },
        destroy()
        {
            canvas.app.ticker.remove(tick);
            destroyGraphics(gfx);
            marks.length = 0;
        },
    };
}

export { createSingleMarkStore };
