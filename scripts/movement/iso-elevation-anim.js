/* global game, canvas, Hooks, requestAnimationFrame */

import { ISO_SETTINGS, isIsoPerspectiveFeatureEnabled, ISO_PERSPECTIVE_ID } from '../setup/iso-settings.js';

const ISO_MODULE_ID = ISO_PERSPECTIVE_ID;

function _isoActive(scene)
{
    const mod = game.modules.get(ISO_MODULE_ID);
    if (!mod?.active)
        return false;
    try
    {
        if (!game.settings.get(ISO_MODULE_ID, 'worldIsometricFlag'))
            return false;
    }
    catch
    {
        return false;
    }
    return !!(scene ?? canvas.scene)?.getFlag(ISO_MODULE_ID, 'isometricEnabled');
}

import { thtGroundAt as _thtGroundAt } from './movement-utils.js';

function _isoElevationDelta(elevation)
{
    const scale = canvas.scene.grid.size / canvas.scene.grid.distance;
    const delta = elevation * scale;
    return { x: delta, y: -delta };
}

// Per-token eased terrain offset so elevation ramps instead of snapping cell-to-cell.
const _smoothBump = new WeakMap();
const BUMP_EASE = 0.22;

// Debug accumulator. `globalThis._laIsoDebugOn = true` to record, `globalThis._laIsoDebug = null`
// to clear before a move, then drag the token and inspect `globalThis._laIsoDebug[<tokenId>]`.
function _laIsoDebug(token, frame)
{
    const debugGlobals = /** @type {any} */ (globalThis);
    if (!debugGlobals._laIsoDebugOn)
        return;
    const id = token.document?.id;
    if (!id)
        return;
    debugGlobals._laIsoDebug = debugGlobals._laIsoDebug ?? {};
    let buf = debugGlobals._laIsoDebug[id];
    if (!buf)
    {
        buf = { tokenName: token.document?.name, tokenId: id, autoClimbOn: null, frames: [] };
        try
        {
            buf.autoClimbOn = !!game.settings.get('lancer-automations', 'enableClimbWaypoints');
        }
        catch
        { /* ignore */ }
        debugGlobals._laIsoDebug[id] = buf;
    }
    buf.frames.push(frame);
}

Hooks.on('refreshToken', (token) =>
{
    if (!isIsoPerspectiveFeatureEnabled(ISO_SETTINGS.elevationAnimation))
        return;
    if (!_isoActive(token.scene))
        return;
    if (!token.mesh)
        return;
    if (token.isPreview)
        return; // drag-preview clone: leave it at its own elevation, no bump
    if (token.document?.getFlag(ISO_MODULE_ID, 'isoTokenDisabled'))
        return;
    try
    {
        if (!game.settings.get(ISO_MODULE_ID, 'enableHeightAdjustment'))
            return;
    }
    catch
    {
        return;
    }

    // Cancel iso-perspective's terrain contribution; rebuild it per-cell during a move so
    // the flying portion of doc.elevation stays visible.
    const doc = token.document;
    const movement = doc.movement;
    const width = token.w, height = token.h;
    const animGround = _thtGroundAt({ x: doc.x + width / 2, y: doc.y + height / 2 });
    const elev = doc.elevation ?? 0;
    const isMoving = !!movement && (
        movement.origin.x !== movement.destination.x
        || movement.origin.y !== movement.destination.y
        || (movement.origin.elevation ?? 0) !== (movement.destination.elevation ?? 0)
    );
    let target;
    let _dbgStartGround, _dbgDestGround, _dbgInterpolatedTerrain, _dbgDElev, _dbgLerpT, _dbgElevClimbed, _dbgClimbing;
    if (isMoving)
    {
        const startGround = _thtGroundAt({ x: movement.origin.x + width / 2, y: movement.origin.y + height / 2 });
        const destGround = _thtGroundAt({ x: movement.destination.x + width / 2, y: movement.destination.y + height / 2 });
        _dbgStartGround = startGround; _dbgDestGround = destGround;
        let interpolatedTerrain;
        if (startGround === destGround)
            interpolatedTerrain = startGround;
        else
        {
            // lerpT derived from doc.elev so flying ramps naturally across the move.
            const dElev = (movement.destination.elevation ?? 0) - (movement.origin.elevation ?? 0);
            const lerpT = dElev !== 0 ? (elev - (movement.origin.elevation ?? 0)) / dElev : 0;
            _dbgDElev = dElev; _dbgLerpT = lerpT;
            interpolatedTerrain = startGround + (destGround - startGround) * lerpT;
        }
        _dbgInterpolatedTerrain = interpolatedTerrain;
        _dbgElevClimbed = elev - (movement.origin.elevation ?? 0);
        target = animGround - elev;
    }
    else
        target = animGround - elev;

    if (globalThis._laIsoDebugOn)
    {
        _laIsoDebug(token, {
            ts: Date.now(),
            isMoving,
            elev,
            animGround,
            target,
            climbing: _dbgClimbing,
            elevDelta: _dbgElevClimbed,
            startGround: _dbgStartGround,
            destGround: _dbgDestGround,
            dElev: _dbgDElev,
            t: _dbgLerpT,
            interpolatedTerrain: _dbgInterpolatedTerrain,
            docPos: { x: doc.x, y: doc.y },
            mvOrigin: movement ? { x: movement.origin.x, y: movement.origin.y, elevation: movement.origin.elevation } : null,
            mvDest: movement ? { x: movement.destination.x, y: movement.destination.y, elevation: movement.destination.elevation } : null,
            passedCount: movement?.passed?.waypoints?.length ?? 0,
            pendingCount: movement?.pending?.waypoints?.length ?? 0
        });
    }

    let bumpState = _smoothBump.get(token);
    if (!bumpState)
    {
        bumpState = { value: target, raf: null }; _smoothBump.set(token, bumpState);
    }
    bumpState.value += (target - bumpState.value) * BUMP_EASE;
    if (Math.abs(bumpState.value - target) < 0.02)
        bumpState.value = target;

    if (bumpState.value !== 0)
    {
        const delta = _isoElevationDelta(bumpState.value);
        token.mesh.position.x += delta.x;
        token.mesh.position.y += delta.y;
    }

    // The move stops firing refreshes, so nudge one more frame until the offset finishes easing.
    if (bumpState.value !== target && bumpState.raf == null)
    {
        bumpState.raf = requestAnimationFrame(() =>
        {
            bumpState.raf = null;
            if (!token.destroyed)
                token.renderFlags.set({ refreshPosition: true });
        });
    }
});

