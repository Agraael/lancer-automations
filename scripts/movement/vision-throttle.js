/* global game, Hooks, libWrapper, performance */

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
const SETTING_FPS = 'visionAnimationThrottleFps';
const SETTING_DRAG_FPS = 'dragVisionRefreshFps';
const SKIP_FLAG = Symbol('laVisionThrottleSkip');

const DRAG_GATED_FLAGS = ['initializeLighting', 'initializeLightSources', 'initializeDarknessSources', 'refreshLighting', 'refreshLightSources',
    'initializeVisionModes', 'initializeVision', 'refreshVision', 'refreshVisionSources'];

const lastVisionRefresh = new Map();
const trailingTimers = new Map();
let lastDragRefresh = 0;
let deferredDragFlags = null;
let dragTrailingTimer = null;

export function dragRefreshMs()
{
    const fps = Number(getModuleSetting(SETTING_DRAG_FPS)) || 0;
    return fps > 0 ? 1000 / fps : 0;
}

function _isDragging()
{
    return (globalThis.canvas?.tokens?.preview?.children?.length ?? 0) > 0;
}

function _withDeferredDragFlags(flags)
{
    if (!deferredDragFlags)
        return flags;

    const merged = { ...flags };
    for (const flag of Object.keys(deferredDragFlags))
        merged[flag] = true;
    deferredDragFlags = null;

    if (dragTrailingTimer !== null)
    {
        globalThis.clearTimeout(dragTrailingTimer);
        dragTrailingTimer = null;
    }

    return merged;
}

function _gateDragFlags(flags)
{
    const throttleMs = dragRefreshMs();
    if (!flags || throttleMs <= 0 || !_isDragging())
        return _withDeferredDragFlags(flags);

    const gated = DRAG_GATED_FLAGS.filter(flag => flags[flag]);
    if (!gated.length)
        return flags;

    const now = performance.now();
    const elapsed = now - lastDragRefresh;

    if (elapsed >= throttleMs)
    {
        lastDragRefresh = now;
        return _withDeferredDragFlags(flags);
    }

    const passed = { ...flags };
    deferredDragFlags ??= {};

    for (const flag of gated)
    {
        deferredDragFlags[flag] = true;
        delete passed[flag];
    }

    if (dragTrailingTimer === null)
    {
        dragTrailingTimer = globalThis.setTimeout(() =>
        {
            dragTrailingTimer = null;
            const pending = deferredDragFlags;
            deferredDragFlags = null;
            if (pending)
                globalThis.canvas?.perception?.update(pending);
        }, throttleMs - elapsed + 1);
    }

    return passed;
}

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
function _scheduleTrailing(token, delayMs, perception)
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
        globalThis.canvas?.perception?.update(perception);
    }, delayMs);

    trailingTimers.set(id, timer);
}

Hooks.once('init', () =>
{
    game.settings.register(MODULE_ID, SETTING_FPS, {
        name: 'LA.settings.visionAnimationThrottleFps.name',
        hint: 'LA.settings.visionAnimationThrottleFps.hint',
        scope: 'world',
        type: Number,
        default: 30,
        config: false
    });
    game.settings.register(MODULE_ID, SETTING_DRAG_FPS, {
        name: 'LA.settings.dragVisionRefreshFps.name',
        hint: 'LA.settings.dragVisionRefreshFps.hint',
        scope: 'client',
        type: Number,
        default: 30,
        config: false
    });
});

Hooks.once('ready', () =>
{
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._onAnimationUpdate', function(wrapped, changed, context)
    {
        const fps = Number(getModuleSetting(SETTING_FPS)) || 0;
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
            _scheduleTrailing(this, throttleMs * 1.5, { refreshVision: true, refreshOcclusion: true });
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

        // The drag preview refreshes on every cell change, outside the animation path above.
        if (this.isPreview && !args[0]?.deleted)
        {
            const fps = Number(getModuleSetting(SETTING_FPS)) || 0;

            if (fps > 0)
            {
                const throttleMs = 1000 / fps;
                const id = this.document.id;
                const now = performance.now();
                const elapsed = now - (lastVisionRefresh.get(id) ?? 0);

                if (elapsed < throttleMs)
                {
                    _scheduleTrailing(this, throttleMs - elapsed + 1, { refreshLighting: true, refreshVision: true });
                    return;
                }

                lastVisionRefresh.set(id, now);
                _clearTrailing(id);
            }
        }

        return wrapped.apply(this, args);
    }, 'MIXED');

    libWrapper.register(MODULE_ID, 'foundry.canvas.perception.PerceptionManager.prototype.update', function(wrapped, flags)
    {
        return wrapped.call(this, _gateDragFlags(flags));
    }, 'WRAPPER');
});

Hooks.on('destroyToken', token =>
{
    const id = token.document?.id;
    lastVisionRefresh.delete(id);
    _clearTrailing(id);
});
