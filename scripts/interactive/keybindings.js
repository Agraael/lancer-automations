/* global game */

// Rebindable elevation/tilt shortcuts for the placement tools (Settings > Configure Controls).
const MODULE_ID = 'lancer-automations';

export const ELEV_TILT_KEYBINDS = [
    { id: 'elevationUp', name: 'Area/Token: Elevation Up', key: 'KeyE' },
    { id: 'elevationDown', name: 'Area/Token: Elevation Down', key: 'KeyQ' },
    { id: 'lineTiltUp', name: 'Line: Tilt End Up', key: 'KeyW' },
    { id: 'lineTiltDown', name: 'Line: Tilt End Down', key: 'KeyS' },
];

export function registerElevTiltKeybindings() {
    for (const k of ELEV_TILT_KEYBINDS) {
        game.keybindings.register(MODULE_ID, k.id, {
            name: k.name,
            editable: [{ key: k.key }],
        });
    }
}

// Key codes bound to a shortcut (read inside the tools' own keydown handlers).
export function keyCodesFor(id) {
    return new Set((game.keybindings.get(MODULE_ID, id) ?? []).map(b => b.key));
}

// First bound key (for hint labels), else the default.
export function firstKeyFor(id) {
    return game.keybindings.get(MODULE_ID, id)?.[0]?.key
        ?? ELEV_TILT_KEYBINDS.find(k => k.id === id)?.key
        ?? '';
}