// iso resets mesh.anchor to (0.5, 0.5) on non-iso scenes, so put the doc's own anchor back.
// updateToken with no movement-fields (eg movementAction-only) sets no renderFlags -> refreshToken
// never fires, so the standalone refresh hook isn't enough.
Hooks.once('ready', () =>
{
    const mod = game.modules.get(ISO_MODULE_ID);
    if (!mod?.active)
        return;
    const restore = (token) =>
    {
        if (!isIsoPerspectiveFeatureEnabled(ISO_SETTINGS.restoreAnchor))
            return;
        if (!token?.mesh)
            return;
        const sceneIso = _isoActive(token.scene);
        const tokenDisabled = !!token.document?.getFlag(ISO_MODULE_ID, 'isoTokenDisabled');
        if (sceneIso && !tokenDisabled)
            return;
        const ax = token.document?.texture?.anchorX ?? 0.5;
        const ay = token.document?.texture?.anchorY ?? 0.5;
        if (token.mesh.anchor.x !== ax || token.mesh.anchor.y !== ay)
            token.mesh.anchor.set(ax, ay);
    };
    Hooks.on('refreshToken', restore);
    Hooks.on('updateToken', (doc) => restore(doc.object));
});

// Sequencer's iso plugin re-skews isometricContainer every tick. Clamp it back per-frame.
Hooks.on('createSequencerEffect', (effect) =>
{
    if (!game.modules.get(ISO_MODULE_ID)?.active)
        return;
    if (_isoActive(canvas.scene))
        return;
    const ticker = () =>
    {
        const isoContainer = effect?.isometricContainer;
        if (!isoContainer || isoContainer.destroyed || !isoContainer.transform)
        {
            PIXI.Ticker.shared.remove(ticker);
            return;
        }
        if (isoContainer.skew.x !== 0 || isoContainer.skew.y !== 0)
            isoContainer.skew.set(0, 0);
        if (isoContainer.scale.x !== 1 || isoContainer.scale.y !== 1)
            isoContainer.scale.set(1, 1);
    };
    PIXI.Ticker.shared.add(ticker);
    const onEnded = (endedEffect) =>
    {
        if (endedEffect !== effect)
            return;
        PIXI.Ticker.shared.remove(ticker);
        Hooks.off('endedSequencerEffect', endedId);
    };
    const endedId = Hooks.on('endedSequencerEffect', onEnded);
});
