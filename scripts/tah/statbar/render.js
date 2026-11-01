import { isLancerActor as isLancerCombatant, hasMechStats, hasReaction, corePowerState } from '../../utils/lancer-token.js';
import { MODULE_ID, SETTING_MIN_ZOOM_SCALE, SETTING_SHOW_VALUES, MAX_BAR_WIDTH, REF_GRID_SIZE, REF_ROW_HEIGHT } from './config.js';
import { _lastValues, _overlayHubs, getHubOverlay, getOriginalDrawBars, _countFrom } from './state.js';
import { isEnabled, _getIsoState, getWorldSetting, statBarRowHeight, shouldShowBars, followsTokenWidth } from './rules.js';
import { BAR_DEFS, _hubRows, _pipSlotCount, _armorTicks, _hubExtraLines, getEffectiveMax, _parseHex, snapshotValues } from './model.js';
import { _gaugeSegment, _reduceMotion, _breath, _easeOut } from './animations.js';
import { reactionCounts } from '../../combat/action-extras.js';
import { drawElevationBadge } from './elevation-badge.js';
import { overchargeColor, REPAIR_COLOR } from '../../tools/color-utils.js';

// Rendering

const BAKE_RESOLUTION = 4;
const HP_TICK_STEP = 5;
const COUNT_MS = 300;
const AMBIENT_BREATH_MS = 1600;
const POWER_BREATH_MS = 1000;

// Swaps gfx for a baked sprite at the same z-slot; tracks texture for cleanup.
function bakeAndSwap(container, gfx, tokenId, { addAt } = {})
{
    const sprite = bakeGraphicsToTexture(gfx);
    if (!sprite)
        return false;
    container.removeChild(gfx);
    if (Number.isFinite(addAt))
        container.addChildAt(sprite, addAt);
    else
        container.addChild(sprite);
    gfx.destroy();
    const entry = _overlayHubs.get(tokenId);
    if (entry)
    {
        entry.bakedTextures = entry.bakedTextures || [];
        entry.bakedTextures.push(sprite._laBakedTexture);
    }
    return true;
}

function _addBreathingBox(container, gfx, x, periodMs, baseAlpha, swing)
{
    const box = new PIXI.Container();
    box.name = 'la-fixed-box';
    box.position.set(x, 0);
    box.addChild(gfx);
    container.addChild(box);
    const breathe = () =>
    {
        if (gfx.destroyed)
        {
            canvas.app.ticker.remove(breathe);
            return;
        }
        gfx.alpha = baseAlpha + swing * _breath(periodMs);
    };
    canvas.app.ticker.add(breathe);
    breathe();
}

function _addFixedBox(container, boxGfx, x, tokenId)
{
    const box = new PIXI.Container();
    box.name = 'la-fixed-box';
    box.position.set(x, 0);
    box.addChild(boxGfx);
    container.addChild(box);
    bakeAndSwap(box, boxGfx, tokenId);
}

// Bakes gfx to a high-res RenderTexture -> crisp Sprite at any zoom. Caller destroys gfx; texture kept on sprite._laBakedTexture for cleanup.
function bakeGraphicsToTexture(gfx, resolution = BAKE_RESOLUTION)
{
    if (!canvas?.app?.renderer || !gfx)
        return null;
    try
    {
        const bounds = gfx.getLocalBounds();
        if (bounds.width <= 0 || bounds.height <= 0)
            return null;
        const region = new PIXI.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
        const tex = canvas.app.renderer.generateTexture(gfx, {
            resolution,
            region,
            multisample: PIXI.MSAA_QUALITY?.HIGH ?? 4,
        });
        // Mipmaps: GPU uses pre-filtered downsamples instead of 1-of-N nearest sampling (the moiré source).
        if (tex.baseTexture)
        {
            tex.baseTexture.mipmap = PIXI.MIPMAP_MODES?.ON ?? 1;
            tex.baseTexture.anisotropicLevel = 16;
            tex.baseTexture.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? 1;
            tex.baseTexture.update();
        }
        const sprite = new PIXI.Sprite(tex);
        sprite.position.set(bounds.x, bounds.y);
        sprite._laBakedTexture = tex;
        return sprite;
    }
    catch (e)
    {
        console.warn(`${MODULE_ID} | bakeGraphicsToTexture failed`, e);
        return null;
    }
}

