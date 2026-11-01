import { getModuleSetting } from "../tools/settings-utils.js";
import { MODULE_ID } from "../tools/constants.js";

// Targeting palette.
export const TG = {
    inRange: 0x0088ff,
    target: 0x00ffff,
    reference: 0xffffff,
    outOfRange: 0xff2c21,
    placed: 0xffd84a,
    noHost: 0xffaa00,
    selected: 0x00ff00,
    crit: 0xffd700,
    rangeFill: 0x888888,
    traceStart: 0xffff00,
    traceEnd: 0xff6400,
    traceLine: 0xffffff,
    markAdd: 0x33ff66,
    markRemove: 0xff3b30,
};

// Range-pulse glow per range kind.
export const RANGE_GLOW = {
    manual: 0xffffff,
    threat: 0xad5cff,
    sensor: 0x7ce4fe,
    weapon: 0xfe9e43,
    reach: 0xff4747,
    mark: 0xffffff,
    deploy: 0x74e08a,
};

/** Resolves a glow key ('sensor') or a raw color to a RANGE_GLOW value. */
export function resolveRangeGlow(glow, fallback = RANGE_GLOW.manual)
{
    if (typeof glow === 'number')
        return glow;
    if (typeof glow === 'string' && glow in RANGE_GLOW)
        return RANGE_GLOW[glow];
    return fallback;
}

// Shared range-pulse styling. Tune here; used by every range-pulse builder + the picker.
export const RANGE_PULSE_STYLE = {
    baseColor: 0x888888,
    lineColor: 0xFFFFFF,
    staticFillAlpha: 0.0125,
    staticLineAlpha: 0.0125,
    perimeterAlpha: 0.6,
    pulseSpeed: 1,
};

// Client color settings backing the palettes above. [settingKey, object, prop, menuLabel]
const _PALETTE_DEFS = [
    ['color.inRange', TG, 'inRange', 'In Range'],
    ['color.target', TG, 'target', 'Target'],
    ['color.reference', TG, 'reference', 'Reference Token'],
    ['color.outOfRange', TG, 'outOfRange', 'Out of Range'],
    ['color.placed', TG, 'placed', 'Placed Shape'],
    ['color.noHost', TG, 'noHost', 'No Host'],
    ['color.selected', TG, 'selected', 'Selected'],
    ['color.crit', TG, 'crit', 'Critical'],
    ['color.rangeFill', TG, 'rangeFill', 'Range Fill'],
    ['color.traceStart', TG, 'traceStart', 'Trace Start'],
    ['color.traceEnd', TG, 'traceEnd', 'Trace End'],
    ['color.traceLine', TG, 'traceLine', 'Trace Line'],
    ['color.glowManual', RANGE_GLOW, 'manual', 'Default'],
    ['color.glowThreat', RANGE_GLOW, 'threat', 'Threat'],
    ['color.glowSensor', RANGE_GLOW, 'sensor', 'Sensor'],
    ['color.glowWeapon', RANGE_GLOW, 'weapon', 'Weapon'],
    ['color.glowReach', RANGE_GLOW, 'reach', 'Max Reach'],
    ['color.glowMark', RANGE_GLOW, 'mark', 'Mark'],
    ['color.glowDeploy', RANGE_GLOW, 'deploy', 'Deploy'],
    ['color.pulseLine', RANGE_PULSE_STYLE, 'lineColor', 'Pulse Line'],
];

// Ruler speed-tier color keys; listed here so Colors-tab reset covers them too.
const RULER_COLOR_KEYS = [
    'speedProvider.colorStandard',
    'speedProvider.colorBoost',
    'speedProvider.colorOverBoost',
    'speedProvider.colorFreeMovement',
    'speedProvider.colorForceMovement',
];

const _toHex = (value) => '#' + (value & 0xffffff).toString(16).padStart(6, '0');
const _fromHex = (hex) =>
{
    const parsed = Number.parseInt(String(hex).replace(/^#/, ''), 16);
    return Number.isFinite(parsed) ? parsed : null;
};

// Overwrite the live palette objects in place so every importer picks up the change.
function applyPaletteColorSettings()
{
    for (const [key, obj, prop] of _PALETTE_DEFS)
    {
        const value = _fromHex(getModuleSetting(key));
        if (value !== null)
            obj[prop] = value;
    }
}

/**
 * Restore the palette colors, the ruler colors and any extra keys to their registered defaults,
 * mirroring onto whatever inputs the settings menu currently has open.
 * @param {string[]} [extraKeys] Additional setting keys on the same tab (sliders, selects).
 */
export async function resetPaletteColorSettings(extraKeys = [])
{
    const keys = [...new Set([..._PALETTE_DEFS.map(([key]) => key), ...RULER_COLOR_KEYS, ...extraKeys])];
    for (const key of keys)
    {
        const registered = game.settings.settings.get(`lancer-automations.${key}`);
        const defaultValue = registered?.default;
        if (defaultValue == null)
            continue;
        await game.settings.set(MODULE_ID,key, defaultValue);
        const input = /** @type {HTMLInputElement|null} */ (document.querySelector(`[name="${key}"]`));
        if (!input)
            continue;
        input.value = String(defaultValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

Hooks.once('init', () =>
{
    for (const [key, obj, prop, label] of _PALETTE_DEFS)
    {
        game.settings.register(MODULE_ID,key, {
            name: label,
            scope: 'client',
            config: false,
            type: String,
            default: _toHex(obj[prop]),
            onChange: applyPaletteColorSettings,
        });
    }
});
Hooks.once('ready', applyPaletteColorSettings);
