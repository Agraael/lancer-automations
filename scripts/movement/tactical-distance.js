/* global game, canvas, foundry, Hooks, PIXI */

import { getMinGridDistance } from '../combat/grid-helpers.js';
import { ISO_SETTINGS, isIsoFeatureEnabled, getIsoProvider } from '../setup/iso-settings.js';

const MODULE_ID = 'lancer-automations';
const MODE_KEY = 'enableTacticalDistance'; // values: 'off' | 'combat' | 'always' (legacy boolean migrated below)
const LABEL_KEY = '_laTacticalLabel';

function _getIsoState(token) {
    if (!isIsoFeatureEnabled(ISO_SETTINGS.tacticalDistance))
        return null;
    const provider = getIsoProvider(token?.scene);
    if (!provider)
        return null;
    if (provider.isTokenDisabled(token))
        return null;
    return {
        reverseRotation: provider.reverseRotation,
        reverseSkewX: provider.reverseSkewX,
        reverseSkewY: provider.reverseSkewY,
        counterScale: provider.counterScale,
    };
}

function getMode() {
    try {
        const v = game.settings.get(MODULE_ID, MODE_KEY);
        if (v === true)  return 'always'; // legacy bool
        if (v === false) return 'off';
        if (v === 'off' || v === 'combat' || v === 'always') return v;
        return 'off';
    } catch {
        return 'off';
    }
}

function shouldShow() {
    const m = getMode();
    if (m === 'off') return false;
    if (m === 'always') return true;
    return !!game.combat; // combat (started or not)
}

function makeLabel() {
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

function ensureLabel(token) {
    if (token[LABEL_KEY] && !token[LABEL_KEY].destroyed)
        return token[LABEL_KEY];
    const label = makeLabel();
    token.addChild(label);
    token[LABEL_KEY] = label;
    return label;
}

function removeLabel(token) {
    const label = token[LABEL_KEY];
    if (label) {
        try {
            label.parent?.removeChild(label); label.destroy();
        } catch { /* ignore */ }
        delete token[LABEL_KEY];
    }
}

function clearAll() {
    for (const t of canvas.tokens?.placeables ?? [])
        removeLabel(t);
}

function buildLabelText(previewToken, targetToken) {
    const units = canvas.scene?.grid?.units ?? '';
    const dist = getMinGridDistance(previewToken, targetToken, null, false);
    let line = `↔ ${dist}${units ? ` ${units}` : ''}`;
    const dElev = (targetToken.document.elevation ?? 0) - (previewToken.document.elevation ?? 0);
    if (dElev !== 0) {
        const arrow = dElev > 0 ? '↑' : '↓';
        line += `  ${arrow} ${Math.abs(dElev)}${units ? ` ${units}` : ''}`;
    }
    return line;
}

function positionLabel(target, label) {
    const iso = _getIsoState(target);
    if (iso && target.mesh) {
        label.x = target.mesh.position.x - target.position.x;
        label.y = target.mesh.position.y - target.position.y;
        label.rotation = iso.reverseRotation;
        label.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        label.scale.set(iso.counterScale, 1 / iso.counterScale);
        label.pivot.set(0, -(target.h / 2 + 4));
    } else {
        label.x = target.w / 2;
        label.y = target.h + 4;
        label.rotation = 0;
        label.skew.set(0, 0);
        label.scale.set(1, 1);
        label.pivot.set(0, 0);
    }
}

function updateLabelsFor(previewToken) {
    const previewSourceId = previewToken.sourceId ?? previewToken.document?.id;
    for (const target of canvas.tokens.placeables) {
        if (target.isPreview)
            continue;
        if (target.id === previewSourceId || target.document?.id === previewSourceId) {
            removeLabel(target);
            continue;
        }
        if (!target.visible) {
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
function _queueUpdate(previewToken) {
    _pendingPreview = previewToken;
    if (_rafQueued)
        return;
    _rafQueued = true;
    requestAnimationFrame(() => {
        _rafQueued = false;
        const t = _pendingPreview;
        _pendingPreview = null;
        if (!t || t.destroyed)
            return;
        updateLabelsFor(t);
    });
}

Hooks.on('refreshToken', (token) => {
    if (!shouldShow())
        return;
    if (!token.isPreview)
        return;
    _queueUpdate(token);
});

Hooks.on('destroyToken', (token) => {
    if (!token.isPreview)
        return;
    clearAll();
});

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, MODE_KEY, {
        name: 'Tactical Distance Labels',
        hint: 'While dragging a token, show its distance and elevation delta below every other visible token.',
        scope: 'client',
        type: String,
        choices: { off: 'Disabled', combat: 'Only in Combat', always: 'Always' },
        default: 'combat',
        config: false
    });
});

// also clear labels on combat lifecycle so "combat" mode removes stale ones
Hooks.on('deleteCombat', clearAll);
Hooks.on('combatStart', clearAll);