function drawSegment(gfx, x, y, w, h, def, barValue, chromeScale = 1)
{
    const max = (barValue.max && barValue.max > 0) ? barValue.max : (def.softMax ?? 1);
    const value = Math.max(0, barValue.value ?? 0);
    const pct = Math.clamp(value / max, 0, 1);

    gfx.lineStyle(0);
    gfx.beginFill(0x111111, 0.9);
    gfx.drawRect(x, y, w, h);
    gfx.endFill();
    gfx.beginFill(0x222222, 0.9);
    gfx.drawRect(x + chromeScale, y + chromeScale, w - 2 * chromeScale, h - 2 * chromeScale);
    gfx.endFill();

    if (def.pips)
    {
        // Drains left-first (STR/Stress) unless pipsLTR is set (extras fill left-first).
        const gap = chromeScale;
        const inner = w - 2 * chromeScale;
        const segW = (inner - gap * (max - 1)) / max;
        const filledCount = Math.max(0, Math.min(max, value));
        for (let pipIdx = 0; pipIdx < max; pipIdx++)
        {
            const filled = def.pipsLTR ? (pipIdx < filledCount) : (pipIdx >= max - filledCount);
            gfx.beginFill(filled ? def.color : 0x333333, filled ? 1 : 0.6);
            gfx.drawRect(x + chromeScale + pipIdx * (segW + gap), y + chromeScale, segW, h - 2 * chromeScale);
            gfx.endFill();
        }
    }
    else
    {
        const fillW = Math.max(0, (w - 2 * chromeScale) * pct);
        if (fillW > 0)
        {
            gfx.beginFill(def.color, 1);
            gfx.drawRect(x + chromeScale, y + chromeScale, fillW, h - 2 * chromeScale);
            gfx.endFill();
        }
    }
}

export function _removeOverlayHub(tokenId)
{
    _removeSyncTicker(tokenId);
    const entry = _overlayHubs.get(tokenId);
    if (!entry)
        return;
    if (!entry.wrapper.destroyed)
        entry.wrapper.destroy({ children: true });
    if (entry.bakedTextures)
    {
        for (const tex of entry.bakedTextures)
        {
            try
            {
                tex.destroy(true);
            }
            catch
            { /* ignore */ }
        }
    }
    _overlayHubs.delete(tokenId);
}

// Per-frame position sync so the hub follows token drag.
const _syncTickers = new Map();

function _ensureSyncTicker(token)
{
    if (_syncTickers.has(token.id))
        return;
    const tick = () =>
    {
        const entry = _overlayHubs.get(token.id);
        if (!entry || token.destroyed)
        {
            canvas.app.ticker.remove(tick);
            _syncTickers.delete(token.id);
            return;
        }
        const active = _activeForId(token.id) ?? token;
        const iso = _getIsoState(active);
        if (iso && active.mesh)
            entry.wrapper.position.set(active.mesh.position.x, active.mesh.position.y);
        else
            entry.wrapper.position.set(active.position.x, active.position.y);
        const minZoom = getWorldSetting(SETTING_MIN_ZOOM_SCALE, 0);
        const floorW = REF_GRID_SIZE * Math.min(1, entry.width / (canvas.dimensions?.size || entry.width));
        let nameGrowth = 1;
        let boxScale = 1;
        if (minZoom > 0 && !iso)
        {
            const zoom = canvas.stage?.scale?.x || 1;
            // Use effective bar width so sub-1x1 tokens don't get double-scaled.
            const effW = Math.max(entry.tokenW, entry.width);
            const kx = Math.max(1, (floorW * minZoom) / (effW * zoom));
            const ky = Math.max(1, (REF_ROW_HEIGHT * minZoom) / (entry.rowHeight * zoom));
            nameGrowth = ky;
            boxScale = ky / kx;
            entry.wrapper.scale.set(kx, ky);
            entry.hub.position.set(
                (entry.tokenW / kx - entry.width) / 2,
                entry.startY / ky
            );
            // Undo non-uniform stretch on labels.
            for (const child of entry.hub.children)
            {
                if (child?.name === 'la-bar-label')
                    child.scale.set((ky / kx) / 8, 1 / 8);
            }
        }
        else if (minZoom > 0 && iso)
        {
            // local axes stay screen-aligned under the counter-transform, so per-axis growth is safe
            const zoom = canvas.stage?.scale?.x || 1;
            const effW = Math.max(entry.tokenW, entry.width);
            const kx = Math.max(1, (floorW * minZoom) / (effW * zoom));
            const ky = Math.max(1, (REF_ROW_HEIGHT * minZoom) / (entry.rowHeight * zoom));
            boxScale = ky / kx;
            entry.wrapper.scale.set(iso.counterScale * kx, (1 / iso.counterScale) * ky);
            entry.hub.position.set(-entry.width / 2, ((entry.tokenH / 2) + 3 - entry.rowHeight) / ky);
            for (const child of entry.hub.children)
            {
                if (child?.name === 'la-bar-label')
                    child.scale.set((ky / kx) / 8, 1 / 8);
            }
        }
        if (entry.boxScale !== boxScale)
        {
            entry.boxScale = boxScale;
            for (const child of entry.hub.children)
            {
                if (child?.name === 'la-fixed-box')
                    child.scale.x = boxScale;
                else if (child?.name === 'la-bar-label')
                    child.position.x = entry.labelBaseX + entry.sideExt * boxScale + 2;
            }
        }
        // Keep the name below the live-scaled hub (non-iso; iso is set on refresh).
        const nameplate = token.nameplate;
        if (nameplate?.visible && !iso)
        {
            const bars = shouldShowBars(token);
            const uiScale = canvas.dimensions?.uiScale ?? 1;
            const growth = bars ? nameGrowth : 1;
            nameplate.scale.set(uiScale * growth, uiScale * growth);
            nameplate.position.x = token.w / 2;
            nameplate.position.y = bars
                ? token.h + 10 + (entry.totalHeight ?? 0) * (entry.wrapper.scale.y - 1)
                : token.h + 2;
        }
    };
    _syncTickers.set(token.id, tick);
    canvas.app.ticker.add(tick);
}

