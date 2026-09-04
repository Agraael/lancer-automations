/* global canvas, PIXI, game, ui, TokenDocument */

import {
    isHexGrid, offsetToCube, cubeDistance,
    pixelToOffset, getOccupiedOffsets, getInRangeOffsets,
} from "../../combat/grid-helpers.js";

import {
    _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard,
} from "../cards.js";

import {
    suppressTokenLayerClick, pointerToWorld,
    createMergedRangeHighlight, isPulseLosEnabled,
} from "../canvas-helpers.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";
import { rangePulse, RANGE_PULSE_PRIORITY } from "../range-pulse-manager.js";
import { getHexGroundElevation } from "../../combat/terrain-utils.js";

const ZONE_TEXTURE_DRIFT = { x: 15, y: 15 };

/**
 * Tokens currently inside a placed template, ready to pass to executeDamageRoll.
 * Wraps templatemacro's `findContained` (elevation/terrain-aware, handles multi-cell
 * tokens and donut templates) and maps the ids to actor-bearing Token placeables.
 *
 * @param {any} templateOrResult A template document, its placeable, or a `placeZone` result (`{ x, y, template }`).
 * @returns {Token[]} Tokens inside the template that have an actor. Empty if templatemacro is unavailable.
 */
export function tokensInTemplate(templateOrResult)
{
    const doc = templateOrResult?.template   // placeZone result: { x, y, template }
        ?? templateOrResult?.document        // placeable -> its document
        ?? templateOrResult;                 // already a document
    const tmApi = game.modules.get('templatemacro')?.api;
    if (!tmApi?.findContained || !doc)
        return [];
    return tmApi.findContained(doc)
        .map(id => canvas.tokens.get(id))
        .filter(token => token?.actor);
}

/**
 * Place a template zone on the map using Lancer's WeaponRangeTemplate.
 * Delegates to templatemacro's `placeZone`, which supports three specialized zone types via options:
 *
 * **Dangerous zone** (triggers ENG check on entry/turn start, deals damage on failure):
 * ```js
 * placeZone(token, { size: 2, dangerous: { damageType: "kinetic", damageValue: 5 } });
 * ```
 */
export async function placeZone(casterToken, options = {})
{
    const results = await _placeZoneInner(casterToken, options);
    await _applyZoneExpiry(results, casterToken, /** @type {any} */ (options).expires);
    return results;
}

// expires: { on: 'ownerTurnStart' | 'ownerTurnEnd', originToken?, turns? } - template auto-deletes
// on that combat event; turns > 1 survives that many occurrences before deleting.
async function _applyZoneExpiry(results, casterToken, expires)
{
    if (!expires?.on || !results?.length)
        return;
    const originId = expires.originToken?.id ?? expires.originToken ?? casterToken?.id ?? null;
    const remaining = Math.max(1, Number(expires.turns) || 1);
    for (const placed of results)
    {
        if (placed?.template?.setFlag)
            await placed.template.setFlag('lancer-automations', 'zoneExpires', { on: expires.on, tokenId: originId, remaining });
    }
}

Hooks.on('combatTurnChange', async (combat, prior, current) =>
{
    if (!game.users.activeGM?.isSelf)
        return;
    const priorTokenId = prior?.combatantId ? combat.combatants.get(prior.combatantId)?.token?.id : null;
    const currentTokenId = current?.combatantId ? combat.combatants.get(current.combatantId)?.token?.id : null;
    const expired = [];
    const ticked = [];
    for (const template of (canvas.scene?.templates ?? []))
    {
        const expiry = template.getFlag?.('lancer-automations', 'zoneExpires');
        if (!expiry?.on)
            continue;
        const hit = (expiry.on === 'ownerTurnStart' && expiry.tokenId === currentTokenId)
            || (expiry.on === 'ownerTurnEnd' && expiry.tokenId === priorTokenId);
        if (!hit)
            continue;
        const remaining = (Number(expiry.remaining) || 1) - 1;
        if (remaining <= 0)
            expired.push(template);
        else
            ticked.push({ template, expiry: { ...expiry, remaining } });
    }
    for (const template of expired)
        await template.delete().catch(() => {});
    for (const entry of ticked)
        await entry.template.setFlag('lancer-automations', 'zoneExpires', entry.expiry);
});

