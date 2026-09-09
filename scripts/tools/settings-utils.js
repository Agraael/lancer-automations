// Read a lancer-automations setting; boolean without a fallback, raw value with one.
export function getModuleSetting(key, fallback)
{
    try
    {
        const value = game.settings.get('lancer-automations', key);
        return fallback === undefined ? !!value : value;
    }
    catch
    {
        return fallback === undefined ? false : fallback;
    }
}
