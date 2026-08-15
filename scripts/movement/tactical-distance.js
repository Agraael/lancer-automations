/* global game, canvas, foundry, Hooks, PIXI */

import { getMinGridDistance, getDistanceTokenToPoint } from '../combat/grid-helpers.js';
import { ISO_SETTINGS, isIsoFeatureEnabled, getIsoStateForToken } from '../setup/iso-settings.js';
import { hasLineOfSight } from '../vision/lancerDetectionModes.js';
import { belowBarsY } from '../tah/tokenStatBar.js';

const MODULE_ID = 'lancer-automations';
const MODE_KEY = 'enableTacticalDistance'; // values: 'off' | 'combat' | 'always' (legacy boolean migrated below)
const LABEL_KEY = '_laTacticalLabel';
const GHOST_KEY = '_laTacticalLabelGhost';
// mdi eye-outline / eye-off-outline
const EYE_ON = '\u{F06D0}';
const EYE_OFF = '\u{F06D1}';
const EYE_SEEN = '#4dd35f';
const EYE_BLOCKED = '#ff5b52';

function _getIsoState(token)
{
    if (!isIsoFeatureEnabled(ISO_SETTINGS.tacticalDistance))
        return null;
    return getIsoStateForToken(token);
}

function getMode()
{
    try
    {
        const raw = game.settings.get(MODULE_ID, MODE_KEY);
        if (raw === true)
            return 'always'; // legacy bool
        if (raw === false)
            return 'off';
        if (raw === 'off' || raw === 'combat' || raw === 'always')
            return raw;
        return 'off';
    }
    catch
    {
        return 'off';
    }
}

function shouldShow()
{
    const mode = getMode();
    if (mode === 'off')
        return false;
    if (mode === 'always')
        return true;
    return !!game.combat; // combat (started or not)
}

function makeLabel()
{
    const style = foundry.canvas.containers.PreciseText.getTextStyle({
        fontFamily: ['Material Design Icons', 'Signika'],
        fontSize: 14,
        fill: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center',
        fontWeight: '600'
    });
    const text = new foundry.canvas.containers.PreciseText('', style);
    text.anchor.set(0.5, 0);
    return text;
}

// Above the stat-bar overlay (zIndex 99999) so bars never cover labels.
let _labelOverlay = null;
function getLabelOverlay()
{
    if (_labelOverlay && !_labelOverlay.destroyed)
        return _labelOverlay;
    if (!canvas?.tokens)
        return null;
    _labelOverlay = new PIXI.Container();
    _labelOverlay.name = 'la-tactical-label-overlay';
    _labelOverlay.zIndex = 100000;
    canvas.tokens.addChild(_labelOverlay);
    return _labelOverlay;
}

function _livePlaceable(token)
{
    const id = token?.document?.id;
    for (const preview of canvas.tokens?.preview?.children ?? [])
    {
        if (preview?.document?.id === id)
            return preview;
    }
    return token;
}

let _labelRefId = null;

// Overlay labels don't inherit token transforms; reposition every frame so they follow
// moving tokens and drag previews.
let _tickerFn = null;
function _startTicker()
{
    if (_tickerFn || !canvas?.app?.ticker)
        return;
    _tickerFn = () =>
    {
        for (const token of canvas.tokens?.placeables ?? [])
        {
            const label = token[LABEL_KEY];
            if (label && !label.destroyed)
                positionLabel(token, label);
            const ghost = token[GHOST_KEY];
            if (ghost && !ghost.destroyed)
            {
                const clone = _livePlaceable(token);
                if (clone !== token)
                    positionLabel(clone, ghost);
            }
        }
    };
    canvas.app.ticker.add(_tickerFn);
}

function _stopTicker()
{
    if (_tickerFn)
        canvas?.app?.ticker?.remove(_tickerFn);
    _tickerFn = null;
}

