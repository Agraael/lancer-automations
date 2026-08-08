// Read a lancer-automations boolean setting; false if settings are not ready.
export function getModuleSetting(key)
{
    try
    {
        return !!game.settings.get('lancer-automations', key);
    }
    catch
    {
        return false;
    }
}
