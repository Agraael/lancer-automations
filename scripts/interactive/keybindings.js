/* global game */

// Rebindable elevation/tilt shortcuts for the placement tools (Settings > Configure Controls).
const MODULE_ID = 'lancer-automations';

export const ELEV_TILT_KEYBINDS = [
    { id: 'elevationUp', name: 'Area/Token: Elevation Up', key: 'KeyE' },
    { id: 'elevationDown', name: 'Area/Token: Elevation Down', key: 'KeyQ' },
    { id: 'lineTiltUp', name: 'Line: Tilt End Up', key: 'KeyW' },
    { id: 'lineTiltDown', name: 'Line: Tilt End Down', key: 'KeyS' },
    { id: 'resetShape', name: 'Area: Reset elevation offset + rotation + tilt', key: 'KeyZ' },
];

export const TAH_NAV_KEYBINDS = [
    { id: 'tahNavUp', name: 'TAH: Move Up', key: 'KeyW', modifiers: ['Shift'] },
    { id: 'tahNavDown', name: 'TAH: Move Down', key: 'KeyS', modifiers: ['Shift'] },
    { id: 'tahNavLeft', name: 'TAH: Column Left', key: 'KeyA', modifiers: ['Shift'] },
    { id: 'tahNavRight', name: 'TAH: Column Right', key: 'KeyD', modifiers: ['Shift'] },
    { id: 'tahNavActivate', name: 'TAH: Activate (left-click)', key: 'KeyE', modifiers: ['Shift'] },
    { id: 'tahNavContext', name: 'TAH: Context (right-click)', key: 'KeyQ', modifiers: ['Shift'] },
];

export function registerElevTiltKeybindings()
{
    for (const k of ELEV_TILT_KEYBINDS)
    {
        game.keybindings.register(MODULE_ID, k.id, {
            name: k.name,
            editable: [{ key: k.key }],
        });
    }
    for (const k of TAH_NAV_KEYBINDS)
    {
        game.keybindings.register(MODULE_ID, k.id, {
            name: k.name,
            editable: [{ key: k.key, modifiers: k.modifiers ?? [] }],
        });
    }
}

export function eventMatchesKeybind(event, actionId)
{
    for (const binding of (game.keybindings.get(MODULE_ID, actionId) ?? []))
    {
        const modifiers = binding.modifiers ?? [];
        if (binding.key === event.code
            && !!event.shiftKey === modifiers.includes('Shift')
            && !!event.ctrlKey === modifiers.includes('Control')
            && !!event.altKey === modifiers.includes('Alt'))
            return true;
    }
    return false;
}

// Key codes bound to a shortcut (read inside the tools' own keydown handlers).
export function keyCodesFor(id)
{
    return new Set((game.keybindings.get(MODULE_ID, id) ?? []).map(b => b.key));
}

// First bound key (for hint labels), else the default.
export function firstKeyFor(id)
{
    return game.keybindings.get(MODULE_ID, id)?.[0]?.key
        ?? ELEV_TILT_KEYBINDS.find(k => k.id === id)?.key
        ?? '';
}
