/* global canvas, game, Hooks */

const MODULE_ID = 'lancer-automations';
const SPLIT_AT_TRIGGER_BOUNDARIES = 'splitMovementAtTriggerBoundaries';

function _thtMatchKey(thtMatch) {
    const bounds = thtMatch?.shape?.polygon?.boundingRect;
    return `tht::${thtMatch?.shape?.terrainTypeId}::${thtMatch?.shape?.bottom}::${thtMatch?.shape?.top}::${bounds?.x},${bounds?.y}`;
}

const _GAA_EFFECT_BOUNDARY = new Set(['APPLY_ON_ENTER', 'APPLY_ON_LEAVE', 'REMOVE_ON_ENTER', 'REMOVE_ON_LEAVE']);
const _GAA_MACRO_BOUNDARY = new Set(['ENTER_LEAVE', 'ENTER', 'LEAVE', 'PREVIEW_ENTER_LEAVE', 'PREVIEW_ENTER', 'PREVIEW_LEAVE']);
const _GAA_SEQ_BOUNDARY = new Set(['ON_ENTER', 'ON_LEAVE']);

function _gaaAuraHasBoundaryTrigger(auraCfg) {
    if (!auraCfg) return false;
    if (Array.isArray(auraCfg.effects)) for (const effect of auraCfg.effects) if (_GAA_EFFECT_BOUNDARY.has(effect?.mode)) return true;
    if (Array.isArray(auraCfg.macros)) for (const macro of auraCfg.macros) if (_GAA_MACRO_BOUNDARY.has(macro?.mode)) return true;
    if (Array.isArray(auraCfg.sequencerEffects)) for (const seqEffect of auraCfg.sequencerEffects) if (_GAA_SEQ_BOUNDARY.has(seqEffect?.trigger)) return true;
    return false;
}

function _getTriggerKeys(tokenDoc, pos) {
    const keys = new Set();
    const tht = /** @type {any} */ (globalThis).terrainHeightTools;
    if (tht?.getContainingTriggerMatches) {
        try {
            const matches = tht.getContainingTriggerMatches(tokenDoc, pos) ?? [];
            for (const thtMatch of matches) keys.add(_thtMatchKey(thtMatch));
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
                    /** @type {any} */ (action) => action?.trigger === 'whenEntered' || action?.trigger === 'whenLeft'
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
            const centerPoint = tokenDoc.getCenterPoint?.({ x: pos.x, y: pos.y }) ?? {
                x: pos.x + (tokenDoc.width ?? 1) * (canvas.grid.sizeX ?? canvas.grid.size) / 2,
                y: pos.y + (tokenDoc.height ?? 1) * (canvas.grid.sizeY ?? canvas.grid.size) / 2
            };
            const inCombat = !!game.combat;
            const selfId = tokenDoc.id;
            for (const { parent, aura } of gaaLayer._auraManager.getAllAuras({ preview: false })) {
                const auraCfg = aura?.config;
                if (!auraCfg?.enabled) continue;
                if (auraCfg.onlyEnabledInCombat && !inCombat) continue;
                if (parent?.document?.id === selfId) continue;
                if (!_gaaAuraHasBoundaryTrigger(auraCfg)) continue;
                if (!aura.isWorldPointInside?.(centerPoint.x, centerPoint.y)) continue;
                keys.add(`gaa::${parent.document?.id}::${auraCfg.id}`);
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
    const _mkSilent = (waypoint) => ({
        x: waypoint.x, y: waypoint.y, elevation: waypoint.elevation,
        width: refW, height: refH, shape: refS,
        action: waypoint.action,
        snapped: true, explicit: false, checkpoint: true, intermediate: false,
        _laSilent: true
    });
    for (let i = 1; i < densePath.length; i++) {
        const waypoint = densePath[i];
        const prev = densePath[i - 1];
        const currentKeys = _getTriggerKeys(doc, {
            x: waypoint.x, y: waypoint.y, elevation: waypoint.elevation
        });
        let transition = false;
        for (const key of currentKeys) if (!prevKeys.has(key)) { transition = true; break; }
        if (!transition) for (const key of prevKeys) if (!currentKeys.has(key)) { transition = true; break; }
        if (transition && !_AUTO_ELEV_ACTIONS.has(waypoint.action) && !_AUTO_ELEV_ACTIONS.has(prev?.action)) {
            if (prev) inserted.push(_mkSilent(prev));
            inserted.push(_mkSilent(waypoint));
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
    for (const [tokenId, ctx] of Object.entries(contexts)) {
        const token = canvas.tokens.get(tokenId);
        if (!token) continue;
        try { _injectSilents(token.document, /** @type {any} */ (ctx)); }
        catch (err) { console.warn(`${MODULE_ID} | silent injection failed for ${tokenId}`, err); }
    }
}

export function initTerrainTriggerSplits() {
    Hooks.on('modifyPlannedMovement', _onModifyPlannedMovement);
}
