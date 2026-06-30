/* global game, canvas, PIXI, Hooks, setInterval, clearInterval */

import { isHexGrid, getHexCenter, drawHexAt, getOccupiedOffsets } from "../combat/grid-helpers.js";
import { addGraphicsBelowTokens, destroyGraphics } from "./canvas-helpers.js";

// Live overlay of other clients' interactive tools (target pickers, chooseToken, placement, moves).
// Same colours as the local tool but more transparent, so each client can tell it's a remote ghost.

const CHANNEL = 'module.lancer-automations';
const STALE_MS = 2500;

function enabled() {
    try {
        return !!game.settings.get('lancer-automations', 'displayToolsToOthers');
    } catch {
        return false;
    }
}

function drawCell(g, col, row) {
    if (isHexGrid()) {
        drawHexAt(g, col, row);
    } else {
        const c = getHexCenter(col, row);
        g.drawRect(c.x - canvas.grid.size / 2, c.y - canvas.grid.size / 2, canvas.grid.size, canvas.grid.size);
    }
}

// --- Broadcast (local tool -> other clients) ---
const _lastSig = new Map(); // kind -> signature
const _lastAt = new Map();  // kind -> timestamp

export function broadcastToolPresence(kind, data) {
    if (!enabled() || !canvas.scene)
        return;
    // Related token hidden (e.g. a stealthed unit): reveal nothing to other clients, drop any live ghost once.
    if (data.relatedToken?.document?.hidden) {
        if (_lastSig.has(kind))
            clearToolPresence(kind);
        return;
    }
    const cells = data.cells ?? [];
    const placedCells = data.placedCells ?? [];
    const originCells = data.originCells ?? [];
    const lines = data.lines ?? [];
    // Never reveal a hidden token's highlight to other clients (GM may still target it locally).
    const tokens = (data.tokens ?? []).filter(id => !canvas.tokens.get(id)?.document?.hidden);
    const labels = data.labels ?? [];
    const lineSig = lines.map(l => `${Math.trunc(l.x1)},${Math.trunc(l.y1)},${Math.trunc(l.x2)},${Math.trunc(l.y2)}`).join(';');
    const labelSig = labels.map(l => `${Math.trunc(l.x)},${Math.trunc(l.y)}:${l.text}`).join(';');
    const sig = `${cells.join('|')}#${placedCells.join('|')}#${originCells.join('|')}#${tokens.join(',')}#${lineSig}#${labelSig}`;
    const now = Date.now();
    const lastAt = _lastAt.get(kind) ?? 0;
    // Skip unchanged frames; still re-send every ~1s as a heartbeat.
    if (_lastSig.get(kind) === sig && now - lastAt < 1000)
        return;
    if (now - lastAt < 100)
        return;
    _lastSig.set(kind, sig);
    _lastAt.set(kind, now);
    game.socket.emit(CHANNEL, {
        action: 'toolPresence',
        payload: {
            userId: game.user.id, kind, sceneId: canvas.scene.id, ts: now,
            cells, placedCells, originCells, lines, tokens, labels,
            cellColor: data.cellColor, placedColor: data.placedColor,
            originColor: data.originColor, lineColor: data.lineColor,
        },
    });
}

export function clearToolPresence(kind) {
    _lastSig.delete(kind);
    _lastAt.delete(kind);
    if (!game.user)
        return;
    game.socket.emit(CHANNEL, { action: 'toolPresenceClear', payload: { userId: game.user.id, kind } });
}

// Active sender heartbeats, cleared on scene change so a tool open during teardown can't leak its interval.
const _activeBeats = new Set();
// Re-emit a tool's presence every ~1.2s so its ghost survives idle (cursor not moving). Returns a stop fn.
export function startToolHeartbeat(kind, getData) {
    const beat = setInterval(() => {
        try {
            const data = getData();
            if (data)
                broadcastToolPresence(kind, data);
        } catch { /* canvas torn down or tool disposed */ }
    }, 1200);
    _activeBeats.add(beat);
    return () => {
        clearInterval(beat);
        _activeBeats.delete(beat);
    };
}

// --- Remote render (other clients -> me) ---
const _ghosts = new Map(); // `${userId}|${kind}` -> { container, ts }

const ghostKey = (userId, kind) => `${userId}|${kind}`;