function _removeSyncTicker(tokenId)
{
    const tick = _syncTickers.get(tokenId);
    if (tick)
    {
        canvas.app.ticker.remove(tick);
        _syncTickers.delete(tokenId);
    }
}

// Returns drag preview if available, else source token (both share id in v13).
function _activeForId(tokenId)
{
    const previews = canvas.tokens?.preview?.children ?? [];
    for (const preview of previews)
    {
        if (preview?.document?.id === tokenId && preview.mesh)
            return preview;
    }
    return canvas.tokens?.get?.(tokenId) ?? null;
}

export function _syncHubPosition(token)
{
    const entry = _overlayHubs.get(token.id);
    if (!entry)
        return;
    const active = _activeForId(token.id) ?? token;
    const iso = _getIsoState(active);
    if (iso && active.mesh)
        entry.wrapper.position.set(active.mesh.position.x, active.mesh.position.y);
    else
        entry.wrapper.position.set(active.position.x, active.position.y);
    _ensureSyncTicker(token);
}

export function drawStatHub()
{
    const token = this;
    const tokenId = /** @type {any} */ (token).id;
    const actor = token?.actor;

    if (!token?.bars)
        return;

    token.bars.removeChildren();

    // Preserve flash children and alpha before destroying the old hub.
    const oldEntry = _overlayHubs.get(token.id);
    const prevAlpha = oldEntry?.wrapper?.alpha;
    const savedFlashes = [];
    if (oldEntry?.hub)
    {
        for (const child of [...oldEntry.hub.children])
        {
            if (child.name?.startsWith('la-flash-'))
            {
                oldEntry.hub.removeChild(child);
                savedFlashes.push(child);
            }
        }
    }
    _removeOverlayHub(token.id);

    if (!isEnabled() || !isLancerCombatant(actor))
    {
        const originalDrawBars = getOriginalDrawBars();
        if (originalDrawBars)
            return originalDrawBars.call(token);
        return;
    }

    token.displayBars = CONST.TOKEN_DISPLAY_MODES.ALWAYS;

    const overlay = getHubOverlay();
    if (!overlay)
        return;

    const { visibleIds, rows } = _hubRows(actor, token.document);
    const find = id => BAR_DEFS.find(def => def.id === id);
    const mechStats = hasMechStats(actor);
    const reactionEnabled = hasReaction(actor);

    if (rows.length === 0)
    {
        token.bars.visible = false;
        // Seed snapshot anyway: updateToken/updateActor still need it to diff extras.
        if (!_lastValues.has(token.id))
            _lastValues.set(token.id, snapshotValues(actor, /** @type {any} */ (token).document));
        return;
    }

    // Floor the bar at one grid cell so small tokens stay readable, unless their actor type follows the token width.
    const minBarW = followsTokenWidth(actor) ? token.w : (canvas.dimensions?.size ?? token.w);
    const width = Math.min(MAX_BAR_WIDTH, Math.max(token.w, minBarW));
    const rowHeightOverride = statBarRowHeight(token.document);
    const rowHeight = rowHeightOverride > 0
        ? rowHeightOverride
        : Math.max(3, Math.round(canvas.dimensions.size * 0.07));
    const chromeScale = Math.max(0.5, rowHeight / REF_ROW_HEIGHT);
    const rowGap = chromeScale;
    const startY = token.h + Math.max(2, Math.round(rowHeight * 0.4)) - rowHeight;

    const armorTickW = chromeScale * 2;
    const armorTickGap = chromeScale;
    const reactions = reactionEnabled ? reactionCounts(actor) : null;
    // Reaction extends left of the bar block.
    let indicatorW = reactionEnabled ? rowHeight : 0;
    if (reactions && reactions.total > 1)
        indicatorW = reactions.total * armorTickW + (reactions.total - 1) * armorTickGap + 2 * chromeScale;
    const indicatorGap = reactionEnabled ? chromeScale : 0;
    const reactionExtension = indicatorW + indicatorGap;
    const layoutOffsetX = 0;

    const usableW = width;
    const colGap = mechStats ? chromeScale : 0;
    // Pip column shrinks with fewer pips, capped at 4 for sizing.
    let pipColW = 0;
    if (mechStats)
    {
        const baseColW = Math.floor(usableW * 0.32);
        const innerGap = chromeScale;
        const pipSlotW = (baseColW - 2 * chromeScale - innerGap * 3) / 4;
        const pipCount = _pipSlotCount(actor);
        pipColW = Math.ceil(pipCount * pipSlotW + innerGap * (pipCount - 1) + 2 * chromeScale);
    }

    // Armor ticks: right of HP bar, GM/owners only.
    const armorVal = _armorTicks(actor);
    const armorW = armorVal > 0
        ? armorVal * armorTickW + (armorVal - 1) * armorTickGap + 2 * chromeScale
        : 0;
    const armorGap = armorVal > 0 ? colGap : 0;

    const rightColX = layoutOffsetX + pipColW + colGap;
    const rightColW = usableW - pipColW - colGap;

    const wrapper = new PIXI.Container();
    wrapper.name = `la-hub-wrapper-${token.id}`;
    overlay.addChild(wrapper);

    const container = new PIXI.Container();
    container.name = 'la-stat-hub';
    wrapper.addChild(container);

    const iso = _getIsoState(token);
    if (iso && token.mesh)
    {
        wrapper.position.set(token.mesh.position.x, token.mesh.position.y);
        wrapper.rotation = iso.reverseRotation;
        wrapper.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        // K = 1/sqrt(sqrt(3)) ≈ 0.76 cancels the True Iso aspect change.
        const isoScale = 0.76;
        wrapper.scale.set(isoScale, 1 / isoScale);
        container.position.set(-width / 2, (token.h / 2) + 3 - rowHeight);
    }
    else
    {
        wrapper.position.set(token.position.x, token.position.y);
        wrapper.rotation = 0;
        wrapper.skew.set(0, 0);
        wrapper.scale.set(1, 1);
        container.position.set((token.w - width) / 2, startY);
    }

    const mechDetail = actor.type === 'mech' && (game.user?.isGM || actor.isOwner);
    const ocSequence = actor.system?.overcharge_sequence;
    const ocSteps = mechDetail && typeof ocSequence === 'string' && visibleIds.has('heat')
        ? Math.max(0, ocSequence.split(',').length - 1)
        : 0;
    const ocW = ocSteps > 0
        ? ocSteps * armorTickW + (ocSteps - 1) * armorTickGap + 2 * chromeScale
        : 0;
    const armorExt = armorVal > 0 && visibleIds.has('hp') ? armorGap + armorW : 0;
    const sideExt = Math.max(armorExt, ocSteps > 0 ? colGap + ocW : 0);
    const repairsMax = mechDetail && reactionEnabled ? Math.max(0, actor.system?.repairs?.max ?? 0) : 0;
    const gaugeBaseW = repairsMax > 0 ? Math.max(2, rowHeight * 0.43) : 0;
    const gaugeW = gaugeBaseW > 0 ? gaugeBaseW + chromeScale : 0;
    const gaugeExt = gaugeW > 0 ? gaugeW + chromeScale : 0;
    const gaugeGeom = { gaugeX: -(gaugeW + chromeScale), gaugeW, gaugePad: gaugeBaseW * 0.23, gaugeH: rows.length > 1 ? 2 * rowHeight + rowGap : rowHeight, repairsMax };
    const reactionLeft = -(reactionExtension + gaugeExt);
    _overlayHubs.set(token.id, { wrapper, hub: container, width, rowHeight, startY, tokenW: token.w, tokenH: token.h, labelBaseX: rightColX + rightColW, sideExt });

    const gfx = new PIXI.Graphics();
    container.addChild(gfx);

    gfx.lineStyle(0);
    // Reaction: hangs off the left edge. Skipped for deployables.
    if (reactions)
    {
        const reactionX = reactionLeft;
        const reactionGfx = new PIXI.Graphics();
        reactionGfx.beginFill(0x111111, 0.9);
        reactionGfx.drawRect(reactionX, 0, indicatorW, rowHeight);
        reactionGfx.endFill();
        if (reactions.total > 1)
        {
            for (let slot = 0; slot < reactions.total; slot++)
            {
                const lit = slot >= reactions.total - reactions.left;
                reactionGfx.beginFill(lit ? 0x9944cc : 0x333333, lit ? 1 : 0.6);
                reactionGfx.drawRect(reactionX + chromeScale + slot * (armorTickW + armorTickGap), chromeScale, armorTickW, rowHeight - 2 * chromeScale);
                reactionGfx.endFill();
            }
        }
        else
        {
            const reactionAvailable = reactions.left > 0;
            reactionGfx.beginFill(reactionAvailable ? 0x9944cc : 0x333333, reactionAvailable ? 1 : 0.6);
            reactionGfx.drawRect(reactionX + chromeScale, chromeScale, indicatorW - 2 * chromeScale, rowHeight - 2 * chromeScale);
            reactionGfx.endFill();
        }
        _addFixedBox(container, reactionGfx, 0, tokenId);
    }

    if (repairsMax > 0)
    {
        const repairsLeft = Math.max(0, Math.min(repairsMax, actor.system?.repairs?.value ?? 0));
        const gaugeGfx = new PIXI.Graphics();
        gaugeGfx.beginFill(0x111111, 0.9);
        gaugeGfx.drawRect(gaugeGeom.gaugeX, 0, gaugeW, gaugeGeom.gaugeH);
        gaugeGfx.endFill();
        for (let segIdx = 0; segIdx < repairsMax; segIdx++)
        {
            const seg = _gaugeSegment(gaugeGeom, segIdx);
            const lit = segIdx < repairsLeft;
            gaugeGfx.beginFill(lit ? REPAIR_COLOR : 0x333333, lit ? 1 : 0.6);
            gaugeGfx.drawRect(seg.x, seg.y, seg.w, Math.max(0.3, seg.h));
            gaugeGfx.endFill();
        }
        _addFixedBox(container, gaugeGfx, 0, tokenId);
    }

    const coreCenterX = reactionLeft + indicatorW - rowHeight / 2;
    const coreCenterY = rowHeight + rowGap + rowHeight / 2;
    if (mechDetail && reactionEnabled && rows.length > 1)
    {
        const core = corePowerState(actor);
        const centerX = coreCenterX;
        const centerY = coreCenterY;
        const diamondPoints = size => [centerX, centerY - size, centerX + size, centerY, centerX, centerY + size, centerX - size, centerY];
        const coreGfx = new PIXI.Graphics();
        if (core.active)
        {
            coreGfx.beginFill(0xffffff, 0.25);
            coreGfx.drawPolygon(diamondPoints(rowHeight / 2 + chromeScale));
            coreGfx.endFill();
        }
        coreGfx.beginFill(0x111111, 0.9);
        coreGfx.drawPolygon(diamondPoints(rowHeight / 2));
        coreGfx.endFill();
        const coreLit = core.active || core.charged;
        coreGfx.beginFill(core.active ? 0xffffff : (core.charged ? 0xcfcfcf : 0x333333), coreLit ? 1 : 0.6);
        coreGfx.drawPolygon(diamondPoints(rowHeight / 2 - chromeScale * 1.1));
        coreGfx.endFill();
        _addFixedBox(container, coreGfx, 0, tokenId);
        if (core.active && !_reduceMotion())
        {
            const breathGfx = new PIXI.Graphics();
            breathGfx.lineStyle(Math.max(0.5, chromeScale * 0.7), 0xffffff, 1);
            breathGfx.drawPolygon(diamondPoints(rowHeight / 2 + chromeScale * 0.9));
            _addBreathingBox(container, breathGfx, 0, POWER_BREATH_MS, 0.15, 0.6);
        }
    }

    rows.forEach((row, rowIdx) =>
    {
        const rowY = rowIdx * (rowHeight + rowGap);
        const [leftDef, rightDef] = row;
        if (leftDef && visibleIds.has(leftDef.id))
            drawSegment(gfx, layoutOffsetX, rowY, pipColW, rowHeight, leftDef, leftDef.getValue(actor), chromeScale);
        if (rightDef && visibleIds.has(rightDef.id))
            drawSegment(gfx, rightColX, rowY, rightColW, rowHeight, rightDef, rightDef.getValue(actor), chromeScale);
    });

    if (visibleIds.has('hp') && (game.user?.isGM || actor.isOwner))
    {
        const hpMax = getEffectiveMax(actor, 'hp');
        const innerW = rightColW - 2 * chromeScale;
        let step = HP_TICK_STEP;
        while (hpMax > 0 && innerW * step / hpMax < 3 * chromeScale)
            step *= 2;
        const tickW = Math.max(0.5, chromeScale * 0.6);
        gfx.beginFill(0x000000, 0.55);
        for (let hpMark = step; hpMark < hpMax; hpMark += step)
            gfx.drawRect(rightColX + chromeScale + (hpMark / hpMax) * innerW - tickW / 2, chromeScale, tickW, rowHeight - 2 * chromeScale);
        gfx.endFill();
    }

    // Armor ticks (HP row, right extension).
    if (armorExt > 0)
    {
        const innerH = rowHeight - 2 * chromeScale;
        const armorGfx = new PIXI.Graphics();
        armorGfx.beginFill(0x111111, 0.9);
        armorGfx.drawRect(armorGap, 0, armorW, rowHeight);
        armorGfx.endFill();
        for (let tickIdx = 0; tickIdx < armorVal; tickIdx++)
        {
            const tx = armorGap + chromeScale + tickIdx * (armorTickW + armorTickGap);
            armorGfx.beginFill(0xc8c8c8, 1);
            armorGfx.drawRect(tx, chromeScale, armorTickW, innerH);
            armorGfx.endFill();
        }
        _addFixedBox(container, armorGfx, rightColX + rightColW, tokenId);
    }

    if (ocSteps > 0)
    {
        const ocStage = Math.min(ocSteps, Math.max(0, actor.system?.overcharge ?? 0));
        const heatRowY = rowHeight + rowGap;
        const innerH = rowHeight - 2 * chromeScale;
        const ocGfx = new PIXI.Graphics();
        ocGfx.beginFill(0x111111, 0.9);
        ocGfx.drawRect(colGap, heatRowY, ocW, rowHeight);
        ocGfx.endFill();
        for (let tickIdx = 0; tickIdx < ocSteps; tickIdx++)
        {
            const lit = tickIdx < ocStage;
            const tx = colGap + chromeScale + tickIdx * (armorTickW + armorTickGap);
            ocGfx.beginFill(lit ? overchargeColor(tickIdx + 1, ocSteps) : 0x333333, lit ? 1 : 0.6);
            ocGfx.drawRect(tx, heatRowY + chromeScale, armorTickW, innerH);
            ocGfx.endFill();
        }
        _addFixedBox(container, ocGfx, rightColX + rightColW, tokenId);
        if (ocStage >= ocSteps && !_reduceMotion())
        {
            const pulseGfx = new PIXI.Graphics();
            pulseGfx.beginFill(0xff2a1a, 1);
            for (let tickIdx = 0; tickIdx < ocSteps; tickIdx++)
                pulseGfx.drawRect(colGap + chromeScale + tickIdx * (armorTickW + armorTickGap), heatRowY + chromeScale, armorTickW, innerH);
            pulseGfx.endFill();
            _addBreathingBox(container, pulseGfx, rightColX + rightColW, POWER_BREATH_MS, 0, 0.5);
        }
    }

    // Static chrome at the back of the z-stack so live overlays (OS, stripes, labels) sit on top.
    bakeAndSwap(container, gfx, token.id, { addAt: 0 });

    // Overshield overlay on HP row.
    const osVal = actor.system?.overshield?.value ?? 0;
    const hpMax = getEffectiveMax(actor, 'hp');
    if (osVal > 0 && hpMax > 0 && visibleIds.has('hp'))
    {
        const osPct = Math.min(1, osVal / hpMax);
        const osW = Math.max(0, Math.floor((rightColW - 2 * chromeScale) * osPct));
        const osX = rightColX + chromeScale;
        const osY = chromeScale;
        const osH = rowHeight - 2 * chromeScale;

        const osGfx = new PIXI.Graphics();
        osGfx.name = 'la-overshield';
        container.addChild(osGfx);

        const colorA = 0x2244ee;
        const colorB = 0x1133ee;
        const rA = (colorA >> 16) & 0xff, gA = (colorA >> 8) & 0xff, bA = colorA & 0xff;
        const rB = (colorB >> 16) & 0xff, gB = (colorB >> 8) & 0xff, bB = colorB & 0xff;
        const periodMs = 2200;

        const tick = () =>
        {
            if (osGfx.destroyed || !osGfx.parent)
            {
                canvas.app.ticker.remove(tick);
                return;
            }
            osGfx.clear();
            const phase = (performance.now() % periodMs) / periodMs;
            for (let pixelIdx = 0; pixelIdx < osW; pixelIdx++)
            {
                const base = osW > 1 ? pixelIdx / (osW - 1) : 0;
                let mix = (base + phase) % 1;
                if (mix > 0.5)
                    mix = 1 - mix;
                mix *= 2;
                const red = Math.round(rA + (rB - rA) * mix);
                const green = Math.round(gA + (gB - gA) * mix);
                const blue = Math.round(bA + (bB - bA) * mix);
                osGfx.beginFill((red << 16) | (green << 8) | blue, 0.75);
                osGfx.drawRect(osX + pixelIdx, osY, 1, osH);
                osGfx.endFill();
            }
            // Right-edge terminator
            osGfx.beginFill(0x000000, 1);
            osGfx.drawRect(osX + osW - chromeScale, osY, chromeScale, osH);
            osGfx.endFill();
        };
        canvas.app.ticker.add(tick);
        tick();
    }

    // Burn/Infection pulsing stripes.
    const drawCounterStripe = (rowIdx, def, hostId, direction) =>
    {
        if (!visibleIds.has(hostId))
            return;
        const counterV = def.getValue(actor);
        if ((counterV.value ?? 0) <= 0)
            return;
        const hostV = find(hostId).getValue(actor);
        const hostMax = hostV.max ?? 0;
        if (hostMax <= 0)
            return;
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const stripeY = rowIdx * (rowHeight + rowGap) + 1;
        const stripeH = rowHeight - 2;

        const fillPx = (Math.max(0, hostV.value ?? 0) / hostMax) * barW;
        const counterPx = Math.min(barW, (counterV.value / hostMax) * barW);

        let stripeX;
        let stripeW;
        if (direction === 'left')
        {
            stripeX = barX + Math.max(0, fillPx - counterPx);
            stripeW = Math.min(counterPx, fillPx);
        }
        else
        {
            stripeX = barX + fillPx;
            stripeW = Math.min(counterPx, barW - fillPx);
        }
        if (stripeW <= 0)
            return;

        const stripeGfx = new PIXI.Graphics();
        stripeGfx.name = `la-counter-${def.id}`;
        container.addChild(stripeGfx);
        stripeGfx.beginFill(def.color, 1);
        stripeGfx.drawRect(stripeX, stripeY, stripeW, stripeH);
        stripeGfx.endFill();

        // Separator edge.
        stripeGfx.beginFill(0x000000, 1);
        const delimX = direction === 'left' ? stripeX : stripeX + stripeW - chromeScale;
        stripeGfx.drawRect(delimX, stripeY, chromeScale, stripeH);
        stripeGfx.endFill();

        if (_reduceMotion())
        {
            stripeGfx.alpha = 0.85;
            return;
        }
        const pulse = () =>
        {
            if (!stripeGfx || stripeGfx.destroyed)
            {
                canvas.app.ticker.remove(pulse);
                return;
            }
            stripeGfx.alpha = 0.6 + 0.4 * _breath(AMBIENT_BREATH_MS);
        };
        canvas.app.ticker.add(pulse);
    };
    drawCounterStripe(0, find('burn'), 'hp', 'left');
    drawCounterStripe(1, find('infection'), 'heat', 'right');

    // Heat fill terminator + danger zone. Only for actors with a real heat max.
    if (visibleIds.has('heat') && (actor.system?.heat?.max ?? 0) > 0)
    {
        const heatBarX = rightColX + 1;
        const heatBarW = rightColW - 2;
        const heatRowY = rowHeight + rowGap;
        const heatV = find('heat').getValue(actor);
        const heatMax = heatV.max ?? 0;
        if (heatMax > 0)
        {
            const heatGfx = new PIXI.Graphics();
            heatGfx.name = 'la-heat-decorations';
            container.addChild(heatGfx);

            const heatPct = Math.max(0, Math.min(1, (heatV.value ?? 0) / heatMax));
            const fillW = heatBarW * heatPct;
            if (fillW > 0)
            {
                heatGfx.beginFill(0x000000, 1);
                heatGfx.drawRect(heatBarX + fillW - chromeScale, heatRowY + chromeScale, chromeScale, rowHeight - 2 * chromeScale);
                heatGfx.endFill();
            }
            // Danger Zone tick at 50%.
            const dangerX = heatBarX + heatBarW * 0.5 - Math.floor(chromeScale / 2);
            heatGfx.beginFill(0x882222, 0.8);
            heatGfx.drawRect(dangerX, heatRowY + chromeScale, chromeScale, rowHeight - 2 * chromeScale);
            heatGfx.endFill();

            bakeAndSwap(container, heatGfx, token.id);
        }
    }

    // Extra bars (user-defined via Resources tab): drawn live post-bake so value redraws don't invalidate the baked chrome.
    const extraLines = _hubExtraLines(actor, token.document);
    const extrasGeom = [];
    const extrasSeparator = extraLines.length > 0 && rows.length > 0
        ? Math.max(1, Math.round(chromeScale))
        : 0;
    if (extraLines.length > 0)
    {
        const extraGfx = new PIXI.Graphics();
        extraGfx.name = 'la-extras';
        container.addChild(extraGfx);
        const extrasStartY = rows.length * (rowHeight + rowGap) + extrasSeparator;
        const lineGap = Math.floor(chromeScale);
        const interGap = chromeScale;
        for (let li = 0; li < extraLines.length; li++)
        {
            const line = extraLines[li];
            const lineY = extrasStartY + li * (rowHeight + lineGap);
            let runningX = 0;
            const entryGeoms = [];
            for (let ei = 0; ei < line.length; ei++)
            {
                const { entry, width, value, max, segments, color } = line[ei];
                const slot = Math.floor(usableW * (width / 100));
                const entryWidth = Math.max(2, slot - (ei < line.length - 1 ? interGap : 0));
                if (entry?.segmented)
                {
                    drawSegment(
                        extraGfx, runningX, lineY, entryWidth, rowHeight,
                        { color: _parseHex(color), pips: true, pipsLTR: true },
                        { value, max: segments },
                        chromeScale
                    );
                }
                else
                {
                    drawSegment(
                        extraGfx, runningX, lineY, entryWidth, rowHeight,
                        { color: _parseHex(color), softMax: 1 },
                        { value, max },
                        chromeScale
                    );
                }
                entryGeoms.push({
                    entryId: entry.id,
                    x: runningX,
                    w: entryWidth,
                    segmented: !!entry.segmented,
                    segments,
                    max,
                    primaryColor: _parseHex(color),
                });
                runningX += slot;
            }
            extrasGeom.push({ y: lineY, entries: entryGeoms });
        }
        // Bake to match the chrome (raw Graphics look noticeably sharper).
        bakeAndSwap(container, extraGfx, token.id);
    }

    // Geometry for spawnFlash(). startY=0 because the container is already offset.
    token._laBarsGeom = {
        layoutOffsetX,
        pipColW,
        rowHeight,
        rowGap,
        startY: 0,
        visibleIds,
        indicatorW,
        reactionExtension,
        rightColX,
        rightColW,
        extras: extrasGeom,
        chromeScale,
        reactionX: reactionLeft,
        reactionTotal: reactions?.total ?? 0,
        coreCenterX: mechDetail && reactionEnabled && rows.length > 1 ? coreCenterX : null,
        coreCenterY,
        armorOriginX: visibleIds.has('hp') && (game.user?.isGM || actor.isOwner) ? rightColX + rightColW : null,
        armorGap: colGap,
        tickW: armorTickW,
        tickGap: armorTickGap,
        ocOriginX: ocSteps > 0 ? rightColX + rightColW : null,
        ocGap: colGap,
        ocSteps,
        heatRowY: rowHeight + rowGap,
        ...gaugeGeom,
    };

    // Seed snapshot; updateActor writes subsequent ones.
    if (!_lastValues.has(token.id))
        _lastValues.set(token.id, snapshotValues(actor, /** @type {any} */ (token).document));

    const extraLinesHeight = extraLines.length > 0
        ? extraLines.length * rowHeight + (extraLines.length - 1) * Math.floor(chromeScale) + Math.floor(chromeScale)
        : 0;
    const totalHeight = rows.length * (rowHeight + rowGap) - rowGap + extrasSeparator + extraLinesHeight;
    token.bars.visible = true;
    token.bars.height = totalHeight;
    const _hubEntry = _overlayHubs.get(token.id);
    if (_hubEntry)
        _hubEntry.totalHeight = totalHeight;
    // Zero alpha only on first draw, redraws keep the old alpha so they don't flicker.
    if (wrapper.alpha === undefined || token._laFirstDraw !== false)
    {
        wrapper.alpha = 0;
        token._laFirstDraw = false;
    }
    else if (prevAlpha !== undefined)
        wrapper.alpha = prevAlpha;

    // HP / Heat value labels.
    const hpLabelX = rightColX + rightColW + sideExt + 2;
    _drawBarValueLabels(actor, rows, visibleIds, container, hpLabelX, hpLabelX, rowHeight, rowGap, tokenId);

    // Re-attach saved flashes on top of everything.
    for (const flash of savedFlashes)
    {
        if (!flash.destroyed)
            container.addChild(flash);
    }

    // Elevation badge: replaces the vanilla "+N" tooltip text.
    drawElevationBadge(token);

    // Undo fvtt-perf-optim bitmap caching.
    const tok = token;
    setTimeout(() =>
    {
        if (tok.destroyed || !tok.bars)
            return;
        const undoCache = (node) =>
        {
            if (node instanceof PIXI.Graphics && node.cacheAsBitmap)
                node.cacheAsBitmap = false;
            if (node.children)
                node.children.forEach(undoCache);
        };
        undoCache(tok.bars);
    }, 0);
}

