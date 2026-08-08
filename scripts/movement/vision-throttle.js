/* global game, Hooks, libWrapper, performance */

const MODULE_ID = 'lancer-automations';
const SETTING_FPS = 'visionAnimationThrottleFps';
const SKIP_FLAG = Symbol('laVisionThrottleSkip');

const lastVisionRefresh = new Map();
const trailingTimers = new Map();

function _clearTrailing(id)
{
    const timer = trailingTimers.get(id);
    if (timer !== undefined)
    {
        globalThis.clearTimeout(timer);
        trailingTimers.delete(id);
    }
}

// The last animation frame is often inside the throttle window and gets skipped, leaving vision
// frozen at the pre-move state. Schedule a trailing refresh that fires once movement settles.
function _scheduleTrailing(token, delayMs)
{
    const id = token.document?.id;
    if (!id)
        return;
    _clearTrailing(id);
    const timer = globalThis.setTimeout(() =>
    {
        trailingTimers.delete(id);
        if (token.destroyed)
            return;
        token.initializeSources();
        globalThis.canvas?.perception?.update({ refreshVision: true, refreshOcclusion: true });
    }, delayMs);
    trailingTimers.set(id, timer);
}

Hooks.once('init', () =>
{
    game.settings.register(MODULE_ID, SETTING_FPS, {
        name: 'Vision Animation Throttle (FPS)',
        hint: 'Cap vision/light refresh rate during token movement (0 = vanilla).',
        scope: 'world',
        type: Number,
        default: 0,
        config: false
    });
});

Hooks.once('ready', () =>
{
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._onAnimationUpdate', function(wrapped, changed, context)
    {
        const fps = Number(game.settings.get(MODULE_ID, SETTING_FPS)) || 0;
        if (fps <= 0)
            return wrapped.call(this, changed, context);
        if (!game.settings.get('core', 'visionAnimation'))
            return wrapped.call(this, changed, context);

        const throttleMs = 1000 / fps;
        const now = performance.now();
        const last = lastVisionRefresh.get(this.document.id) ?? 0;

        if ((now - last) >= throttleMs)
        {
            lastVisionRefresh.set(this.document.id, now);
            _clearTrailing(this.document.id);
            return wrapped.call(this, changed, context);
        }

        this[SKIP_FLAG] = true;
        try
        {
            const result = wrapped.call(this, changed, context);
            _scheduleTrailing(this, throttleMs * 1.5);
            return result;
        }
        finally
        {
            this[SKIP_FLAG] = false;
        }
    }, 'WRAPPER');

    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype.initializeSources', function(wrapped, ...args)
    {
        if (this[SKIP_FLAG])
            return;
        return wrapped.apply(this, args);
    }, 'MIXED');
});

Hooks.on('destroyToken', token =>
{
    const id = token.document?.id;
    lastVisionRefresh.delete(id);
    _clearTrailing(id);
});
