/* global canvas, game, document, Hooks, PIXI, performance, MutationObserver, ui, requestAnimationFrame, cancelAnimationFrame, ResizeObserver, window */
// Standalone per-client measure tool: shape placement + targets + Ctrl+click marks + a reference range pulse,
// built on the shared shape-placement engine and the range-pulse manager. style:ignore

import { createShapePlacement, createPlacedShapeStore } from "../shape-placement-engine.js";
import {
    pointerToWorld, makeSafe, suppressTokenInteraction, addGraphicsBelowTokens, addGraphicsAboveTokens,
    destroyGraphics, paintSingleMarkCursor, gridLineWidth, TG, createMergedRangeHighlight, RANGE_GLOW,
    createCtrlMarkIndicator, paintDashedFootprint,
    suppressEvent,
} from "../canvas-helpers.js";
import { isHexGrid, getHexCenter, pixelToOffset, drawHexAt, getOccupiedOffsets } from "../../combat/grid-helpers.js";
import { rangePulse, RANGE_PULSE_PRIORITY } from "../range-pulse-manager.js";
import { createMovementReachHighlight } from "../movement-reach-highlight.js";
import { isLancerRulerActive } from "../../movement/cost-rules.js";
import { getActorMaxThreat, getWeaponProfiles_WithBonus, weaponPulseRange } from "../../tools/misc-tools.js";
import { getActorMaxReach_WithBonus } from "../../tools/weapon-bonus-utils.js";
import { getWeapons } from "../deployables.js";
import { weaponTypeIcon } from "../../tah/item-helpers.js";
import { isActorRevealedToUser, getUnknownLabel } from "../../tah/tokenStatHint.js";
import { setMeasureDistanceReference, setMeasureDistancePoint } from "../../movement/tactical-distance.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";

let _open = false;
let _controller = null;
let _singleActive = false;
let _singleCursor = null;
let _singleHandlers = null;
let _toolbarEl = null;
let _observer = null;
let _styleInjected = false;
let _autoCloseInstalled = false;
let _leaving = false;
let _leaveCleanup = null;
let _togglesSeeded = false;
let _suppressed = false;
let _hudDepth = 0;
let _cardActive = false;
let _hotbarObserver = null;
let _animateAreaControls = false;
let _animateRangeParam = false;
let _overToolbar = false;

const _saved = {
    store: null,
    marks: null,
    whiteMarks: null,
    mode: 'free',
    pattern: 'blast',
    areaRange: 1,
    size: 1,
    rangeSource: 'none',
    manualRadius: 5,
    weaponItemId: null,
    elevationAware: true,
    autoElevation: true,
    propagation: false,
    pulseEnabled: false,
    movementReachEnabled: false,
    tacticalLabels: false,
};

let _movementReach = null;
let _movementReachSig = null;
let _shapeMarker = null;
let _ctrlCursorWorld = null;
let _ctrlIndicator = null;
let _areaIndicator = null;
let _targetIndicator = null;
let _safeCtrlMove = null;
let _safeCtrlDown = null;
let _safeCtrlUp = null;
let _markPaint = null;
let _ctrlDistanceHeld = false;
let _prevTool = null;
let _safeDistanceKey = null;
let _safeDistanceBlur = null;

function tokenAt(tx, ty)
{
    return canvas.tokens.placeables.find(token =>
    {
        const bounds = token.bounds;
        return tx >= bounds.left && tx <= bounds.right && ty >= bounds.top && ty <= bounds.bottom;
    }) || null;
}

function ensureStore()
{
    if (!_saved.store)
        _saved.store = createPlacedShapeStore();
    return _saved.store;
}

// Marks reuse the gold breathing visual of placed attack-roll targets (target-shapes.js).
function createSingleMarkStore(colorFn = () => TG.placed, above = false, haloFn = () => false, drawTokens = true, dashed = false)
{
    const marks = [];
    const gfx = new PIXI.Graphics();
    if (above)
        addGraphicsAboveTokens(gfx);
    else
        addGraphicsBelowTokens(gfx);
    const keyOf = (mark) => mark.tokenId ?? `${mark.col},${mark.row}`;
    const indexOf = (mark) => marks.findIndex(existing => keyOf(existing) === keyOf(mark));
    const liveToken = (id) =>
    {
        for (const preview of canvas.tokens?.preview?.children ?? [])
        {
            if (preview?.document?.id === id)
                return preview;
        }
        return canvas.tokens.get(id);
    };
    const drawGeom = (mark) =>
    {
        if (mark.tokenId)
        {
            if (!drawTokens)
                return;
            const token = liveToken(mark.tokenId);
            if (!token)
                return;
            if (isHexGrid())
            {
                for (const offset of getOccupiedOffsets(token))
                    drawHexAt(gfx, offset.col, offset.row);
            }
            else
                gfx.drawRect(token.document.x, token.document.y, token.document.width * canvas.grid.size, token.document.height * canvas.grid.size);
        }
        else if (isHexGrid())
            drawHexAt(gfx, mark.col, mark.row);
        else
        {
            const center = getHexCenter(mark.col, mark.row);
            gfx.drawRect(center.x - canvas.grid.size / 2, center.y - canvas.grid.size / 2, canvas.grid.size, canvas.grid.size);
        }
    };
    const markCells = (mark) =>
    {
        if (!mark.tokenId)
            return [[mark.col, mark.row]];
        if (!drawTokens)
            return [];
        const token = liveToken(mark.tokenId);
        return token ? getOccupiedOffsets(token).map(offset => [offset.col, offset.row]) : [];
    };
    const drawDashed = () =>
    {
        const seen = new Set();
        const cells = [];
        for (const mark of marks)
        {
            for (const [col, row] of markCells(mark))
            {
                const key = `${col},${row}`;
                if (!seen.has(key))
                {
                    seen.add(key);
                    cells.push([col, row]);
                }
            }
        }
        paintDashedFootprint(gfx, cells, colorFn(marks[0]), { halo: haloFn(marks[0]) });
    };
    const tick = () =>
    {
        if (gfx.destroyed)
        {
            canvas.app.ticker.remove(tick);
            return;
        }
        gfx.alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
        gfx.clear();
        if (!marks.length)
            return;
        if (dashed)
        {
            drawDashed();
            return;
        }
        gfx.lineStyle(gridLineWidth(7), 0x000000, 0.6);
        for (const mark of marks)
        {
            if (haloFn(mark))
                drawGeom(mark);
        }
        for (const mark of marks)
        {
            const color = colorFn(mark);
            gfx.lineStyle(gridLineWidth(4), color, 0.85);
            gfx.beginFill(color, 0.22);
            drawGeom(mark);
            gfx.endFill();
        }
    };
    canvas.app.ticker.add(tick);
    return {
        marks,
        has(mark)
        {
            return indexOf(mark) >= 0;
        },
        toggle(mark)
        {
            const index = indexOf(mark);
            if (index >= 0)
                marks.splice(index, 1);
            else
                marks.push(mark);
        },
        remove(mark)
        {
            const index = indexOf(mark);
            if (index >= 0)
                marks.splice(index, 1);
        },
        clear()
        {
            marks.length = 0;
        },
        setVisible(visible)
        {
            gfx.visible = visible;
        },
        destroy()
        {
            canvas.app.ticker.remove(tick);
            destroyGraphics(gfx);
            marks.length = 0;
        },
    };
}

function ensureMarkStore()
{
    if (!_saved.marks)
        _saved.marks = createSingleMarkStore(() => TG.placed, false, () => false, false);
    return _saved.marks;
}

function ensureWhiteMarkStore()
{
    if (!_saved.whiteMarks)
        _saved.whiteMarks = createSingleMarkStore(() => RANGE_GLOW.mark, true, () => true, true, true);
    return _saved.whiteMarks;
}

function getControlled()
{
    return canvas.tokens?.controlled ?? [];
}

let _hoverToken = null;
let _lastClientX = -1;
let _lastClientY = -1;

// geometric check; mouseenter/mouseleave state can go stale when DOM under the cursor is replaced
function pointerOverToolbar()
{
    if (!_toolbarEl || !_toolbarEl.isConnected || _lastClientX < 0)
        return false;
    const el = document.elementFromPoint(_lastClientX, _lastClientY);
    return !!el && _toolbarEl.contains(el);
}

function onClientPointerMove(event)
{
    _lastClientX = event.clientX;
    _lastClientY = event.clientY;
    if (_overToolbar || _hoverToken)
        _overToolbar = pointerOverToolbar();
}

// Referenceable = actor exists and token not destroyed.
function isValidRef(token)
{
    const actor = token?.actor;
    return !!actor && !token.destroyed;
}

// Known = owned or revealed (scan/observer). Unknown enemies still reference but hide stat-derived data.
function isKnownToken(token)
{
    return isValidRef(token) && (token.isOwner || isActorRevealedToUser(token.actor));
}

// Token marks act like targets: always referenced (range + movement), alongside hover/selection.
function markedTokens()
{
    const store = _saved.whiteMarks;
    if (!store)
        return [];
    const out = [];
    for (const mark of store.marks)
    {
        if (!mark.tokenId)
            continue;
        const token = canvas.tokens.get(mark.tokenId);
        if (isValidRef(token))
            out.push(token);
    }
    return out;
}

function getReferenceTokens()
{
    const primary = (_hoverToken && isValidRef(_hoverToken))
        ? [_hoverToken]
        : getControlled().filter(isValidRef);
    const byId = new Map();
    for (const token of [...primary, ...markedTokens()])
        byId.set(token.id, token);
    return Array.from(byId.values());
}

function computeRadiusForToken(token, source = _saved.rangeSource, weaponItemId = _saved.weaponItemId)
{
    if (source === 'none')
        return 0;
    if (source === 'manual')
        return _saved.manualRadius;
    if (!isKnownToken(token))
        return null;
    const actor = token?.actor;
    if (!actor)
        return _saved.manualRadius;
    if (source === 'threat')
        return getActorMaxThreat(actor);
    if (source === 'sensor')
        return actor.type === 'pilot' ? 5 : (actor.system?.sensor_range ?? 10);
    // weapon is owner-only (loadout is yours to know); a scanned enemy falls back to max reach
    if (source === 'reach' || (source === 'weapon' && !token.isOwner))
        return getActorMaxReach_WithBonus(actor);
    if (source === 'weapon')
    {
        const weapon = actor.items.get(weaponItemId) ?? getWeapons(token)[0];
        return weapon ? weaponMaxRange(weapon, actor) : _saved.manualRadius;
    }
    return _saved.manualRadius;
}

function weaponRangeMap(weapon, actor)
{
    const profiles = getWeaponProfiles_WithBonus(weapon, actor);
    const activeProfile = profiles[weapon.system?.selected_profile_index ?? 0] ?? profiles[0];
    const ranges = {};
    for (const { type, val } of (activeProfile?.range ?? []))
        ranges[type] = Math.max(ranges[type] ?? 0, Number.parseInt(val) || 0);
    return ranges;
}

function weaponMaxRange(weapon, actor)
{
    return weaponPulseRange(weaponRangeMap(weapon, actor));
}

// Pinned marker auras: static outline, session-lived, several at once, tool-independent.
const _rangePins = new Map();

function _pinKey(tokenId, source, weaponItemId)
{
    return `${tokenId}|${source}|${weaponItemId ?? ''}`;
}

function _tokenHasPin(tokenId)
{
    for (const pin of _rangePins.values())
    {
        if (pin.tokenId === tokenId)
            return true;
    }
    return false;
}

let _pinGroups = new Map();
let _pinBreathTick = null;
let _pinPixTick = null;

const _pinPix = { rows: [], prevAlpha: null, sample: null };
globalThis.laPinPix = (count = 240) =>
{
    const rows = _pinPix.rows.slice(-count);
    console.table(rows);
    return rows;
};

