/* global game, canvas, Hooks, requestAnimationFrame */

import { getHexGroundElevation } from '../combat/terrain-utils.js';
import { ISO_SETTINGS, isIsoPerspectiveFeatureEnabled, ISO_PERSPECTIVE_ID } from '../setup/iso-settings.js';

const ISO_MODULE_ID = ISO_PERSPECTIVE_ID;

function _isoActive(scene) {
    const mod = game.modules.get(ISO_MODULE_ID);
    if (!mod?.active)
        return false;
    try {
        if (!game.settings.get(ISO_MODULE_ID, 'worldIsometricFlag'))
            return false;
    } catch {
        return false;
    }
    return !!(scene ?? canvas.scene)?.getFlag(ISO_MODULE_ID, 'isometricEnabled');
}

function _thtGroundAt(x, y) {
    if (!globalThis.terrainHeightTools)
        return 0;
    try {
        const offset = canvas.grid.getOffset({ x, y });
        return getHexGroundElevation(offset.j, offset.i) || 0;
    } catch {
        return 0;
    }
}

function _isoElevationDelta(elevation) {
    const scale = canvas.scene.grid.size / canvas.scene.grid.distance;
    const d = elevation * scale;
    return { x: d, y: -d };
}

// Per-token eased terrain offset so elevation ramps instead of snapping cell-to-cell.
const _smoothBump = new WeakMap();
const BUMP_EASE = 0.22;

// Debug accumulator. `globalThis._laIsoDebugOn = true` to record, `globalThis._laIsoDebug = null`
// to clear before a move, then drag the token and inspect `globalThis._laIsoDebug[<tokenId>]`.
function _laIsoDebug(token, frame) {
    const _g = /** @type {any} */ (globalThis);
    if (!_g._laIsoDebugOn) return;
    const id = token.document?.id;
    if (!id) return;
    _g._laIsoDebug = _g._laIsoDebug ?? {};
    let buf = _g._laIsoDebug[id];
    if (!buf) {
        buf = { tokenName: token.document?.name, tokenId: id, autoClimbOn: null, frames: [] };
        try { buf.autoClimbOn = !!game.settings.get('lancer-automations', 'enableClimbWaypoints'); } catch { /* ignore */ }
        _g._laIsoDebug[id] = buf;
    }
    buf.frames.push(frame);
}

Hooks.on('refreshToken', (token) => {
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
    try {
        if (!game.settings.get(ISO_MODULE_ID, 'enableHeightAdjustment'))
            return;
    } catch {
        return;
    }

    // Cancel iso-perspective's terrain contribution; rebuild it per-cell during a move so
    // the flying portion of doc.elevation stays visible.
    const doc = token.document;
    const mv = doc.movement;
    const w = token.w, h = token.h;
    const animGround = _thtGroundAt(doc.x + w / 2, doc.y + h / 2);
    const elev = doc.elevation ?? 0;
    const isMoving = !!mv && (
        mv.origin.x !== mv.destination.x
        || mv.origin.y !== mv.destination.y
        || (mv.origin.elevation ?? 0) !== (mv.destination.elevation ?? 0)
    );
    let target;
    let _dbgStartGround, _dbgDestGround, _dbgInterp, _dbgDElev, _dbgT, _dbgElevClimbed, _dbgClimbing;
    if (isMoving) {
        const startGround = _thtGroundAt(mv.origin.x + w / 2, mv.origin.y + h / 2);
        const destGround = _thtGroundAt(mv.destination.x + w / 2, mv.destination.y + h / 2);
        _dbgStartGround = startGround; _dbgDestGround = destGround;
        let interpolatedTerrain;
        if (startGround === destGround) {
            interpolatedTerrain = startGround;
        } else {
            // t derived from doc.elev so flying ramps naturally across the move.
            const dElev = (mv.destination.elevation ?? 0) - (mv.origin.elevation ?? 0);
            const t = dElev !== 0 ? (elev - (mv.origin.elevation ?? 0)) / dElev : 0;
            _dbgDElev = dElev; _dbgT = t;
            interpolatedTerrain = startGround + (destGround - startGround) * t;
        }
        _dbgInterp = interpolatedTerrain;
        _dbgElevClimbed = elev - (mv.origin.elevation ?? 0);
        target = animGround - elev;
    } else {
        target = animGround - elev;
    }

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
        t: _dbgT,
        interpolatedTerrain: _dbgInterp,
        docPos: { x: doc.x, y: doc.y },
        mvOrigin: mv ? { x: mv.origin.x, y: mv.origin.y, elevation: mv.origin.elevation } : null,
        mvDest: mv ? { x: mv.destination.x, y: mv.destination.y, elevation: mv.destination.elevation } : null,
        passedCount: mv?.passed?.waypoints?.length ?? 0,
        pendingCount: mv?.pending?.waypoints?.length ?? 0
    });

    let st = _smoothBump.get(token);
    if (!st) {
        st = { value: target, raf: null }; _smoothBump.set(token, st);
    }
    st.value += (target - st.value) * BUMP_EASE;
    if (Math.abs(st.value - target) < 0.02)
        st.value = target;

    if (st.value !== 0) {
        const delta = _isoElevationDelta(st.value);
        token.mesh.position.x += delta.x;
        token.mesh.position.y += delta.y;
    }

    // The move stops firing refreshes, so nudge one more frame until the offset finishes easing.
    if (st.value !== target && st.raf == null) {
        st.raf = requestAnimationFrame(() => {
            st.raf = null;
            if (!token.destroyed)
                token.renderFlags.set({ refreshPosition: true });
        });
    }
});

// iso resets mesh.anchor to (0.5, 0.5) on non-iso scenes, so put the doc's own anchor back.
// updateToken with no movement-fields (eg movementAction-only) sets no renderFlags -> refreshToken
// never fires, so the standalone refresh hook isn't enough.
Hooks.once('ready', () => {
    const mod = game.modules.get(ISO_MODULE_ID);
    if (!mod?.active)
        return;
    const restore = (token) => {
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
Hooks.on('createSequencerEffect', (effect) => {
    if (!game.modules.get(ISO_MODULE_ID)?.active)
        return;
    if (_isoActive(canvas.scene))
        return;
    const ticker = () => {
        const ic = effect?.isometricContainer;
        if (!ic)
            return;
        if (ic.skew.x !== 0 || ic.skew.y !== 0)
            ic.skew.set(0, 0);
        if (ic.scale.x !== 1 || ic.scale.y !== 1)
            ic.scale.set(1, 1);
    };
    PIXI.Ticker.shared.add(ticker);
    Hooks.once('endedSequencerEffect', (e) => {
        if (e === effect)
            PIXI.Ticker.shared.remove(ticker);
    });
});
