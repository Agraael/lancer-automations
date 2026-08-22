/* global canvas, PIXI, game, Hooks, performance */

import { getOccupiedOffsets } from "../combat/grid-helpers.js";
import { makeHitLabel, hitLabelAnchor, gridTextResolution, applyTargetInfoLabel, TG, paintDashedFootprint } from "./canvas-helpers.js";
import { getIsoProvider } from "../setup/iso-settings.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "./presence.js";
import { setMeasureDistanceReference } from "../movement/tactical-distance.js";

let _persistG = null;              // Container above tokens (pulsing marks)
let _labelG = null;                // Container above tokens (steady hit-% labels)
const _persistShapes = new Map();  // tokenId -> Graphics
const _persistLabels = new Map();  // tokenId -> Text
let _persistPulse = null;          // alpha ticker
let _sessionActive = false;
let _hitChanceFor = null;           // (token) => { hit, crit } | null
let _distanceRef = null;            // caster token driving tactical-distance labels this session
let _presenceStop = null;           // stop fn for the ghost-broadcast heartbeat
const _customMarks = new Map();     // markId -> { token, graphic, color } - session-independent follow-marks
const _chanceLabels = new Map();    // labelId -> { token, fn, label } - session-independent live % labels
let _nextMarkId = 1;
let _customPresenceStop = null;

// Footprint cells of the tokens that carry a gold single-shape, for the remote ghost.
// Hidden targets are never broadcast (would reveal their position to players).
function presenceData()
{
    const placedCells = [];
    for (const token of game.user?.targets ?? [])
    {
        if (!token || token.document?.hidden)
            continue;
        for (const offset of getOccupiedOffsets(token))
            placedCells.push(`${offset.col},${offset.row}`);
    }
    return { placedCells, placedColor: TG.placed };
}

function ensureContainer()
{
    if (_persistG)
        return;
    _persistG = new PIXI.Container();
    canvas.stage.addChild(_persistG).eventMode = 'none'; // above tokens
    _labelG = new PIXI.Container();
    canvas.stage.addChild(_labelG).eventMode = 'none';
    _persistPulse = () =>
    {
        // detach if torn down (scene change), don't write to a dead object
        if (!_persistG || _persistG.destroyed)
        {
            canvas.app.ticker.remove(_persistPulse);
            _persistPulse = null;
            _persistG = null;
            _labelG = null;
            _persistShapes.clear();
            _persistLabels.clear();
            _customMarks.clear();
            _chanceLabels.clear();
            if (_customPresenceStop)
            {
                _customPresenceStop();
                _customPresenceStop = null;
            }
            return;
        }
        _persistG.alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
        for (const [id, markGraphic] of _persistShapes)
        {
            const token = canvas.tokens.get(id);
            if (token)
                paintShape(token, markGraphic);
        }
        for (const mark of _customMarks.values())
        {
            if (mark.graphic && !mark.graphic.destroyed)
                paintShape(mark.token, mark.graphic, mark.color);
        }
        if (_hitChanceFor)
        {
            for (const [id, label] of _persistLabels)
            {
                const token = canvas.tokens.get(id);
                if (token)
                    updateLabel(token, label);
            }
        }
        for (const entry of _chanceLabels.values())
        {
            if (entry.label && !entry.label.destroyed)
                updateChanceLabel(entry);
        }
    };
    canvas.app.ticker.add(_persistPulse);
}

// repaint at the token's current cells each tick so the mark follows it
function paintShape(token, markGraphic, color = TG.placed)
{
    markGraphic.clear();
    if (!token?.document || token.destroyed)
        return;
    const cells = getOccupiedOffsets(token).map(offset => [offset.col, offset.row]);
    paintDashedFootprint(markGraphic, cells, color, { halo: color === TG.reference });
}

function drawShape(token)
{
    const markGraphic = new PIXI.Graphics();
    paintShape(token, markGraphic);
    return markGraphic;
}

