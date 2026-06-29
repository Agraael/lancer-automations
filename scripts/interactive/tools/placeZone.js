/* global canvas, PIXI, game, ui, TokenDocument */

import {
    isHexGrid, offsetToCube, cubeDistance,
    pixelToOffset, getOccupiedOffsets, getInRangeOffsets,
} from "../../combat/grid-helpers.js";

import {
    _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard,
} from "../cards.js";

import {
    addGraphicsBelowTokens, suppressTokenLayerClick, destroyGraphics,
    drawRangeHighlight, _groupCellsByDistance, _makeRangePulseTick, pointerToWorld,
} from "../canvas-helpers.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";

/**
 * Place a template zone on the map using Lancer's WeaponRangeTemplate.
 * Delegates to templatemacro's `placeZone`, which supports three specialized zone types via options:
 *
 * **Dangerous zone** (triggers ENG check on entry/turn start, deals damage on failure):
 * ```js
 * placeZone(token, { size: 2, dangerous: { damageType: "kinetic", damageValue: 5 } });
 * ```
 */
export async function placeZone(casterToken, options = {}) {
    const _opts = /** @type {any} */ (options);

    // Place zones in templatemacro's Advanced Mode (custom render) unless explicitly opted out.
    if (_opts.useCustomRender !== false)
        _opts.tmacGraphics = { ..._opts.tmacGraphics, useCustomRender: true };

    // Direct placement — bypass interactive card when coordinates are provided
    if (_opts.x !== undefined && _opts.y !== undefined) {
        const templateMacroApi = game.modules.get('templatemacro')?.api;
        if (templateMacroApi?.placeZone) {
            const result = await templateMacroApi.placeZone(options, _opts.hooks ?? {});
            if (result && _opts.attachToToken) {
                const tokenDoc = _opts.attachToToken instanceof TokenDocument ? _opts.attachToToken : canvas.scene.tokens.get(_opts.attachToToken);
                if (tokenDoc && templateMacroApi.attachTemplateToToken)
                    await templateMacroApi.attachTemplateToToken(result, tokenDoc);
            }
            return result ? [result] : null;
        }
        // Fallback: no templatemacro
        const templatePreview = game.lancer.canvas.WeaponRangeTemplate.fromRange({ type: _opts.type ?? "Blast", val: _opts.size ?? 1 });
        const baseData = templatePreview.document?.toObject() ?? {};
        const [created] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [{
            ...baseData,
            x: _opts.x,
            y: _opts.y,
            user: game.user.id
        }]);
        if (created && _opts.attachToToken) {
            const tokenDoc = _opts.attachToToken instanceof TokenDocument ? _opts.attachToToken : canvas.scene.tokens.get(_opts.attachToToken);
            if (tokenDoc) {
                const tmApi = game.modules.get('templatemacro')?.api;
                if (tmApi?.attachTemplateToToken)
                    await tmApi.attachTemplateToToken({ template: created }, tokenDoc);
            }
        }
        return created ? [{ x: created.x, y: created.y, template: created }] : null;
    }

    const _title = options.title || 'PLACE ZONE';
    return _queueCard(() => new Promise(async (resolve) => {
        const {
            range = null,
            size = 1,
            type = "Blast",
            fillColor = "#ff6400",
            borderColor = "#964611ff",
            texture = null,
            hooks = {},
            count = 1,
            title,
            description = "",
            icon,
            headerClass = "",
            rangeOrigin = null
        } = /** @type {any} */ (options);

        let rangeHighlight = null;
        const placedZones = [];
        let cancelled = false;
        let confirmed = false;

        const pulseGraphic = new PIXI.Graphics();
        addGraphicsBelowTokens(pulseGraphic);
        let wavePulse = null;

        // Draw range highlight if range is specified (low grey, very transparent)
        // rangeOrigin can be a {x, y} point to override the default casterToken origin
        if (range !== null && (casterToken || rangeOrigin)) {
            const rangeAnchor = rangeOrigin || casterToken;
            rangeHighlight = drawRangeHighlight(rangeAnchor, range, 0x888888, 0.1, false);

            const isPoint = rangeAnchor && !rangeAnchor.document && typeof rangeAnchor.x === 'number' && typeof rangeAnchor.y === 'number';
            const originOffsets = isPoint ? [pixelToOffset(rangeAnchor.x, rangeAnchor.y)] : getOccupiedOffsets(rangeAnchor);
            const hexesByDist = _groupCellsByDistance(
                originOffsets,
                getInRangeOffsets(rangeAnchor, range, { includeSelf: true })
            );
            wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range);
            canvas.app.ticker.add(wavePulse);
        }

        const restoreLayerClick = suppressTokenLayerClick();

        const doCleanup = () => {
            if (wavePulse)
                canvas.app.ticker.remove(wavePulse);
            destroyGraphics(rangeHighlight);
            destroyGraphics(pulseGraphic);
            restoreLayerClick();
            _removeInfoCard(cardEl);
        };

        let placing = true; // auto-start placement when the card opens

        const cardEl = _createInfoCard("placeZone", {
            title,
            icon,
            headerClass,
            description,
            range,
            count,
            zoneType: type,
            zoneSize: size,
            relatedToken: casterToken,
            onConfirm: () => {
                confirmed = true;
            },
            onCancel: () => {
                cancelled = true;
            }
        });

        // Lancer binds template-placement cancel to right-click (oncontextmenu) and has no Escape
        // handler. Swallow right-click; only Escape cancels the current placement.
        const withEscOnlyCancel = (placePromise) => {
            const view = /** @type {any} */ (canvas.app?.view);
            const lancerCancel = view?.oncontextmenu;
            if (!view || typeof lancerCancel !== 'function')
                return placePromise;
            view.oncontextmenu = (ev) => { ev?.preventDefault?.(); };
            const onKey = (ev) => {
                if (ev.key !== 'Escape')
                    return;
                ev.preventDefault();
                ev.stopPropagation();
                globalThis.removeEventListener('keydown', onKey, true);
                lancerCancel(ev);
            };
            globalThis.addEventListener('keydown', onKey, true);
            return placePromise.finally(() => globalThis.removeEventListener('keydown', onKey, true));
        };

        const canPlaceMore = () => count === -1 || placedZones.length < count;

        const refreshZoneCard = () => {
            _updateInfoCard(cardEl, "placeZone", {
                placedZones,
                canPlaceMore: canPlaceMore(),
                onPlaceMore: () => { placing = true; },
                onDeleteZone: async (idx) => {
                    const removed = placedZones.splice(idx, 1);
                    if (removed[0]?.template) {
                        try { await removed[0].template.delete(); } catch (_) { /* ignore */ }
                    }
                    refreshZoneCard();
                }
            });
        };

        // One interactive placement; returns a { x, y, template } result, or null if cancelled.
        const placeOne = async () => {
            const onMove = (e) => {
                const { x, y } = pointerToWorld(e);
                const o = pixelToOffset(x, y);
                playTargetingMove(o.col, o.row);
            };
            canvas.stage.on('pointermove', onMove);
            try {
                const templateMacroApi = game.modules.get('templatemacro')?.api;
                if (templateMacroApi?.placeZone) {
                    const res = await withEscOnlyCancel(templateMacroApi.placeZone(options, hooks));
                    if (res)
                        playUiSound('targetingConfirm');
                    return res;
                }
                const templatePreview = game.lancer.canvas.WeaponRangeTemplate.fromRange({ type, val: size });
                const template = await withEscOnlyCancel(templatePreview.placeTemplate());
                if (!template)
                    return null;
                playUiSound('targetingConfirm');
                const updateData = { fillColor, borderColor };
                if (texture)
                    updateData.texture = texture;
                await template.update(updateData);
                return { x: template.x, y: template.y, template };
            } finally {
                canvas.stage.off('pointermove', onMove);
            }
        };

        const deleteAll = async () => {
            for (const zone of placedZones) {
                try { await zone.template.delete(); } catch (_) { /* ignore */ }
            }
        };

        try {
            refreshZoneCard();

            while (true) {
                if (cancelled) {
                    await deleteAll();
                    doCleanup();
                    resolve(null);
                    return;
                }
                if (confirmed) {
                    doCleanup();
                    resolve(placedZones);
                    return;
                }
                // Idle: nothing to place right now — wait for Place / Confirm / Cancel.
                if (!placing || !canPlaceMore()) {
                    await new Promise(r => setTimeout(r, 100));
                    continue;
                }

                const result = await placeOne();

                // Flags may have flipped while awaiting the placement.
                if (cancelled) {
                    if (result?.template) {
                        try { await result.template.delete(); } catch (_) { /* ignore */ }
                    }
                    await deleteAll();
                    doCleanup();
                    resolve(null);
                    return;
                }
                if (confirmed) {
                    doCleanup();
                    resolve(placedZones);
                    return;
                }

                // Escape during placement: stop auto-placing, idle for Place / Confirm / Cancel.
                if (!result?.template) {
                    placing = false;
                    continue;
                }

                if (range !== null && (casterToken || rangeOrigin)) {
                    const origin = rangeOrigin || casterToken;
                    let dist;
                    if (origin.document) {
                        // Token origin: measure from nearest occupied hex (matches highlight)
                        const pointOffset = pixelToOffset(result.x, result.y);
                        const offsets = getOccupiedOffsets(origin);
                        if (isHexGrid()) {
                            const pointCube = offsetToCube(pointOffset.col, pointOffset.row);
                            dist = Math.min(...offsets.map(o => cubeDistance(offsetToCube(o.col, o.row), pointCube)));
                        } else {
                            dist = Math.min(...offsets.map(o => Math.max(Math.abs(o.col - pointOffset.col), Math.abs(o.row - pointOffset.row))));
                        }
                    } else {
                        // Point origin: simple grid distance
                        dist = Math.round(canvas.grid.measurePath([origin, { x: result.x, y: result.y }]).distance / canvas.dimensions.distance);
                    }
                    if (dist > range) {
                        await result.template.delete();
                        ui.notifications.warn("Target is out of range!");
                        continue; // placing stays true -> retry
                    }
                }

                placedZones.push(result);

                if (_opts.attachToToken && result.template) {
                    const tokenDoc = _opts.attachToToken instanceof TokenDocument ? _opts.attachToToken : canvas.scene.tokens.get(_opts.attachToToken);
                    if (tokenDoc) {
                        const tmApi = game.modules.get('templatemacro')?.api;
                        if (tmApi?.attachTemplateToToken)
                            await tmApi.attachTemplateToToken(result, tokenDoc);
                    }
                }

                // Stop auto-placing once the count is reached; the card's Place button re-arms it.
                if (!canPlaceMore())
                    placing = false;

                refreshZoneCard();
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (e) {
            console.error(e);
            doCleanup();
            resolve(placedZones.length > 0 ? placedZones : null);
        }
    }), _title);
}