// Reads the composited pixel the GPU actually produced last frame.
function _readPixel(worldX, worldY)
{
    const renderer = canvas.app?.renderer;
    const gl = renderer?.gl;
    if (!gl)
        return null;
    const global = canvas.stage.toGlobal({ x: worldX, y: worldY });
    const resolution = renderer.resolution ?? 1;
    const px = Math.round(global.x * resolution);
    const py = Math.round(renderer.height - global.y * resolution);
    if (px < 0 || py < 0 || px >= renderer.width || py >= renderer.height)
        return null;
    const buf = new Uint8Array(4);
    const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
    return { r: buf[0], g: buf[1], b: buf[2] };
}

function _syncPinBreath()
{
    if (_pinGroups.size && !_pinBreathTick)
    {
        _pinBreathTick = () =>
        {
            // Peaks at 0.77: measured, the interior gains a shade only across 0.78-0.85, so the sweep stays under it.
            const alpha = 0.535 + 0.235 * Math.sin(performance.now() / 280);
            _pinPix.prevAlpha = alpha;
            for (const pinHandle of _pinGroups.values())
            {
                for (const graphic of pinHandle.graphics ?? [])
                {
                    if (!graphic.destroyed)
                        graphic.alpha = alpha;
                }
            }
        };
        canvas.app.ticker.add(_pinBreathTick);
        // Runs after Application's render (LOW), so the drawing buffer still holds this frame.
        _pinPixTick = () =>
        {
            if (!_pinPix.sample || _pinPix.prevAlpha === null)
                return;
            const rgb = _readPixel(_pinPix.sample.x, _pinPix.sample.y);
            if (!rgb)
                return;
            _pinPix.rows.push({
                alpha: Math.round(_pinPix.prevAlpha * 10000) / 10000,
                r: rgb.r,
                g: rgb.g,
                b: rgb.b,
            });
            if (_pinPix.rows.length > 900)
                _pinPix.rows.shift();
        };
        canvas.app.ticker.add(_pinPixTick, null, PIXI.UPDATE_PRIORITY.UTILITY);
    }
    else if (!_pinGroups.size && _pinBreathTick)
    {
        canvas?.app?.ticker?.remove(_pinBreathTick);
        _pinBreathTick = null;
        if (_pinPixTick)
            canvas?.app?.ticker?.remove(_pinPixTick);
        _pinPixTick = null;
    }
}

// Re-insert pin graphics so the pulse, built later, cannot bury the coloured rings.
function _raisePins()
{
    for (const destroy of _pinGroups.values())
    {
        for (const graphic of destroy.graphics ?? [])
        {
            if (!graphic.destroyed)
                addGraphicsBelowTokens(graphic);
        }
    }
}

function _hidePins()
{
    for (const destroy of _pinGroups.values())
        destroy();
    _pinGroups = new Map();
    _syncPinBreath();
}

// Pins of the same source merge into one union region, pulse-style minus the wave.
function _rebuildPinVisuals()
{
    _hidePins();
    _pinPix.sample = null;
    if (!_open)
        return;
    const bySource = new Map();
    for (const pin of _rangePins.values())
    {
        const token = canvas.tokens.get(pin.tokenId);
        if (!token || token.destroyed)
            continue;
        if (!bySource.has(pin.source))
            bySource.set(pin.source, []);
        bySource.get(pin.source).push({ token, range: pin.range });
        if (!_pinPix.sample)
            _pinPix.sample = { x: token.center.x + canvas.grid.size, y: token.center.y };
    }

    const allEntries = [...bySource.values()].flat();
    if (allEntries.length && !rangePulse.has('advanced-measure'))
    {
        _pinGroups.set('__fill', createMergedRangeHighlight(allEntries, {
            includeSelf: true,
            wave: false,
            perimeter: false,
            fadeInMs: 0,
        }));
    }
    for (const [source, entries] of bySource)
    {
        _pinGroups.set(source, createMergedRangeHighlight(entries, {
            includeSelf: true,
            glowColor: RANGE_GLOW[source] ?? RANGE_GLOW.manual,
            wave: false,
            staticFillAlpha: 0,
            staticLineAlpha: 0,
            perimeterAlpha: 0.6,
            perimeterHalo: false,
            fadeInMs: 0,
        }));
    }
    _raisePins();
    _syncPinBreath();
}

function _destroyPin(key)
{
    _rangePins.delete(key);
}

function _showPins()
{
    _rebuildPinVisuals();
}

export function hasRangePin(token, source, weaponItemId = null)
{
    if (source === 'weapon' && weaponItemId === null)
    {
        for (const pin of _rangePins.values())
        {
            if (pin.tokenId === token?.id && pin.source === 'weapon')
                return true;
        }
        return false;
    }
    return _rangePins.has(_pinKey(token?.id, source, weaponItemId));
}

export function toggleRangePin(token, source, { weaponItemId = null, range = null } = {})
{
    if (!token || !source || source === 'none')
        return;
    const key = _pinKey(token.id, source, weaponItemId);
    if (_rangePins.has(key))
        _destroyPin(key);
    else
    {
        const radius = range ?? computeRadiusForToken(token, source, weaponItemId);
        if (!radius || radius <= 0)
            return;
        _rangePins.set(key, { tokenId: token.id, source, range: radius });
    }
    _rebuildPinVisuals();
    Hooks.callAll('lancer-automations.advancedMeasureStateChange');
}

export function clearRangePins(tokenId = null)
{
    for (const key of [..._rangePins.keys()])
    {
        if (tokenId === null || _rangePins.get(key)?.tokenId === tokenId)
            _destroyPin(key);
    }
    _rebuildPinVisuals();
    Hooks.callAll('lancer-automations.advancedMeasureStateChange');
}

Hooks.on('canvasTearDown', () =>
{
    _rangePins.clear();
    _hidePins();
});

Hooks.on('deleteToken', (doc) =>
{
    if (_tokenHasPin(doc.id))
        clearRangePins(doc.id);
});

const RANGE_TYPE_CCI = { range: 'cci-range', threat: 'cci-threat', thrown: 'cci-thrown', line: 'cci-line', cone: 'cci-cone', blast: 'cci-blast', burst: 'cci-burst' };
const RANGE_TYPE_ORDER = Object.keys(RANGE_TYPE_CCI);

function weaponRangeHtml(ranges)
{
    const parts = Object.entries(ranges)
        .filter(([, val]) => val > 0)
        .sort(([typeA], [typeB]) => RANGE_TYPE_ORDER.indexOf(String(typeA).toLowerCase()) - RANGE_TYPE_ORDER.indexOf(String(typeB).toLowerCase()))
        .map(([type, val]) => `<i class="cci ${RANGE_TYPE_CCI[String(type).toLowerCase()] ?? 'cci-range'}"></i>${val}`);
    return parts.join(' ');
}

// Reference = hovered (priority) or controlled, gated to owned/scanned; merged pulse. No reference = no pulse.
function rebuildPulse()
{
    const entries = [];
    for (const token of getReferenceTokens())
    {
        const range = computeRadiusForToken(token);
        if (range > 0)
            entries.push({ token, range });
    }
    if (_saved.rangeSource === 'manual' && _saved.manualRadius > 0)
    {
        for (const mark of groundMarks())
            entries.push({ point: getHexCenter(mark.col, mark.row), range: _saved.manualRadius });
    }
    if (_suppressed || _saved.rangeSource === 'none' || !entries.length)
    {
        const had = rangePulse.has('advanced-measure');
        rangePulse.clear('advanced-measure');
        if (had)
            _rebuildPinVisuals();
        return;
    }
    const glowColor = RANGE_GLOW[_saved.rangeSource] ?? RANGE_GLOW.manual;
    const signature = `${_saved.rangeSource}|` + entries.map(entry => entry.token ? `${entry.token.document.id}:${entry.range}` : `c:${entry.point.x},${entry.point.y}:${entry.range}`).sort().join('|');
    const hadPulse = rangePulse.has('advanced-measure');
    rangePulse.set('advanced-measure', {
        priority: RANGE_PULSE_PRIORITY.MEASURE,
        signature,
        build: () => createMergedRangeHighlight(entries, { includeSelf: true, glowColor }),
    });
    if (hadPulse)
        _raisePins();
    else
        _rebuildPinVisuals();
}

// Tool-owned so it coexists with rangePulse; force=true recreates on turn/cap change.
function rebuildMovementReach(force = false)
{
    const tokens = getReferenceTokens().filter(isKnownToken);
    const enabled = _saved.movementReachEnabled && isLancerRulerActive();
    const signature = (!_suppressed && enabled && tokens.length)
        ? tokens.map(token => token.document.id).sort().join('|')
        : null;
    if (!force && signature !== null && signature === _movementReachSig)
        return;
    _movementReach?.();
    _movementReach = null;
    _movementReachSig = signature;
    if (signature === null)
        return;
    _movementReach = createMovementReachHighlight(tokens);
}

function destroyMovementReach()
{
    _movementReach?.();
    _movementReach = null;
    _movementReachSig = null;
}

function groundMarks()
{
    return _saved.whiteMarks ? _saved.whiteMarks.marks.filter(mark => !mark.tokenId) : [];
}

// Cells of the gold "Target" marks (each target is a 1-hex shape): token footprints + placed cells.
function targetCells()
{
    const out = [];
    for (const mark of _saved.marks?.marks ?? [])
    {
        if (mark.tokenId)
        {
            const token = canvas.tokens.get(mark.tokenId);
            if (token)
            {
                for (const offset of getOccupiedOffsets(token))
                    out.push(`${offset.col},${offset.row}`);
            }
        }
        else
            out.push(`${mark.col},${mark.row}`);
    }
    return out;
}

// Gold breathing footprint (TG.placed, above tokens) on any token covered by a placed shape or target.
function createShapeTokenMarker()
{
    const gfx = new PIXI.Graphics();
    addGraphicsAboveTokens(gfx);
    const tick = () =>
    {
        if (gfx.destroyed)
        {
            canvas.app.ticker.remove(tick);
            return;
        }
        gfx.clear();
        const cells = new Set(_open && !_suppressed ? [...(_saved.store?.cells ?? []), ...targetCells()] : []);
        if (!cells.size)
            return;
        gfx.alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
        gfx.lineStyle(gridLineWidth(4), TG.placed, 0.9);
        gfx.beginFill(TG.placed, 0.2);
        for (const token of canvas.tokens?.placeables ?? [])
        {
            const offsets = getOccupiedOffsets(token);
            if (!offsets.some(offset => cells.has(`${offset.col},${offset.row}`)))
                continue;
            if (isHexGrid())
            {
                for (const offset of offsets)
                    drawHexAt(gfx, offset.col, offset.row);
            }
            else
                gfx.drawRect(token.document.x, token.document.y, token.document.width * canvas.grid.size, token.document.height * canvas.grid.size);
        }
        gfx.endFill();
    };
    canvas.app.ticker.add(tick);
    return () =>
    {
        canvas.app.ticker.remove(tick);
        destroyGraphics(gfx);
    };
}

function destroyShapeMarker()
{
    _shapeMarker?.();
    _shapeMarker = null;
}

function ctrlMarkActive()
{
    return _open && !_suppressed && _saved.mode !== 'area';
}

function applyMark(mark, token, adding, sound)
{
    const store = ensureWhiteMarkStore();
    if (store.has(mark) === adding)
        return;
    store.toggle(mark);
    if (sound)
        playUiSound(token ? (adding ? 'tokenTarget' : 'tokenUntarget') : 'targetingConfirm');
    onSelectionChange();
    if (_ctrlCursorWorld)
        _ctrlIndicator?.move(_ctrlCursorWorld.x, _ctrlCursorWorld.y);
}

function onCtrlMarkMove(event)
{
    _ctrlCursorWorld = pointerToWorld(event);
    // drop the hover reference once the cursor leaves the token, even without a hover-out event
    if (_hoverToken && !pointerOverToolbar()
        && (_hoverToken.destroyed || !_hoverToken.bounds.contains(_ctrlCursorWorld.x, _ctrlCursorWorld.y)))
    {
        _hoverToken = null;
        onSelectionChange();
    }
    _ctrlIndicator?.move(_ctrlCursorWorld.x, _ctrlCursorWorld.y);
    _areaIndicator?.move(_ctrlCursorWorld.x, _ctrlCursorWorld.y);
    _targetIndicator?.move(_ctrlCursorWorld.x, _ctrlCursorWorld.y);
    if (_ctrlDistanceHeld)
        pushDistancePoint();
    if (_markPaint && ctrlMarkActive())
    {
        const { token, mark } = markAtCursor(_ctrlCursorWorld.x, _ctrlCursorWorld.y);
        applyMark(mark, token, _markPaint.adding, true);
    }
}