// Refresh-time reassert, same recipe as the stat bar and tactical labels.
function applyIsoToLabel(label)
{
    const iso = getIsoProvider();
    if (!iso)
        return;
    label.rotation = iso.reverseRotation;
    label.skew.set(iso.reverseSkewX, iso.reverseSkewY);
    label.scale.set(iso.counterScale, 1 / iso.counterScale);
}

function updateLabel(token, label)
{
    const hitChance = _hitChanceFor?.(token);
    if (!hitChance)
    {
        label.visible = false;
        return;
    }
    applyTargetInfoLabel(label, hitChance);
    label.resolution = gridTextResolution();
    applyIsoToLabel(label);
    const anchor = hitLabelAnchor(token);
    label.position.set(anchor.x, anchor.y);
    label.visible = true;
}

function addLabel(token)
{
    if (!_hitChanceFor)
        return;
    const label = makeHitLabel(_labelG);
    _persistLabels.set(token.id, label);
    updateLabel(token, label);
}

function removeShape(tokenId)
{
    const graphic = _persistShapes.get(tokenId);
    if (!graphic)
        return;
    if (graphic.parent)
        graphic.parent.removeChild(graphic);
    graphic.destroy();
    _persistShapes.delete(tokenId);
}

function removeLabel(tokenId)
{
    const label = _persistLabels.get(tokenId);
    if (!label)
        return;
    if (label.parent)
        label.parent.removeChild(label);
    label.destroy();
    _persistLabels.delete(tokenId);
}

// Reconcile shapes against current targets. No-op (and clears) outside a session.
export function syncTargetShapes()
{
    if (!_sessionActive)
    {
        clearSingleTargetShape();
        return;
    }
    const wantedShapes = new Set();
    const wantedLabels = new Set();
    for (const token of game.user?.targets ?? [])
    {
        if (!token)
            continue;
        // hit-% label: every target rolls to hit, whether or not an AoE shape covers it
        if (_hitChanceFor)
        {
            wantedLabels.add(token.id);
            if (!_persistLabels.has(token.id))
            {
                ensureContainer();
                addLabel(token);
            }
        }
        // gold per-token marker on every target, including tokens caught by a placed AoE shape
        wantedShapes.add(token.id);
        if (!_persistShapes.has(token.id))
        {
            ensureContainer();
            const shape = drawShape(token);
            _persistG.addChild(shape);
            _persistShapes.set(token.id, shape);
        }
    }
    for (const id of [..._persistShapes.keys()])
    {
        if (!wantedShapes.has(id))
            removeShape(id);
    }
    for (const id of [..._persistLabels.keys()])
    {
        if (!wantedLabels.has(id))
            removeLabel(id);
    }
    broadcastToolPresence('targetShapes', presenceData());
}

// True while some HUD/picker owns the shared shape session (lets another HUD defer instead of hijacking it).
export function isTargetSessionActive()
{
    return _sessionActive;
}

// hitChanceFor: optional (token) => { hit, crit } for live hit-% labels per target.
// casterToken: optional; shows tactical-distance labels from it while the session runs.
export function beginTargetSession(hitChanceFor = null, casterToken = null)
{
    _sessionActive = true;
    _hitChanceFor = hitChanceFor;
    if (casterToken && !casterToken.destroyed)
    {
        _distanceRef = casterToken;
        setMeasureDistanceReference(casterToken);
    }
    if (!_presenceStop)
        _presenceStop = startToolHeartbeat('targetShapes', () => _sessionActive ? presenceData() : null);
    syncTargetShapes();
}

function _maybeTeardownContainers()
{
    if (_persistShapes.size || _persistLabels.size || _customMarks.size || _chanceLabels.size)
        return;
    if (_persistPulse)
    {
        canvas.app.ticker.remove(_persistPulse);
        _persistPulse = null;
    }
    if (_persistG)
    {
        if (_persistG.parent)
            _persistG.parent.removeChild(_persistG);
        _persistG.destroy({ children: true });
        _persistG = null;
    }
    if (_labelG)
    {
        if (_labelG.parent)
            _labelG.parent.removeChild(_labelG);
        _labelG.destroy({ children: true });
        _labelG = null;
    }
}

