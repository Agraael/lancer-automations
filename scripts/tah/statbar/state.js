// Shared mutable state for the token stat-bar system: overlay hubs, per-token value
// snapshots, and fade/flash/alt-peek tracking.

/* global canvas, PIXI */

let _altHeld = false;
export function isAltHeld()
{
    return _altHeld;
}
export function setAltHeld(held)
{
    _altHeld = held;
}

export const _lastValues = new Map();
export const _flashingTokens = new Set();
export const _fadeState = new Map();
export const _overlayHubs = new Map();

// Overlay on canvas.tokens; hubs render above all tokens.
let _hubOverlay = null;
export function getHubOverlay()
{
    if (_hubOverlay && !_hubOverlay.destroyed)
        return _hubOverlay;
    if (!canvas?.tokens)
        return null;
    _hubOverlay = new PIXI.Container();
    _hubOverlay.name = 'la-stat-bar-overlay';
    _hubOverlay.sortableChildren = true;
    _hubOverlay.zIndex = 99999;
    canvas.tokens.addChild(_hubOverlay);
    return _hubOverlay;
}
export function resetHubOverlay()
{
    _hubOverlay = null;
}