function onCtrlMarkUp()
{
    _markPaint = null;
    if (_ctrlCursorWorld)
        _ctrlIndicator?.move(_ctrlCursorWorld.x, _ctrlCursorWorld.y);
}

// In area mode a click removes when the cursor cell is covered by a placed shape, else adds.
function areaRemoveQuery(worldX, worldY)
{
    const cell = pixelToOffset(worldX, worldY);
    return (_saved.store?.cells ?? []).includes(`${cell.col},${cell.row}`);
}

// In Target mode a click removes when the cursor is on an existing target, else adds.
function targetRemoveQuery(worldX, worldY)
{
    const { mark } = markAtCursor(worldX, worldY);
    return _saved.marks?.has(mark) ?? false;
}

function onCtrlMarkDown(event)
{
    if (!ctrlMarkActive() || event.button !== 0 || !event.shiftKey)
        return;
    if (event.target !== canvas.app?.view || !_ctrlCursorWorld)
        return;
    suppressEvent(event);
    const { token, mark } = markAtCursor(_ctrlCursorWorld.x, _ctrlCursorWorld.y);
    _markPaint = { adding: !ensureWhiteMarkStore().has(mark) };
    applyMark(mark, token, _markPaint.adding, true);
}

function ctrlQueryMarked(worldX, worldY)
{
    if (!_open || _suppressed || _saved.mode !== 'free')
        return null;
    if (_markPaint)
        return !_markPaint.adding;
    const { mark } = markAtCursor(worldX, worldY);
    return _saved.whiteMarks ? _saved.whiteMarks.has(mark) : false;
}

function onWhiteMarkTokenDeleted(doc)
{
    const store = _saved.whiteMarks;
    if (!store)
        return;
    const before = store.marks.length;
    for (const mark of store.marks.slice())
    {
        if (mark.tokenId === doc.id)
            store.remove(mark);
    }
    if (store.marks.length !== before)
        onSelectionChange();
}

function onCombatStateChange()
{
    if (_open)
        rebuildMovementReach(true);
}

// Show the tactical-distance labels from the active reference; clear if off/none/suppressed.
function updateDistanceLabels()
{
    const off = _suppressed || !_saved.tacticalLabels;
    setMeasureDistanceReference(off ? null : (getReferenceTokens()[0] ?? null));
}

// Screen-space cursor that follows the mouse, showing the matching scene-control tool's icon.
let _toolCursorEl = null;
let _toolCursorKind = null;
let _toolCursorShown = false;

function targetLaserIconUrl()
{
    const path = 'modules/lancer-automations/icons/cursors/targeting.svg';
    return globalThis.foundry?.utils?.getRoute?.(path) ?? path;
}

function ensureToolCursorEl()
{
    if (_toolCursorEl)
        return _toolCursorEl;
    injectStyles();
    const el = document.createElement('div');
    el.className = 'la-mt-distance-cursor';
    document.body.appendChild(el);
    _toolCursorEl = el;
    return el;
}

function positionToolCursor()
{
    if (!_toolCursorEl)
        return;
    _toolCursorEl.style.left = `${Math.round(_gLastClient.x)}px`;
    _toolCursorEl.style.top = `${Math.round(_gLastClient.y)}px`;
}

// 'ruler' -> fa-ruler glyph (matches the Measure Distance tool); 'target' -> the target-laser icon.
function setToolCursorKind(kind)
{
    if (kind === _toolCursorKind)
        return;
    _toolCursorKind = kind;
    const icon = document.createElement('i');
    icon.className = kind === 'target' ? 'mdi mdi-target' : 'fa-solid fa-ruler';
    _toolCursorEl.replaceChildren(icon);
}

function showToolCursor(show, kind)
{
    _toolCursorShown = show;
    if (!show)
    {
        if (_toolCursorEl)
            _toolCursorEl.style.display = 'none';
        return;
    }
    ensureToolCursorEl();
    setToolCursorKind(kind);
    positionToolCursor();
    _toolCursorEl.style.display = 'block';
}

function setCanvasCursorHidden(hidden)
{
    const view = canvas.app?.view;
    view?.classList?.toggle('la-mt-hide-cursor', hidden);
}

let _pickerCursorOn = false;
export function setPickerTargetCursor(on)
{
    if (on === _pickerCursorOn)
        return;
    _pickerCursorOn = on;
    const icon = on ? 'target' : desiredToolCursorIcon();
    setCanvasCursorHidden(!!icon);
    showToolCursor(!!icon, icon ?? 'ruler');
}

function activateRuler()
{
    _prevTool = game.activeTool;
    ui.controls?.activate({ tool: 'ruler' });
}

function restoreTool()
{
    ui.controls?.activate({ tool: _prevTool || 'select' });
    _prevTool = null;
}

// While measuring, the tactical labels (if on) re-origin to the cursor's hex center.
function pushDistancePoint()
{
    if (_ctrlDistanceHeld && _saved.tacticalLabels && _ctrlCursorWorld && !_suppressed)
    {
        const cell = pixelToOffset(_ctrlCursorWorld.x, _ctrlCursorWorld.y);
        setMeasureDistancePoint(getHexCenter(cell.col, cell.row));
    }
}

const CTRL_RULER_KEY = 'ctrlRulerMode';
const RULER_CURSOR_KEY = 'rulerToolCursor';
const TARGET_CURSOR_KEY = 'targetToolCursor';
const TOOLBAR_SCALE_KEY = 'advMeasureScale';
Hooks.once('init', () =>
{
    game.settings.register('lancer-automations', TOOLBAR_SCALE_KEY, {
        name: 'Advanced Measure: toolbar scale',
        hint: 'Size of the measure toolbar.',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0.6, max: 1.6, step: 0.05 },
        onChange: (value) => _toolbarEl?.style.setProperty('--la-mt-scale', String(Number(value) || 1)),
    });
    game.settings.register('lancer-automations', CTRL_RULER_KEY, {
        scope: 'client',
        config: false,
        type: String,
        choices: { none: 'Disabled', tool: 'Only in Advanced Measure', always: 'Always' },
        default: 'tool',
        onChange: () => refreshGlobalRulerDecoration(),
    });
    game.settings.register('lancer-automations', RULER_CURSOR_KEY, {
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => refreshGlobalRulerDecoration(),
    });
    game.settings.register('lancer-automations', TARGET_CURSOR_KEY, {
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => refreshGlobalRulerDecoration(),
    });
});
// While a token drag is live, Ctrl belongs to Foundry's waypoint placement.
function tokenDragActive()
{
    return !!canvas.tokens?.preview?.children?.length;
}
function ctrlRulerMode()
{
    try
    {
        return game.settings.get('lancer-automations', CTRL_RULER_KEY);
    }
    catch
    {
        return 'tool';
    }
}
function targetCursorOn()
{
    try
    {
        return !!game.settings.get('lancer-automations', TARGET_CURSOR_KEY);
    }
    catch
    {
        return true;
    }
}
function rulerCursorOn()
{
    try
    {
        return !!game.settings.get('lancer-automations', RULER_CURSOR_KEY);
    }
    catch
    {
        return true;
    }
}

function cycleRangeSource()
{
    const refs = getReferenceTokens();
    const weaponOk = refs.length === 1 && refs[0]?.isOwner && getWeapons(refs[0]).length > 0;
    const values = RANGE_SOURCES.map(src => src.value).filter(value => value !== 'weapon' || weaponOk);
    const idx = values.indexOf(_saved.rangeSource);
    applyRangeSource(values[(idx + 1) % values.length]);
    playUiSound('toggle');
}

function _isTypingTarget(target)
{
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || !!target?.isContentEditable;
}

function onDistanceKey(event)
{
    if (event.type === 'keydown' && _open && !_suppressed && !event.repeat
        && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        && !_isTypingTarget(event.target))
    {
        const key = String(event.key ?? '').toLowerCase();
        if (key === 't')
        {
            event.preventDefault();
            event.stopPropagation();
            cycleRangeSource();
            return;
        }
        if (key === 'g')
        {
            event.preventDefault();
            event.stopPropagation();
            playUiSound('toggle');
            clearPlacements();
            return;
        }
    }
    if (event.key !== 'Control' || _suppressed)
        return;
    // 'always' mode is handled by the global layer (works with the tool closed too).
    if (ctrlRulerMode() !== 'tool' || !_open)
        return;
    const down = event.type === 'keydown';
    if (down === _ctrlDistanceHeld)
        return;
    if (down && tokenDragActive())
        return;
    _ctrlDistanceHeld = down;
    playUiSound('toggle');
    if (down)
        activateRuler();
    else
        restoreTool();
    setCanvasCursorHidden(down);
    showToolCursor(down, 'ruler');
    if (down)
        pushDistancePoint();
    else
        setMeasureDistancePoint(null);
}

function onDistanceBlur()
{
    if (!_ctrlDistanceHeld)
        return;
    _ctrlDistanceHeld = false;
    restoreTool();
    setCanvasCursorHidden(false);
    showToolCursor(false);
    setMeasureDistancePoint(null);
}

// Global layer: cursor icon+sound for ruler ('always' mode) and targeting, open or not.
let _gCtrlHeld = false;
let _gPrevTool = null;
let _gDecoratedIcon = null;
const _gLastClient = { x: 0, y: 0 };

function desiredToolCursorIcon()
{
    if (game.activeTool === 'ruler' && rulerCursorOn())
        return 'ruler';
    if (game.activeTool === 'target' && targetCursorOn())
        return 'target';
    return null;
}

function refreshGlobalRulerDecoration()
{
    const icon = desiredToolCursorIcon();
    if (icon === _gDecoratedIcon)
        return;
    _gDecoratedIcon = icon;
    playUiSound('toggle');
    setCanvasCursorHidden(icon !== null);
    showToolCursor(icon !== null, icon ?? 'ruler');
}

function onGlobalCtrlKey(event)
{
    if (event.key !== 'Control' || ctrlRulerMode() !== 'always')
        return;
    const down = event.type === 'keydown';
    if (down === _gCtrlHeld)
        return;
    if (down && tokenDragActive())
        return;
    _gCtrlHeld = down;
    if (down)
    {
        _gPrevTool = game.activeTool;
        ui.controls?.activate({ tool: 'ruler' });
    }
    else
    {
        ui.controls?.activate({ tool: _gPrevTool || 'select' });
        _gPrevTool = null;
    }
}

function onGlobalCtrlBlur()
{
    if (!_gCtrlHeld)
        return;
    _gCtrlHeld = false;
    ui.controls?.activate({ tool: _gPrevTool || 'select' });
    _gPrevTool = null;
}

function onGlobalMove(event)
{
    _gLastClient.x = event.clientX;
    _gLastClient.y = event.clientY;
    if (_toolCursorShown)
        positionToolCursor();
}

let _globalRulerInited = false;
export function initGlobalCtrlRuler()
{
    if (_globalRulerInited)
        return;
    _globalRulerInited = true;
    injectStyles();
    document.addEventListener('keydown', onGlobalCtrlKey, true);
    document.addEventListener('keyup', onGlobalCtrlKey, true);
    document.addEventListener('mousemove', onGlobalMove, true);
    window.addEventListener('blur', onGlobalCtrlBlur);
    Hooks.on('activateSceneControls', () => refreshGlobalRulerDecoration());
}

// controlToken/hoverToken fire per-token; coalesce a burst into a single refresh.
let _selectionRaf = null;
function onSelectionChange()
{
    if (_selectionRaf)
        return;
    _selectionRaf = requestAnimationFrame(() =>
    {
        _selectionRaf = null;
        if (!_open)
            return;
        if (_saved.rangeSource === 'weapon' && getControlled().length > 1)
        {
            _saved.rangeSource = 'reach';
            _saved.weaponItemId = null;
            _emitStateChange();
        }
        rebuildPulse();
        rebuildMovementReach();
        updateDistanceLabels();
        renderToolbar();
    });
}

