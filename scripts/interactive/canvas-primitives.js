import { isHexGrid, getHexCenter, drawHexAt } from "../combat/grid-helpers.js";
import { getIsoProvider } from "../setup/iso-settings.js";

/** Unparent + destroy a PIXI display object (containers destroy their children too). Safe with null/undefined. */
export function destroyGraphics(graphic)
{
    if (!graphic || graphic.destroyed)
        return;
    if (graphic.labelLayer)
        destroyGraphics(graphic.labelLayer);
    if (graphic.parent)
        graphic.parent.removeChild(graphic);
    graphic.destroy({ children: true });
}

/** Insert a graphic below the tokens layer (so tokens overlay it), or fall back to canvas.stage. */
export function addGraphicsBelowTokens(graphic)
{
    graphic.eventMode = 'none';
    if (canvas.tokens?.parent)
        canvas.tokens.parent.addChildAt(graphic, canvas.tokens.parent.getChildIndex(canvas.tokens));
    else
        canvas.stage.addChild(graphic);
    return graphic;
}

/** Insert a graphic above the tokens (canvas.stage, same layer the cursor labels use). */
export function addGraphicsAboveTokens(graphic)
{
    graphic.eventMode = 'none';
    canvas.stage.addChild(graphic);
    return graphic;
}

/** Paint a list of cells (hex or square) onto a PIXI.Graphics. Caller sets fill/stroke. */
export function _paintCells(graphics, cells, { gridSize = canvas.grid.size } = {})
{
    const hex = isHexGrid();
    for (const cell of cells)
    {
        const col = typeof cell === 'string' ? Number(cell.split(',')[0]) : cell.col;
        const row = typeof cell === 'string' ? Number(cell.split(',')[1]) : cell.row;
        if (hex)
            drawHexAt(graphics, col, row);
        else
        {
            const cellCenter = getHexCenter(col, row);
            graphics.drawRect(cellCenter.x - gridSize / 2, cellCenter.y - gridSize / 2, gridSize, gridSize);
        }
    }
}

/** World-space stroke width scaled to the grid (calibrated on a 100px grid), min 1px. */
export function gridLineWidth(base = 2)
{
    return Math.max(1, base * canvas.grid.size / 100);
}

export function drawDashedEdges(graphic, edges, dash, gap, phase)
{
    const step = dash + gap;
    const offset = ((phase % step) + step) % step;
    for (const [from, to] of edges)
    {
        const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        const ux = (to.x - from.x) / len;
        const uy = (to.y - from.y) / len;
        for (let pos = -offset; pos < len; pos += step)
        {
            const start = Math.max(0, pos);
            const end = Math.min(pos + dash, len);
            if (end <= start)
                continue;
            graphic.moveTo(from.x + ux * start, from.y + uy * start);
            graphic.lineTo(from.x + ux * end, from.y + uy * end);
        }
    }
}

export function paintWithHalo(graphic, drawGeometry, { color = 0xffffff, lineWidth = 2, lineAlpha = 0.8, fillColor = null, fillAlpha = 0 } = {})
{
    const stroke = gridLineWidth(lineWidth);
    const halo = stroke + Math.max(1, 2 * canvas.grid.size / 100);
    if (lineAlpha > 0)
    {
        graphic.lineStyle(halo, 0x000000, lineAlpha);
        drawGeometry(graphic);
        graphic.lineStyle(stroke, color, lineAlpha);
    }
    if (fillAlpha > 0)
        graphic.beginFill(fillColor ?? color, fillAlpha);
    drawGeometry(graphic);
    if (fillAlpha > 0)
        graphic.endFill();
}

/** Text rasterisation resolution that keeps labels crisp when zoomed in (small grids upscale more). */
export function gridTextResolution()
{
    const dpr = canvas.app?.renderer?.resolution ?? 1;
    const zoom = canvas.stage?.scale?.x ?? 1;
    const factor = Math.max(1, zoom, 100 / canvas.grid.size);
    return Math.min(10, dpr * factor * 1.5);
}

/** PIXI.Text with zoom-aware resolution (crisp when zoomed in on small grids). */
export function makeText(text, style)
{
    const pixiText = new PIXI.Text(text, style);
    pixiText.resolution = gridTextResolution();
    const iso = getIsoProvider();
    if (iso)
    {
        pixiText.rotation = iso.reverseRotation;
        pixiText.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        pixiText.scale.set(iso.counterScale, 1 / iso.counterScale);
    }
    return pixiText;
}
