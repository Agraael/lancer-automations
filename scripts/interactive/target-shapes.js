/* global canvas, PIXI, game, Hooks, performance */

import { isHexGrid, drawHexAt, getOccupiedOffsets } from "../combat/grid-helpers.js";
import { gridLineWidth } from "./canvas-helpers.js";

// Yellow pulsing footprint per game.user.target, minus tokens under a placed AoE shape.
// Live only during a targeting session (HUD/picker); reconciled on every target change.

let _persistG = null;              // Container above tokens
const _persistShapes = new Map();  // tokenId -> Graphics
let _persistPulse = null;          // alpha ticker
let _sessionActive = false;
let _coveredCells = new Set();      // "col,row" cells under placed AoE shape(s)

function ensureContainer() {
    if (_persistG)
        return;
    _persistG = new PIXI.Container();
    canvas.stage.addChild(_persistG); // above tokens
    _persistPulse = () => {
        // detach if torn down (scene change), don't write to a dead object
        if (!_persistG || _persistG.destroyed) {
            canvas.app.ticker.remove(_persistPulse);
            _persistPulse = null;
            _persistG = null;
            _persistShapes.clear();
            return;
        }
        _persistG.alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
    };
    canvas.app.ticker.add(_persistPulse);
}

function drawShape(token) {
    const g = new PIXI.Graphics();
    g.lineStyle(gridLineWidth(4), 0xffd84a, 0.85);
    g.beginFill(0xffd84a, 0.22);
    if (isHexGrid()) {
        for (const o of getOccupiedOffsets(token))
            drawHexAt(g, o.col, o.row);
    } else {
        g.drawRect(token.document.x, token.document.y, token.document.width * canvas.grid.size, token.document.height * canvas.grid.size);
    }
    g.endFill();
    return g;
}

function removeShape(tokenId) {
    const g = _persistShapes.get(tokenId);
    if (!g)
        return;
    if (g.parent)
        g.parent.removeChild(g);
    g.destroy();
    _persistShapes.delete(tokenId);
}

// A token is "covered" when any of its cells sits under a placed AoE shape.
function isCovered(token) {
    if (!_coveredCells.size)
        return false;
    return getOccupiedOffsets(token).some(o => _coveredCells.has(`${o.col},${o.row}`));
}

// Reconcile shapes against current targets (minus AoE-covered). No-op (and clears) outside a session.
export function syncTargetShapes() {
    if (!_sessionActive) {
        clearSingleTargetShape();
        return;
    }
    const wanted = new Set();
    for (const t of game.user?.targets ?? []) {
        if (!t || isCovered(t))
            continue;
        wanted.add(t.id);
        if (!_persistShapes.has(t.id)) {
            ensureContainer();
            const g = drawShape(t);
            _persistG.addChild(g);
            _persistShapes.set(t.id, g);
        }
    }
    for (const id of [..._persistShapes.keys()]) {
        if (!wanted.has(id))
            removeShape(id);
    }
}

// Start a targeting session and show shapes for the current targets.
export function beginTargetSession() {
    _sessionActive = true;
    syncTargetShapes();
}

// End the session: drop all single shapes + pulse + AoE coverage.
export function clearSingleTargetShape() {
    _sessionActive = false;
    _coveredCells = new Set();
    if (_persistPulse) {
        canvas.app.ticker.remove(_persistPulse);
        _persistPulse = null;
    }
    if (_persistG) {
        if (_persistG.parent)
            _persistG.parent.removeChild(_persistG);
        _persistG.destroy({ children: true });
        _persistG = null;
    }
    _persistShapes.clear();
}

// Area picker reports the cells under its placed shape(s); covered targets lose their single shape.
export function setAreaCoveredCells(cells) {
    _coveredCells = new Set(cells ?? []);
    syncTargetShapes();
}

// Any target change (picker, manual, AoE catch, post-roll clear) re-reconciles while in session.
Hooks.on('targetToken', (user) => {
    if (user?.id !== game.userId)
        return;
    if (_sessionActive)
        syncTargetShapes();
});