// Keep the reference when the un-hover comes from the toolbar covering the token.
function onHoverToken(token, hovered)
{
    if (hovered || _hoverToken !== token)
    {
        if (hovered)
            _hoverToken = token;
        onSelectionChange();
        return;
    }
    requestAnimationFrame(() =>
    {
        if (_hoverToken !== token || token.hover)
            return;
        if (pointerOverToolbar())
            return;
        _hoverToken = null;
        onSelectionChange();
    });
}

function onProfileSwitched(item, changes)
{
    if (!_open || !foundry.utils.hasProperty(changes, 'system.selected_profile_index'))
        return;
    rebuildPulse();
    renderToolbar();
}

function isTypingInToolbar(event)
{
    return !!(_toolbarEl && event.target && _toolbarEl.contains(event.target));
}

// In Free mode Escape closes the tool; area/single handle their own Escape (return to Free).
function onFreeEsc(event)
{
    if (event.key !== 'Escape' || _suppressed || _saved.mode !== 'free' || isTypingInToolbar(event))
        return;
    suppressEvent(event);
    closeAdvancedMeasure();
}

// Free mode has no capturing engine; Shift+wheel here bumps the manual radius (area mode owns Shift+wheel itself).
function applyRangeSource(value)
{
    _animateRangeParam = value === 'manual' || value === 'weapon';
    _saved.rangeSource = value;
    _saved.pulseEnabled = value !== 'none';
    rebuildPulse();
    renderToolbar();
    _emitStateChange();
}

function onFreeWheel(event)
{
    if (!_open || _suppressed || _saved.mode === 'area')
        return;
    if (event.shiftKey && _saved.mode === 'free' && _saved.rangeSource === 'manual')
    {
        event.preventDefault();
        event.stopPropagation();
        setManualRadius(_saved.manualRadius + (event.deltaY < 0 ? 1 : -1));
        playUiSound('targeting');
    }
}

// toggle: mirrors single-mark (remove if placed, add if not)
function onAreaPlace(result)
{
    const store = ensureStore();
    const offset = pixelToOffset(result.labelPt.x, result.labelPt.y);
    const clickedCell = `${offset.col},${offset.row}`;
    if (store.removeAt(clickedCell))
        return;
    store.addShape(result);
}

function startAreaMode()
{
    if (_controller)
        return;
    ensureStore();
    _controller = createShapePlacement({
        casterToken: null,
        pattern: _saved.pattern,
        areaRange: _saved.areaRange,
        size: _saved.size,
        multiStack: true,
        highlightCaught: true,
        sound: () => !_overToolbar,
        resolveOnClick: false,
        placedStore: null,
        colorFor: () => TG.inRange,
        getToggles: () => ({ elevationAware: _saved.elevationAware, autoElevation: _saved.autoElevation, propagation: _saved.propagation }),
        onPlace: onAreaPlace,
        onResize: dir => setAreaRange(_saved.areaRange + dir),
        onCancel: escapeToFree,
        shouldIgnoreKey: isTypingInToolbar,
    });
    _controller.start();
    _areaIndicator = createCtrlMarkIndicator({ queryMarked: areaRemoveQuery, alwaysOn: true });
}

function stopAreaMode()
{
    if (_controller)
    {
        _controller.dispose();
        _controller = null;
    }
    _areaIndicator?.dispose();
    _areaIndicator = null;
}

// Escape out of a capturing mode (area/single) back to Free, with the click blip.
function escapeToFree()
{
    playUiSound('toggle');
    setMode('free');
}

function markAtCursor(tx, ty)
{
    const token = tokenAt(tx, ty);
    if (token)
        return { token, mark: { tokenId: token.id } };
    const cell = pixelToOffset(tx, ty);
    return { token: null, mark: { col: cell.col, row: cell.row } };
}

function startSingleMode()
{
    if (_singleActive)
        return;
    _singleActive = true;
    const restoreTokenInteraction = suppressTokenInteraction();
    const cursorGfx = new PIXI.Graphics();
    canvas.stage.addChild(cursorGfx).eventMode = 'none';
    const safe = makeSafe('advancedMeasureSingle', () => closeAdvancedMeasure());
    const onMove = safe((event) =>
    {
        const { x, y } = pointerToWorld(event);
        // Marking is not targeting: no range check, never red.
        paintSingleMarkCursor(cursorGfx, x, y);
        if (!_overToolbar)
        {
            const cell = pixelToOffset(x, y);
            playTargetingMove(cell.col, cell.row);
        }
    });
    const onClick = safe((event) =>
    {
        const { x, y } = pointerToWorld(event);
        const marks = ensureMarkStore();
        const { token, mark } = markAtCursor(x, y);
        const wasPresent = marks.has(mark);
        marks.toggle(mark);
        if (token)
            playUiSound(wasPresent ? 'tokenUntarget' : 'tokenTarget');
        else
            playUiSound('targetingConfirm');
    });
    const onRight = safe((event) =>
    {
        const { x, y } = pointerToWorld(event);
        const marks = ensureMarkStore();
        const { token, mark } = markAtCursor(x, y);
        if (!marks.has(mark))
            return;
        marks.remove(mark);
        playUiSound(token ? 'tokenUntarget' : 'targetingConfirm');
    });
    const onKey = safe((event) =>
    {
        if (event.key === 'Escape' && !isTypingInToolbar(event))
        {
            suppressEvent(event);
            escapeToFree();
        }
    });
    canvas.stage.on('pointermove', onMove);
    canvas.stage.on('click', onClick);
    canvas.stage.on('rightdown', onRight);
    document.addEventListener('keydown', onKey, true);
    _singleCursor = { gfx: cursorGfx, restoreTokenInteraction };
    _singleHandlers = { onMove, onClick, onRight, onKey };
    _targetIndicator = createCtrlMarkIndicator({ queryMarked: targetRemoveQuery, alwaysOn: true });
}

function stopSingleMode()
{
    if (!_singleActive)
        return;
    _singleActive = false;
    if (_singleHandlers)
    {
        canvas.stage.off('pointermove', _singleHandlers.onMove);
        canvas.stage.off('click', _singleHandlers.onClick);
        canvas.stage.off('rightdown', _singleHandlers.onRight);
        document.removeEventListener('keydown', _singleHandlers.onKey, true);
        _singleHandlers = null;
    }
    if (_singleCursor)
    {
        destroyGraphics(_singleCursor.gfx);
        _singleCursor.restoreTokenInteraction();
        _singleCursor = null;
    }
    _targetIndicator?.dispose();
    _targetIndicator = null;
}

// free = no capture (canvas fully interactive); area/single each own the pointer.
function setMode(mode)
{
    if (_saved.mode === mode)
    {
        if (mode === 'area' && _controller)
            return;
        if (mode === 'single' && _singleActive)
            return;
        if (mode === 'free' && !_controller && !_singleActive)
            return;
    }
    _saved.mode = mode;
    if (mode === 'free')
    {
        stopAreaMode();
        stopSingleMode();
    }
    else if (mode === 'area')
    {
        stopSingleMode();
        startAreaMode();
        _animateAreaControls = true;
    }
    else
    {
        stopAreaMode();
        startSingleMode();
    }
    renderToolbar();
}

function setAreaRange(value)
{
    _saved.areaRange = Math.max(1, value);
    _controller?.setAreaRange(_saved.areaRange);
    renderToolbar();
}

function setManualRadius(value)
{
    _saved.manualRadius = Math.max(0, value);
    rebuildPulse();
    renderToolbar();
}

function clearPlacements()
{
    _saved.store?.destroy();
    _saved.marks?.clear();
    _saved.whiteMarks?.clear();
    clearRangePins();
    _saved.rangeSource = 'none';
    _saved.pulseEnabled = false;
    _saved.movementReachEnabled = false;
    _saved.tacticalLabels = false;
    _controller?.redraw();
    _emitStateChange();
    onSelectionChange();
}

