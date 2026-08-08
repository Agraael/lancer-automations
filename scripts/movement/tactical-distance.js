/* global game, canvas, foundry, Hooks, PIXI */

import { getMinGridDistance, getDistanceTokenToPoint } from '../combat/grid-helpers.js';
import { ISO_SETTINGS, isIsoFeatureEnabled, getIsoStateForToken } from '../setup/iso-settings.js';

const MODULE_ID = 'lancer-automations';
const MODE_KEY = 'enableTacticalDistance'; // values: 'off' | 'combat' | 'always' (legacy boolean migrated below)
const LABEL_KEY = '_laTacticalLabel';

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
        fontFamily: 'Signika',
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

function ensureLabel(token)
{
    if (token[LABEL_KEY] && !token[LABEL_KEY].destroyed)
        return token[LABEL_KEY];
    const label = makeLabel();
    token.addChild(label);
    token[LABEL_KEY] = label;
    return label;
}

function removeLabel(token)
{
    const label = token[LABEL_KEY];
    if (label)
    {
        try
        {
            label.parent?.removeChild(label); label.destroy();
        }
        catch
        { /* ignore */ }
        delete token[LABEL_KEY];
    }
}

function clearAll()
{
    for (const t of canvas.tokens?.placeables ?? [])
        removeLabel(t);
}

// Tool-driven reference: the Advanced Measure tool shows distance labels from a selected/hovered
// token, bypassing the drag-only path. null clears them.
let _measureRef = null;

// Follow the reference's drag preview while it's being dragged, else the reference itself.
function _effectiveMeasureRef()
{
    if (!_measureRef || _measureRef.destroyed)
        return null;
    const id = _measureRef.document?.id;
    for (const preview of canvas.tokens?.preview?.children ?? [])
    {
        if (preview?.document?.id === id)
            return preview;
    }
    return _measureRef;
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
    const units = canvas.scene?.grid?.units ?? '';
    for (const target of canvas.tokens.placeables)
    {
        if (target.isPreview || !target.visible)
        {
            removeLabel(target);
            continue;
        }
        const label = ensureLabel(target);
        const text = `↔ ${getDistanceTokenToPoint(point, target)}${units ? ` ${units}` : ''}`;
        if (label.text !== text)
            label.text = text;
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

function positionLabel(target, label)
{
    const iso = _getIsoState(target);
    if (iso && target.mesh)
    {
        label.x = target.mesh.position.x - target.position.x;
        label.y = target.mesh.position.y - target.position.y;
        label.rotation = iso.reverseRotation;
        label.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        label.scale.set(iso.counterScale, 1 / iso.counterScale);
        label.pivot.set(0, -(target.h / 2 + 4));
    }
    else
    {
        label.x = target.w / 2;
        label.y = target.h + 4;
        label.rotation = 0;
        label.skew.set(0, 0);
        label.scale.set(1, 1);
        label.pivot.set(0, 0);
    }
}

function updateLabelsFor(previewToken)
{
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
        const text = buildLabelText(previewToken, target);
        if (label.text !== text)
            label.text = text;
        positionLabel(target, label);
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
        name: 'Tactical Distance Labels',
        hint: 'While dragging a token, show its distance and elevation delta below every other visible token.',
        scope: 'client',
        type: String,
        choices: { off: 'Disabled', combat: 'Only in Combat', always: 'Always' },
        default: 'combat',
        config: false
    });
    game.settings.register(MODULE_ID, 'tacticalElevationStep', {
        name: 'Tactical Label Elevation Step',
        hint: 'Snap the elevation delta shown on tactical distance labels to the nearest multiple of this value. Gridless scenes are unaffected.',
        scope: 'client',
        type: Number,
        default: 0.5,
        config: false
    });
});

// also clear labels on combat lifecycle so "combat" mode removes stale ones (keep the tool's reference labels)
Hooks.on('deleteCombat', () => _measureRef ? _queueRefUpdate() : clearAll());
Hooks.on('combatStart', () => _measureRef ? _queueRefUpdate() : clearAll());
