/* global game, canvas, foundry, Hooks, PIXI */

import { getMinGridDistance } from '../combat/grid-helpers.js';
import { ISO_SETTINGS, isIsoFeatureEnabled, getIsoProvider } from '../setup/iso-settings.js';

const MODULE_ID = 'lancer-automations';
const ENABLED = 'enableTacticalDistance';
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

function settingOn() {
    try {
        return !!game.settings.get(MODULE_ID, ENABLED);
    } catch {
        return false;
    }
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
            removeLabel(target); continue;
        }
        const label = ensureLabel(target);
        label.text = buildLabelText(previewToken, target);
        positionLabel(target, label);
    }
}

Hooks.on('refreshToken', (token) => {
    if (!settingOn())
        return;
    if (!token.isPreview)
        return;
    updateLabelsFor(token);
});

Hooks.on('destroyToken', (token) => {
    if (!token.isPreview)
        return;
    clearAll();
});

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, ENABLED, {
        name: 'Tactical Distance Labels',
        hint: 'While dragging a token, show its distance and elevation delta below every other visible token.',
        scope: 'client',
        type: Boolean,
        default: false,
        config: false
    });
});
