/* global game, Hooks, libWrapper, canvas */

const MODULE_ID = 'lancer-automations';
const SETTING_MAX = 'disableVisionAboveControlled';

let active = false;

function _max() {
    try {
        return Number(game.settings.get(MODULE_ID, SETTING_MAX)) || 0;
    } catch {
        return 0;
    }
}

function _shouldDisable() {
    const max = _max();
    if (max <= 0) return false;
    return (canvas?.tokens?.controlled?.length ?? 0) > max;
}

function _applyState() {
    const now = _shouldDisable();
    if (now === active) return;
    active = now;
    canvas?.perception?.update?.({ initializeVision: true, initializeLighting: true });
}

export function initVisionDisableOnSelect() {
    game.settings.register(MODULE_ID, SETTING_MAX, {
        name: 'Disable Vision Above N Controlled Tokens',
        hint: 'Turn token vision off while more than N tokens are controlled (0 = never).',
        scope: 'world',
        type: Number,
        default: 5,
        config: false,
        onChange: _applyState
    });

    Hooks.once('ready', () => {
        if (typeof libWrapper === 'undefined') return;
        libWrapper.register(MODULE_ID, 'foundry.canvas.groups.CanvasVisibility.prototype.tokenVision', function (wrapped) {
            if (_shouldDisable()) return false;
            return wrapped();
        }, 'MIXED');
    });

    Hooks.on('controlToken', _applyState);
}
