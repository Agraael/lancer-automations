/* global game, Hooks, canvas, foundry */

const MODULE_ID = 'lancer-automations';

let _forceFree = false;
let _forceDebug = false;

export function isForceFreeMovement()
{
    return _forceFree;
}
export function isForceDebugMovement()
{
    return _forceDebug;
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

function refreshActiveDragPreviews()
{
    for (const token of canvas.tokens?.placeables ?? [])
    {
        const interactionData = token.mouseInteractionManager?.interactionData;
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
        name: 'Free Movement (hold)',
        hint: 'While held, the next move (drag-drop or from code) does not consume the movement cap and ignores terrain penalty.',
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
        precedence: foundry.helpers.interaction.ClientKeybindings?.PRECEDENCE?.PRIORITY ?? 2
    });

    game.keybindings.register(MODULE_ID, 'debugMovement', {
        name: 'Debug Movement (hold)',
        hint: 'While held, the next move is recorded by Foundry but skips LA automation hooks (no onMove trigger, no history append, no engagement update).',
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
        precedence: foundry.helpers.interaction.ClientKeybindings?.PRECEDENCE?.PRIORITY ?? 2
    });
});
