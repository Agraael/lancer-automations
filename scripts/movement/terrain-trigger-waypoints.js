/* global canvas, game, Hooks */

const MODULE_ID = 'lancer-automations';
const SPLIT_AT_TRIGGER_BOUNDARIES = 'splitMovementAtTriggerBoundaries';

function _thtMatchKey(m) {
    const r = m?.shape?.polygon?.boundingRect;
    return `tht::${m?.shape?.terrainTypeId}::${m?.shape?.bottom}::${m?.shape?.top}::${r?.x},${r?.y}`;
}

const _GAA_EFFECT_BOUNDARY = new Set(['APPLY_ON_ENTER', 'APPLY_ON_LEAVE', 'REMOVE_ON_ENTER', 'REMOVE_ON_LEAVE']);
const _GAA_MACRO_BOUNDARY = new Set(['ENTER_LEAVE', 'ENTER', 'LEAVE', 'PREVIEW_ENTER_LEAVE', 'PREVIEW_ENTER', 'PREVIEW_LEAVE']);
const _GAA_SEQ_BOUNDARY = new Set(['ON_ENTER', 'ON_LEAVE']);

function _gaaAuraHasBoundaryTrigger(cfg) {
    if (!cfg) return false;
    if (Array.isArray(cfg.effects)) for (const e of cfg.effects) if (_GAA_EFFECT_BOUNDARY.has(e?.mode)) return true;
    if (Array.isArray(cfg.macros)) for (const m of cfg.macros) if (_GAA_MACRO_BOUNDARY.has(m?.mode)) return true;
    if (Array.isArray(cfg.sequencerEffects)) for (const s of cfg.sequencerEffects) if (_GAA_SEQ_BOUNDARY.has(s?.trigger)) return true;
    return false;
}

function _getTriggerKeys(tokenDoc, pos) {
    const keys = new Set();
    const tht = /** @type {any} */ (globalThis).terrainHeightTools;
    if (tht?.getContainingTriggerMatches) {
        try {
            const matches = tht.getContainingTriggerMatches(tokenDoc, pos) ?? [];
            for (const m of matches) keys.add(_thtMatchKey(m));
        } catch {}
    }
    const tmApi = /** @type {any} */ (game.modules.get('templatemacro'))?.api;
    if (tmApi?.findContainers) {
        try {
            const ids = tmApi.findContainers(tokenDoc, pos) ?? [];
            for (const id of ids) {
                const tDoc = tokenDoc.parent?.templates?.get(id);
                const tf = tDoc?.flags?.templatemacro;
                if (!tf) continue;
                // TM stores triggers either at when<X>.command (legacy) or in actions[] (UI).
                const hasLegacy = !!(tf.whenEntered?.command || tf.whenLeft?.command);
                const hasAction = Array.isArray(tf.actions) && tf.actions.some(
                    /** @type {any} */ (a) => a?.trigger === 'whenEntered' || a?.trigger === 'whenLeft'
                );
                if (!hasLegacy && !hasAction) continue;
                keys.add(`tm::${id}`);
            }
        } catch {}
    }
    // Native Foundry regions: same cell-based pattern as THT/TM/GAA.
    const scene = tokenDoc.parent;
    if (scene?.regions?.size) {
        const src = tokenDoc._source;
        const probePoint = { x: pos.x, y: pos.y, elevation: pos.elevation ?? src.elevation ?? 0,
            width: src.width, height: src.height, shape: src.shape };
        for (const region of scene.regions) {
            let inside = false;
            try { inside = tokenDoc.testInsideRegion(region, probePoint); }
            catch { continue; }
            if (inside) keys.add(`region::${region.id}`);
        }
    }
    const gaaLayer = /** @type {any} */ (canvas)?.gaaAuraLayer;
    if (gaaLayer?._auraManager?.getAllAuras) {
        try {
            const c = tokenDoc.getCenterPoint?.({ x: pos.x, y: pos.y }) ?? {
                x: pos.x + (tokenDoc.width ?? 1) * (canvas.grid.sizeX ?? canvas.grid.size) / 2,
                y: pos.y + (tokenDoc.height ?? 1) * (canvas.grid.sizeY ?? canvas.grid.size) / 2
            };
            const inCombat = !!game.combat;
            const selfId = tokenDoc.id;
            for (const { parent, aura } of gaaLayer._auraManager.getAllAuras({ preview: false })) {
                const cfg = aura?.config;
                if (!cfg?.enabled) continue;
                if (cfg.onlyEnabledInCombat && !inCombat) continue;
                if (parent?.document?.id === selfId) continue;
                if (!_gaaAuraHasBoundaryTrigger(cfg)) continue;
                if (!aura.isWorldPointInside?.(c.x, c.y)) continue;
                keys.add(`gaa::${parent.document?.id}::${cfg.id}`);
            }
        } catch {}
    }
    return keys;
}