function injectStyles()
{
    if (_styleInjected)
        return;
    _styleInjected = true;
    const style = document.createElement('style');
    style.id = 'la-measure-toolbar-styles';
    style.textContent = `
        .la-mt-hide-cursor, .la-mt-hide-cursor * { cursor: none !important; }
        .la-mt-distance-cursor { position: fixed; pointer-events: none; z-index: 100000; transform: translate(-50%, -50%); color: #ffffff; font-size: 22px; line-height: 1; display: none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.9)); }
        .la-mt-distance-cursor .la-mt-cursor-laser { width: 30px; height: 30px; display: block; }
        #la-measure-toolbar { --la-mt-cut: 10px; position: fixed; left: 50%; bottom: 10px; z-index: 70; isolation: isolate; display: flex; align-items: center; gap: 8px; padding: 7px 16px; background: transparent; font-family: var(--font-primary, "Signika", sans-serif); color: var(--la-ink, #e8e8e8); font-size: 13px; opacity: 0; transform-origin: 50% 100%; transform: translateX(-50%) translateY(24px) scale(var(--la-mt-scale, 1)); transition: opacity 200ms ease-out, transform 240ms cubic-bezier(0.22, 1, 0.36, 1); }
        #la-measure-toolbar::before { content: ""; position: absolute; inset: 0; z-index: -2; background: var(--primary-color, #ff6400); clip-path: polygon(0 0, calc(100% - var(--la-mt-cut)) 0, 100% var(--la-mt-cut), 100% 100%, var(--la-mt-cut) 100%, 0 calc(100% - var(--la-mt-cut))); filter: drop-shadow(0 4px 14px rgba(0,0,0,0.55)); }
        #la-measure-toolbar::after { content: ""; position: absolute; inset: 2px; z-index: -1; background: var(--la-plate, #e4dccd); clip-path: polygon(0 0, calc(100% - var(--la-mt-cut)) 0, 100% var(--la-mt-cut), 100% 100%, var(--la-mt-cut) 100%, 0 calc(100% - var(--la-mt-cut))); }
        #la-measure-toolbar.la-show { opacity: 1; transform: translateX(-50%) translateY(0) scale(var(--la-mt-scale, 1)); }
        #la-measure-toolbar.la-hide { opacity: 0; transform: translateX(-50%) translateY(24px) scale(var(--la-mt-scale, 1)); }
        #la-measure-toolbar.la-mt-suppressed { opacity: 0.45; pointer-events: none; filter: grayscale(0.75); }
        #la-measure-toolbar .la-mt-badge { display: flex; align-items: center; justify-content: center; background: var(--primary-color, #ff6400); color: var(--light-text, #fff); padding: 5px 9px; line-height: 1; }
        #la-measure-toolbar .la-mt-badge-icon { width: 18px; height: 18px; display: block; border: none; object-fit: contain; }
        #la-measure-toolbar button.lancer-action-btn { cursor: pointer; line-height: 1; padding: 6px 11px; margin: 0; min-height: 0; flex: 0 0 auto; }
        #la-measure-toolbar button.la-mt-active { --la-line: var(--primary-color, #ff6400); --la-fill: var(--primary-color, #ff6400); color: var(--light-text, #fff) !important; }
        @keyframes la-mt-pulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.5); } }
        #la-measure-toolbar button.la-mt-pulse { animation: la-mt-pulse 1.1s ease-in-out infinite; }
        #la-measure-toolbar .la-mt-group { display: flex; align-items: center; gap: 4px; }
        #la-measure-toolbar .la-mt-sep { width: 1px; height: 22px; background: color-mix(in srgb, var(--primary-color, #ff6400), transparent 55%); }
        #la-measure-toolbar .la-mt-toggles { display: flex; align-items: center; gap: 10px; font-size: 11px; }
        #la-measure-toolbar .la-mt-toggles label { display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.04em; }
        #la-measure-toolbar .la-mt-toggles input[type=checkbox] { -webkit-appearance: auto; appearance: auto; accent-color: var(--primary-color, #ff6400); width: 14px; height: 14px; min-width: 0; min-height: 0; margin: 0; padding: 0; background: initial; border: initial; box-shadow: none; cursor: pointer; }
        #la-measure-toolbar .la-mt-toggles input[type=checkbox]::before, #la-measure-toolbar .la-mt-toggles input[type=checkbox]::after { content: none; display: none; }
        @keyframes la-mt-appear { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        #la-measure-toolbar .la-mt-appear { animation: la-mt-appear 160ms ease-out; }
        #la-measure-toolbar input, #la-measure-toolbar select { -webkit-appearance: auto; appearance: auto; background: var(--la-raise, var(--la-plate, #e4dccd)); color: var(--la-ink, #e8e8e8); border: 1px solid var(--la-edge, #3a3a3a); border-radius: 0; padding: 2px 5px; font-family: var(--la-mono, ui-monospace, "Cascadia Mono", Consolas, monospace); font-size: 12px; }
        #la-measure-toolbar select option { background: var(--la-plate, #e4dccd); color: var(--la-ink, #111); }
        #la-measure-toolbar input:focus, #la-measure-toolbar select:focus { border-color: var(--primary-color, #ff6400); outline: none; }
        #la-measure-toolbar input[type=number] { width: 46px; }
        #la-measure-toolbar .la-mt-ref { display: flex; align-items: center; gap: 6px; max-width: 160px; }
        #la-measure-toolbar .la-mt-ref img { width: 23px; height: 23px; object-fit: contain; border: 1px solid var(--la-edge, rgba(128,128,128,0.5)); background: #000; }
        #la-measure-toolbar .la-mt-ref span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
        #la-measure-toolbar .la-mt-ref-badge { font-weight: 700; font-size: 14px; color: var(--light-text, #fff); background: var(--primary-color, #ff6400); padding: 1px 5px; }
        #la-measure-toolbar .la-mt-name { display: inline-block; width: 96px; max-width: 96px; overflow: hidden; white-space: nowrap; }
        #la-measure-toolbar .la-mt-name-inner { display: inline-block; white-space: nowrap; will-change: transform; }
        #la-measure-toolbar .la-mt-help { position: relative; width: 21px; height: 21px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--primary-color, #ff6400); border-radius: 50%; font-weight: 700; font-size: 13px; cursor: help; color: var(--la-accent); }
        #la-measure-toolbar .la-mt-help-tip { display: none; position: absolute; bottom: 150%; left: 0; z-index: 71; background: var(--la-plate, rgba(15,15,17,0.98)); border: 1px solid var(--primary-color, #ff6400); padding: 10px 13px; font-size: 11.5px; color: var(--la-ink, #f2f2f2); width: max-content; max-width: 360px; box-shadow: 0 6px 20px rgba(0,0,0,0.7); }
        #la-measure-toolbar .la-mt-help-tip .la-mt-help-row { line-height: 1.7; }
        #la-measure-toolbar .la-mt-help-tip .la-mt-key { display: inline-block; margin: 0 2px; padding: 1px 5px; border-radius: 3px; background: var(--primary-color, #ff6400); color: var(--light-text, #fff); font-weight: 700; font-size: 10px; letter-spacing: 0.3px; box-shadow: 0 1px 0 rgba(0,0,0,0.4); }
        #la-measure-toolbar .la-mt-help:hover .la-mt-help-tip { display: block; }
        #la-measure-toolbar .la-mt-icon-btn { padding: 6px 8px; display: inline-flex; align-items: center; justify-content: center; }
        #la-measure-toolbar .la-mt-icon-btn i, #la-measure-toolbar .la-mt-dd-trigger i { font-size: 15px; line-height: 1; }
        #la-measure-toolbar .la-mt-icon-btn i, #la-measure-toolbar .la-mt-dd-trigger i:not(.la-mt-dd-caret), #la-measure-toolbar .la-mt-dd-item i { color: var(--la-accent); }
        #la-measure-toolbar .la-mt-svg-icon { display: inline-block; width: 15px; height: 15px; background-color: var(--la-accent); -webkit-mask: center / contain no-repeat; mask: center / contain no-repeat; }
        #la-measure-toolbar .la-mt-dd-item .la-mt-svg-icon { width: 16px; }
        #la-measure-toolbar button.la-mt-active .la-mt-svg-icon { background-color: var(--light-text, #fff) !important; }
        #la-measure-toolbar .la-mt-dd { position: relative; display: inline-flex; }
        #la-measure-toolbar .la-mt-dd-trigger { display: inline-flex; align-items: center; gap: 6px; }
        #la-measure-toolbar .la-mt-dd-trigger span { font-family: var(--la-mono, ui-monospace, monospace); font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; max-width: 58px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #la-measure-toolbar .la-mt-dd-caret { font-size: 10px !important; opacity: 0.7; margin-left: 1px; }
        #la-measure-toolbar button.la-mt-active i, #la-measure-toolbar button.la-mt-active svg { color: var(--light-text, #fff) !important; fill: var(--light-text, #fff) !important; }
        #la-measure-toolbar .la-mt-hidden { display: none !important; }
        #la-measure-toolbar .la-mt-dd-panel, #la-measure-toolbar .la-mt-pop { --pcut: 8px; isolation: isolate; background: transparent; border: none; box-shadow: none; }
        #la-measure-toolbar .la-mt-dd-panel::before, #la-measure-toolbar .la-mt-pop::before { content: ""; position: absolute; inset: 0; z-index: -2; background: var(--primary-color, #ff6400); clip-path: polygon(0 0, calc(100% - var(--pcut)) 0, 100% var(--pcut), 100% 100%, var(--pcut) 100%, 0 calc(100% - var(--pcut))); filter: drop-shadow(0 5px 16px rgba(0,0,0,0.5)); }
        #la-measure-toolbar .la-mt-dd-panel::after, #la-measure-toolbar .la-mt-pop::after { content: ""; position: absolute; inset: 2px; z-index: -1; background: var(--la-plate, rgba(15,15,17,0.98)); clip-path: polygon(0 0, calc(100% - var(--pcut)) 0, 100% var(--pcut), 100% 100%, var(--pcut) 100%, 0 calc(100% - var(--pcut))); }
        #la-measure-toolbar .la-mt-dd-panel { display: none; flex-direction: column; position: absolute; bottom: calc(100% + 7px); left: 0; z-index: 72; min-width: 148px; padding: 4px; }
        #la-measure-toolbar .la-mt-dd-panel.open { display: flex; }
        #la-measure-toolbar .la-mt-dd-item { display: flex; align-items: center; gap: 9px; padding: 6px 11px; background: transparent; border: none; border-radius: 0; color: var(--la-ink, #e8e8e8); font-family: var(--la-mono, ui-monospace, monospace); font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; text-align: left; white-space: nowrap; }
        #la-measure-toolbar .la-mt-dd-item i { width: 16px; text-align: center; font-size: 14px; }
        #la-measure-toolbar .la-mt-dd-item:hover:not(:disabled) { background: color-mix(in srgb, var(--primary-color, #ff6400), transparent 80%); }
        #la-measure-toolbar .la-mt-dd-item.active { background: var(--primary-color, #ff6400); color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-dd-item.active:hover:not(:disabled) { background: color-mix(in srgb, var(--primary-color, #ff6400), #000 18%); }
        #la-measure-toolbar .la-mt-dd-item.active i { color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-dd-item.active .la-mt-svg-icon { background-color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-dd-item.active .la-hud-fav-mark { color: var(--light-text, #fff) !important; }
        #la-measure-toolbar .la-mt-dd-item.active .la-mt-weap-r { color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-dd-item:disabled { opacity: 0.4; cursor: default; }
        #la-measure-toolbar .la-mt-weap-row { justify-content: flex-start; gap: 9px; }
        #la-measure-toolbar .la-mt-weap-n { flex: 1 1 auto; }
        #la-measure-toolbar .la-mt-weap-r { color: var(--la-accent); font-variant-numeric: tabular-nums; }
        #la-measure-toolbar .la-mt-anchor { position: relative; }
        #la-measure-toolbar .la-mt-pop { position: absolute; bottom: calc(100% + 10px); left: 50%; z-index: 72; display: flex; flex-direction: column; gap: 6px; padding: 6px 12px; opacity: 0; pointer-events: none; transform: translateX(-50%) translateY(8px); transition: opacity 160ms ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1); }
        #la-measure-toolbar .la-mt-pop .la-mt-icon-btn { padding: 3px 7px; }
        #la-measure-toolbar .la-mt-pop.open { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
        #la-measure-toolbar .la-mt-pop-row { display: flex; align-items: center; gap: 8px; }
        #la-measure-toolbar .la-mt-pop-label { font-family: var(--la-mono, ui-monospace, monospace); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; min-width: 42px; }
        #la-measure-toolbar .la-mt-pop-input { width: 52px; text-align: center; font-variant-numeric: tabular-nums; }
        #la-measure-toolbar .la-mt-pop-empty { font-size: 12px; opacity: 0.7; font-style: italic; }
    `;
    document.head.appendChild(style);
}

function makeButton(label, onClick)
{
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lancer-action-btn';
    button.textContent = label;
    button.addEventListener('mouseenter', () => playUiSound('statusHover'));
    button.addEventListener('click', () =>
    {
        playUiSound('toggle');
        onClick();
    });
    return button;
}

function makeIcon(iconSpec)
{
    if (iconSpec.endsWith('.svg'))
    {
        const span = document.createElement('span');
        span.className = 'la-mt-svg-icon';
        const url = globalThis.foundry?.utils?.getRoute?.(iconSpec) ?? iconSpec;
        span.style.webkitMaskImage = `url("${url}")`;
        span.style.maskImage = `url("${url}")`;
        return span;
    }
    const icon = document.createElement('i');
    icon.className = iconSpec;
    return icon;
}

function makeIconButton(iconClass, title, onClick)
{
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lancer-action-btn la-mt-icon-btn';
    button.title = title;
    button.appendChild(makeIcon(iconClass));
    button.addEventListener('mouseenter', () => playUiSound('statusHover'));
    button.addEventListener('click', () =>
    {
        playUiSound('toggle');
        onClick();
    });
    return button;
}

function makeParamPopover(animate)
{
    const pop = document.createElement('div');
    pop.className = 'la-mt-pop';
    if (animate)
        requestAnimationFrame(() => pop.classList.add('open'));
    else
        pop.classList.add('open');
    return pop;
}

const RANGE_SOURCES = [
    { value: 'none', label: 'None', icon: 'systems/lancer/assets/icons/status_downandout.svg' },
    { value: 'manual', label: 'Manual', icon: 'systems/lancer/assets/icons/range.svg' },
    { value: 'threat', label: 'Threat', icon: 'cci cci-threat' },
    { value: 'sensor', label: 'Sensor', icon: 'cci cci-sensor' },
    { value: 'reach', label: 'Max Reach', icon: 'systems/lancer/assets/icons/nested_hexagons.svg' },
    { value: 'weapon', label: 'Weapon', icon: 'cci cci-weapon' },
];

const SHAPE_BUTTONS = [
    { pattern: 'blast', label: 'Blast', icon: 'cci cci-blast' },
    { pattern: 'burst', label: 'Burst', icon: 'cci cci-burst' },
    { pattern: 'cone', label: 'Cone', icon: 'cci cci-cone' },
    { pattern: 'line', label: 'Line', icon: 'cci cci-line' },
];

