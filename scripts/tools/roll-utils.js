const _formulaBounds = new Map();

export function formulaBounds(formula)
{
    let bounds = _formulaBounds.get(formula);
    if (!bounds)
    {
        try
        {
            bounds = {
                min: Number(new Roll(formula).evaluateSync({ minimize: true }).total) || 0,
                max: Number(new Roll(formula).evaluateSync({ maximize: true }).total) || 0,
            };
        }
        catch
        {
            bounds = { min: 0, max: 0 };
        }
        _formulaBounds.set(formula, bounds);
    }
    return bounds;
}
