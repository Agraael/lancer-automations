/* global game, Hooks, canvas */

const MODULE_ID = 'lancer-automations';

let _forceFree = false;
let _forceDebug = false;

export function isForceFreeMovement() {
    return _forceFree;
}
export function isForceDebugMovement() {
    return _forceDebug;
}

function refreshActiveDragPreviews() {
    for (const tok of canvas.tokens?.placeables ?? []) {
        const idata = tok.mouseInteractionManager?.interactionData;
        if (idata?.destination) {
            try {
                tok._updateDragDestination?.(idata.destination, { snap: false });
            } catch { /* ignore */ }
        }
        // ruler.refresh forces the new style; measurement alone reuses prior styles.
        try {
            tok.ruler?.refresh?.();
        } catch { /* ignore */ }
    }
}

Hooks.once('init', () => {
    game.keybindings.register(MODULE_ID, 'freeMovement', {
        name: 'Free Movement (hold)',
        hint: 'While held, the next move (drag-drop or programmatic) does not consume the movement cap and ignores terrain penalty. Mirrors v12 ER\'s Force Free Movement.',
        editable: [{ key: 'KeyV' }],
        onDown: () => {
            _forceFree = true; refreshActiveDragPreviews(); return true;
        },
        onUp:   () => {
            _forceFree = false; refreshActiveDragPreviews(); return true;
        },
        repeat: false,
        precedence: foundry.helpers.interaction.ClientKeybindings?.PRECEDENCE?.PRIORITY ?? 2
    });

    game.keybindings.register(MODULE_ID, 'debugMovement', {
        name: 'Debug Movement (hold)',
        hint: 'While held, the next move is recorded by Foundry but skips LA automation hooks (no onMove trigger, no history append, no engagement update). Mirrors v12 ER\'s Force Debug Movement.',
        editable: [{ key: 'KeyB' }],
        onDown: () => {
            _forceDebug = true; refreshActiveDragPreviews(); return true;
        },
        onUp:   () => {
            _forceDebug = false; refreshActiveDragPreviews(); return true;
        },
        repeat: false,
        precedence: foundry.helpers.interaction.ClientKeybindings?.PRECEDENCE?.PRIORITY ?? 2
    });
});
