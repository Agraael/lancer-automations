import { MODULE_ID } from './constants.js';

// v13 builds a Setting document on every client-scope read, so primitive reads are memoized here.
// Objects stay live (mutated before set), null too (core writes performanceMode raw).
const _cache = new Map();
const SETTING_CACHE_ALL = 'settingsCacheAllModules';
let _cacheAll = false;

// Each write path clears before its onChange runs, on every client for world scope.
function _clearing(wrapped, ...args)
{
    _cache.clear();
    return wrapped(...args);
}

Hooks.once('init', () =>
{
    game.settings.register(MODULE_ID, SETTING_CACHE_ALL, {
        name: 'LA.settings.settingsCacheAllModules.name',
        hint: 'LA.settings.settingsCacheAllModules.hint',
        scope: 'world',
        type: Boolean,
        default: false,
        config: false,
        onChange: value =>
        {
            _cacheAll = !!value;
            _cache.clear();
        }
    });
    _cacheAll = !!game.settings.get(MODULE_ID, SETTING_CACHE_ALL);
    if (typeof libWrapper === 'undefined')
        return;
    libWrapper.register(MODULE_ID, 'foundry.helpers.ClientSettings.prototype.get', function (wrapped, namespace, key, options)
    {
        if (options?.document || (!_cacheAll && namespace !== MODULE_ID))
            return wrapped(namespace, key, options);
        const bucket = _cache.get(namespace);
        if (bucket?.has(key))
            return bucket.get(key);
        const value = wrapped(namespace, key, options);
        if (typeof value !== 'object')
        {
            if (bucket)
                bucket.set(key, value);
            else
                _cache.set(namespace, new Map([[key, value]]));
        }
        return value;
    }, 'MIXED');
    // Force Client Settings redirects forced keys inside the same call, so either nesting order yields the same value.
    libWrapper.ignore_conflicts(MODULE_ID, 'force-client-settings', 'foundry.helpers.ClientSettings.prototype.get');

    for (const target of ['foundry.helpers.ClientSettings.prototype.set', 'foundry.helpers.ClientSettings.prototype.register',
        'foundry.documents.Setting.prototype._onCreate', 'foundry.documents.Setting.prototype._onUpdate', 'foundry.documents.Setting.prototype._onDelete'])
        libWrapper.register(MODULE_ID, target, _clearing, 'WRAPPER');
});

function _read(namespace, key, fallback)
{
    try
    {
        return game.settings.get(namespace, key);
    }
    catch
    {
        return fallback;
    }
}

// Read a lancer-automations setting, falling back instead of throwing when it is
// not registered yet. Returns the value as registered, whatever its type.
export function getModuleSetting(key, fallback)
{
    return _read(MODULE_ID, key, fallback);
}

// Same for another module's setting.
export function getExternalSetting(namespace, key, fallback)
{
    return _read(namespace, key, fallback);
}
