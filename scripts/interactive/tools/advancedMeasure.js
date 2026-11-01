/* global canvas, game, document, Hooks, PIXI, performance, MutationObserver, ui, requestAnimationFrame, cancelAnimationFrame, ResizeObserver, window */
// Standalone per-client measure tool: shape placement + targets + Ctrl+click marks + a reference range pulse,
// built on the shared shape-placement engine and the range-pulse manager. style:ignore

import { createShapePlacement, createPlacedShapeStore } from "../shape-placement-engine.js";
import { getModuleSetting } from "../../tools/settings-utils.js";
import { localize } from "../../tools/string-utils.js";
import { MODULE_ID } from "../../tools/constants.js";
import {
    pointerToWorld, makeSafe, suppressTokenInteraction, addGraphicsBelowTokens, addGraphicsAboveTokens,
    destroyGraphics, paintSingleMarkCursor, gridLineWidth, TG, createMergedRangeHighlight, RANGE_GLOW,
    createCtrlMarkIndicator,
    suppressEvent,
} from "../canvas-helpers.js";
import { isHexGrid, getHexCenter, pixelToOffset, drawHexAt, getOccupiedOffsets } from "../../combat/grid-helpers.js";
import { rangePulse, RANGE_PULSE_PRIORITY } from "../range-pulse-manager.js";
import { createMovementReachHighlight } from "../movement-reach-highlight.js";
import { isLancerRulerActive } from "../../movement/cost-rules.js";
import { drawSightlines, clearSightlines } from "../../vision/sightlines.js";
import { initGlobalCtrlRuler, showToolCursor, setCanvasCursorHidden, tokenDragActive, ctrlRulerMode, CTRL_RULER_HOLD_MS } from "./measureToolCursor.js";
export { setPickerTargetCursor } from "./measureToolCursor.js";
import { getActorMaxThreat, getWeaponProfiles_WithBonus } from "../../tools/misc-tools.js";
import { getActorMaxReach_WithBonus, getActorReachBands_WithBonus, weaponIgnoresLineOfSight, getSensorRange_WithBonus, getWeaponReachRange } from "../../tools/weapon-bonus-utils.js";
import { getWeapons } from "../deployables.js";
import { weaponTypeIcon } from "../../tah/item-helpers.js";
import { isActorRevealedToUser, getUnknownLabel } from "../../tah/tokenStatHint.js";
import { setMeasureDistanceReference, setMeasureDistancePoint } from "../../movement/tactical-distance.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";
import { getSettingEnabled } from "../../setup/settings-register.js";
import { isTokenVisible } from "../../utils/lancer-token.js";
import { isTypingTarget } from "../keybindings.js";
import { injectStyles } from "./measureStyles.js";
import { createSingleMarkStore } from "./measureMarkStore.js";

let _open = false;
let _controller = null;
let _singleActive = false;
let _singleCursor = null;
let _singleHandlers = null;
let _toolbarEl = null;
let _observer = null;
let _autoCloseInstalled = false;
let _leaving = false;
let _leaveCleanup = null;
let _togglesSeeded = false;
let _suppressed = false;
let _hudDepth = 0;
let _cardActive = false;
let _hotbarObserver = null;
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
    losEye: false,
    losBySource: {},
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
        if (!isTokenVisible(token))
            return false;
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
        if (isValidRef(token) && isTokenVisible(token))
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
        return actor.type === 'pilot' ? 5 : getSensorRange_WithBonus(actor);
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

// Untouched sources keep their own rule: a weapon's Arcing/Seeking tags, reach's free band.
function losStateFor(source)
{
    const stored = _saved.losBySource?.[source];
    return typeof stored === 'boolean' ? stored : source !== 'manual';
}

function toggleLosState(source)
{
    _saved.losBySource = { ..._saved.losBySource, [source]: !losStateFor(source) };
}