function makeIconDropdown(current, items, onSelect, onContext = null, isPinned = null)
{
    const starFor = new Map();
    const refreshStars = () =>
    {
        for (const [value, star] of starFor)
            star.style.display = isPinned?.(value) ? '' : 'none';
    };
    const wrap = document.createElement('div');
    wrap.className = 'la-mt-dd';
    const currentItem = items.find(item => item.value === current) ?? items[0];
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'lancer-action-btn la-mt-dd-trigger';
    if (current && current !== 'none')
        markActive(trigger, false);
    trigger.title = currentItem.label;
    const triggerLabel = document.createElement('span');
    triggerLabel.textContent = currentItem.label;
    const caret = document.createElement('i');
    caret.className = 'fa-solid fa-caret-down la-mt-dd-caret';
    trigger.append(makeIcon(currentItem.icon), triggerLabel, caret);
    const panel = document.createElement('div');
    panel.className = 'la-mt-dd-panel';

    const siblingPops = () => Array.from(wrap.parentElement?.querySelectorAll('.la-mt-pop') ?? []);
    const close = () =>
    {
        panel.classList.remove('open');
        for (const pop of siblingPops())
            pop.classList.remove('la-mt-hidden');
        document.removeEventListener('mousedown', onOutside, true);
    };
    function onOutside(event)
    {
        if (!wrap.isConnected)
        {
            document.removeEventListener('mousedown', onOutside, true);
            return;
        }
        if (!wrap.contains(event.target))
            close();
    }
    for (const item of items)
    {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'la-mt-dd-item';
        row.disabled = !!item.disabled;
        row.title = item.label;
        if (item.value === current)
            row.classList.add('active');
        const itemLabel = document.createElement('span');
        itemLabel.textContent = item.label;
        row.append(makeIcon(item.icon), itemLabel);
        if (isPinned)
        {
            const star = document.createElement('span');
            star.className = 'la-hud-fav-mark';
            star.textContent = '★';
            star.style.display = isPinned(item.value) ? '' : 'none';
            row.style.position = 'relative';
            starFor.set(item.value, star);
            row.appendChild(star);
        }
        row.addEventListener('mouseenter', () =>
        {
            if (!item.disabled)
                playUiSound('statusHover');
        });
        row.addEventListener('click', () =>
        {
            if (item.disabled)
                return;
            playUiSound('toggle');
            close();
            onSelect(item.value);
        });
        if (onContext)
        {
            row.addEventListener('contextmenu', (event) =>
            {
                suppressEvent(event);
                if (item.disabled)
                    return;
                playUiSound('toggle');
                onContext(item.value);
                refreshStars();
            });
        }
        panel.appendChild(row);
    }
    trigger.addEventListener('mouseenter', () => playUiSound('statusHover'));
    trigger.addEventListener('click', () =>
    {
        const willOpen = !panel.classList.contains('open');
        playUiSound('toggle');
        panel.classList.toggle('open', willOpen);
        for (const pop of siblingPops())
            pop.classList.toggle('la-mt-hidden', willOpen);
        if (willOpen)
            document.addEventListener('mousedown', onOutside, true);
        else
            document.removeEventListener('mousedown', onOutside, true);
    });
    wrap.append(trigger, panel);
    return wrap;
}

function markActive(button, pulsing)
{
    button.classList.add('la-mt-active');
    // inline !important beats the library's layered .lancer-action-btn color:!important
    button.style.setProperty('color', 'var(--light-text, #fff)', 'important');
    if (pulsing)
        button.classList.add('la-mt-pulse');
}

function makeSep()
{
    const element = document.createElement('div');
    element.className = 'la-mt-sep';
    return element;
}

// Route-aware path so the icon resolves under any Foundry route prefix (injected CSS resolves relative to the page).
function sextantIconUrl()
{
    const path = 'modules/lancer-automations/icons/sextant.svg';
    return globalThis.foundry?.utils?.getRoute?.(path) ?? path;
}

function renderBadge()
{
    const badge = document.createElement('span');
    badge.className = 'la-mt-badge';
    badge.title = 'Advanced Measure';
    const icon = document.createElement('img');
    icon.className = 'la-mt-badge-icon';
    icon.src = sextantIconUrl();
    icon.alt = '';
    badge.appendChild(icon);
    return badge;
}

const HELP_LINES = [
    'Shape / Target icons: click to arm, click again for free',
    'No shape armed = free (move & drag tokens)',
    '[[Shift+click]]: mark a token (targets it) or a hex (Manual range)',
    '[[Ctrl]] (hold): measure distance (ruler)',
    '[[Ctrl+wheel]]: rotate   [[Shift+wheel]]: size   [[Q/E]]: elevation',
    '[[W/S]]: tilt line',
    '[[Right-click]] also removes a target',
    'Reference: hover or select an owned/scanned token',
    'Range: pick a source (None = off, re-click = off)',
    '[[T]]: next range source   [[G]]: clear all',
    '[[Right-click]] a range source or a weapon: pin its outline (★, no pulse)',
    'Move: movement reach in ruler speed tiers',
    '[[Escape]]: stop placing   [[Shift+R]]: close',
];

function buildHelpRow(line)
{
    const row = document.createElement('div');
    row.className = 'la-mt-help-row';
    for (const part of line.split(/(\[\[[^\]]+\]\])/))
    {
        if (!part)
            continue;
        const key = part.match(/^\[\[([^\]]+)\]\]$/);
        if (key)
        {
            const kbd = document.createElement('span');
            kbd.className = 'la-mt-key';
            kbd.textContent = key[1];
            row.appendChild(kbd);
        }
        else
            row.appendChild(document.createTextNode(part));
    }
    return row;
}

function renderHelp()
{
    const help = document.createElement('div');
    help.className = 'la-mt-help';
    help.textContent = '?';
    const tip = document.createElement('div');
    tip.className = 'la-mt-help-tip';
    for (const line of HELP_LINES)
        tip.appendChild(buildHelpRow(line));
    help.appendChild(tip);
    return help;
}

function makeScrollingName(text)
{
    const wrap = document.createElement('span');
    wrap.className = 'la-mt-name';
    const inner = document.createElement('span');
    inner.className = 'la-mt-name-inner';
    inner.textContent = text;
    wrap.appendChild(inner);
    wrap.addEventListener('mouseenter', () =>
    {
        const overflow = inner.scrollWidth - wrap.clientWidth;
        if (overflow <= 0)
            return;
        inner.style.transition = `transform ${Math.max(0.5, overflow / 45)}s linear`;
        inner.style.transform = `translateX(-${overflow}px)`;
    });
    wrap.addEventListener('mouseleave', () =>
    {
        inner.style.transition = 'transform 0.25s ease';
        inner.style.transform = 'translateX(0)';
    });
    return wrap;
}

function makeHorusText(text)
{
    const glitch = document.createElement('s');
    glitch.className = 'horus--subtle';
    glitch.textContent = String(text).toUpperCase();
    glitch.style.opacity = '0.85';
    glitch.style.color = '#e50000';
    glitch.style.textDecoration = 'none';
    return glitch;
}

function makeUnknownName()
{
    return makeHorusText(getUnknownLabel());
}

function renderControlledChip()
{
    const tokens = getReferenceTokens();
    const chip = document.createElement('div');
    chip.className = 'la-mt-ref';
    if (!tokens.length)
    {
        const name = document.createElement('span');
        name.textContent = 'no token';
        name.style.color = '#999';
        chip.appendChild(name);
        return chip;
    }
    const first = tokens[0];
    const img = document.createElement('img');
    img.src = first.document.texture.src;
    chip.appendChild(img);
    if (tokens.length > 1)
    {
        const badge = document.createElement('span');
        badge.className = 'la-mt-ref-badge';
        badge.textContent = `×${tokens.length}`;
        chip.appendChild(badge);
    }
    else if (isKnownToken(first))
        chip.appendChild(makeScrollingName(first.name));
    else
        chip.appendChild(makeUnknownName());
    chip.title = 'Reference: the controlled token(s). Select tokens to change.';
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', () => canvas.animatePan({ x: first.center.x, y: first.center.y }));
    return chip;
}

function renderModeButtons()
{
    const group = document.createElement('div');
    group.className = 'la-mt-group la-mt-anchor';
    for (const { pattern, label, icon } of SHAPE_BUTTONS)
    {
        const active = _saved.mode === 'area' && _saved.pattern === pattern;
        const button = makeIconButton(icon, label, () =>
        {
            if (active)
            {
                setMode('free');
                return;
            }
            _saved.pattern = pattern;
            if (_saved.mode === 'area')
            {
                _controller?.setPattern(pattern);
                renderToolbar();
            }
            else
                setMode('area');
        });
        if (active)
            markActive(button, true);
        group.appendChild(button);
    }
    const markOn = _saved.mode === 'single';
    const single = makeIconButton('systems/lancer/assets/icons/reticule.svg', 'Target', () => setMode(markOn ? 'free' : 'single'));
    if (markOn)
        markActive(single, true);
    group.appendChild(single);
    if (_saved.mode === 'area')
        group.appendChild(renderAreaParamPopover());
    return group;
}

function makeParamRow(labelText, value, min, max, onValue)
{
    const row = document.createElement('div');
    row.className = 'la-mt-pop-row';
    const label = document.createElement('span');
    label.className = 'la-mt-pop-label';
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'la-mt-pop-input';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    const commit = next =>
    {
        const clamped = Math.max(min, Math.min(max, next));
        input.value = String(clamped);
        onValue(clamped);
    };
    const current = () => Number.parseInt(input.value) || min;
    input.addEventListener('change', () => commit(current()));
    const minus = makeIconButton('fa-solid fa-minus', 'Decrease', () => commit(current() - 1));
    const plus = makeIconButton('fa-solid fa-plus', 'Increase', () => commit(current() + 1));
    row.append(label, minus, input, plus);
    return { row };
}

function renderAreaParamPopover()
{
    const pop = makeParamPopover(_animateAreaControls);
    _animateAreaControls = false;
    const { row } = makeParamRow('Size', _saved.areaRange, 1, 99, next =>
    {
        _saved.areaRange = next;
        _controller?.setAreaRange(next);
    });
    pop.appendChild(row);
    pop.appendChild(renderToggleRow());
    return pop;
}

// Same toggles as accdiff injectToggleRow; Auto+Prop disabled when Elevation is off.
function renderToggleRow()
{
    const wrap = document.createElement('div');
    wrap.className = 'la-mt-toggles';
    const elevOn = _saved.elevationAware;
    const addToggle = (cls, text, tip, checked, disabled, apply) =>
    {
        const label = document.createElement('label');
        label.title = tip;
        if (disabled)
            label.style.opacity = '0.5';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = cls;
        checkbox.checked = checked;
        checkbox.disabled = disabled;
        checkbox.addEventListener('change', () =>
        {
            playUiSound('toggle');
            apply(checkbox.checked);
            _controller?.redraw();
            renderToolbar();
        });
        const span = document.createElement('span');
        span.textContent = text;
        label.append(checkbox, span);
        wrap.appendChild(label);
    };
    addToggle('la-tg-elev', 'Elev', 'Elevation aware', elevOn, false, value =>
    {
        _saved.elevationAware = value;
    });
    addToggle('la-tg-autoelev', 'Auto', 'Auto elevation from terrain', _saved.autoElevation, !elevOn, value =>
    {
        _saved.autoElevation = value;
    });
    addToggle('la-tg-prop', 'Prop', 'Propagation: area spreads cell-to-cell', _saved.propagation, !elevOn, value =>
    {
        _saved.propagation = value;
    });
    return wrap;
}

function renderRangeControls()
{
    const controlled = getReferenceTokens();
    const refToken = controlled[0] ?? null;
    const group = document.createElement('div');
    group.className = 'la-mt-group la-mt-anchor';
    // weapon is owner-only; a scanned enemy reference offers range/reach but not its weapon loadout
    const ownedRef = !!refToken?.isOwner;
    const hasWeapon = ownedRef ? getWeapons(refToken).length > 0 : false;
    const canResolve = value => value !== 'weapon' || (ownedRef && controlled.length === 1 && hasWeapon);
    const items = RANGE_SOURCES.map(src => ({
        value: src.value,
        icon: src.icon,
        label: src.value === 'weapon' && refToken && !hasWeapon ? 'Weapon (none)' : src.label,
        disabled: !canResolve(src.value),
    }));
    const dropdown = makeIconDropdown(_saved.rangeSource, items, (value) => applyRangeSource(value === _saved.rangeSource && value !== 'none' ? 'none' : value), (value) =>
    {
        if (value === 'weapon')
        {
            applyRangeSource('weapon');
            return;
        }
        const tokens = getReferenceTokens();
        if (!tokens.length)
            return;
        const allPinned = tokens.every(pinToken => hasRangePin(pinToken, value));
        for (const pinToken of tokens)
        {
            if (allPinned || !hasRangePin(pinToken, value))
                toggleRangePin(pinToken, value);
        }
    }, (value) =>
    {
        const tokens = getReferenceTokens();
        return tokens.length > 0 && tokens.every(pinToken => hasRangePin(pinToken, value));
    });
    group.appendChild(dropdown);

    const statSource = _saved.rangeSource !== 'manual' && _saved.rangeSource !== 'none';
    if (refToken && statSource && !isKnownToken(refToken))
    {
        group.appendChild(makeHorusText('?'));
        return group;
    }

    if (refToken && statSource && canResolve(_saved.rangeSource))
    {
        const radiusLabel = document.createElement('span');
        radiusLabel.textContent = `R ${computeRadiusForToken(refToken)}`;
        radiusLabel.style.minWidth = '34px';
        radiusLabel.style.textAlign = 'center';
        group.appendChild(radiusLabel);
    }

    if (_saved.rangeSource === 'manual')
        group.appendChild(renderManualPopover());
    else if (_saved.rangeSource === 'weapon')
        group.appendChild(renderWeaponPopover(refToken));
    return group;
}