function _ensureLabelAt(token, key)
{
    if (token[key] && !token[key].destroyed)
        return token[key];
    const overlay = getLabelOverlay();
    if (!overlay)
        return null;
    const label = makeLabel();
    overlay.addChild(label);
    token[key] = label;
    _startTicker();
    return label;
}

function _removeLabelAt(token, key)
{
    const label = token[key];
    if (label)
    {
        try
        {
            label.parent?.removeChild(label); label.destroy();
        }
        catch
        { /* ignore */ }
        delete token[key];
    }
}

const ensureLabel = (token) => _ensureLabelAt(token, LABEL_KEY);
const ensureGhostLabel = (token) => _ensureLabelAt(token, GHOST_KEY);
const removeGhostLabel = (token) => _removeLabelAt(token, GHOST_KEY);

function removeLabel(token)
{
    _removeLabelAt(token, LABEL_KEY);
    _removeLabelAt(token, GHOST_KEY);
}

function clearAll()
{
    for (const t of canvas.tokens?.placeables ?? [])
        removeLabel(t);
    _stopTicker();
}

// Tool-driven reference: the Advanced Measure tool shows distance labels from a selected/hovered
// token, bypassing the drag-only path. null clears them.
let _measureRef = null;

function _effectiveMeasureRef()
{
    if (!_measureRef || _measureRef.destroyed)
        return null;
    return _livePlaceable(_measureRef);
}

// Coalesced redraw that re-reads the CURRENT reference at fire time (never a stale captured token).
let _refRafQueued = false;
function _queueRefUpdate()
{
    if (_refRafQueued)
        return;
    _refRafQueued = true;
    requestAnimationFrame(() =>
    {
        _refRafQueued = false;
        if (_measurePoint)
        {
            updateLabelsForPoint(_measurePoint);
            return;
        }
        const ref = _effectiveMeasureRef();
        if (ref)
            updateLabelsFor(ref);
        else
            clearAll();
    });
}

export function setMeasureDistanceReference(token)
{
    _measureRef = (token && !token.destroyed) ? token : null;
    const ref = _effectiveMeasureRef();
    if (ref)
        updateLabelsFor(ref);
    else
        clearAll();
}

// The eye bakes as tofu if drawn before the webfont loads; unchanged .text never re-renders.
let _mdiFontReady = false;
function _ensureMdiFont()
{
    if (_mdiFontReady || !globalThis.document?.fonts?.load)
        return;
    globalThis.document.fonts.load('14px "Material Design Icons"').then(() =>
    {
        _mdiFontReady = true;
        clearAll();
        _queueRefUpdate();
    }).catch(() =>
    {
        _mdiFontReady = true;
    });
}

function losEyeEnabled()
{
    try
    {
        return game.settings.get(MODULE_ID, 'lancerLos') === true;
    }
    catch
    {
        return false;
    }
}

// A point origin (e.g. the cursor) takes priority over the token reference while set; null reverts.
let _measurePoint = null;
export function setMeasureDistancePoint(point)
{
    _measurePoint = point || null;
    if (_measurePoint)
    {
        updateLabelsForPoint(_measurePoint);
        return;
    }
    const ref = _effectiveMeasureRef();
    if (ref)
        updateLabelsFor(ref);
    else
        clearAll();
}

function updateLabelsForPoint(point)
{
    _labelRefId = null;
    const units = canvas.scene?.grid?.units ?? '';
    for (const target of canvas.tokens.placeables)
    {
        if (target.isPreview || !target.visible)
        {
            removeLabel(target);
            continue;
        }
        const label = ensureLabel(target);
        if (!label)
            continue;
        removeGhostLabel(target);
        const text = `↔ ${getDistanceTokenToPoint(point, target)}${units ? ` ${units}` : ''}`;
        if (label.text !== text)
            label.text = text;
        _syncEye(label, null);
        positionLabel(target, label);
    }
}