// End the session: drop all single shapes + labels. Session-independent marks stay.
export function clearSingleTargetShape()
{
    _sessionActive = false;
    _hitChanceFor = null;
    if (_distanceRef)
    {
        setMeasureDistanceReference(null);
        _distanceRef = null;
    }
    if (_presenceStop)
    {
        _presenceStop();
        _presenceStop = null;
    }
    clearToolPresence('targetShapes');
    for (const id of [..._persistShapes.keys()])
        removeShape(id);
    for (const id of [..._persistLabels.keys()])
        removeLabel(id);
    _maybeTeardownContainers();
}

function customMarkPresenceData()
{
    const placedCells = [];
    for (const mark of _customMarks.values())
    {
        const token = mark.token;
        if (!token?.document || token.destroyed || token.document.hidden)
            continue;
        for (const offset of getOccupiedOffsets(token))
            placedCells.push(`${offset.col},${offset.row}`);
    }
    return { placedCells, placedColor: TG.target };
}

// Session-independent pulsing follow-mark on a token, broadcast as a ghost like the session shapes.
export function createTokenMark(token, color = TG.reference)
{
    if (!token || !canvas?.stage)
        return { destroy()
        {} };
    ensureContainer();
    const graphic = new PIXI.Graphics();
    paintShape(token, graphic, color);
    _persistG.addChild(graphic);
    const markId = _nextMarkId++;
    _customMarks.set(markId, { token, graphic, color });
    if (!_customPresenceStop)
        _customPresenceStop = startToolHeartbeat('actingMark', () => _customMarks.size ? customMarkPresenceData() : null);
    broadcastToolPresence('actingMark', customMarkPresenceData());
    return {
        destroy()
        {
            const mark = _customMarks.get(markId);
            if (!mark)
                return;
            _customMarks.delete(markId);
            if (mark.graphic && !mark.graphic.destroyed)
                mark.graphic.destroy();
            if (_customMarks.size)
                broadcastToolPresence('actingMark', customMarkPresenceData());
            else
            {
                if (_customPresenceStop)
                {
                    _customPresenceStop();
                    _customPresenceStop = null;
                }
                clearToolPresence('actingMark');
            }
            _maybeTeardownContainers();
        }
    };
}

function updateChanceLabel(entry)
{
    const token = entry.token;
    if (!token?.document || token.destroyed)
    {
        entry.label.visible = false;
        return;
    }
    const hitChance = entry.fn?.(token);
    if (!hitChance)
    {
        entry.label.visible = false;
        return;
    }
    applyTargetInfoLabel(entry.label, hitChance);
    entry.label.resolution = gridTextResolution();
    applyIsoToLabel(entry.label);
    const anchor = hitLabelAnchor(token);
    entry.label.position.set(anchor.x, anchor.y);
    entry.label.visible = true;
}

// Session-independent live % label on a token; fn: (token) => { hit, crit } | null.
export function createChanceLabel(token, fn)
{
    if (!token || !canvas?.stage)
        return { destroy()
        {} };
    ensureContainer();
    const label = makeHitLabel(_labelG);
    const labelId = _nextMarkId++;
    const entry = { token, fn, label };
    _chanceLabels.set(labelId, entry);
    updateChanceLabel(entry);
    return {
        destroy()
        {
            if (!_chanceLabels.delete(labelId))
                return;
            if (label && !label.destroyed)
            {
                label.parent?.removeChild(label);
                label.destroy();
            }
            _maybeTeardownContainers();
        }
    };
}

// Any target change (picker, manual, AoE catch, post-roll clear) re-reconciles while in session.
Hooks.on('targetToken', (user) =>
{
    if (user?.id !== game.userId)
        return;
    if (_sessionActive)
        syncTargetShapes();
});