function renderManualPopover()
{
    const pop = makeParamPopover(_animateRangeParam);
    _animateRangeParam = false;
    const { row } = makeParamRow('Range', _saved.manualRadius, 0, 99, next =>
    {
        _saved.manualRadius = next;
        rebuildPulse();
    });
    pop.appendChild(row);
    return pop;
}

function renderWeaponPopover(refToken)
{
    const pop = makeParamPopover(_animateRangeParam);
    _animateRangeParam = false;
    const weapons = refToken ? getWeapons(refToken) : [];
    if (!weapons.length)
    {
        const empty = document.createElement('div');
        empty.className = 'la-mt-pop-empty';
        empty.textContent = '(no weapons)';
        pop.appendChild(empty);
        return pop;
    }
    if (!_saved.weaponItemId || !weapons.some(weapon => weapon.id === _saved.weaponItemId))
        _saved.weaponItemId = weapons[0].id;
    const actor = refToken?.actor;
    for (const weapon of weapons)
    {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'la-mt-dd-item la-mt-weap-row';
        row.title = weapon.name;
        const name = document.createElement('span');
        name.className = 'la-mt-weap-n';
        name.textContent = weapon.name;
        const rng = document.createElement('span');
        rng.className = 'la-mt-weap-r';
        rng.innerHTML = weaponRangeHtml(weaponRangeMap(weapon, actor)) || `R ${weaponMaxRange(weapon, actor)}`;
        const star = document.createElement('span');
        star.className = 'la-hud-fav-mark';
        star.textContent = '★';
        star.style.display = hasRangePin(refToken, 'weapon', weapon.id) ? '' : 'none';
        row.style.position = 'relative';
        row.append(makeIcon(weaponTypeIcon(weapon) ?? 'mdi mdi-help-rhombus-outline'), name, rng, star);
        if (_saved.weaponItemId === weapon.id)
            row.classList.add('active');
        row.addEventListener('mouseenter', () => playUiSound('statusHover'));
        row.addEventListener('click', () =>
        {
            playUiSound('toggle');
            _saved.weaponItemId = weapon.id;
            rebuildPulse();
            renderToolbar();
        });
        row.addEventListener('contextmenu', (event) =>
        {
            suppressEvent(event);
            playUiSound('toggle');
            toggleRangePin(refToken, 'weapon', { weaponItemId: weapon.id });
            star.style.display = hasRangePin(refToken, 'weapon', weapon.id) ? '' : 'none';
        });
        pop.appendChild(row);
    }
    return pop;
}

function renderMoveToggle()
{
    const button = makeIconButton('fa-solid fa-person-running', 'Movement reach (speed tiers, terrain cost)', () =>
    {
        _saved.movementReachEnabled = !_saved.movementReachEnabled;
        rebuildMovementReach();
        renderToolbar();
        _emitStateChange();
    });
    if (_saved.movementReachEnabled)
        markActive(button, false);
    return button;
}

function renderLabelsToggle()
{
    const button = makeIconButton('fa-solid fa-ruler-horizontal', 'Tactical distance labels', () =>
    {
        _saved.tacticalLabels = !_saved.tacticalLabels;
        updateDistanceLabels();
        renderToolbar();
    });
    if (_saved.tacticalLabels)
        markActive(button, false);
    return button;
}

function renderToolbar()
{
    if (!_toolbarEl)
        return;
    _toolbarEl.replaceChildren();
    _toolbarEl.appendChild(renderBadge());
    _toolbarEl.appendChild(makeSep());
    _toolbarEl.appendChild(renderHelp());
    _toolbarEl.appendChild(makeSep());
    _toolbarEl.appendChild(renderControlledChip());
    _toolbarEl.appendChild(makeSep());
    _toolbarEl.appendChild(renderModeButtons());
    _toolbarEl.appendChild(makeSep());
    _toolbarEl.appendChild(renderRangeControls());
    if (isLancerRulerActive())
        _toolbarEl.appendChild(renderMoveToggle());
    _toolbarEl.appendChild(renderLabelsToggle());
    _toolbarEl.appendChild(makeSep());
    _toolbarEl.appendChild(makeButton('Clear', clearPlacements));
    _toolbarEl.appendChild(makeButton('✕', () => closeAdvancedMeasure()));
    _overToolbar = pointerOverToolbar();
}

// Sit just above the Foundry macro hotbar, tracking its collapse/expand/hide.
function positionAboveHotbar()
{
    if (!_toolbarEl)
        return;
    const hotbar = document.getElementById('hotbar');
    let bottom = 12;
    if (hotbar)
    {
        const rect = hotbar.getBoundingClientRect();
        if (rect.height > 0 && rect.top < window.innerHeight)
            bottom = Math.max(12, window.innerHeight - rect.top + 8);
    }
    _toolbarEl.style.bottom = `${bottom}px`;
}

function watchHotbar()
{
    positionAboveHotbar();
    _hotbarObserver?.disconnect();
    _hotbarObserver = null;
    const hotbar = document.getElementById('hotbar');
    if (hotbar && typeof ResizeObserver !== 'undefined')
    {
        _hotbarObserver = new ResizeObserver(() => positionAboveHotbar());
        _hotbarObserver.observe(hotbar);
    }
}

function onHotbarChange()
{
    if (_toolbarEl)
        watchHotbar();
}

function buildToolbar()
{
    injectStyles();
    _toolbarEl = document.createElement('div');
    _toolbarEl.id = 'la-measure-toolbar';
    _toolbarEl.className = 'lancer lancer-hud';
    try
    {
        const toolbarScale = Number(game.settings.get('lancer-automations', TOOLBAR_SCALE_KEY)) || 1;
        if (toolbarScale !== 1)
            _toolbarEl.style.setProperty('--la-mt-scale', String(toolbarScale));
    }
    catch
    { /* */ }
    _toolbarEl.addEventListener('mouseenter', () =>
    {
        _overToolbar = true;
    });
    _toolbarEl.addEventListener('mouseleave', () =>
    {
        _overToolbar = false;
        requestAnimationFrame(() =>
        {
            if (!_overToolbar && _hoverToken && !_hoverToken.hover)
            {
                _hoverToken = null;
                onSelectionChange();
            }
        });
    });
    document.body.appendChild(_toolbarEl);
    renderToolbar();
    watchHotbar();
    void _toolbarEl.offsetWidth;
    _toolbarEl.classList.add('la-show');
}

function removeToolbar()
{
    _hotbarObserver?.disconnect();
    _hotbarObserver = null;
    if (_toolbarEl)
    {
        _toolbarEl.remove();
        _toolbarEl = null;
    }
}

function beginLeaveAnimation()
{
    const element = _toolbarEl;
    if (!element)
    {
        _leaving = false;
        return;
    }
    _leaving = true;
    element.classList.remove('la-show');
    element.classList.add('la-hide');
    let fallbackTimer = null;
    const finish = () =>
    {
        element.removeEventListener('transitionend', onEnd);
        if (fallbackTimer)
            clearTimeout(fallbackTimer);
        _leaving = false;
        _leaveCleanup = null;
        if (_toolbarEl === element)
            removeToolbar();
    };
    const onEnd = (event) =>
    {
        if (event.target === element && event.propertyName === 'transform')
            finish();
    };
    element.addEventListener('transitionend', onEnd);
    fallbackTimer = setTimeout(finish, 320);
    _leaveCleanup = () =>
    {
        element.removeEventListener('transitionend', onEnd);
        if (fallbackTimer)
            clearTimeout(fallbackTimer);
    };
}

// Suppressed: bar greys and clears canvas overlays as if closed; restores on unsuppress.
function deactivateRunning()
{
    stopAreaMode();
    stopSingleMode();
    rangePulse.clear('advanced-measure');
    destroyMovementReach();
    setMeasureDistanceReference(null);
    setMeasureDistancePoint(null);
    if (_ctrlDistanceHeld)
        restoreTool();
    _ctrlDistanceHeld = false;
    setCanvasCursorHidden(false);
    showToolCursor(false);
    _saved.store?.setVisible(false);
    _saved.marks?.setVisible(false);
    _saved.whiteMarks?.setVisible(false);
    _toolbarEl?.classList.add('la-mt-suppressed');
}

function activateRunning()
{
    _saved.mode = 'free';
    _toolbarEl?.classList.remove('la-mt-suppressed');
    renderToolbar();
    _saved.store?.setVisible(true);
    _saved.marks?.setVisible(true);
    _saved.whiteMarks?.setVisible(true);
    rebuildPulse();
    rebuildMovementReach();
    updateDistanceLabels();
}

function updateSuppressed()
{
    const next = _hudDepth > 0 || _cardActive;
    if (next === _suppressed)
        return;
    _suppressed = next;
    if (_open)
    {
        if (_suppressed)
            deactivateRunning();
        else
            activateRunning();
    }
    syncSceneControls();
}

// Interactive cards (.la-info-card) are transient and never the measure toolbar (which is .lancer-hud).
function installSuppressionWatcher()
{
    if (_observer)
        return;
    if (!document.getElementById('la-measure-disabled-styles'))
    {
        const style = document.createElement('style');
        style.id = 'la-measure-disabled-styles';
        style.textContent = `
            body.la-measure-suppressed #controls .control-tool[data-tool="advancedMeasure"] { opacity: 0.4; filter: grayscale(0.7); }
            #controls .control-tool[data-tool="advancedMeasure"] .la-mt-control-icon { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; }
            #controls .control-tool[data-tool="advancedMeasure"] .la-mt-control-icon svg { width: 100%; height: 100%; display: block; }
            #controls .control-tool[data-tool="advancedMeasure"] .la-mt-control-icon svg path { fill: currentColor; }
        `;
        document.head.appendChild(style);
    }
    _observer = new MutationObserver(() =>
    {
        const present = !!document.querySelector('.la-info-card');
        if (present !== _cardActive)
        {
            _cardActive = present;
            updateSuppressed();
        }
    });
    _observer.observe(document.body, { childList: true, subtree: true });
}

