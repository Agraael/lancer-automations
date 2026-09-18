/* global game, Hooks, canvas, foundry */

import { MODULE_ID } from '../tools/constants.js';

import { getSettingEnabled } from '../setup/settings-register.js';
import { playUiSound } from '../tah/sound.js';
import { localize } from '../tools/string-utils.js';

let _forceFree = false;
let _forceDebug = false;
let _pathfindOverride = null;
let _elevationModeOverride = null;

export function isForceFreeMovement()
{
    return _forceFree;
}
export function isForceDebugMovement()
{
    return _forceDebug;
}

// The world setting is the master switch; X flips it per session only while it is on.
export function pathfindDragEnabled()
{
    if (!getSettingEnabled('pathfindDragMovement'))
        return false;
    return _pathfindOverride ?? true;
}

/**
 * Auto-elevation mode for a movement action. Walkers stand on a surface, flyers keep an altitude;
 * Z swaps that for the session.
 * @param {string|null|undefined} action
 * @returns {'ground'|'hold'|null} null when the action ignores terrain
 */
export function elevationModeFor(action)
{
    if (action === 'ignore')
        return null;
    return _elevationModeOverride ?? (action === 'fly' ? 'hold' : 'ground');
}

export function currentElevationMode()
{
    return elevationModeFor(getCurrentMovementType());
}

export function getCurrentMovementType()
{
    const layer = /** @type {any} */ (canvas.tokens);
    if (layer?._dragMovementAction)
        return layer._dragMovementAction;
    const token = layer?._draggedToken ?? layer?.controlled?.[0];
    const docAction = token?.document?.movementAction;
    if (docAction)
        return docAction;
    return 'walk';
}

export function floatDragFeedback(text)
{
    if (!canvas?.interface?.createScrollingText)
        return;
    for (const token of canvas.tokens?.placeables ?? [])
    {
        const contexts = token.mouseInteractionManager?.interactionData?.contexts;
        if (!contexts)
            continue;
        for (const context of Object.values(contexts))
        {
            const source = context?.clonedToken ?? context?.token;
            const center = source?.center;
            if (!center)
                continue;
            const origin = { x: center.x, y: center.y - (source.h ?? 0) / 2 - 12 };
            canvas.interface.createScrollingText(origin, text, {
                anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                direction: CONST.TEXT_ANCHOR_POINTS.TOP,
                duration: 1500,
                fontSize: 20,
                fill: '#cccccc',
                stroke: 0,
                strokeThickness: 4,
                jitter: 0.25,
            });
        }
    }
}

function refreshActiveDragPreviews({ replan = false } = {})
{
    for (const token of canvas.tokens?.placeables ?? [])
    {
        const interactionData = token.mouseInteractionManager?.interactionData;
        // Foundry skips a destination whose keys all still match; a throwaway key forces the path to be replanned.
        if (replan)
        {
            for (const context of Object.values(interactionData?.contexts ?? {}))
            {
                if (context?.destination)
                    context.destination = { ...context.destination, _laElevReplan: Math.random() };
            }
        }
        if (interactionData?.destination)
        {
            try
            {
                token._updateDragDestination?.(interactionData.destination, { snap: false });
            }
            catch
            { /* ignore */ }
        }
        // ruler.refresh forces the new style; measurement alone reuses prior styles.
        try
        {
            token.ruler?.refresh?.();
        }
        catch
        { /* ignore */ }
    }
}

Hooks.once('init', () =>
{
    game.keybindings.register(MODULE_ID, 'freeMovement', {
        name: 'LA.keybindings.freeMovement.name',
        hint: 'LA.keybindings.freeMovement.hint',
        editable: [{ key: 'KeyV' }],
        onDown: () =>
        {
            _forceFree = true; refreshActiveDragPreviews(); return true;
        },
        onUp:   () =>
        {
            _forceFree = false; refreshActiveDragPreviews(); return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });

    game.keybindings.register(MODULE_ID, 'debugMovement', {
        name: 'LA.keybindings.debugMovement.name',
        hint: 'LA.keybindings.debugMovement.hint',
        editable: [{ key: 'KeyB' }],
        onDown: () =>
        {
            _forceDebug = true; refreshActiveDragPreviews(); return true;
        },
        onUp:   () =>
        {
            _forceDebug = false; refreshActiveDragPreviews(); return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });

    game.keybindings.register(MODULE_ID, 'togglePathfinding', {
        name: 'LA.keybindings.togglePathfinding.name',
        hint: 'LA.keybindings.togglePathfinding.hint',
        editable: [{ key: 'KeyX' }],
        onDown: () =>
        {
            if (canvas?.activeLayer !== canvas?.tokens)
                return false;
            if (!canvas?.tokens?.preview?.children?.length)
                return false;
            if (!getSettingEnabled('pathfindDragMovement'))
                return false;
            _pathfindOverride = !pathfindDragEnabled();
            playUiSound('toggle');
            floatDragFeedback(localize(pathfindDragEnabled() ? 'LA.dragFeedback.pathfindOn' : 'LA.dragFeedback.pathfindOff'));
            refreshActiveDragPreviews();
            return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });

    game.keybindings.register(MODULE_ID, 'swapElevationMode', {
        name: 'LA.keybindings.swapElevationMode.name',
        hint: 'LA.keybindings.swapElevationMode.hint',
        editable: [{ key: 'KeyZ' }],
        onDown: () =>
        {
            if (canvas?.activeLayer !== canvas?.tokens)
                return false;
            if (!canvas?.tokens?.preview?.children?.length)
                return false;
            const action = getCurrentMovementType();
            if (action === 'ignore')
                return false;
            const base = action === 'fly' ? 'hold' : 'ground';
            const other = base === 'hold' ? 'ground' : 'hold';
            _elevationModeOverride = elevationModeFor(action) === base ? other : null;
            playUiSound('toggle');
            floatDragFeedback(localize(elevationModeFor(action) === 'hold' ? 'LA.dragFeedback.hold' : 'LA.dragFeedback.ground'));
            refreshActiveDragPreviews({ replan: true });
            return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
});