// HP / Heat value labels

function _drawBarValueLabels(actor, rows, visibleIds, container, hpLabelX, heatLabelX, rowHeight, rowGap, tokenId = null)
{
    if (!game.user?.isGM && !actor.isOwner)
        return;
    if (getWorldSetting(SETTING_SHOW_VALUES, true) === false)
        return;
    const innerH = rowHeight - 2;
    const renderScale = 8;
    const renderFontSize = Math.max(8, (innerH + 2) * renderScale);
    const renderStroke = Math.max(1, Math.round(renderFontSize * 0.15));
    const txtResolution = 2;

    const makeStyle = (fill) => new PIXI.TextStyle({
        fontFamily: 'Signika, sans-serif',
        fontSize: renderFontSize,
        fontWeight: 'bold',
        fill,
        stroke: 0x000000,
        strokeThickness: renderStroke,
        align: 'left',
    });
    const whiteStyle = makeStyle(0xffffff);

    rows.forEach((row, rowIdx) =>
    {
        const rightDef = row[1];
        if (!rightDef || !visibleIds.has(rightDef.id))
            return;
        if (rightDef.id !== 'hp' && rightDef.id !== 'heat' && rightDef.id !== 'pilotStress')
            return;

        // Segments: value + optional colored OS/burn/infection suffixes.
        const segments = [];
        const barValue = rightDef.getValue(actor);
        segments.push({ text: `${barValue.value ?? 0}`, style: whiteStyle });

        if (rightDef.id === 'hp')
        {
            const os = actor.system?.overshield?.value ?? 0;
            const burn = actor.system?.burn ?? 0;
            if (os > 0)
                segments.push({ text: ` ${os}`, style: makeStyle(0x4488ff) });
            if (burn > 0)
                segments.push({ text: ` ${burn}`, style: makeStyle(0xff4444) });
        }
        else if (rightDef.id === 'heat')
        {
            const infection = actor.system?.infection ?? 0;
            if (infection > 0)
                segments.push({ text: ` ${infection}`, style: makeStyle(0x1a8844) });
        }

        const labelX = rightDef.id === 'hp' ? hpLabelX : heatLabelX;
        // pilotStress shares the heat slot: same label position as heat.
        const labelContainer = new PIXI.Container();
        labelContainer.name = 'la-bar-label';
        labelContainer.scale.set(1 / renderScale);
        labelContainer.position.set(
            labelX,
            rowIdx * (rowHeight + rowGap) + rowHeight / 2
        );
        labelContainer.eventMode = 'none';

        let cursorX = 0;
        for (const seg of segments)
        {
            const txt = new PIXI.Text(seg.text, seg.style);
            txt.resolution = txtResolution;
            txt.anchor.set(0, 0.5);
            txt.position.set(cursorX, 0);
            labelContainer.addChild(txt);
            cursorX += txt.width;
        }

        container.addChild(labelContainer);
        _countLabelUp(labelContainer, tokenId, rightDef.id, barValue.value ?? 0);
    });
}

function _countLabelUp(labelContainer, tokenId, barId, toVal)
{
    const countFrom = tokenId ? _countFrom.get(tokenId) : null;
    if (!countFrom)
        return;
    if (performance.now() - countFrom.at >= COUNT_MS)
    {
        _countFrom.delete(tokenId);
        return;
    }
    const fromVal = countFrom[barId];
    if (fromVal === undefined || fromVal === toVal || _reduceMotion())
        return;
    const texts = labelContainer.children;
    const count = () =>
    {
        if (labelContainer.destroyed)
        {
            canvas.app.ticker.remove(count);
            return;
        }
        const progress = Math.min(1, (performance.now() - countFrom.at) / COUNT_MS);
        texts[0].text = `${Math.round(fromVal + (toVal - fromVal) * _easeOut(progress))}`;
        let cursorX = 0;
        for (const child of texts)
        {
            child.position.x = cursorX;
            cursorX += child.width;
        }
        if (progress >= 1)
            canvas.app.ticker.remove(count);
    };
    canvas.app.ticker.add(count);
    count();
}