export function openAdvancedMeasure(options)
{
    if (_open)
        return;
    if (!isMeasureControlAllowed())
        return;
    _open = true;
    _overToolbar = false;
    document.addEventListener('pointermove', onClientPointerMove, { capture: true, passive: true });
    _showPins();
    if (!_togglesSeeded)
    {
        try
        {
            _saved.elevationAware = !!game.settings.get('lancer-automations', 'tah.areaElevationAware');
        }
        catch
        { /* setting not ready */ }
        _togglesSeeded = true;
    }
    if (!options?.preserveMode)
        _saved.mode = 'free';
    if (_leaving && _toolbarEl)
    {
        _leaveCleanup?.();
        _leaving = false;
        _leaveCleanup = null;
        _toolbarEl.classList.remove('la-hide');
        renderToolbar();
        void _toolbarEl.offsetWidth;
        _toolbarEl.classList.add('la-show');
    }
    else
        buildToolbar();
    watchHotbar();
    document.addEventListener('keydown', onFreeEsc, true);
    document.addEventListener('wheel', onFreeWheel, { capture: true, passive: false });
    Hooks.on('controlToken', onSelectionChange);
    Hooks.on('hoverToken', onHoverToken);
    Hooks.on('renderHotbar', onHotbarChange);
    Hooks.on('combatStart', onCombatStateChange);
    Hooks.on('combatTurnChange', onCombatStateChange);
    Hooks.on('combatRound', onCombatStateChange);
    Hooks.on('deleteCombat', onCombatStateChange);
    Hooks.on('deleteToken', onWhiteMarkTokenDeleted);
    Hooks.on('updateItem', onProfileSwitched);
    window.addEventListener('resize', onHotbarChange);
    ensureWhiteMarkStore();
    const safeMark = makeSafe('advancedMeasureMark', () => closeAdvancedMeasure());
    _safeCtrlMove = safeMark(onCtrlMarkMove);
    _safeCtrlDown = safeMark(onCtrlMarkDown);
    _safeCtrlUp = safeMark(onCtrlMarkUp);
    _safeDistanceKey = safeMark(onDistanceKey);
    _safeDistanceBlur = safeMark(onDistanceBlur);
    canvas.stage.on('pointermove', _safeCtrlMove);
    document.addEventListener('pointerdown', _safeCtrlDown, true);
    document.addEventListener('pointerup', _safeCtrlUp, true);
    document.addEventListener('keydown', _safeDistanceKey, true);
    document.addEventListener('keyup', _safeDistanceKey, true);
    window.addEventListener('blur', _safeDistanceBlur);
    _ctrlIndicator = createCtrlMarkIndicator({ queryMarked: ctrlQueryMarked });
    _shapeMarker = createShapeTokenMarker();
    // Opening during an attack/card is allowed; it just comes up disabled.
    _cardActive = !!document.querySelector('.la-info-card');
    _suppressed = _hudDepth > 0 || _cardActive;
    if (_suppressed)
        deactivateRunning();
    else
    {
        _saved.store?.setVisible(true);
        _saved.marks?.setVisible(true);
        _saved.whiteMarks?.setVisible(true);
        rebuildPulse();
        rebuildMovementReach();
        updateDistanceLabels();
    }
    playUiSound('details');
    syncSceneControls();
    _emitStateChange();
}

export function closeAdvancedMeasure()
{
    if (!_open)
        return;
    _open = false;
    _overToolbar = false;
    document.removeEventListener('pointermove', onClientPointerMove, { capture: true });
    _hidePins();
    playUiSound('details');
    document.removeEventListener('keydown', onFreeEsc, true);
    document.removeEventListener('wheel', onFreeWheel, { capture: true });
    Hooks.off('controlToken', onSelectionChange);
    Hooks.off('hoverToken', onHoverToken);
    Hooks.off('renderHotbar', onHotbarChange);
    Hooks.off('combatStart', onCombatStateChange);
    Hooks.off('combatTurnChange', onCombatStateChange);
    Hooks.off('combatRound', onCombatStateChange);
    Hooks.off('deleteCombat', onCombatStateChange);
    Hooks.off('deleteToken', onWhiteMarkTokenDeleted);
    Hooks.off('updateItem', onProfileSwitched);
    window.removeEventListener('resize', onHotbarChange);
    if (_safeCtrlMove)
        canvas.stage.off('pointermove', _safeCtrlMove);
    document.removeEventListener('pointerdown', _safeCtrlDown, true);
    document.removeEventListener('pointerup', _safeCtrlUp, true);
    document.removeEventListener('keydown', _safeDistanceKey, true);
    document.removeEventListener('keyup', _safeDistanceKey, true);
    window.removeEventListener('blur', _safeDistanceBlur);
    _safeCtrlMove = null;
    _safeCtrlDown = null;
    _safeCtrlUp = null;
    _safeDistanceKey = null;
    _safeDistanceBlur = null;
    _markPaint = null;
    setMeasureDistancePoint(null);
    if (_ctrlDistanceHeld)
        restoreTool();
    _ctrlDistanceHeld = false;
    setCanvasCursorHidden(false);
    _ctrlIndicator?.dispose();
    _ctrlIndicator = null;
    showToolCursor(false);
    _ctrlCursorWorld = null;
    destroyShapeMarker();
    if (_selectionRaf)
    {
        cancelAnimationFrame(_selectionRaf);
        _selectionRaf = null;
    }
    _hoverToken = null;
    setMeasureDistanceReference(null);
    stopAreaMode();
    stopSingleMode();
    _saved.store?.setVisible(false);
    _saved.marks?.setVisible(false);
    rangePulse.clear('advanced-measure');
    destroyMovementReach();
    _saved.whiteMarks?.setVisible(false);
    _toolbarEl?.classList.remove('la-mt-suppressed');
    beginLeaveAnimation();
    syncSceneControls();
    _emitStateChange();
}

export function toggleAdvancedMeasure()
{
    if (_open)
        closeAdvancedMeasure();
    else
        openAdvancedMeasure();
}

function _emitStateChange()
{
    try
    {
        Hooks.callAll('lancer-automations.advancedMeasureStateChange', getAdvancedMeasureState());
    }
    catch (err)
    {
        console.warn('lancer-automations | advancedMeasureStateChange hook failed', err);
    }
}

export function getAdvancedMeasureState()
{
    return {
        open: _open,
        mode: _saved.mode,
        pattern: _saved.pattern,
        areaRange: _saved.areaRange,
        rangeSource: _saved.rangeSource,
        manualRadius: _saved.manualRadius,
        weaponItemId: _saved.weaponItemId,
        pulseEnabled: _saved.pulseEnabled,
        movementReachEnabled: _saved.movementReachEnabled,
    };
}

const _STATE_KEYS = new Set(['mode', 'pattern', 'areaRange', 'rangeSource', 'manualRadius', 'weaponItemId', 'pulseEnabled', 'movementReachEnabled']);

export async function setAdvancedMeasureState(patch)
{
    if (!patch || typeof patch !== 'object')
        return;
    let changed = false;
    for (const [key, value] of Object.entries(patch))
    {
        if (!_STATE_KEYS.has(key))
            continue;
        if (_saved[key] !== value)
        {
            _saved[key] = value;
            changed = true;
        }
    }
    if (!changed)
        return;
    if (_open)
    {
        rebuildPulse();
        rebuildMovementReach();
        renderToolbar();
    }
    _emitStateChange();
}

export async function openAdvancedMeasureWithState(patch)
{
    const preserveMode = patch && Object.prototype.hasOwnProperty.call(patch, 'mode');
    if (!_open)
        openAdvancedMeasure({ preserveMode });
    await setAdvancedMeasureState(patch);
}

export function isAdvancedMeasureActive()
{
    return _open;
}

export function resetAdvancedMeasureState()
{
    _saved.store?.destroy();
    _saved.store = null;
    _saved.marks?.destroy();
    _saved.marks = null;
    _saved.whiteMarks?.destroy();
    _saved.whiteMarks = null;
    _saved.mode = 'free';
    _saved.pattern = 'blast';
    _saved.areaRange = 1;
    _saved.size = 1;
    _saved.rangeSource = 'none';
    _saved.manualRadius = 5;
    _saved.weaponItemId = null;
    _saved.elevationAware = true;
    _saved.autoElevation = true;
    _saved.propagation = false;
    _saved.pulseEnabled = false;
    _saved.movementReachEnabled = false;
    _saved.tacticalLabels = false;
    destroyMovementReach();
    destroyShapeMarker();
    _togglesSeeded = false;
    _suppressed = false;
    _hudDepth = 0;
    _cardActive = false;
}

// Disable the tool while an attack/damage/HASE HUD is up (and watch for interactive cards).
export function initAdvancedMeasureAutoClose()
{
    if (_autoCloseInstalled)
        return;
    _autoCloseInstalled = true;
    initGlobalCtrlRuler();
    installSuppressionWatcher();
    for (const stepName of ['showAttackHUD', 'showDamageHUD', 'showStatRollHUD'])
    {
        const original = game.lancer?.flowSteps?.get?.(stepName);
        if (!original)
            continue;
        game.lancer.flowSteps.set(stepName, async function(state, options)
        {
            _hudDepth++;
            updateSuppressed();
            try
            {
                return await original(state, options);
            }
            finally
            {
                _hudDepth = Math.max(0, _hudDepth - 1);
                updateSuppressed();
            }
        });
    }
}

Hooks.on('canvasTearDown', () =>
{
    closeAdvancedMeasure();
    resetAdvancedMeasureState();
});

// Syncs open/suppressed state; CSS body class survives re-renders, tool.active keeps foreign renders correct.
function syncSceneControls()
{
    const active = _open;
    for (const group of Object.values(ui.controls?.controls ?? {}))
    {
        const tools = group?.tools;
        const tool = Array.isArray(tools) ? tools.find(existing => existing.name === 'advancedMeasure') : tools?.advancedMeasure;
        if (tool)
            tool.active = active;
    }
    document.body.classList.toggle('la-measure-suppressed', _suppressed);
    const button = document.querySelector('#controls .control-tool[data-tool="advancedMeasure"]');
    if (button)
        button.classList.toggle('active', active);
}

function measureShortcutLabel()
{
    try
    {
        const binding = game.keybindings.get('lancer-automations', 'advancedMeasure')?.[0];
        if (!binding?.key)
            return 'Shift + R';
        const key = binding.key.replace(/^Key/, '').replace(/^Digit/, '');
        return [...(binding.modifiers ?? []), key].join(' + ');
    }
    catch
    {
        return 'Shift + R';
    }
}

// Adds toggle below ruler; handles v12 array and v13 record shapes; handler-driven to prevent active desync.
Hooks.on('getSceneControlButtons', (controls) =>
{
    const setActive = (active) =>
    {
        if (active)
            openAdvancedMeasure();
        else
            closeAdvancedMeasure();
    };
    const tool = {
        name: 'advancedMeasure',
        title: 'Advanced Measure Tool',
        icon: 'la-mt-control-icon',
        toggle: true,
        active: isAdvancedMeasureActive(),
        onClick: (active) => setActive(active),
        onChange: (event, active) => setActive(active ?? !isAdvancedMeasureActive()),
        toolclip: {
            heading: 'Advanced Measure Tool',
            items: [
                { paragraph: 'Measure with AoE shapes and targets, Shift+click to mark tokens/hexes, and pulse a range around the controlled token(s).' },
                { heading: 'Toggle', reference: measureShortcutLabel() },
            ],
        },
    };
    if (!Array.isArray(controls))
    {
        const group = controls.tokens ?? controls.token;
        if (!group?.tools)
            return;
        const rulerOrder = group.tools.ruler?.order;
        tool.order = (typeof rulerOrder === 'number' ? rulerOrder : Object.keys(group.tools).length) + 0.5;
        group.tools[tool.name] = tool;
        return;
    }
    const group = controls.find(control => control.name === 'token' || control.name === 'tokens');
    if (!group?.tools)
        return;
    const rulerIndex = group.tools.findIndex(existing => existing.name === 'ruler');
    if (rulerIndex >= 0)
        group.tools.splice(rulerIndex + 1, 0, tool);
    else
        group.tools.push(tool);
});

// Inject sextant SVG after controls render (bare class, not glyph) to survive FA SVG mode and crlngn restyling.
let _sextantSvg = null;
function injectControlIcon(svg)
{
    for (const node of Array.from(document.querySelectorAll('.la-mt-control-icon')))
        node.innerHTML = svg;
}
function paintControlIcon()
{
    if (_sextantSvg)
    {
        injectControlIcon(_sextantSvg);
        return;
    }
    fetch(sextantIconUrl())
        .then(response => response.text())
        .then(text =>
        {
            _sextantSvg = text;
            injectControlIcon(text);
        })
        .catch(() =>
        {});
}

function isMeasureControlAllowed()
{
    const activeName = ui.controls?.control?.name;
    return activeName === 'token' || activeName === 'tokens' || activeName === 'templates';
}
Hooks.on('renderSceneControls', () =>
{
    paintControlIcon();
    if (_open && !isMeasureControlAllowed())
        closeAdvancedMeasure();
});