const _AUTO_ELEV_ACTIONS = new Set(['climb', 'fly']);
let _patchDetected = false;

function _injectSilents(doc, context) {
    if (!Array.isArray(context?.foundPath) || context.foundPath.length < 2) return;
    if (context.foundPath.some(/** @type {any} */ (w) => w?._laSilent)) return;
    if (canvas.grid?.isGridless) return;
    const tht = /** @type {any} */ (globalThis).terrainHeightTools;
    const tmApi = /** @type {any} */ (game.modules.get('templatemacro'))?.api;
    const gaaLayer = /** @type {any} */ (canvas)?.gaaAuraLayer;
    const hasRegions = (doc.parent?.regions?.size ?? 0) > 0;
    if (!tht?.getContainingTriggerMatches && !tmApi?.findContainers && !gaaLayer?._auraManager && !hasRegions) return;
    // Hex _positionToGridOffset depends on (w,h,shape); silent must match _source.
    const src = doc._source;
    const refW = src.width, refH = src.height, refS = src.shape;

    let densePath;
    try { densePath = doc.getCompleteMovementPath(context.foundPath); }
    catch { return; }
    if (!Array.isArray(densePath) || densePath.length < 2) return;

    let prevKeys = _getTriggerKeys(doc, {
        x: densePath[0].x, y: densePath[0].y, elevation: densePath[0].elevation
    });

    // Two silents per transition (auto-elev pattern): last OUT then first IN, so the trigger
    // fires when the token visually reaches the boundary cell.
    const inserted = [];
    const _mkSilent = (wp) => ({
        x: wp.x, y: wp.y, elevation: wp.elevation,
        width: refW, height: refH, shape: refS,
        action: wp.action,
        snapped: true, explicit: false, checkpoint: true, intermediate: false,
        _laSilent: true
    });
    for (let i = 1; i < densePath.length; i++) {
        const wp = densePath[i];
        const prev = densePath[i - 1];
        const currentKeys = _getTriggerKeys(doc, {
            x: wp.x, y: wp.y, elevation: wp.elevation
        });
        let transition = false;
        for (const k of currentKeys) if (!prevKeys.has(k)) { transition = true; break; }
        if (!transition) for (const k of prevKeys) if (!currentKeys.has(k)) { transition = true; break; }
        if (transition && !_AUTO_ELEV_ACTIONS.has(wp.action) && !_AUTO_ELEV_ACTIONS.has(prev?.action)) {
            if (prev) inserted.push(_mkSilent(prev));
            inserted.push(_mkSilent(wp));
        }
        prevKeys = currentKeys;
    }
    if (inserted.length === 0) return;
    context.foundPath = [context.foundPath[0], ...inserted, ...context.foundPath.slice(1)];
}

function _onModifyPlannedMovement(token, context) {
    _patchDetected = true;
    try { if (!game.settings.get(MODULE_ID, SPLIT_AT_TRIGGER_BOUNDARIES)) return; }
    catch { return; }
    _injectSilents(token.document, context);
}

export function injectTriggerSilentsAtDrop(event) {
    if (_patchDetected) return;
    try {
        if (!game.settings.get(MODULE_ID, SPLIT_AT_TRIGGER_BOUNDARIES)) return;
    } catch { return; }
    const contexts = event?.interactionData?.contexts ?? {};
    for (const [id, ctx] of Object.entries(contexts)) {
        const token = canvas.tokens.get(id);
        if (!token) continue;
        try { _injectSilents(token.document, /** @type {any} */ (ctx)); }
        catch (e) { console.warn(`${MODULE_ID} | silent injection failed for ${id}`, e); }
    }
}

export function initTerrainTriggerSplits() {
    Hooks.on('modifyPlannedMovement', _onModifyPlannedMovement);
}