export function snapElevationForDisplay(rawElev)
{
    const value = Number(rawElev) || 0;
    const isGridless = canvas.grid?.type === globalThis.CONST.GRID_TYPES.GRIDLESS;
    if (isGridless)
        return Math.round(value * 100) / 100;
    const step = Number(game.settings.get(MODULE_ID, 'tacticalElevationStep')) || 0.5;
    return Number((Math.round(value / step) * step).toFixed(3));
}

function buildLabelText(previewToken, targetToken)
{
    const units = canvas.scene?.grid?.units ?? '';
    const dist = getMinGridDistance(previewToken, targetToken, null, false);
    let line = `↔ ${dist}${units ? ` ${units}` : ''}`;
    const dElev = snapElevationForDisplay((targetToken.document.elevation ?? 0) - (previewToken.document.elevation ?? 0));
    if (dElev !== 0)
    {
        const arrow = dElev > 0 ? '↑' : '↓';
        line += `  ${arrow} ${Math.abs(dElev)}${units ? ` ${units}` : ''}`;
    }
    return line;
}

function _losState(previewToken, targetToken)
{
    return losEyeEnabled() ? hasLineOfSight(previewToken, targetToken) : null;
}

function _syncEye(label, seen)
{
    if (seen === null)
    {
        if (label._laEye && !label._laEye.destroyed)
            label._laEye.destroy();
        label._laEye = null;
        return;
    }
    if (!label._laEye || label._laEye.destroyed)
    {
        const style = foundry.canvas.containers.PreciseText.getTextStyle({
            fontFamily: ['Material Design Icons', 'Signika'],
            fontSize: 14,
            stroke: '#000000',
            strokeThickness: 3,
            fontWeight: '600'
        });
        const eye = new foundry.canvas.containers.PreciseText('', style);
        eye.anchor.set(1, 0.5);
        label.addChild(eye);
        label._laEye = eye;
    }
    const eye = label._laEye;
    const glyph = seen ? EYE_ON : EYE_OFF;
    if (eye.text !== glyph)
        eye.text = glyph;
    const fill = seen ? EYE_SEEN : EYE_BLOCKED;
    if (eye.style.fill !== fill)
        eye.style.fill = fill;
}

function labelBelow()
{
    try
    {
        return game.settings.get(MODULE_ID, 'tacticalLabelPosition') === 'below';
    }
    catch
    {
        return false;
    }
}

// Below mode clears the stat bars and the nameplate, matching where the bars push the name.
function belowAnchorY(target)
{
    let anchor = belowBarsY(target) ?? target.h + 2;
    const nameplate = target.nameplate;
    if (nameplate?.visible)
        anchor = Math.max(anchor, nameplate.position.y + (nameplate.height ?? 0) + 2);
    return anchor;
}

function zoomCounterScale()
{
    let minZoom = 0;
    try
    {
        minZoom = Number(game.settings.get(MODULE_ID, 'tacticalMinZoomScale')) || 0;
    }
    catch
    {
        minZoom = 0;
    }
    if (minZoom <= 0)
        return 1;
    const zoom = canvas.stage?.scale?.x || 1;
    return Math.max(1, minZoom / zoom);
}

function positionLabel(target, label)
{
    label.alpha = target.alpha ?? 1;
    const below = labelBelow();
    const iso = _getIsoState(target);
    const zoomK = zoomCounterScale();
    if (iso && target.mesh)
    {
        label.anchor.set(0.5, below ? 0 : 1);
        label.position.set(target.mesh.position.x, target.mesh.position.y);
        label.rotation = iso.reverseRotation;
        label.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        label.scale.set(iso.counterScale * zoomK, (1 / iso.counterScale) * zoomK);
        label.pivot.set(0, (below ? -(belowAnchorY(target) - target.h / 2) : target.h / 2 + 4) / zoomK);
    }
    else
    {
        label.anchor.set(0.5, below ? 0 : 1);
        label.position.set(target.x + target.w / 2, below ? target.y + belowAnchorY(target) : target.y - 4);
        label.rotation = 0;
        label.skew.set(0, 0);
        label.scale.set(zoomK, zoomK);
        label.pivot.set(0, 0);
    }
    const eye = label._laEye;
    if (eye && !eye.destroyed)
    {
        const textW = label.texture?.orig?.width ?? 0;
        const textH = label.texture?.orig?.height ?? 0;
        eye.x = -textW / 2 - 4;
        eye.y = textH * (0.5 - label.anchor.y);
    }
}

