/* global game, Hooks, canvas, foundry */

import { MODULE_ID } from '../tools/constants.js';

import { getSettingEnabled } from '../setup/settings-register.js';
import { playUiSound } from '../tah/sound.js';
import { localize } from '../tools/string-utils.js';
import { parseAction } from './movement-actions.js';

let _forceFree = false;
let _forceDebug = false;
let _pathfindOverride = null;
let _elevationModeOverride = null;
let _movementPicker = null;
let _straightFlip = false;
let _climberFlip = false;
let _dragToggleIds = new Set();
let _climberBase = (tokenDoc) => !!tokenDoc?.actor?.statuses?.has('climber');

export const STRAIGHT_LINE_STATUS = 'straight_line';

let _straightLineBase = (tokenDoc) => !!tokenDoc?.actor?.statuses?.has(STRAIGHT_LINE_STATUS);

export function setClimberBase(provider)
{
    _climberBase = provider;
}

export function setStraightLineBase(provider)
{
    _straightLineBase = provider;
}

export function resetDragToggles()
{
    _straightFlip = false;
    _climberFlip = false;
    _dragToggleIds = new Set();
}

export function straightLineDefault(tokenDoc, action)
{
    const statuses = tokenDoc?.actor?.statuses;
    if (_straightLineBase(tokenDoc))
        return true;
    const base = parseAction(action).base;
    if (base === 'jump')
        return true;
    return base === 'fly' && !statuses?.has('hover');
}

export function straightFlipFor(tokenDoc)
{
    return _straightFlip && _dragToggleIds.has(tokenDoc?.id);
}

export function straightLineFor(tokenDoc, action)
{
    return straightLineDefault(tokenDoc, action) !== straightFlipFor(tokenDoc);
}

export function climberFlipFor(tokenDoc)
{
    return _climberFlip && _dragToggleIds.has(tokenDoc?.id);
}

function draggedTokens()
{
    const layer = /** @type {any} */ (canvas.tokens);
    const tokens = [...(layer?.controlled ?? [])];
    if (layer?._draggedToken && !tokens.includes(layer._draggedToken))
        tokens.unshift(layer._draggedToken);
    return tokens;
}

function markDraggedTokens()
{
    for (const token of draggedTokens())
        _dragToggleIds.add(token.id);
}

export function setMovementPicker(picker)
{
    _movementPicker = picker;
}

function dragPreviewActive()
{
    return !!_movementPicker || !!canvas?.tokens?.preview?.children?.length;
}

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
    if (_movementPicker)
        return _movementPicker.action();

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

    const float = (origin) => canvas.interface.createScrollingText(origin, text, {
        anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
        direction: CONST.TEXT_ANCHOR_POINTS.TOP,
        duration: 1500,
        fontSize: 20,
        fill: '#cccccc',
        stroke: 0,
        strokeThickness: 4,
        jitter: 0.25,
    });

    const pickerAnchor = _movementPicker?.anchor?.();
    if (pickerAnchor)
        float(pickerAnchor);

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
            float({ x: center.x, y: center.y - (source.h ?? 0) / 2 - 12 });
        }
    }
}

function toggleKeyFeedback(labelKey)
{
    if (!dragPreviewActive())
        return;
    playUiSound('toggle');
    floatDragFeedback(localize(labelKey));
}

export function clearMoveModes()
{
    const wasFree = _forceFree;
    _forceFree = false;
    _forceDebug = false;
    if (wasFree)
        Hooks.callAll(`${MODULE_ID}.freeKeyChanged`, false);
}

function refreshActiveDragPreviews({ replan = false } = {})
{
    _movementPicker?.refresh();

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
            _forceFree = !_forceFree; refreshActiveDragPreviews(); toggleKeyFeedback(_forceFree ? 'LA.dragFeedback.freeOn' : 'LA.dragFeedback.freeOff'); Hooks.callAll(`${MODULE_ID}.freeKeyChanged`, _forceFree); return true;
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
            _forceDebug = !_forceDebug; refreshActiveDragPreviews({ replan: true }); toggleKeyFeedback(_forceDebug ? 'LA.dragFeedback.debugOn' : 'LA.dragFeedback.debugOff'); return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });

    game.keybindings.register(MODULE_ID, 'togglePathfinding', {
        name: 'LA.keybindings.togglePathfinding.name',
        hint: 'LA.keybindings.togglePathfinding.hint',
        editable: [{ key: 'KeyX' }],
        onDown: (context) =>
        {
            if (canvas?.activeLayer !== canvas?.tokens)
                return false;
            if (!dragPreviewActive())
                return false;
            if (!getSettingEnabled('pathfindDragMovement'))
                return false;
            _pathfindOverride = !pathfindDragEnabled();
            playUiSound('toggle');
            floatDragFeedback(localize(pathfindDragEnabled() ? 'LA.dragFeedback.pathfindOn' : 'LA.dragFeedback.pathfindOff'));
            refreshActiveDragPreviews();
            context?.event?.stopImmediatePropagation();
            return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });

    game.keybindings.register(MODULE_ID, 'swapElevationMode', {
        name: 'LA.keybindings.swapElevationMode.name',
        hint: 'LA.keybindings.swapElevationMode.hint',
        editable: [{ key: 'KeyZ' }],
        onDown: (context) =>
        {
            if (canvas?.activeLayer !== canvas?.tokens)
                return false;
            if (!dragPreviewActive())
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
            context?.event?.stopImmediatePropagation();
            return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });

    game.keybindings.register(MODULE_ID, 'toggleStraightLine', {
        name: 'LA.keybindings.toggleStraightLine.name',
        hint: 'LA.keybindings.toggleStraightLine.hint',
        editable: [{ key: 'KeyC' }],
        onDown: (context) =>
        {
            if (canvas?.activeLayer !== canvas?.tokens)
                return false;
            if (!dragPreviewActive())
                return false;
            _straightFlip = !_straightFlip;
            markDraggedTokens();
            const lead = draggedTokens()[0]?.document;
            playUiSound('toggle');
            floatDragFeedback(localize(straightLineFor(lead, getCurrentMovementType()) ? 'LA.dragFeedback.straightOn' : 'LA.dragFeedback.straightOff'));
            refreshActiveDragPreviews({ replan: true });
            context?.event?.stopImmediatePropagation();
            return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });

    game.keybindings.register(MODULE_ID, 'toggleElevationCost', {
        name: 'LA.keybindings.toggleElevationCost.name',
        hint: 'LA.keybindings.toggleElevationCost.hint',
        editable: [{ key: 'KeyG' }],
        onDown: (context) =>
        {
            if (canvas?.activeLayer !== canvas?.tokens)
                return false;
            if (!dragPreviewActive())
                return false;
            _climberFlip = !_climberFlip;
            markDraggedTokens();
            const lead = draggedTokens()[0]?.document;
            playUiSound('toggle');
            floatDragFeedback(localize(_climberBase(lead) !== climberFlipFor(lead) ? 'LA.dragFeedback.elevationCostOff' : 'LA.dragFeedback.elevationCostOn'));
            refreshActiveDragPreviews({ replan: true });
            context?.event?.stopImmediatePropagation();
            return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
});