// Weapon, reach, sensor and threat ranges follow line of sight; Arcing/Seeking reach stays free.
function losInfoForToken(token, range, source = _saved.rangeSource)
{
    const none = { los: false, freeRange: 0 };
    const stored = _saved.losBySource?.[source];
    if (stored === false)
        return none;
    if (stored === true)
        return { los: true, freeRange: 0 };
    if (source === 'manual')
        return none;
    if (source === 'sensor' || source === 'threat')
        return { los: true, freeRange: 0 };
    if (source !== 'weapon' && source !== 'reach')
        return none;
    const actor = token?.actor;
    if (!actor)
        return none;
    if (source === 'weapon' && token.isOwner)
    {
        const weapon = actor.items.get(_saved.weaponItemId) ?? getWeapons(token)[0];
        if (weapon)
            return { los: !weaponIgnoresLineOfSight(weapon), freeRange: 0 };
    }
    const freeMax = Math.min(range, getActorReachBands_WithBonus(actor).freeMax);
    return { los: range > freeMax, freeRange: freeMax };
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
    return getWeaponReachRange(weapon, actor);
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

// Re-insert pin graphics so the pulse, built later, cannot bury the coloured rings.
function _raisePins()
{
    for (const pinGroup of _pinGroups.values())
    {
        for (const graphic of pinGroup.graphics ?? [])
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
}

function _syncPinFill()
{
    const visible = rangePulse.activeOwner() !== 'advanced-measure';
    for (const graphic of _pinGroups.get('__fill')?.graphics ?? [])
        graphic.visible = visible;
}

Hooks.on('lancer-automations.rangePulseChanged', () =>
{
    _syncPinFill();
    _raisePins();
});

// Pins of the same source merge into one union region, pulse-style minus the wave.
function _rebuildPinVisuals()
{
    _hidePins();
    const bySource = new Map();
    for (const pin of _rangePins.values())
    {
        const token = canvas.tokens.get(pin.tokenId);
        if (!token || token.destroyed)
            continue;
        if (!bySource.has(pin.source))
            bySource.set(pin.source, []);
        bySource.get(pin.source).push({ token, range: pin.range, ...losInfoForToken(token, pin.range, pin.source) });
    }

    const allEntries = [...bySource.values()].flat();
    if (allEntries.length)
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
    _syncPinFill();
    _raisePins();
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
        .filter(([, distance]) => distance > 0)
        .sort(([typeA], [typeB]) => RANGE_TYPE_ORDER.indexOf(String(typeA).toLowerCase()) - RANGE_TYPE_ORDER.indexOf(String(typeB).toLowerCase()))
        .map(([type, distance]) => `<i class="cci ${RANGE_TYPE_CCI[String(type).toLowerCase()] ?? 'cci-range'}"></i>${distance}`);
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
            entries.push({ token, range, ...losInfoForToken(token, range) });
    }
    if (_saved.rangeSource === 'manual' && _saved.manualRadius > 0)
    {
        for (const mark of groundMarks())
            entries.push({ point: getHexCenter(mark.col, mark.row), range: _saved.manualRadius });
    }
    if (_suppressed || _saved.rangeSource === 'none' || !entries.length)
    {
        rangePulse.clear('advanced-measure');
        return;
    }
    const glowColor = RANGE_GLOW[_saved.rangeSource] ?? RANGE_GLOW.manual;
    const signature = `${_saved.rangeSource}|` + entries.map(entry => entry.token ? `${entry.token.document.id}:${entry.range}:${entry.los === true}:${entry.freeRange ?? 0}` : `c:${entry.point.x},${entry.point.y}:${entry.range}`).sort().join('|');
    rangePulse.set('advanced-measure', {
        priority: RANGE_PULSE_PRIORITY.MEASURE,
        signature,
        build: () => createMergedRangeHighlight(entries, { includeSelf: true, glowColor }),
    });
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
            if (token && isTokenVisible(token))
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
    let lastKey = '';
    const tick = () =>
    {
        if (gfx.destroyed)
        {
            canvas.app.ticker.remove(tick);
            return;
        }
        const cells = new Set(_open && !_suppressed ? [...(_saved.store?.cells ?? []), ...targetCells()] : []);
        if (!cells.size)
        {
            if (lastKey)
                gfx.clear();
            lastKey = '';
            return;
        }
        gfx.alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
        const tokens = (canvas.tokens?.placeables ?? []).filter(isTokenVisible);
        const key = `${[...cells].join(';')}|${tokens.map(token => `${token.id}:${token.document.x}:${token.document.y}:${token.document.width}:${token.document.height}`).join(';')}`;
        if (key === lastKey)
            return;
        lastKey = key;
        gfx.clear();
        gfx.lineStyle(gridLineWidth(4), TG.placed, 0.9);
        gfx.beginFill(TG.placed, 0.2);
        for (const token of tokens)
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
    refreshLosEye();
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
    {
        refreshLosEye();
        onSelectionChange();
    }
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

const TOOLBAR_SCALE_KEY = 'tah.uiScale';
Hooks.on(`${MODULE_ID}.uiScaleChanged`, (value) =>
{
    if (!_toolbarEl)
        return;
    _toolbarEl.style.setProperty('--la-mt-scale', String(Number(value) || 1));
    pinBarLeft();
});
Hooks.once('init', () =>
{
    game.keybindings.register(MODULE_ID, 'advancedMeasureNextSource', {
        name: 'LA.keybindings.advancedMeasureNextSource.name',
        hint: 'LA.keybindings.advancedMeasureNextSource.hint',
        editable: [{ key: 'KeyT' }],
        onDown: () =>
        {
            if (!_open || _suppressed)
                return false;
            cycleRangeSource();
            return true;
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
    });
    game.keybindings.register(MODULE_ID, 'advancedMeasureClear', {
        name: 'LA.keybindings.advancedMeasureClear.name',
        hint: 'LA.keybindings.advancedMeasureClear.hint',
        editable: [{ key: 'KeyG', modifiers: ['SHIFT'] }],
        onDown: () =>
        {
            if (!_open || _suppressed)
                return false;
            playUiSound('toggle');
            clearPlacements();
            return true;
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });
    game.keybindings.register(MODULE_ID, 'advancedMeasureClose', {
        name: 'LA.keybindings.advancedMeasureClose.name',
        hint: 'LA.keybindings.advancedMeasureClose.hint',
        uneditable: [{ key: 'Escape' }],
        onDown: onMeasureEscape,
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    });
});

function cycleRangeSource()
{
    const refs = getReferenceTokens();
    const weaponOk = refs.length === 1 && refs[0]?.isOwner && getWeapons(refs[0]).length > 0;
    const values = RANGE_SOURCES.map(src => src.value).filter(value => value !== 'weapon' || weaponOk);
    const idx = values.indexOf(_saved.rangeSource);
    applyRangeSource(values[(idx + 1) % values.length]);
    playUiSound('toggle');
}

let _ctrlArmTimer = null;

function cancelCtrlArm()
{
    clearTimeout(_ctrlArmTimer);
    _ctrlArmTimer = null;
}

function setCtrlDistance(on)
{
    if (on === _ctrlDistanceHeld)
        return;
    _ctrlDistanceHeld = on;
    playUiSound('toggle');
    if (on)
        activateRuler();
    else
        restoreTool();
    setCanvasCursorHidden(on);
    showToolCursor(on, 'ruler');
    if (on)
        pushDistancePoint();
    else
        setMeasureDistancePoint(null);
}

function onDistanceKey(event)
{
    if (event.key !== 'Control')
    {
        if (event.type === 'keydown')
            cancelCtrlArm();
        return;
    }
    if (_suppressed)
        return;
    // 'always' mode is handled by the global layer (works with the tool closed too).
    if (ctrlRulerMode() !== 'tool' || !_open)
        return;
    if (event.type === 'keyup')
    {
        cancelCtrlArm();
        setCtrlDistance(false);
        return;
    }
    if (event.repeat || _ctrlDistanceHeld || _ctrlArmTimer || tokenDragActive() || isTypingTarget(event.target))
        return;
    _ctrlArmTimer = setTimeout(() =>
    {
        _ctrlArmTimer = null;
        if (_open && !_suppressed && !tokenDragActive())
            setCtrlDistance(true);
    }, CTRL_RULER_HOLD_MS);
}

function onDistanceBlur()
{
    cancelCtrlArm();
    if (!_ctrlDistanceHeld)
        return;
    _ctrlDistanceHeld = false;
    restoreTool();
    setCanvasCursorHidden(false);
    showToolCursor(false);
    setMeasureDistancePoint(null);
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

// In Free mode Escape closes the tool once Foundry has nothing to dismiss; area/single handle their own Escape (return to Free).
function onMeasureEscape(context)
{
    if (!_open || _suppressed || _saved.mode !== 'free' || context?.event?.defaultPrevented)
        return false;
    if (canvas.currentMouseManager || ui.menu?.rendered || ui.context?.element || foundry.nue?.Tour?.tourInProgress)
        return false;
    if (Object.keys(ui.windows ?? {}).length || [...foundry.applications.instances.values()].some(app => app.hasFrame && app.rendered))
        return false;
    if (_openMenu)
        setOpenMenu(null);
    else
        closeAdvancedMeasure();
    return true;
}

// Free mode has no capturing engine; Shift+wheel here bumps the manual radius (area mode owns Shift+wheel itself).
function applyRangeSource(value)
{
    _saved.rangeSource = value;
    _saved.pulseEnabled = value !== 'none';
    rebuildPulse();
    renderToolbar();
    _emitStateChange();
}

function onFreeWheel(event)
{
    if (event.ctrlKey)
        cancelCtrlArm();
    if (!_open || _suppressed || _saved.mode === 'area')
        return;
    if (event.shiftKey && _saved.mode === 'free' && _saved.rangeSource === 'manual')
    {
        event.preventDefault();
        event.stopPropagation();
        setManualRadiusFromWheel(_saved.manualRadius + (event.deltaY < 0 ? 1 : -1));
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
        visibleOnly: true,
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
        paintSingleMarkCursor(cursorGfx, x, y, { tokens: canvas.tokens.placeables.filter(isTokenVisible) });
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
        renderToolbar();
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
        renderToolbar();
    });
    const onKey = safe((event) =>
    {
        if (event.key === 'Escape' && !isTypingInToolbar(event) && !isTypingTarget(event.target))
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

let _wheelRebuildTimer = null;
const WHEEL_REBUILD_HOLD_MS = 120;

// Every wheel tick would rebuild the pulse in full, so the number updates at once and the pulse waits for the wheel to stop.
function setManualRadiusFromWheel(value)
{
    _saved.manualRadius = Math.max(0, value);
    renderToolbar();
    if (_wheelRebuildTimer !== null)
        clearTimeout(_wheelRebuildTimer);
    _wheelRebuildTimer = setTimeout(() =>
    {
        _wheelRebuildTimer = null;
        if (_open)
            rebuildPulse();
    }, WHEEL_REBUILD_HOLD_MS);
}

function clearPlacements()
{
    _saved.store?.destroy();
    _saved.marks?.clear();
    _saved.whiteMarks?.clear();
    _controller?.redraw();
    refreshLosEye();
    onSelectionChange();
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
    button.title = localize(title);
    button.appendChild(makeIcon(iconClass));
    button.addEventListener('mouseenter', () => playUiSound('statusHover'));
    button.addEventListener('click', () =>
    {
        playUiSound('toggle');
        onClick();
    });
    return button;
}

// Labels are keys, not text: this runs at import time, before i18n is loaded.
const RANGE_SOURCES = [
    { value: 'none', label: 'LA.measure.source.none', icon: 'systems/lancer/assets/icons/status_downandout.svg' },
    { value: 'manual', label: 'LA.measure.source.manual', icon: 'systems/lancer/assets/icons/range.svg' },
    { value: 'threat', label: 'LA.measure.source.threat', icon: 'cci cci-threat' },
    { value: 'sensor', label: 'LA.measure.source.sensor', icon: 'cci cci-sensor' },
    { value: 'reach', label: 'LA.measure.source.reach', icon: 'systems/lancer/assets/icons/nested_hexagons.svg' },
    { value: 'weapon', label: 'LA.measure.source.weapon', icon: 'cci cci-weapon' },
];

const SHAPE_BUTTONS = [
    { pattern: 'blast', label: 'LA.measure.shape.blast', icon: 'cci cci-blast' },
    { pattern: 'burst', label: 'LA.measure.shape.burst', icon: 'cci cci-burst' },
    { pattern: 'cone', label: 'LA.measure.shape.cone', icon: 'cci cci-cone' },
    { pattern: 'line', label: 'LA.measure.shape.line', icon: 'cci cci-line' },
];

function makeMenuColumn(iconClass, title, on, disabled, onClick)
{
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `la-mt-dd-item la-mt-dd-col${on ? ' la-mt-dd-col-on' : ''}`;
    button.title = localize(title);
    button.disabled = disabled;
    const icon = document.createElement('i');
    icon.className = iconClass;
    button.appendChild(icon);
    button.addEventListener('click', (event) =>
    {
        suppressEvent(event);
        playUiSound('toggle');
        onClick();
    });
    return button;
}

function renderRangeDropdown(items)
{
    const open = _openMenu === 'range';
    const wrap = document.createElement('div');
    wrap.className = 'la-mt-dd';
    wrap.dataset.menu = 'range';
    const currentItem = items.find(item => item.value === _saved.rangeSource) ?? null;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `lancer-action-btn la-mt-dd-trigger${currentItem ? '' : ' la-mt-placeholder'}`;
    if (currentItem)
        markActive(trigger);
    const labelText = localize(currentItem?.label ?? 'LA.measure.range');
    trigger.title = labelText;
    const label = document.createElement('span');
    label.className = 'la-mt-dd-label';
    label.textContent = labelText;
    trigger.append(makeIcon(currentItem?.icon ?? 'systems/lancer/assets/icons/range.svg'), label);
    if (currentItem?.number)
    {
        const value = document.createElement('b');
        value.className = 'la-mt-dd-val';
        value.textContent = currentItem.number;
        trigger.appendChild(value);
    }
    const pinCount = items.filter(item => item.pinned).length;
    if (pinCount)
    {
        const pins = document.createElement('span');
        pins.className = 'la-mt-dd-pins';
        pins.textContent = `★${pinCount}`;
        trigger.appendChild(pins);
    }
    const caret = document.createElement('i');
    caret.className = 'fa-solid fa-caret-down la-mt-dd-caret';
    trigger.appendChild(caret);
    trigger.addEventListener('mouseenter', () => playUiSound('statusHover'));
    trigger.addEventListener('click', () =>
    {
        playUiSound('toggle');
        setOpenMenu(open ? null : 'range');
    });
    const panel = document.createElement('div');
    panel.className = `la-mt-dd-panel${open ? ' open' : ''}`;
    if (open)
    {
        const losColumn = getSettingEnabled('rangePulseLos');
        for (const item of items)
        {
            const active = item.value === _saved.rangeSource;
            const entry = document.createElement('div');
            entry.className = `la-mt-dd-entry${active ? ' active' : ''}`;
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `la-mt-dd-item${active ? ' active' : ''}`;
            row.disabled = item.disabled;
            row.title = localize(item.label);
            const name = document.createElement('span');
            name.textContent = localize(item.label);
            const number = document.createElement('b');
            number.className = 'la-mt-dd-num';
            number.textContent = item.number;
            row.append(makeIcon(item.icon), name, number);
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
                setOpenMenu(null);
                applyRangeSource(active ? 'none' : item.value);
            });
            row.addEventListener('contextmenu', (event) =>
            {
                suppressEvent(event);
                if (item.disabled)
                    return;
                playUiSound('toggle');
                toggleSourcePin(item.value);
                renderToolbar();
            });
            entry.appendChild(row);
            // sibling button, never nested: the row button owns its whole hit area
            entry.appendChild(makeMenuColumn('fa-solid fa-thumbtack', 'LA.measure.pin', item.pinned, item.disabled, () =>
            {
                toggleSourcePin(item.value);
                renderToolbar();
            }));
            if (losColumn)
            {
                const sightOn = losStateFor(item.value);
                entry.appendChild(makeMenuColumn(sightOn ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash', sightOn ? 'LA.measure.sightOn' : 'LA.measure.sightOff', sightOn, item.disabled, () =>
                {
                    toggleLosState(item.value);
                    rebuildPulse();
                    _emitStateChange();
                    renderToolbar();
                }));
            }
            panel.appendChild(entry);
        }
        const foot = document.createElement('div');
        foot.className = 'la-mt-dd-foot';
        foot.textContent = localize('LA.measure.clickAgainOff');
        panel.appendChild(foot);
    }
    wrap.append(trigger, panel);
    return wrap;
}

function markActive(button)
{
    button.classList.add('la-mt-active');
    // inline !important beats the library's layered .lancer-action-btn color:!important
    button.style.setProperty('color', 'var(--light-text, #fff)', 'important');
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

let _openMenu = null;
let _menuOutside = null;

function setOpenMenu(name)
{
    _openMenu = name;
    if (_menuOutside)
    {
        document.removeEventListener('mousedown', _menuOutside, true);
        _menuOutside = null;
    }
    if (name)
    {
        _menuOutside = (event) =>
        {
            if (!_toolbarEl?.querySelector(`[data-menu="${name}"]`)?.contains(event.target))
                setOpenMenu(null);
        };
        document.addEventListener('mousedown', _menuOutside, true);
    }
    renderToolbar();
}

function keyLabel(action, fallback = '')
{
    try
    {
        const binding = game.keybindings.get(MODULE_ID, action)?.[0];
        if (!binding?.key)
            return fallback;
        const key = binding.key.replace(/^Key/, '').replace(/^Digit/, '');
        return [...(binding.modifiers ?? []), key].join('+');
    }
    catch
    {
        return fallback;
    }
}

const HELP_ROWS = [
    { group: 'LA.measure.help.group.place' },
    { name: 'LA.measure.help.shapeButton', text: 'LA.measure.help.armShape' },
    { kbd: 'LA.measure.help.key.click', text: 'LA.measure.help.dropShape' },
    { kbd: 'LA.measure.help.key.shiftWheel', text: 'LA.measure.help.size' },
    { kbd: 'LA.measure.help.key.ctrlWheel', text: 'LA.measure.help.turn' },
    { bind: ['elevationDown', 'elevationUp'], text: 'LA.measure.help.height' },
    { bind: ['lineTiltDown', 'lineTiltUp'], text: 'LA.measure.help.tilt' },
    { bind: ['resetShape'], text: 'LA.measure.help.reset' },
    { group: 'LA.measure.help.group.mark' },
    { name: 'LA.measure.mark', text: 'LA.measure.help.markGold' },
    { kbd: 'LA.measure.help.key.shiftClick', text: 'LA.measure.help.markShift' },
    { name: 'LA.measure.help.markedToken', text: 'LA.measure.help.markedTokenText' },
    { name: 'LA.measure.help.markedHex', text: 'LA.measure.help.markedHexText' },
    { name: 'LA.measure.help.eye', text: 'LA.measure.help.eyeText' },
    { group: 'LA.measure.help.group.range' },
    { name: 'LA.measure.help.hoverSelect', text: 'LA.measure.help.measureFrom' },
    { bind: ['advancedMeasureNextSource'], text: 'LA.measure.help.nextSource' },
    { kbd: 'LA.measure.help.key.rightClick', text: 'LA.measure.help.pinSource' },
    { group: 'LA.measure.help.group.bar' },
    { kbd: 'LA.measure.help.key.holdCtrl', text: 'LA.measure.help.ruler' },
    { bind: ['advancedMeasureClear'], text: 'LA.measure.help.clear' },
    { kbd: 'LA.measure.help.key.esc', text: 'LA.measure.help.esc' },
    { bind: ['advancedMeasure'], text: 'LA.measure.help.close' },
];

function renderHelpCard()
{
    const card = document.createElement('div');
    const open = _openMenu === 'help';
    card.className = `la-mt-helpcard${open ? ' open' : ''}`;
    if (!open)
        return card;
    for (const row of HELP_ROWS)
    {
        if (row.group)
        {
            const heading = document.createElement('h5');
            heading.textContent = localize(row.group);
            card.appendChild(heading);
            continue;
        }
        const line = document.createElement('div');
        line.className = 'la-mt-help-row';
        const cell = document.createElement(row.name ? 'b' : 'kbd');
        if (row.bind)
            cell.textContent = row.bind.map(action => keyLabel(action, '?')).join(' / ');
        else
            cell.textContent = localize(row.name ?? row.kbd);
        const text = document.createElement('span');
        text.textContent = localize(row.text);
        line.append(cell, text);
        card.appendChild(line);
    }
    const foot = document.createElement('div');
    foot.className = 'la-mt-help-foot';
    const note = document.createElement('span');
    note.textContent = localize('LA.measure.help.keysFollow');
    const tour = document.createElement('a');
    tour.textContent = localize('LA.measure.help.tour');
    tour.addEventListener('click', () =>
    {
        setOpenMenu(null);
        import('../../setup/tour.js').then(module => module.startAdvMeasureTour());
    });
    foot.append(note, tour);
    card.appendChild(foot);
    return card;
}

function renderBadge()
{
    const badge = document.createElement('span');
    badge.className = 'la-mt-badge';
    badge.title = localize('LA.measure.advancedMeasureTool');
    const icon = document.createElement('img');
    icon.className = 'la-mt-badge-icon';
    icon.src = sextantIconUrl();
    icon.alt = '';
    badge.appendChild(icon);
    return badge;
}

function renderHelp()
{
    const open = _openMenu === 'help';
    const wrap = document.createElement('div');
    wrap.className = 'la-mt-help-wrap';
    wrap.dataset.menu = 'help';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `la-mt-help${open ? ' open' : ''}`;
    button.title = localize('LA.measure.help.title');
    button.textContent = '?';
    button.addEventListener('mouseenter', () => playUiSound('statusHover'));
    button.addEventListener('click', () =>
    {
        playUiSound('toggle');
        setOpenMenu(open ? null : 'help');
    });
    wrap.append(button, renderHelpCard());
    return wrap;
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

function makeUnknownName(token)
{
    return makeHorusText(getUnknownLabel(token?.document ?? token));
}

function renderControlledChip()
{
    const tokens = getReferenceTokens();
    const chip = document.createElement('div');
    chip.className = 'la-mt-ref';
    if (!tokens.length)
    {
        const name = document.createElement('span');
        name.textContent = localize('LA.measure.noToken');
        name.style.color = '#999';
        chip.appendChild(name);
        return chip;
    }
    const first = tokens[0];
    for (const token of tokens.slice(0, 3))
    {
        const img = document.createElement('img');
        img.src = token.document.texture.src;
        chip.appendChild(img);
    }
    const text = document.createElement('span');
    text.className = 'la-mt-ref-text';
    let origin = 'marked';
    if (_hoverToken && isValidRef(_hoverToken))
        origin = 'hover';
    else if (getControlled().some(isValidRef))
        origin = 'selected';
    const tag = document.createElement('b');
    tag.className = `la-mt-ref-tag la-mt-ref-tag-${origin}`;
    tag.textContent = localize(`LA.measure.refTag.${origin}`);
    text.appendChild(tag);
    if (tokens.length > 1)
    {
        chip.classList.add('la-mt-ref-multi');
        const badge = document.createElement('span');
        badge.className = 'la-mt-ref-badge';
        badge.textContent = `×${tokens.length}`;
        text.appendChild(badge);
    }
    else if (isKnownToken(first))
        text.appendChild(makeScrollingName(first.name));
    else
        text.appendChild(makeUnknownName(first));
    chip.appendChild(text);
    chip.title = localize('LA.measure.reference');
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', () =>
    {
        const target = getReferenceTokens()[0];
        if (target)
            canvas.animatePan({ x: target.center.x, y: target.center.y });
    });
    return chip;
}

function renderModeButtons()
{
    const group = document.createElement('div');
    group.className = 'la-mt-group la-mt-anchor la-mt-shapes';
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
            markActive(button);
        group.appendChild(button);
    }
    const markOn = _saved.mode === 'single';
    const single = makeIconButton('systems/lancer/assets/icons/reticule.svg', 'LA.measure.mark', () => setMode(markOn ? 'free' : 'single'));
    if (markOn)
        markActive(single);
    group.appendChild(single);
    if (_saved.mode === 'area' && !_openMenu)
        group.appendChild(renderAreaPopover());
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
    input.setAttribute('value', String(value));
    const commit = next =>
    {
        const clamped = Math.max(min, Math.min(max, next));
        input.value = String(clamped);
        onValue(clamped);
    };
    const current = () => Number.parseInt(input.value) || min;
    input.addEventListener('change', () => commit(current()));
    const minus = makeIconButton('fa-solid fa-minus', 'LA.measure.decrease', () => commit(current() - 1));
    const plus = makeIconButton('fa-solid fa-plus', 'LA.measure.increase', () => commit(current() + 1));
    row.append(label, minus, input, plus);
    return { row };
}

let _popsShown = new Set();
let _popsNext = new Set();
let _weapScroll = { tokenId: null, top: 0 };

function makePopover(kind, classes)
{
    const pop = document.createElement('div');
    pop.className = `la-mt-pop ${classes}`;
    if (!_popsShown.has(kind))
    {
        pop.classList.add('la-mt-appear');
        setTimeout(() => pop.classList.remove('la-mt-appear'), 200);
    }
    _popsNext.add(kind);
    return pop;
}

function renderAreaPopover()
{
    const pop = makePopover('area', 'la-mt-pop-end');
    const { row } = makeParamRow(localize('LA.measure.size'), _saved.areaRange, 1, 99, next =>
    {
        _saved.areaRange = next;
        _controller?.setAreaRange(next);
    });
    pop.append(row, renderToggleRow());
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
        checkbox.defaultChecked = checked;
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
    addToggle('la-tg-elev', localize('LA.measure.toggle.elevation'), localize('LA.measure.toggle.elevationHint'), elevOn, false, value =>
    {
        _saved.elevationAware = value;
    });
    addToggle('la-tg-autoelev', localize('LA.measure.toggle.terrain'), localize('LA.measure.toggle.terrainHint'), _saved.autoElevation, !elevOn, value =>
    {
        _saved.autoElevation = value;
    });
    addToggle('la-tg-prop', localize('LA.measure.toggle.spread'), localize('LA.measure.toggle.spreadHint'), _saved.propagation, !elevOn, value =>
    {
        _saved.propagation = value;
    });
    return wrap;
}

function sourceValueText(refToken, source)
{
    if (source === 'manual')
        return String(_saved.manualRadius);
    if (!refToken)
        return '';
    if (!isKnownToken(refToken))
        return '?';
    const radius = computeRadiusForToken(refToken, source);
    return radius === null || radius === undefined ? '?' : String(radius);
}

function sourcePinned(value)
{
    const tokens = getReferenceTokens();
    return tokens.length > 0 && tokens.every(pinToken => hasRangePin(pinToken, value));
}

function toggleSourcePin(value)
{
    const tokens = getReferenceTokens();
    if (!tokens.length)
        return;
    if (value === 'weapon')
    {
        const weapons = getWeapons(tokens[0]);
        const weaponItemId = weapons.some(weapon => weapon.id === _saved.weaponItemId) ? _saved.weaponItemId : weapons[0]?.id;
        if (weaponItemId)
            toggleRangePin(tokens[0], 'weapon', { weaponItemId });
        return;
    }
    const allPinned = tokens.every(pinToken => hasRangePin(pinToken, value));
    for (const pinToken of tokens)
    {
        if (allPinned || !hasRangePin(pinToken, value))
            toggleRangePin(pinToken, value);
    }
}

function renderRangeControls()
{
    const controlled = getReferenceTokens();
    const refToken = controlled[0] ?? null;
    const group = document.createElement('div');
    group.className = 'la-mt-group la-mt-anchor la-mt-range';
    // weapon is owner-only; a scanned enemy reference offers range/reach but not its weapon loadout
    const ownedRef = !!refToken?.isOwner;
    const hasWeapon = ownedRef ? getWeapons(refToken).length > 0 : false;
    const canResolve = value => value !== 'weapon' || (ownedRef && controlled.length === 1 && hasWeapon);
    const items = RANGE_SOURCES.filter(src => src.value !== 'none').map(src =>
    {
        const disabled = !canResolve(src.value);
        return {
            value: src.value,
            icon: src.icon,
            label: src.value === 'weapon' && refToken && !hasWeapon ? 'LA.measure.source.weaponNone' : src.label,
            disabled,
            number: disabled ? '' : sourceValueText(refToken, src.value),
            pinned: sourcePinned(src.value),
        };
    });
    group.appendChild(renderRangeDropdown(items));
    if (!_openMenu && (_saved.rangeSource === 'manual' || _saved.rangeSource === 'weapon'))
        group.appendChild(renderRangePopover(refToken));
    return group;
}

function renderRangePopover(refToken)
{
    if (_saved.rangeSource === 'manual')
    {
        const pop = makePopover('manual', 'la-mt-pop-start');
        const { row } = makeParamRow(localize('LA.measure.range'), _saved.manualRadius, 0, 99, next => setManualRadius(next));
        pop.appendChild(row);
        return pop;
    }
    const pop = makePopover('weapon', 'la-mt-pop-start la-mt-weap-pop');
    const weapons = refToken ? getWeapons(refToken) : [];
    if (!weapons.length)
    {
        const empty = document.createElement('span');
        empty.className = 'la-mt-pop-empty';
        empty.textContent = localize('LA.measure.noWeapons');
        pop.appendChild(empty);
        return pop;
    }
    if (!_saved.weaponItemId || !weapons.some(weapon => weapon.id === _saved.weaponItemId))
        _saved.weaponItemId = weapons[0].id;
    const actor = refToken.actor;
    const list = document.createElement('div');
    list.className = `la-mt-weap-scroll${weapons.length > 5 ? ' la-mt-weap-many' : ''}`;
    list.dataset.tokenId = refToken.id;
    list.addEventListener('scroll', () =>
    {
        _weapScroll = { tokenId: refToken.id, top: list.scrollTop };
    });
    for (const weapon of weapons)
    {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `la-mt-dd-item la-mt-weap-row${weapon.id === _saved.weaponItemId ? ' active' : ''}${weapon.system?.destroyed ? ' la-mt-weap-dead' : ''}`;
        row.title = weapon.name;
        const name = document.createElement('span');
        name.className = 'la-mt-weap-n';
        name.textContent = weapon.name;
        const rangeEl = document.createElement('span');
        rangeEl.className = 'la-mt-weap-r';
        rangeEl.innerHTML = weaponRangeHtml(weaponRangeMap(weapon, actor)) || `R ${weaponMaxRange(weapon, actor)}`;
        const pin = document.createElement('span');
        pin.className = `la-mt-weap-pin${hasRangePin(refToken, 'weapon', weapon.id) ? ' on' : ''}`;
        const pinIcon = document.createElement('i');
        pinIcon.className = 'fa-solid fa-thumbtack';
        pin.appendChild(pinIcon);
        row.append(makeIcon(weaponTypeIcon(weapon)), name, rangeEl, pin);
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
            renderToolbar();
        });
        list.appendChild(row);
    }
    pop.appendChild(list);
    return pop;
}

function renderMoveToggle()
{
    const rulerOn = isLancerRulerActive();
    const button = makeIconButton('fa-solid fa-person-running', rulerOn ? 'LA.measure.move' : 'LA.measure.moveNeedsRuler', () =>
    {
        _saved.movementReachEnabled = !_saved.movementReachEnabled;
        rebuildMovementReach();
        renderToolbar();
        _emitStateChange();
    });
    button.disabled = !rulerOn;
    if (_saved.movementReachEnabled && rulerOn)
        markActive(button);
    return button;
}

function renderLabelsToggle()
{
    const button = makeIconButton('fa-solid fa-ruler-horizontal', 'LA.measure.labels', () =>
    {
        _saved.tacticalLabels = !_saved.tacticalLabels;
        updateDistanceLabels();
        renderToolbar();
    });
    if (_saved.tacticalLabels)
        markActive(button);
    return button;
}

// Ground marks ray like a size-1 token standing on the terrain below them.
function _markGroundHeight(center)
{
    let top = 0;
    try
    {
        for (const shape of globalThis.terrainHeightTools?.getShapesAtPoint?.(center.x, center.y) ?? [])
        {
            const shapeTop = (shape.elevation ?? 0) + (shape.height ?? 0);
            if (Number.isFinite(shapeTop) && shapeTop > top)
                top = shapeTop;
        }
    }
    catch
    {
        top = 0;
    }
    return top + 1.1;
}

// Adjacent ground marks fuse into one footprint that rays like a bigger token.
function _clusterGroundMarks(groundMarks)
{
    const byKey = new Map(groundMarks.map(mark => [`${mark.col},${mark.row}`, mark]));
    const seen = new Set();
    const clusters = [];
    for (const mark of groundMarks)
    {
        const startKey = `${mark.col},${mark.row}`;
        if (seen.has(startKey))
            continue;
        seen.add(startKey);
        const cluster = [];
        const queue = [mark];
        while (queue.length)
        {
            const current = queue.pop();
            cluster.push(current);
            let adjacent = [];
            try
            {
                adjacent = canvas.grid.getAdjacentOffsets({ i: current.row, j: current.col }) ?? [];
            }
            catch
            {
                adjacent = [];
            }
            for (const offset of adjacent)
            {
                const key = `${offset.j},${offset.i}`;
                if (seen.has(key) || !byKey.has(key))
                    continue;
                seen.add(key);
                queue.push(byKey.get(key));
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}

let _losEyeSig = null;

function refreshLosEye(force = false)
{
    const viewer = _open && _saved.losEye ? getReferenceTokens()[0] : null;
    const markers = [...(_saved.whiteMarks?.marks ?? []), ...(_saved.marks?.marks ?? [])];
    const sig = viewer
        ? `${viewer.id}|${markers.map(mark => mark.tokenId ?? `${mark.col},${mark.row}`).sort().join(',')}|${[...(game.user?.targets ?? [])].map(token => token.id).sort().join(',')}`
        : '';
    if (!force && sig === _losEyeSig)
        return;
    _losEyeSig = sig;
    clearSightlines('adv-measure');
    if (!viewer)
        return;
    const targets = [];
    const groundMarks = [];
    // Markers when there are any, the user's targets otherwise.
    if (markers.length)
    {
        const seen = new Set();
        for (const mark of markers)
        {
            const key = mark.tokenId ?? `${mark.col},${mark.row}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            if (mark.tokenId)
            {
                const token = canvas.tokens.get(mark.tokenId);
                if (token && token !== viewer && isTokenVisible(token))
                    targets.push(token);
            }
            else
                groundMarks.push(mark);
        }
    }
    else
    {
        for (const token of game.user?.targets ?? [])
        {
            if (token !== viewer && isTokenVisible(token))
                targets.push(token);
        }
    }
    for (const cluster of _clusterGroundMarks(groundMarks))
    {
        const cells = cluster.map(mark => getHexCenter(mark.col, mark.row));
        const center = {
            x: cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length,
            y: cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length,
        };
        const height = Math.max(...cells.map(cell => _markGroundHeight(cell)));
        targets.push({ ...center, h: height, cells });
    }
    if (targets.length)
        drawSightlines('adv-measure', viewer, targets);
}

function onLosEyeTokenUpdate(tokenDoc, change)
{
    if (!_saved.losEye || !['x', 'y', 'elevation', 'width', 'height'].some(key => key in change))
        return;
    refreshLosEye(true);
}

function onLosEyeTargetChange()
{
    refreshLosEye();
}

let _losEyeRefreshTimer = null;

// Throttled so movement animation frames redraw the rays without recomputing per frame.
function onLosEyeTokenRefresh(token, opts)
{
    if (!_saved.losEye || (!opts?.refreshPosition && !opts?.refreshSize) || _losEyeRefreshTimer)
        return;
    _losEyeRefreshTimer = setTimeout(() =>
    {
        _losEyeRefreshTimer = null;
        refreshLosEye(true);
    }, 100);
}

function renderLosEyeToggle()
{
    const button = makeIconButton('fa-solid fa-eye', 'LA.measure.eye', () =>
    {
        _saved.losEye = !_saved.losEye;
        refreshLosEye();
        renderToolbar();
    });
    if (_saved.losEye)
        markActive(button);
    return button;
}

function patchChildren(container, nodes)
{
    const current = Array.from(container.children);
    nodes.forEach((node, index) =>
    {
        const existing = current[index];
        if (!existing)
            container.appendChild(node);
        else if (existing.outerHTML !== node.outerHTML)
            existing.replaceWith(node);
    });
    for (const extra of current.slice(nodes.length))
        extra.remove();
}

function renderToolbar()
{
    if (!_toolbarEl)
        return;
    patchChildren(_toolbarEl, [
        renderBadge(),
        makeSep(),
        renderHelp(),
        makeSep(),
        renderControlledChip(),
        makeSep(),
        renderModeButtons(),
        makeSep(),
        renderRangeControls(),
        renderMoveToggle(),
        renderLabelsToggle(),
        renderLosEyeToggle(),
        makeSep(),
        makeButton(localize('LA.measure.clear'), clearPlacements),
        makeIconButton('fa-solid fa-xmark', 'LA.measure.close', () => closeAdvancedMeasure()),
    ]);
    _popsShown = _popsNext;
    _popsNext = new Set();
    const weapList = _toolbarEl.querySelector('.la-mt-weap-scroll');
    if (weapList)
    {
        const active = weapList.querySelector('.active');
        weapList.scrollTop = _weapScroll.tokenId === weapList.dataset.tokenId
            ? _weapScroll.top
            : Math.max(0, (active?.offsetTop ?? 0) + (active?.offsetHeight ?? 0) - weapList.clientHeight);
    }
    _overToolbar = pointerOverToolbar();
    clampBarToViewport();
    refreshLosEye();
}

function pinBarLeft()
{
    if (!_toolbarEl)
        return;
    const scale = Number(getComputedStyle(_toolbarEl).getPropertyValue('--la-mt-scale')) || 1;
    const width = _toolbarEl.offsetWidth * scale;
    _toolbarEl.style.left = `${Math.max(8, Math.round((window.innerWidth - width) / 2))}px`;
}

function clampBarToViewport()
{
    if (!_toolbarEl?.style.left)
        return;
    const overflow = _toolbarEl.getBoundingClientRect().right - (window.innerWidth - 8);
    if (overflow > 0)
        _toolbarEl.style.left = `${Math.max(8, Math.round(Number.parseFloat(_toolbarEl.style.left) - overflow))}px`;
}

function onWindowResize()
{
    onHotbarChange();
    pinBarLeft();
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
        const toolbarScale = Number(getModuleSetting(TOOLBAR_SCALE_KEY)) || 1;
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
    pinBarLeft();
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
}

function startCardWatch()
{
    if (_observer)
        return;
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

function stopCardWatch()
{
    _observer?.disconnect();
    _observer = null;
    if (_cardActive)
    {
        _cardActive = false;
        updateSuppressed();
    }
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
            _saved.elevationAware = !!getModuleSetting('tah.areaElevationAware');
            _saved.propagation = !!getModuleSetting('areaSpread');
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
    document.addEventListener('wheel', onFreeWheel, { capture: true, passive: false });
    Hooks.on('controlToken', onSelectionChange);
    Hooks.on('hoverToken', onHoverToken);
    Hooks.on('renderHotbar', onHotbarChange);
    Hooks.on('combatStart', onCombatStateChange);
    Hooks.on('combatTurnChange', onCombatStateChange);
    Hooks.on('combatRound', onCombatStateChange);
    Hooks.on('deleteCombat', onCombatStateChange);
    Hooks.on('deleteToken', onWhiteMarkTokenDeleted);
    Hooks.on('updateToken', onLosEyeTokenUpdate);
    Hooks.on('refreshToken', onLosEyeTokenRefresh);
    Hooks.on('targetToken', onLosEyeTargetChange);
    Hooks.on('updateItem', onProfileSwitched);
    window.addEventListener('resize', onWindowResize);
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
    startCardWatch();
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
    if (_saved.mode !== 'free' && !_suppressed)
    {
        const mode = _saved.mode;
        _saved.mode = 'free';
        setMode(mode);
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
    if (_openMenu)
        setOpenMenu(null);
    stopCardWatch();
    clearSightlines('adv-measure');
    _losEyeSig = null;
    Hooks.off('updateToken', onLosEyeTokenUpdate);
    Hooks.off('refreshToken', onLosEyeTokenRefresh);
    Hooks.off('targetToken', onLosEyeTargetChange);
    clearTimeout(_losEyeRefreshTimer);
    _losEyeRefreshTimer = null;
    document.removeEventListener('pointermove', onClientPointerMove, { capture: true });
    playUiSound('details');
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
    window.removeEventListener('resize', onWindowResize);
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
        losBySource: { ..._saved.losBySource },
        weaponItemId: _saved.weaponItemId,
        pulseEnabled: _saved.pulseEnabled,
        movementReachEnabled: _saved.movementReachEnabled,
    };
}

const _STATE_KEYS = new Set(['mode', 'pattern', 'areaRange', 'rangeSource', 'manualRadius', 'losBySource', 'weaponItemId', 'pulseEnabled', 'movementReachEnabled']);

export async function setAdvancedMeasureState(patch)
{
    if (!patch || typeof patch !== 'object')
        return;
    let changed = false;
    for (const [key, value] of Object.entries(patch))
    {
        if (!_STATE_KEYS.has(key) || key === 'mode')
            continue;
        if (_saved[key] !== value)
        {
            _saved[key] = value;
            changed = true;
        }
    }
    if (Object.hasOwn(patch, 'mode') && patch.mode !== _saved.mode)
    {
        if (_open && !_suppressed)
            setMode(patch.mode);
        else
            _saved.mode = patch.mode;
        changed = true;
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
    _saved.losBySource = {};
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
        title: localize('LA.measure.toolTitle'),
        icon: 'la-mt-control-icon',
        toggle: true,
        active: isAdvancedMeasureActive(),
        onClick: (active) => setActive(active),
        onChange: (event, active) => setActive(active ?? !isAdvancedMeasureActive()),
        toolclip: {
            heading: localize('LA.measure.advancedMeasureTool'),
            items: [
                { paragraph: localize('LA.measure.toolclip') },
                { heading: localize('LA.measure.toolclipToggle'), reference: keyLabel('advancedMeasure', 'Shift+R') },
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