function updateLabelsFor(previewToken)
{
    if (losEyeEnabled())
        _ensureMdiFont();
    _labelRefId = previewToken.document?.id ?? null;
    const previewSourceId = previewToken.sourceId ?? previewToken.document?.id;
    for (const target of canvas.tokens.placeables)
    {
        if (target.isPreview)
            continue;
        if (target.id === previewSourceId || target.document?.id === previewSourceId)
        {
            removeLabel(target);
            continue;
        }
        if (!target.visible)
        {
            removeLabel(target);
            continue;
        }
        const label = ensureLabel(target);
        if (!label)
            continue;
        const text = buildLabelText(previewToken, target);
        if (label.text !== text)
            label.text = text;
        const seen = _losState(previewToken, target);
        _syncEye(label, seen);
        positionLabel(target, label);
        const clone = _livePlaceable(target);
        if (clone === target)
        {
            removeGhostLabel(target);
            continue;
        }
        const ghost = ensureGhostLabel(target);
        if (!ghost)
            continue;
        const isRef = target.document?.id === _labelRefId;
        const ghostText = isRef ? text : buildLabelText(previewToken, clone);
        if (ghost.text !== ghostText)
            ghost.text = ghostText;
        _syncEye(ghost, isRef ? seen : _losState(previewToken, clone));
        positionLabel(clone, ghost);
    }
}

// coalesce refreshToken bursts (1 update per animation frame per dragged preview)
let _pendingPreview = null;
let _rafQueued = false;
function _queueUpdate(previewToken)
{
    _pendingPreview = previewToken;
    if (_rafQueued)
        return;
    _rafQueued = true;
    requestAnimationFrame(() =>
    {
        _rafQueued = false;
        const token = _pendingPreview;
        _pendingPreview = null;
        if (!token || token.destroyed)
            return;
        updateLabelsFor(token);
    });
}

Hooks.on('refreshToken', (token) =>
{
    // A point origin (cursor) or the tool reference owns the labels whenever set.
    if (_measurePoint || _measureRef)
    {
        _queueRefUpdate();
        return;
    }
    // Otherwise the plain drag-preview path (mode-gated).
    if (!shouldShow())
        return;
    if (!token.isPreview)
        return;
    _queueUpdate(token);
});

Hooks.on('destroyToken', (token) =>
{
    if (!token.isPreview)
        return;
    if (_measurePoint || _measureRef)
        _queueRefUpdate();
    else
        clearAll();
});

Hooks.once('init', () =>
{
    game.settings.register(MODULE_ID, MODE_KEY, {
        scope: 'client',
        type: String,
        choices: { off: 'Disabled', combat: 'Only in Combat', always: 'Always' },
        default: 'combat',
        config: false
    });
    game.settings.register(MODULE_ID, 'tacticalElevationStep', {
        scope: 'client',
        type: Number,
        default: 0.5,
        config: false
    });
    game.settings.register(MODULE_ID, 'tacticalLabelPosition', {
        scope: 'client',
        type: String,
        choices: { above: 'Above the token', below: 'Below the token' },
        default: 'below',
        config: false
    });
    game.settings.register(MODULE_ID, 'tacticalMinZoomScale', {
        scope: 'client',
        type: Number,
        default: 0,
        range: { min: 0, max: 4, step: 0.1 },
        config: false
    });
});

// also clear labels on combat lifecycle so "combat" mode removes stale ones (keep the tool's reference labels)
Hooks.on('deleteCombat', () => _measureRef ? _queueRefUpdate() : clearAll());
Hooks.on('combatStart', () => _measureRef ? _queueRefUpdate() : clearAll());
