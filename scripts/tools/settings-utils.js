import { MODULE_ID } from './constants.js';

// Read a lancer-automations setting, falling back instead of throwing when it is
// not registered yet. Returns the value as registered, whatever its type.
export function getModuleSetting(key, fallback)
{
    try
    {
        return game.settings.get(MODULE_ID, key);
    }
    catch
    {
        return fallback;
    }
}
