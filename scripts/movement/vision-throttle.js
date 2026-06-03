/* global game, Hooks, libWrapper, performance */

const MODULE_ID = 'lancer-automations';
const SETTING_FPS = 'visionAnimationThrottleFps';
const SKIP_FLAG = Symbol('laVisionThrottleSkip');

const lastVisionRefresh = new Map();

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, SETTING_FPS, {
        name: 'Vision Animation Throttle (FPS)',
        hint: 'Cap vision/light refresh rate during token movement (0 = vanilla).',
        scope: 'world',
        type: Number,
        default: 0,
        config: false
    });
});

Hooks.once('ready', () => {
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._onAnimationUpdate', function(wrapped, changed, context) {
        const fps = Number(game.settings.get(MODULE_ID, SETTING_FPS)) || 0;
        if (fps <= 0) return wrapped.call(this, changed, context);
        if (!game.settings.get('core', 'visionAnimation')) return wrapped.call(this, changed, context);

        const throttleMs = 1000 / fps;
        const now = performance.now();
        const last = lastVisionRefresh.get(this.document.id) ?? 0;

        if ((now - last) >= throttleMs) {
            lastVisionRefresh.set(this.document.id, now);
            return wrapped.call(this, changed, context);
        }

        this[SKIP_FLAG] = true;
        try {
            return wrapped.call(this, changed, context);
        } finally {
            this[SKIP_FLAG] = false;
        }
    }, 'WRAPPER');

    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype.initializeSources', function(wrapped, ...args) {
        if (this[SKIP_FLAG]) return;
        return wrapped.apply(this, args);
    }, 'MIXED');
});

Hooks.on('destroyToken', token => {
    lastVisionRefresh.delete(token.document?.id);
});