export function onRemotePresence(payload) {
    if (!enabled() || !payload || payload.userId === game.user.id)
        return;
    if (payload.sceneId !== canvas.scene?.id)
        return;
    const key = ghostKey(payload.userId, payload.kind);
    const prev = _ghosts.get(key);
    if (prev)
        destroyGraphics(prev.container);

    const container = new PIXI.Container();
    const g = new PIXI.Graphics();
    // Trace origin footprints: mirror the local origin colour (yellow by default), more transparent.
    const originColor = payload.originColor ?? 0xffff00;
    g.lineStyle(2, originColor, 0.45);
    g.beginFill(originColor, 0.08);
    for (const ckey of payload.originCells ?? []) {
        const [col, row] = ckey.split(',').map(Number);
        drawCell(g, col, row);
    }
    g.endFill();
    // Placed/confirmed shapes: mirror the local placed colour (yellow by default), more transparent.
    const placedColor = payload.placedColor ?? 0xffd84a;
    g.lineStyle(2, placedColor, 0.5);
    g.beginFill(placedColor, 0.1);
    for (const ckey of payload.placedCells ?? []) {
        const [col, row] = ckey.split(',').map(Number);
        drawCell(g, col, row);
    }
    g.endFill();
    // Live cursor preview: mirror the local cursor colour (blue by default), more transparent.
    const cellColor = payload.cellColor ?? 0x0088ff;
    g.lineStyle(2, cellColor, 0.4);
    g.beginFill(cellColor, 0.06);
    for (const ckey of payload.cells ?? []) {
        const [col, row] = ckey.split(',').map(Number);
        drawCell(g, col, row);
    }
    g.endFill();
    // Highlighted tokens: same cyan as the local highlight, more transparent.
    g.lineStyle(3, 0x00ffff, 0.45);
    g.beginFill(0x00ffff, 0.07);
    for (const id of payload.tokens ?? []) {
        const t = canvas.tokens.get(id);
        if (t)
            for (const o of getOccupiedOffsets(t))
                drawCell(g, o.col, o.row);
    }
    g.endFill();
    // Trace lines (origin -> chosen destination); drawn last so no fill bleeds in.
    const lineColor = payload.lineColor ?? 0xffffff;
    g.lineStyle(3, lineColor, 0.5);
    for (const ln of payload.lines ?? []) {
        g.moveTo(ln.x1, ln.y1);
        g.lineTo(ln.x2, ln.y2);
    }
    container.addChild(g);
    // Elevation labels (band / per-cell), white, semi-transparent.
    for (const l of payload.labels ?? []) {
        const txt = new PIXI.Text(l.text, {
            fontFamily: 'Arial',
            fontSize: Math.max(12, canvas.grid.size * 0.18),
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 3,
            fontWeight: 'bold',
            align: 'center',
        });
        txt.anchor.set(0.5);
        txt.position.set(l.x, l.y);
        txt.alpha = 0.75;
        container.addChild(txt);
    }
    addGraphicsBelowTokens(container);
    _ghosts.set(key, { container, ts: payload.ts ?? Date.now() });
}

export function onRemotePresenceClear(payload) {
    if (!payload)
        return;
    for (const [key, entry] of _ghosts) {
        if (!key.startsWith(`${payload.userId}|`))
            continue;
        if (payload.kind && key !== ghostKey(payload.userId, payload.kind))
            continue;
        destroyGraphics(entry.container);
        _ghosts.delete(key);
    }
}

function clearAllGhosts() {
    for (const entry of _ghosts.values())
        destroyGraphics(entry.container);
    _ghosts.clear();
}

// Purge stale ghosts (missed clear / crashed client) + on scene change.
Hooks.once('ready', () => {
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of _ghosts) {
            if (now - entry.ts > STALE_MS) {
                destroyGraphics(entry.container);
                _ghosts.delete(key);
            }
        }
    }, 1000);
});
Hooks.on('canvasTearDown', () => {
    clearAllGhosts();
    for (const beat of _activeBeats)
        clearInterval(beat);
    _activeBeats.clear();
});
// Drop a user's ghosts the moment they disconnect (covers a missed clear).
Hooks.on('userConnected', (user, connected) => {
    if (!connected)
        onRemotePresenceClear({ userId: user.id });
});