async function _placeZoneInner(casterToken, options = {})
{
    const _opts = /** @type {any} */ (options);

    // Library preset (name or id) as base graphics; explicit options win.
    if (_opts.preset)
    {
        const library = /** @type {any[]} */ (game.settings.get('templatemacro', 'templateLibrary') ?? []);
        const entry = library.find(candidate => candidate.id === _opts.preset || candidate.name === _opts.preset);
        if (entry?.graphicsState)
            _opts.tmacGraphics = { ...foundry.utils.deepClone(entry.graphicsState), ..._opts.tmacGraphics };
        else
            ui.notifications.warn(`placeZone: template preset "${_opts.preset}" not found.`);
    }

    // Place zones in templatemacro's Advanced Mode (custom render) unless explicitly opted out.
    if (_opts.useCustomRender !== false)
        _opts.tmacGraphics = { ..._opts.tmacGraphics, useCustomRender: true };

    if (_opts.elevation === undefined && casterToken)
        _opts.elevation = Number(casterToken.document?.elevation) || 0;

    // elevationGated makes templatemacro's findContained ignore tokens outside the zone's elevation band.
    _opts.tmacGraphics = { ..._opts.tmacGraphics, elevationGated: _opts.elevationAware !== false };

    // Drifting texture fill, overridable per call. Inert on zones with no fill texture.
    if (_opts.tmacGraphics.fillTextureOffsetAnimation === undefined)
        _opts.tmacGraphics = { ..._opts.tmacGraphics, fillTextureOffsetAnimation: ZONE_TEXTURE_DRIFT };

    // Direct placement: bypass interactive card when coordinates are provided
    if (_opts.x !== undefined && _opts.y !== undefined)
    {
        const templateMacroApi = game.modules.get('templatemacro')?.api;
        if (templateMacroApi?.placeZone)
        {
            const result = await templateMacroApi.placeZone(options, _opts.hooks ?? {});
            if (result && _opts.attachToToken)
            {
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
        if (created && _opts.attachToToken)
        {
            const tokenDoc = _opts.attachToToken instanceof TokenDocument ? _opts.attachToToken : canvas.scene.tokens.get(_opts.attachToToken);
            if (tokenDoc)
            {
                const tmApi = game.modules.get('templatemacro')?.api;
                if (tmApi?.attachTemplateToToken)
                    await tmApi.attachTemplateToToken({ template: created }, tokenDoc);
            }
        }
        return created ? [{ x: created.x, y: created.y, template: created }] : null;
    }

    const _title = options.title || 'PLACE ZONE';
    return _queueCard(() => new Promise(async (resolve) =>
    {
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
            rangeOrigin = null,
            elevationAware = true,
            autoElevation = true,
            los: optLos = null
        } = /** @type {any} */ (options);

        const placedZones = [];
        let cancelled = false;
        let confirmed = false;
        let autoElev = autoElevation !== false;
        const casterElev = Number(casterToken?.document?.elevation) || 0;
        const groundAt = (x, y) =>
        {
            const terrainAPI = globalThis.terrainHeightTools;
            if (!terrainAPI)
                return 0;
            const offset = pixelToOffset(x, y);
            return Number(getHexGroundElevation(offset.col, offset.row, terrainAPI)) || 0;
        };
        const zoneElevation = (x, y) => (autoElev ? groundAt(x, y) : casterElev);

        // rangeOrigin can be a {x, y} point to override the default casterToken origin
        const rangeAnchor = rangeOrigin || casterToken;
        const anchorIsPoint = rangeAnchor && !rangeAnchor.document && typeof rangeAnchor.x === 'number' && typeof rangeAnchor.y === 'number';
        let losOn = optLos === null ? true : !!optLos;
        const rebuildZonePulse = () =>
        {
            if (range === null || !rangeAnchor)
                return;
            rangePulse.set('interactive:placeZone', {
                priority: RANGE_PULSE_PRIORITY.INTERACTIVE,
                build: () => createMergedRangeHighlight(
                    [anchorIsPoint ? { point: rangeAnchor, range } : { token: rangeAnchor, range, los: losOn }],
                    { includeSelf: false }
                ),
            });
        };
        rebuildZonePulse();

        const restoreLayerClick = suppressTokenLayerClick();

        const refreshElevReadout = () =>
        {
            const readout = cardEl?.find?.('[data-role="zone-elev-readout"]');
            if (readout?.length)
                readout.text(`Elevation: ${autoElev ? 'auto' : casterElev}`);
        };

        const tmDrag = game.modules.get('templatemacro')?.api;
        const doCleanup = () =>
        {
            tmDrag?.setPreviewElevationBase?.(null);
            rangePulse.clear('interactive:placeZone');
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
            elevationAware,
            showLosToggle: range !== null && !!rangeAnchor && !anchorIsPoint && isPulseLosEnabled(),
            losOn,
            relatedToken: casterToken,
            onConfirm: () =>
            {
                confirmed = true;
            },
            onCancel: () =>
            {
                cancelled = true;
            }
        });

        cardEl.find('[data-role="zone-elev-toggle"]').on('change', function ()
        {
            _opts.tmacGraphics = { ..._opts.tmacGraphics, elevationGated: this.checked };
        });
        cardEl.find('[data-role="zone-auto-elev"]').on('change', function ()
        {
            autoElev = this.checked;
            refreshElevReadout();
        });
        cardEl.find('[data-role="zone-los-toggle"]').on('change', function ()
        {
            losOn = this.checked;
            rebuildZonePulse();
        });
        refreshElevReadout();

        // Lancer binds template-placement cancel to right-click (oncontextmenu) and has no Escape
        // handler. Swallow right-click; only Escape cancels the current placement.
        const withEscOnlyCancel = (placePromise) =>
        {
            const view = /** @type {any} */ (canvas.app?.view);
            const lancerCancel = view?.oncontextmenu;
            if (!view || typeof lancerCancel !== 'function')
                return placePromise;
            view.oncontextmenu = (ev) =>
            {
                ev?.preventDefault?.();
            };
            const onKey = (ev) =>
            {
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

        const refreshZoneCard = () =>
        {
            _updateInfoCard(cardEl, "placeZone", {
                placedZones,
                canPlaceMore: canPlaceMore(),
                onPlaceMore: () =>
                {
                    placing = true;
                },
                onDeleteZone: async (idx) =>
                {
                    const removed = placedZones.splice(idx, 1);
                    if (removed[0]?.template)
                    {
                        try
                        {
                            await removed[0].template.delete();
                        }
                        catch (_)
                        { /* ignore */ }
                    }
                    refreshZoneCard();
                }
            });
        };

        // One interactive placement; returns a { x, y, template } result, or null if cancelled.
        const placeOne = async () =>
        {
            tmDrag?.setPreviewElevationBase?.((doc) => zoneElevation(doc.x, doc.y));
            const onMove = (e) =>
            {
                const { x, y } = pointerToWorld(e);
                const offset = pixelToOffset(x, y);
                playTargetingMove(offset.col, offset.row);
            };
            canvas.stage.on('pointermove', onMove);
            try
            {
                const templateMacroApi = game.modules.get('templatemacro')?.api;
                if (templateMacroApi?.placeZone)
                {
                    const zoneResult = await withEscOnlyCancel(templateMacroApi.placeZone(options, hooks));
                    if (zoneResult)
                        playUiSound('targetingConfirm');
                    return zoneResult;
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
            }
            finally
            {
                tmDrag?.setPreviewElevationBase?.(null);
                canvas.stage.off('pointermove', onMove);
            }
        };

        const deleteAll = async () =>
        {
            for (const zone of placedZones)
            {
                try
                {
                    await zone.template.delete();
                }
                catch (_)
                { /* ignore */ }
            }
        };

        try
        {
            refreshZoneCard();

            while (true)
            {
                if (cancelled)
                {
                    await deleteAll();
                    doCleanup();
                    resolve(null);
                    return;
                }
                if (confirmed)
                {
                    doCleanup();
                    resolve(placedZones);
                    return;
                }
                // Idle: nothing to place right now, wait for Place / Confirm / Cancel.
                if (!placing || !canPlaceMore())
                {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                }

                const result = await placeOne();

                if (result?.template && !tmDrag?.setPreviewElevationBase)
                {
                    try
                    {
                        await result.template.update({ elevation: zoneElevation(result.template.x, result.template.y) });
                    }
                    catch (_)
                    { /* ignore */ }
                }

                // Flags may have flipped while awaiting the placement.
                if (cancelled)
                {
                    if (result?.template)
                    {
                        try
                        {
                            await result.template.delete();
                        }
                        catch (_)
                        { /* ignore */ }
                    }
                    await deleteAll();
                    doCleanup();
                    resolve(null);
                    return;
                }
                if (confirmed)
                {
                    doCleanup();
                    resolve(placedZones);
                    return;
                }

                // Escape during placement: stop auto-placing, idle for Place / Confirm / Cancel.
                if (!result?.template)
                {
                    placing = false;
                    continue;
                }

                if (range !== null && (casterToken || rangeOrigin))
                {
                    const origin = rangeOrigin || casterToken;
                    let dist;
                    if (origin.document)
                    {
                        // Token origin: measure from nearest occupied hex (matches highlight)
                        const pointOffset = pixelToOffset(result.x, result.y);
                        const offsets = getOccupiedOffsets(origin);
                        if (isHexGrid())
                        {
                            const pointCube = offsetToCube(pointOffset.col, pointOffset.row);
                            dist = Math.min(...offsets.map(offset => cubeDistance(offsetToCube(offset.col, offset.row), pointCube)));
                        }
                        else
                            dist = Math.min(...offsets.map(offset => Math.max(Math.abs(offset.col - pointOffset.col), Math.abs(offset.row - pointOffset.row))));
                    }
                    else
                    {
                        // Point origin: simple grid distance
                        dist = Math.round(canvas.grid.measurePath([origin, { x: result.x, y: result.y }]).distance / canvas.dimensions.distance);
                    }
                    if (dist > range)
                    {
                        await result.template.delete();
                        ui.notifications.warn("Target is out of range!");
                        continue; // placing stays true -> retry
                    }
                }

                placedZones.push(result);

                if (_opts.attachToToken && result.template)
                {
                    const tokenDoc = _opts.attachToToken instanceof TokenDocument ? _opts.attachToToken : canvas.scene.tokens.get(_opts.attachToToken);
                    if (tokenDoc)
                    {
                        const tmApi = game.modules.get('templatemacro')?.api;
                        if (tmApi?.attachTemplateToToken)
                            await tmApi.attachTemplateToToken(result, tokenDoc);
                    }
                }

                // Stop auto-placing once the count is reached; the card's Place button re-arms it.
                if (!canPlaceMore())
                    placing = false;

                refreshZoneCard();
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        catch (e)
        {
            console.error(e);
            doCleanup();
            resolve(placedZones.length > 0 ? placedZones : null);
        }
    }), _title);
}
