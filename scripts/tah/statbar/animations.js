import { isLancerActor as isLancerCombatant, isTokenInCombat } from '../../utils/lancer-token.js';
import { playStatsSound } from '../sound.js';
import {
    MODULE_ID,
    SETTING_FLASH_FOLLOWS_VIS,
    FLASH_HOLD_MS, FLASH_SHRINK_MS, FLASH_TOTAL_MS, FLASH_LINGER_MS,
    FLAG_EXTRAS,
} from './config.js';
import { _lastValues, _flashingTokens, _fadeState, _overlayHubs, _countFrom } from './state.js';
import { isEnabled, statBarDisabled, passesVisibilityMode, shouldShowBars } from './rules.js';
import { _resolveExtraBarVisibility } from './extras.js';
import { getEffectiveMax, snapshotValues } from './model.js';
import { getModuleSetting, getExternalSetting } from '../../tools/settings-utils.js';
import { floatTokenText } from '../../tools/float-text.js';
import { mixColor, overchargeColor, REPAIR_COLOR } from '../../tools/color-utils.js';
import { getLAFlag } from '../../tools/flag-utils.js';

export function refreshVisibleLancerTokens(cascade = false)
{
    if (!isEnabled())
        return;
    if (!canvas?.tokens)
        return;
    for (const timer of _cascadeTimers)
        clearTimeout(timer);
    _cascadeTimers = [];
    const reveal = [];
    for (const tok of canvas.tokens.placeables)
    {
        if (!isLancerCombatant(tok.actor))
            continue;
        if (!_overlayHubs.has(tok.id))
            continue;
        const show = shouldShowBars(tok);
        if (cascade && show && (_getFadeTarget(tok)?.alpha ?? 0) < 1 && !_reduceMotion())
            reveal.push(tok);
        else
            fadeBars(tok, show ? 1 : 0);
    }
    reveal.sort((left, right) => left.center.x - right.center.x);
    reveal.forEach((tok, order) =>
    {
        const delayMs = Math.min(CASCADE_MAX_MS, order * CASCADE_STEP_MS);
        if (delayMs <= 0)
        {
            fadeBars(tok, 1);
            return;
        }
        _cascadeTimers.push(setTimeout(() =>
        {
            if (!tok.destroyed && shouldShowBars(tok))
                fadeBars(tok, 1);
        }, delayMs));
    });
}

// Fade + flash animations

function _getFadeTarget(token)
{
    const entry = _overlayHubs.get(token.id);
    return entry?.wrapper ?? token.bars;
}

