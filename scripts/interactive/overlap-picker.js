/* global canvas, game, Hooks, libWrapper */

import { showOverlapStackPicker } from './canvas.js';

const MODULE_ID = 'lancer-automations';

function overlappingTokens(token) {
    const x = token.document.x;
    const y = token.document.y;
    const w = token.document.width;
    const h = token.document.height;
    const out = [];
    for (const t of canvas.tokens.placeables) {
        if (!t.document) continue;
        if (t.document.x !== x || t.document.y !== y) continue;
        if (t.document.width !== w || t.document.height !== h) continue;
        if (!t.visible) continue;
        out.push(t);
    }
    return out;
}

Hooks.once('init', () => {
    if (typeof libWrapper === 'undefined') return;
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._onClickLeft', function(wrapped, event) {
        if (game.activeTool === 'target') return wrapped(event);
        let enabled = false;
        try { enabled = !!game.settings.get(MODULE_ID, 'overlapTokenPicker'); } catch { enabled = false; }
        if (!enabled) return wrapped(event);
        const stack = overlappingTokens(this);
        if (stack.length <= 1) return wrapped(event);
        const result = wrapped(event);
        const shift = !!event.shiftKey;
        const oe = event?.data?.originalEvent;
        const startX = oe?.clientX ?? 0;
        const startY = oe?.clientY ?? 0;
        const closePicker = showOverlapStackPicker(stack, startX + 10, startY + 10, {
            isSelected: (t) => t.controlled,
            onPick: (t) => t.control({ releaseOthers: !shift })
        });
        const cleanup = () => {
            globalThis.removeEventListener('pointermove', moveHandler, true);
            globalThis.removeEventListener('pointerup', upHandler, true);
        };
        const moveHandler = (e) => {
            const dx = (e.clientX ?? 0) - startX;
            const dy = (e.clientY ?? 0) - startY;
            if (Math.hypot(dx, dy) > 6) {
                closePicker();
                cleanup();
            }
        };
        const upHandler = () => cleanup();
        globalThis.addEventListener('pointermove', moveHandler, true);
        globalThis.addEventListener('pointerup', upHandler, true);
        return result;
    }, 'MIXED');
});
