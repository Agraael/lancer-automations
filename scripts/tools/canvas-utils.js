/** Scene grid size relative to baseline (100 px); multiply stroke / dash / texture-scale fields by this. */
export function gridScale()
{
    const gridSize = canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100;
    return gridSize / 100;
}

export function tickerToggle(tick)
{
    let ticking = false;

    return wanted =>
    {
        if (wanted === ticking)
            return;

        ticking = wanted;
        if (wanted)
            canvas.app.ticker.add(tick);
        else
            canvas.app.ticker.remove(tick);
    };
}

export function stopTicker(tick)
{
    if (tick)
        canvas?.app?.ticker?.remove(tick);
    return null;
}