export function fadeBars(token, targetAlpha)
{
    const target = _getFadeTarget(token);
    if (!target)
        return;
    const id = token.id;
    const cur = _fadeState.get(id);
    if (cur && cur.target === targetAlpha)
        return;
    if (cur)
        canvas.app.ticker.remove(cur.tick);
    const startAlpha = target.alpha ?? 1;
    const startHub = _overlayHubs.get(id)?.hub;
    if (startAlpha === targetAlpha)
    {
        _fadeState.delete(id);
        if (startHub && !startHub.destroyed)
            startHub.pivot.y = 0;
        return;
    }
    const reduce = _reduceMotion();
    const showing = targetAlpha > startAlpha;
    let duration = 150;
    if (!reduce)
        duration = showing ? APPEAR_MS : HIDE_MS;
    const rowHeight = _overlayHubs.get(id)?.rowHeight ?? 0;
    const pivotNow = startHub && !startHub.destroyed ? startHub.pivot.y : 0;
    let pivotFrom = pivotNow;
    let pivotTo = pivotNow;
    if (showing)
    {
        if (startAlpha <= 0)
            pivotFrom = -rowHeight * APPEAR_RISE;
        pivotTo = 0;
    }
    else if (startAlpha >= 1)
        pivotTo = -rowHeight * HIDE_DROP;
    const startTime = performance.now();

    const tick = () =>
    {
        const fadeTarget = _getFadeTarget(token);
        if (!fadeTarget || token.destroyed)
        {
            canvas.app.ticker.remove(tick);
            _fadeState.delete(id);
            return;
        }
        const progress = Math.min(1, (performance.now() - startTime) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        fadeTarget.alpha = startAlpha + (targetAlpha - startAlpha) * eased;
        const hub = _overlayHubs.get(id)?.hub;
        if (hub && !hub.destroyed)
            hub.pivot.y = reduce || progress >= 1 ? 0 : pivotFrom + (pivotTo - pivotFrom) * eased;
        if (progress >= 1)
        {
            canvas.app.ticker.remove(tick);
            _fadeState.delete(id);
        }
    };

    _fadeState.set(id, { target: targetAlpha, tick });
    canvas.app.ticker.add(tick);
}

function runFlashAnimation(token, name, drawAt, delayMs = 0)
{
    const flashGfx = new PIXI.Graphics();
    flashGfx.name = name;
    // Flash goes into the overlay hub if available.
    const entry = _overlayHubs.get(token.id);
    const parent = entry?.hub ?? token;
    parent.addChild(flashGfx);

    const flashStart = performance.now();
    const tick = () =>
    {
        if (!flashGfx || flashGfx.destroyed)
        {
            canvas.app.ticker.remove(tick);
            return;
        }
        const elapsed = performance.now() - flashStart - delayMs;
        flashGfx.clear();
        if (elapsed < 0)
        {
            drawAt(flashGfx, -1);
            return;
        }
        if (elapsed < FLASH_HOLD_MS)
        {
            drawAt(flashGfx, 0);
            return;
        }
        const progress = Math.min(1, (elapsed - FLASH_HOLD_MS) / FLASH_SHRINK_MS);
        if (progress >= 1)
        {
            flashGfx.destroy();
            canvas.app.ticker.remove(tick);
            return;
        }
        const eased = 1 - Math.pow(1 - progress, 3);
        drawAt(flashGfx, eased);
    };
    canvas.app.ticker.add(tick);
}

function runTimedOverlay(token, name, durationMs, draw)
{
    const entry = _overlayHubs.get(token.id);
    if (!entry?.hub)
        return;
    const gfx = new PIXI.Graphics();
    gfx.name = name;
    entry.hub.addChild(gfx);
    const start = performance.now();
    const tick = () =>
    {
        if (gfx.destroyed)
        {
            canvas.app.ticker.remove(tick);
            return;
        }
        const elapsed = performance.now() - start;
        gfx.clear();
        if (elapsed >= durationMs)
        {
            gfx.destroy();
            canvas.app.ticker.remove(tick);
            return;
        }
        draw(gfx, elapsed, _overlayHubs.get(token.id)?.boxScale ?? 1);
    };
    canvas.app.ticker.add(tick);
    tick();
}

const _joltTickers = new Map();

function _startJolt(token, ampFactor, durationMs)
{
    if (_reduceMotion())
        return;
    const running = _joltTickers.get(token.id);
    if (running && running.ampFactor > ampFactor && performance.now() < running.end)
        return;
    _stopJolt(token.id);
    const start = performance.now();
    const tick = () =>
    {
        const entry = _overlayHubs.get(token.id);
        const elapsed = performance.now() - start;
        if (token.destroyed || elapsed >= durationMs)
        {
            _stopJolt(token.id);
            return;
        }
        if (entry?.hub && !entry.hub.destroyed)
            entry.hub.pivot.x = Math.sin(elapsed / 18) * entry.rowHeight * ampFactor * (1 - elapsed / durationMs);
    };
    _joltTickers.set(token.id, { tick, ampFactor, end: start + durationMs });
    canvas.app.ticker.add(tick);
}

function _stopJolt(tokenId)
{
    const running = _joltTickers.get(tokenId);
    if (!running)
        return;
    canvas.app.ticker.remove(running.tick);
    _joltTickers.delete(tokenId);
    const hub = _overlayHubs.get(tokenId)?.hub;
    if (hub && !hub.destroyed)
        hub.pivot.x = 0;
}

function spawnFlash(token, barId, oldVal, newVal)
{
    const geom = token._laBarsGeom;
    if (!geom || oldVal === newVal)
        return;

    const { layoutOffsetX, pipColW, rowHeight, rowGap, startY, indicatorW, reactionExtension, rightColX, rightColW } = geom;
    const visibleIds = geom.visibleIds;

    if (barId === 'hp' || barId === 'heat' || barId === 'pilotStress')
    {
        if (!visibleIds.has(barId))
            return;
        const rowIdx = barId === 'hp' ? 0 : 1;
        const hostMax = barId === 'pilotStress'
            ? Math.max(token.actor?.system?.bond_state?.stress?.max ?? 8, oldVal, newVal)
            : Math.max(getEffectiveMax(token.actor, barId), oldVal, newVal);
        if (hostMax <= 0)
            return;
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const rowY = startY + rowIdx * (rowHeight + rowGap) + 1;
        const rowH = rowHeight - 2;

        const minVal = Math.min(oldVal, newVal);
        const maxVal = Math.max(oldVal, newVal);
        const isDamage = newVal < oldVal;
        const initialFlashX = barX + (minVal / hostMax) * barW;
        const initialFlashW = ((maxVal - minVal) / hostMax) * barW;
        if (initialFlashW <= 0)
            return;
        let chunkColor = 0xffffff;
        if (barId === 'hp')
            chunkColor = isDamage ? 0xff7b6b : 0xc8ffd0;
        else if (barId === 'heat')
            chunkColor = isDamage ? 0xa8dcff : 0xffd27a;
        if ((barId === 'hp' && isDamage) || (barId === 'heat' && !isDamage))
            _startJolt(token, 0.13, 160);
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) =>
        {
            const remainingW = initialFlashW * (1 - eased);
            const drawX = isDamage
                ? initialFlashX
                : initialFlashX + (initialFlashW - remainingW);
            gfx.beginFill(chunkColor, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'structure' || barId === 'stress')
    {
        if (!visibleIds.has(barId))
            return;
        const rowIdx = barId === 'structure' ? 0 : 1;
        const pipMax = barId === 'structure'
            ? (token.actor?.system?.structure?.max ?? 0)
            : (token.actor?.system?.stress?.max ?? 0);
        if (pipMax <= 0)
            return;
        const chromeScale = geom.chromeScale ?? 1;
        const rowY = startY + rowIdx * (rowHeight + rowGap);
        const pipY = rowY + chromeScale;
        const pipH = rowHeight - 2 * chromeScale;
        const pipSegW = (pipColW - 2 * chromeScale - chromeScale * (pipMax - 1)) / pipMax;
        const oldEmpty = pipMax - Math.max(0, Math.min(pipMax, oldVal));
        const newEmpty = pipMax - Math.max(0, Math.min(pipMax, newVal));
        const startIdx = Math.min(oldEmpty, newEmpty);
        const endIdx = Math.max(oldEmpty, newEmpty);
        if (endIdx <= startIdx)
            return;
        const isDamage = newVal < oldVal;
        const pipColor = barId === 'structure' ? 0xffd633 : 0xff8822;
        const stagger = !_reduceMotion();
        if (!isDamage)
        {
            if (stagger)
            {
                runTimedOverlay(token, `la-flash-${barId}-wash`, 400, (gfx, elapsed) =>
                {
                    gfx.beginFill(pipColor, 0.5 * (1 - elapsed / 400));
                    gfx.drawRect(layoutOffsetX, rowY, pipColW, rowHeight);
                    gfx.endFill();
                });
            }
            for (let pipIdx = startIdx; pipIdx < endIdx; pipIdx++)
            {
                const pipX = layoutOffsetX + chromeScale + pipIdx * (pipSegW + chromeScale);
                const delayMs = stagger ? (endIdx - 1 - pipIdx) * PIP_STEP_MS : 0;
                _gainLight(token, `la-flash-${barId}-${pipIdx}`, _boxPoints(0, pipX, pipY, pipSegW, pipH), pipColor, true, delayMs, false);
            }
            return;
        }
        _startJolt(token, 0.46, 350);
        runTimedOverlay(token, `la-flash-${barId}-hit`, 350, (gfx, elapsed) =>
        {
            gfx.beginFill(0xff3b30, 0.45 * (1 - elapsed / 350));
            gfx.drawRect(layoutOffsetX, rowY, pipColW, rowHeight);
            gfx.endFill();
        });
        for (let pipIdx = startIdx; pipIdx < endIdx; pipIdx++)
        {
            const order = pipIdx - startIdx;
            const pipX = layoutOffsetX + chromeScale + pipIdx * (pipSegW + chromeScale);
            runFlashAnimation(token, `la-flash-${barId}-${pipIdx}`, (gfx, eased) =>
            {
                if (eased < 0)
                {
                    gfx.beginFill(pipColor, 1);
                    gfx.drawRect(pipX, pipY, pipSegW, pipH);
                    gfx.endFill();
                    return;
                }
                const remainingW = pipSegW * (1 - eased);
                gfx.beginFill(0xffffff, 1);
                gfx.drawRect(pipX + (pipSegW - remainingW), pipY, remainingW, pipH);
                gfx.endFill();
            }, stagger ? order * PIP_STEP_MS : 0);
        }
        return;
    }

    if (barId === 'overshield')
    {
        if (!visibleIds.has('hp'))
            return;
        const hpMax = Math.max(getEffectiveMax(token.actor, 'hp'), oldVal, newVal);
        if (hpMax <= 0)
            return;
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const rowY = startY + 1;
        const rowH = rowHeight - 2;

        const minVal = Math.min(oldVal, newVal);
        const maxVal = Math.max(oldVal, newVal);
        const isDamage = newVal < oldVal;
        const initialFlashX = barX + (minVal / hpMax) * barW;
        const initialFlashW = ((maxVal - minVal) / hpMax) * barW;
        if (initialFlashW <= 0)
            return;
        if (isDamage)
            _startJolt(token, 0.13, 160);
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) =>
        {
            const remainingW = initialFlashW * (1 - eased);
            const drawX = isDamage
                ? initialFlashX
                : initialFlashX + (initialFlashW - remainingW);
            gfx.beginFill(isDamage ? 0xff7b6b : 0xbfe4ff, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'burn' || barId === 'infection')
    {
        const hostId = barId === 'burn' ? 'hp' : 'heat';
        if (!visibleIds.has(hostId))
            return;
        const hostMax = Math.max(getEffectiveMax(token.actor, hostId), oldVal, newVal);
        if (hostMax <= 0)
            return;
        const hostVal = barId === 'burn'
            ? (token.actor?.system?.hp?.value ?? 0)
            : (token.actor?.system?.heat?.value ?? 0);
        const rowIdx = barId === 'burn' ? 0 : 1;
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const rowY = startY + rowIdx * (rowHeight + rowGap) + 1;
        const rowH = rowHeight - 2;

        const isReduction = newVal < oldVal;
        const fillPx = (Math.max(0, hostVal) / hostMax) * barW;

        let flashStartX;
        let flashW;
        if (barId === 'burn')
        {
            const oldEdge = barX + Math.max(0, fillPx - (oldVal / hostMax) * barW);
            const newEdge = barX + Math.max(0, fillPx - (newVal / hostMax) * barW);
            flashStartX = Math.min(oldEdge, newEdge);
            flashW = Math.abs(newEdge - oldEdge);
        }
        else
        {
            const oldEdge = barX + Math.min(barW, fillPx + (oldVal / hostMax) * barW);
            const newEdge = barX + Math.min(barW, fillPx + (newVal / hostMax) * barW);
            flashStartX = Math.min(oldEdge, newEdge);
            flashW = Math.abs(newEdge - oldEdge);
        }
        if (flashW <= 0)
            return;

        const initialFlashX = flashStartX;
        const initialFlashW = flashW;
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) =>
        {
            const remainingW = initialFlashW * (1 - eased);
            // Reversed vs host bar.
            let drawX;
            if (barId === 'burn')
            {
                drawX = isReduction
                    ? initialFlashX + (initialFlashW - remainingW)
                    : initialFlashX;
            }
            else
            {
                drawX = isReduction
                    ? initialFlashX
                    : initialFlashX + (initialFlashW - remainingW);
            }
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    const chromeScale = geom.chromeScale ?? 1;
    const ringW = Math.max(0.5, chromeScale * 0.7);

    if ((barId === 'reaction' || barId === 'reactionGain') && indicatorW > 0 && (geom.reactionTotal ?? 0) > 1)
    {
        const reactionX = geom.reactionX ?? -reactionExtension;
        const total = geom.reactionTotal;
        const slotBox = slot => _boxPoints(0, reactionX + chromeScale + slot * (geom.tickW + geom.tickGap), startY + chromeScale, geom.tickW, rowHeight - 2 * chromeScale);
        if (barId === 'reactionGain')
        {
            const stagger = !_reduceMotion();
            for (let slot = Math.max(0, total - newVal); slot < Math.min(total, total - oldVal); slot++)
                _gainLight(token, `la-flash-reaction-${slot}`, slotBox(slot), 0x9944cc, true, stagger ? (total - oldVal - 1 - slot) * PIP_STEP_MS : 0);
            return;
        }
        for (let slot = Math.max(0, total - oldVal); slot < Math.min(total, total - newVal); slot++)
            _spendPop(token, `la-flash-reaction-${slot}`, slotBox(slot), 0xc38cf0, ringW, true);
        return;
    }

    if (barId === 'reaction')
    {
        if (indicatorW <= 0)
            return;
        const reactionX = geom.reactionX ?? -reactionExtension;
        _spendPop(token, 'la-flash-reaction', _boxPoints(0, reactionX, startY, indicatorW, rowHeight), 0xc38cf0, ringW, true);
        return;
    }

    if (barId === 'reactionGain')
    {
        if (indicatorW <= 0)
            return;
        const reactionX = geom.reactionX ?? -reactionExtension;
        _gainLight(token, 'la-flash-reaction', _boxPoints(0, reactionX + chromeScale, startY + chromeScale, indicatorW - 2 * chromeScale, rowHeight - 2 * chromeScale), 0x9944cc, true);
        return;
    }

    if (barId === 'coreCharge')
    {
        if (geom.coreCenterX == null)
            return;
        _gainLight(token, 'la-flash-core', _diamondPoints(0, geom.coreCenterX, geom.coreCenterY, rowHeight / 2 - chromeScale * 1.1), 0xcfcfcf, true);
        return;
    }

    if (barId === 'coreOn' || barId === 'coreOff')
    {
        if (geom.coreCenterX == null)
            return;
        const points = _diamondPoints(0, geom.coreCenterX, geom.coreCenterY, rowHeight / 2);
        if (barId === 'coreOn')
        {
            _spendPop(token, 'la-flash-core', points, 0xffffff, ringW, true);
            return;
        }
        const inner = _diamondPoints(0, geom.coreCenterX, geom.coreCenterY, rowHeight / 2 - chromeScale * 1.1);
        runTimedOverlay(token, 'la-flash-core', 300, (gfx, elapsed, boxScale) =>
        {
            gfx.beginFill(mixColor(0xffffff, 0x333333, elapsed / 300), 1);
            gfx.drawPolygon(inner(1, boxScale));
            gfx.endFill();
        });
        return;
    }

    if (barId === 'armor')
    {
        if (geom.armorOriginX == null)
            return;
        const reduce = _reduceMotion();
        const innerH = rowHeight - 2 * chromeScale;
        if (newVal > oldVal)
        {
            for (let tickIdx = Math.max(0, oldVal); tickIdx < Math.min(8, newVal); tickIdx++)
            {
                const tickX = geom.armorGap + chromeScale + tickIdx * (geom.tickW + geom.tickGap);
                _gainLight(token, `la-flash-armor-${tickIdx}`, _boxPoints(geom.armorOriginX, tickX, startY + chromeScale, geom.tickW, innerH), 0xc8c8c8, false);
            }
            return;
        }
        for (let tickIdx = Math.max(0, newVal); tickIdx < oldVal; tickIdx++)
        {
            const tickX = geom.armorGap + chromeScale + tickIdx * (geom.tickW + geom.tickGap);
            runTimedOverlay(token, `la-flash-armor-${tickIdx}`, 450, (gfx, elapsed, boxScale) =>
            {
                const fade = _easeOut(elapsed / 450);
                const drift = reduce ? 0 : fade * chromeScale;
                const half = geom.tickW / 2;
                const px = localX => geom.armorOriginX + localX * boxScale;
                gfx.beginFill(reduce ? 0xffffff : 0xc8c8c8, 1 - fade);
                gfx.drawRect(px(tickX - drift), startY + chromeScale + drift * 1.5, half * boxScale, innerH / 2);
                gfx.drawRect(px(tickX + half + drift), startY + chromeScale + innerH / 2 + drift * 1.5, half * boxScale, innerH / 2);
                gfx.endFill();
            });
        }
        return;
    }

    if (barId === 'overcharge')
    {
        if (geom.ocOriginX == null || !geom.ocSteps)
            return;
        const reduce = _reduceMotion();
        const innerH = rowHeight - 2 * chromeScale;
        const blockW = geom.ocSteps * geom.tickW + (geom.ocSteps - 1) * geom.tickGap + 2 * chromeScale;
        if (newVal < oldVal)
        {
            if (!reduce)
            {
                runTimedOverlay(token, 'la-flash-overcharge', 500, (gfx, elapsed, boxScale) =>
                {
                    gfx.lineStyle(ringW, 0xa8dcff, 0.9 * (1 - elapsed / 500));
                    gfx.drawRect(geom.ocOriginX + geom.ocGap * boxScale, geom.heatRowY, blockW * boxScale, rowHeight);
                    gfx.lineStyle(0);
                });
            }
            const lastIdx = Math.min(geom.ocSteps, oldVal) - 1;
            for (let tickIdx = Math.max(0, newVal); tickIdx <= lastIdx; tickIdx++)
            {
                const delayMs = reduce ? 0 : (lastIdx - tickIdx) * PIP_STEP_MS;
                const litColor = overchargeColor(tickIdx + 1, geom.ocSteps);
                const tickX = geom.ocGap + chromeScale + tickIdx * (geom.tickW + geom.tickGap);
                const points = _boxPoints(geom.ocOriginX, tickX, geom.heatRowY + chromeScale, geom.tickW, innerH);
                runTimedOverlay(token, `la-flash-overcharge-${tickIdx}`, delayMs + (reduce ? 300 : 420), (gfx, elapsed, boxScale) =>
                {
                    const local = elapsed - delayMs;
                    let tickColor = litColor;
                    if (local >= 0 && reduce)
                        tickColor = mixColor(litColor, 0x262626, local / 300);
                    else if (local >= 0)
                        tickColor = local < 120 ? 0xa8dcff : mixColor(0xa8dcff, 0x262626, (local - 120) / 300);
                    gfx.beginFill(tickColor, 1);
                    gfx.drawPolygon(points(1, boxScale));
                    gfx.endFill();
                });
            }
            return;
        }
        const tickIdx = Math.min(geom.ocSteps, newVal) - 1;
        if (tickIdx < 0)
            return;
        const tickX = geom.ocGap + chromeScale + tickIdx * (geom.tickW + geom.tickGap);
        const tickColor = overchargeColor(tickIdx + 1, geom.ocSteps);
        runTimedOverlay(token, 'la-flash-overcharge', reduce ? 250 : 500, (gfx, elapsed, boxScale) =>
        {
            const px = localX => geom.ocOriginX + localX * boxScale;
            if (reduce)
            {
                gfx.beginFill(0xffffff, 1 - elapsed / 250);
                gfx.drawRect(px(tickX), geom.heatRowY + chromeScale, geom.tickW * boxScale, innerH);
                gfx.endFill();
                return;
            }
            gfx.lineStyle(ringW, 0xff8c50, 0.9 * (1 - elapsed / 500));
            gfx.drawRect(px(geom.ocGap), geom.heatRowY, blockW * boxScale, rowHeight);
            gfx.lineStyle(0);
            if (elapsed < 120)
            {
                gfx.beginFill(0xffffff, 1);
                gfx.drawRect(px(tickX), geom.heatRowY + chromeScale, geom.tickW * boxScale, innerH);
                gfx.endFill();
            }
            else if (elapsed < 420)
            {
                const stretchH = innerH * (1.7 - 0.7 * _easeOut((elapsed - 120) / 300));
                gfx.beginFill(tickColor, 1);
                gfx.drawRect(px(tickX), geom.heatRowY + rowHeight / 2 - stretchH / 2, geom.tickW * boxScale, stretchH);
                gfx.endFill();
            }
        });
        return;
    }

    if (barId === 'repair')
    {
        if (geom.gaugeX == null || !geom.repairsMax)
            return;
        if (newVal > oldVal)
        {
            const stagger = !_reduceMotion();
            for (let segIdx = Math.max(0, oldVal); segIdx < Math.min(geom.repairsMax, newVal); segIdx++)
            {
                const seg = _gaugeSegment(geom, segIdx);
                _gainLight(token, `la-flash-repair-${segIdx}`, _boxPoints(0, seg.x, seg.y, seg.w, seg.h), REPAIR_COLOR, true, stagger ? (segIdx - oldVal) * PIP_STEP_MS : 0);
            }
            return;
        }
        const segIdx = Math.max(0, Math.min(geom.repairsMax - 1, oldVal - 1));
        const seg = _gaugeSegment(geom, segIdx);
        _spendPop(token, 'la-flash-repair', _boxPoints(0, seg.x, seg.y, seg.w, seg.h), REPAIR_COLOR, ringW, false);
    }
}

function _boxPoints(originX, x, y, w, h)
{
    return (scale, boxScale) =>
    {
        const centerX = x + w / 2;
        const centerY = y + h / 2;
        const halfW = (w * scale) / 2;
        const halfH = (h * scale) / 2;
        const px = localX => originX + localX * boxScale;
        return [px(centerX - halfW), centerY - halfH, px(centerX + halfW), centerY - halfH, px(centerX + halfW), centerY + halfH, px(centerX - halfW), centerY + halfH];
    };
}

function _diamondPoints(originX, centerX, centerY, radius)
{
    return (scale, boxScale) =>
    {
        const size = radius * scale;
        const px = localX => originX + localX * boxScale;
        return [px(centerX), centerY - size, px(centerX + size), centerY, px(centerX), centerY + size, px(centerX - size), centerY];
    };
}

export function _gaugeSegment(geom, segIdx)
{
    const pad = geom.gaugePad;
    const gap = geom.gaugeH * 0.04;
    const segH = (geom.gaugeH - 2 * pad - gap * (geom.repairsMax - 1)) / geom.repairsMax;
    return { x: geom.gaugeX + pad, y: geom.gaugeH - pad - (segIdx + 1) * segH - segIdx * gap, w: geom.gaugeW - 2 * pad, h: segH };
}

function _gainLight(token, name, points, color, loud, delayMs = 0, fixed = true)
{
    const swell = loud && !_reduceMotion();
    runTimedOverlay(token, name, delayMs + (swell ? 500 : 300), (gfx, elapsed, boxScale) =>
    {
        const scaleX = fixed ? boxScale : 1;
        const local = elapsed - delayMs;
        if (local < 0)
        {
            gfx.beginFill(0x2b2b2b, 1);
            gfx.drawPolygon(points(1, scaleX));
            gfx.endFill();
            return;
        }
        if (swell)
        {
            const fade = 1 - local / 500;
            gfx.beginFill(color, 0.25 * fade);
            gfx.drawPolygon(points(1.8, scaleX));
            gfx.endFill();
            gfx.beginFill(color, 0.45 * fade);
            gfx.drawPolygon(points(1.4, scaleX));
            gfx.endFill();
        }
        if (local >= 300)
            return;
        let scale = 1;
        if (swell)
            scale = local < 110 ? 1 + 0.3 * (local / 110) : 1.3 - 0.3 * _easeOut((local - 110) / 150);
        gfx.beginFill(mixColor(0xffffff, color, local / 300), 1);
        gfx.drawPolygon(points(scale, scaleX));
        gfx.endFill();
    });
}

function _spendPop(token, name, points, ringColor, ringW, punch)
{
    const reduce = _reduceMotion();
    const flashMs = punch ? 260 : 160;
    const ringMs = punch ? 520 : 420;
    const ringGrow = punch ? 1.8 : 1.2;
    runTimedOverlay(token, name, reduce ? 250 : ringMs, (gfx, elapsed, boxScale) =>
    {
        if (reduce)
        {
            gfx.beginFill(0xffffff, 1 - elapsed / 250);
            gfx.drawPolygon(points(1, boxScale));
            gfx.endFill();
            return;
        }
        if (elapsed < flashMs)
        {
            const scale = !punch ? 1 : (elapsed < 110 ? 1 + 0.35 * (elapsed / 110) : 1.35 - 0.35 * _easeOut((elapsed - 110) / 150));
            gfx.beginFill(0xffffff, 1 - 0.4 * (elapsed / flashMs));
            gfx.drawPolygon(points(scale, boxScale));
            gfx.endFill();
        }
        const ringProgress = elapsed / ringMs;
        gfx.lineStyle(ringW, ringColor, 1 - ringProgress);
        gfx.drawPolygon(points(1 + ringGrow * _easeOut(ringProgress), boxScale));
        gfx.lineStyle(0);
    });
}

// Audio + scrolling text. Fires even without a rendered hub.
function fireExtraFeedback(token, entryId, oldVal, newVal)
{
    if (oldVal === newVal)
        return;
    try
    {
        const extras = getLAFlag(token.document, FLAG_EXTRAS) ?? [];
        const entry = extras.find(/** @type {any} */ extra => extra?.id === entryId);
        if (!entry?.audioTextFeedback)
            return;
        const canSee = _resolveExtraBarVisibility(/** @type {any} */ (token).actor, entry);
        const delta = newVal - oldVal;
        const label = entry.label || 'Stat';
        const text = canSee ? `${delta > 0 ? '+' : ''}${delta} ${label}` : '???';
        if (canvas?.interface?.createScrollingText)
        {
            const showScroll = !!getExternalSetting('lancer', 'floatingNumbers', true);
            if (showScroll)
            {
                const primary = canSee ? (entry.color?.stops?.[0] ?? '#ffffff') : '#888888';
                const floatsUp = entry.autoKey === 'bondXp' ? delta > 0 : delta < 0;
                canvas.interface.createScrollingText(token.center, text, {
                    anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                    direction: floatsUp ? CONST.TEXT_ANCHOR_POINTS.TOP : CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                    fontSize: 28,
                    fill: primary,
                    stroke: 0,
                    strokeThickness: 4,
                    jitter: 0.25,
                });
            }
        }
        playStatsSound('generic_stat');
    }
    catch
    { /* ignore */ }
}

function spawnFlashExtra(token, entryId, oldVal, newVal)
{
    fireExtraFeedback(token, entryId, oldVal, newVal);
    const geom = token._laBarsGeom;
    if (!geom || !Array.isArray(geom.extras) || oldVal === newVal)
        return;
    let barGeom = null;
    let lineY = 0;
    for (const line of geom.extras)
    {
        const found = line.entries.find(/** @type {any} */ entryGeom => entryGeom.entryId === entryId);
        if (found)
        {
            barGeom = found;
            lineY = line.y;
            break;
        }
    }
    if (!barGeom)
        return;

    const { rowHeight } = geom;
    const isDamage = newVal < oldVal;

    if (barGeom.segmented)
    {
        const pipMax = Math.max(1, barGeom.segments);
        const colX = barGeom.x;
        const colW = barGeom.w;
        const rowY = lineY + 1;
        const rowH = rowHeight - 2;
        const pipGapPx = 1;
        const innerW = colW - 2;
        const pipSegW = (innerW - pipGapPx * (pipMax - 1)) / pipMax;
        // LTR fill: changed pips sit between min(old,new) and max(old,new) from the left.
        const minVal = Math.max(0, Math.min(pipMax, Math.min(oldVal, newVal)));
        const maxVal = Math.max(0, Math.min(pipMax, Math.max(oldVal, newVal)));
        if (maxVal <= minVal)
            return;
        const flashStartX = colX + 1 + minVal * (pipSegW + pipGapPx);
        const flashEndX = colX + 1 + maxVal * (pipSegW + pipGapPx) - pipGapPx;
        const initialFlashW = flashEndX - flashStartX;
        if (initialFlashW <= 0)
            return;
        runFlashAnimation(token, `la-flash-extra-${entryId}`, (gfx, eased) =>
        {
            const remainingW = initialFlashW * (1 - eased);
            // Damage: pips drain from the right → flash shrinks from the left.
            const drawX = isDamage
                ? flashStartX
                : flashStartX + (initialFlashW - remainingW);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    // Solid bar: flashes the changed slice; uses barGeom.max for correct delta width.
    const hostMax = Math.max(1, Number(barGeom.max) || 0, oldVal, newVal);
    const barX = barGeom.x + 1;
    const barW = barGeom.w - 2;
    const rowY = lineY + 1;
    const rowH = rowHeight - 2;
    const minVal = Math.min(oldVal, newVal);
    const maxVal = Math.max(oldVal, newVal);
    const initialFlashX = barX + (minVal / hostMax) * barW;
    const initialFlashW = ((maxVal - minVal) / hostMax) * barW;
    if (initialFlashW <= 0)
        return;
    runFlashAnimation(token, `la-flash-extra-${entryId}`, (gfx, eased) =>
    {
        const remainingW = initialFlashW * (1 - eased);
        const drawX = isDamage
            ? initialFlashX
            : initialFlashX + (initialFlashW - remainingW);
        gfx.beginFill(0xffffff, 1);
        gfx.drawRect(drawX, rowY, remainingW, rowH);
        gfx.endFill();
    });
}

const PIP_STEP_MS = 140;
const APPEAR_MS = 180;
const HIDE_MS = 120;
const APPEAR_RISE = 0.4;
const HIDE_DROP = 0.3;
const CASCADE_STEP_MS = 35;
const CASCADE_MAX_MS = 150;
let _cascadeTimers = [];

export function _reduceMotion()
{
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

export function _breath(periodMs)
{
    return 0.5 - 0.5 * Math.cos(((performance.now() % periodMs) / periodMs) * Math.PI * 2);
}

export function _easeOut(progress)
{
    return 1 - Math.pow(1 - Math.clamp(progress, 0, 1), 3);
}

// Fade a token's bars back out once the flash-linger window elapses, unless it should still show.
export function scheduleFlashFade(tok)
{
    if (statBarDisabled(tok?.document))
        return;
    _flashingTokens.add(tok.id);
    Hooks.callAll('lancer-automations.statBarFlash', tok.id, true);
    const fadeTarget = _getFadeTarget(tok);
    const revealed = !getModuleSetting(SETTING_FLASH_FOLLOWS_VIS) || passesVisibilityMode(tok, isTokenInCombat(tok));
    if (fadeTarget && revealed)
        fadeTarget.alpha = 1;
    setTimeout(() =>
    {
        _flashingTokens.delete(tok.id);
        Hooks.callAll('lancer-automations.statBarFlash', tok.id, false);
        if (tok?.destroyed)
            return;
        if (!shouldShowBars(tok))
            fadeBars(tok, 0);
    }, FLASH_TOTAL_MS + FLASH_LINGER_MS);
}

// Flash every extra bar whose value changed between snapshots. Returns true if any flashed.
export function flashChangedExtras(tok, prev, next)
{
    const prevExtras = prev.extras ?? {};
    const nextExtras = next.extras ?? {};
    let flashed = false;
    for (const extraId of Object.keys(nextExtras))
    {
        const oldVal = prevExtras[extraId];
        if (oldVal !== undefined && oldVal !== nextExtras[extraId])
        {
            spawnFlashExtra(tok, extraId, oldVal, nextExtras[extraId]);
            flashed = true;
        }
    }
    return flashed;
}

// Value change detection + flash spawning.
export function animateActorChanges(actor)
{
    // Don't gate on watched keys: extras may bind anywhere. The per-bar diff filters no-ops.
    for (const tok of actor.getActiveTokens())
    {
        const prev = _lastValues.get(tok.id) ?? { extras: {} };
        const next = snapshotValues(actor, tok.document);
        if (prev.hp !== next.hp || prev.heat !== next.heat || prev.pilotStress !== next.pilotStress)
            _countFrom.set(tok.id, { hp: prev.hp, heat: prev.heat, pilotStress: prev.pilotStress, at: performance.now() });

        // Redraw hub with new values.
        try
        {
            tok.drawBars();
        }
        catch (e)
        {
            console.warn(`${MODULE_ID} | drawBars on update failed`, e);
        }

        let flashed = false;
        const FLASH_BARS = ['hp', 'heat', 'structure', 'stress', 'pilotStress', 'overshield', 'burn', 'infection'];
        for (const id of FLASH_BARS)
        {
            if (prev[id] !== undefined && prev[id] !== next[id])
            {
                spawnFlash(tok, id, prev[id], next[id]);
                flashed = true;
            }
        }
        // Path-bound extras: their value updates when the actor changes.
        if (flashChangedExtras(tok, prev, next))
            flashed = true;
        // Pilot stress delta floats over the token like other damages.
        if (prev.pilotStress !== undefined && prev.pilotStress !== next.pilotStress
            && actor.type === 'pilot' && canvas?.interface?.createScrollingText)
        {
            const showScroll = !!getExternalSetting('lancer', 'floatingNumbers', true);
            if (showScroll)
            {
                const delta = next.pilotStress - prev.pilotStress;
                canvas.interface.createScrollingText(tok.center, `${delta > 0 ? '+' : ''}${delta} Stress`, {
                    anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                    direction: delta > 0 ? CONST.TEXT_ANCHOR_POINTS.BOTTOM : CONST.TEXT_ANCHOR_POINTS.TOP,
                    fontSize: 28,
                    fill: '0xd9b800',
                    stroke: 0,
                    strokeThickness: 4,
                    jitter: 0.25,
                });
            }
        }
        // Bond XP delta; skipped when the auto-injected XP bar already emits its own feedback.
        if (prev.bondXp !== undefined && prev.bondXp !== next.bondXp
            && actor.type === 'pilot' && canvas?.interface?.createScrollingText)
        {
            const showScroll = !!getExternalSetting('lancer', 'floatingNumbers', true);
            const extras = getLAFlag(tok.document,FLAG_EXTRAS) ?? [];
            const barCoversIt = extras.some(/** @type {any} */ extra => extra?.autoKey === 'bondXp' && extra.audioTextFeedback);
            if (showScroll && !barCoversIt)
            {
                const delta = next.bondXp - prev.bondXp;
                canvas.interface.createScrollingText(tok.center, `${delta > 0 ? '+' : ''}${delta} XP`, {
                    anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                    direction: delta > 0 ? CONST.TEXT_ANCHOR_POINTS.TOP : CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                    fontSize: 28,
                    fill: '0x00b8d4',
                    stroke: 0,
                    strokeThickness: 4,
                    jitter: 0.25,
                });
            }
        }
        // Clock and burden segments float by name, since the bar has no track for them.
        if (prev.clocks && next.clocks)
        {
            let clockChanged = false;
            for (const [lid, entry] of Object.entries(next.clocks))
            {
                const before = prev.clocks[lid];
                if (!before || before.value === entry.value)
                    continue;
                const delta = entry.value - before.value;
                floatTokenText(tok, `${entry.name || '?'} ${delta > 0 ? '+' : ''}${delta}`, entry.burden ? 0xc33333 : 0x3a9e6e);
                clockChanged = true;
            }
            if (clockChanged)
                playStatsSound('generic_stat');
        }
        // Reaction: only a spend reveals the bars, not the turn reset.
        if (next.reaction < prev.reaction)
        {
            spawnFlash(tok, 'reaction', prev.reaction, next.reaction);
            flashed = true;
        }
        else if (next.reaction > prev.reaction)
            spawnFlash(tok, 'reactionGain', prev.reaction, next.reaction);
        if (prev.armor !== undefined && next.armor !== prev.armor)
        {
            spawnFlash(tok, 'armor', prev.armor, next.armor);
            flashed = true;
        }
        if (prev.repairs !== undefined && next.repairs !== prev.repairs)
        {
            spawnFlash(tok, 'repair', prev.repairs, next.repairs);
            flashed = true;
        }
        if (prev.overcharge !== undefined && next.overcharge !== prev.overcharge)
        {
            spawnFlash(tok, 'overcharge', prev.overcharge, next.overcharge);
            flashed = true;
        }
        const coreRegained = prev.coreCharged === false && next.coreCharged && !next.coreActive;
        if (prev.coreActive !== undefined && prev.coreActive !== next.coreActive && !coreRegained)
        {
            spawnFlash(tok, next.coreActive ? 'coreOn' : 'coreOff', 0, 1);
            flashed = true;
        }
        if (coreRegained)
        {
            spawnFlash(tok, 'coreCharge', 0, 1);
            flashed = true;
        }

        _lastValues.set(tok.id, next);

        if (flashed)
            scheduleFlashFade(tok);
    }
}
