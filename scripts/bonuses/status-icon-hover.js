import { getGlobalBonuses, getBonusDetailString } from './genericBonuses.js';
import { playUiSound } from '../tah/sound.js';

const HOVER_SCALE = 1.3;

let _hover = null;
let _tip = null;

export function initStatusIconHover()
{
    if (canvas?.ready)
        canvas.stage.on('pointermove', _onPointerMove);
    Hooks.on('canvasReady', () =>
    {
        canvas.stage.on('pointermove', _onPointerMove);
    });
}

function _enabled()
{
    try
    {
        return !!game.settings.get('lancer-automations', 'statusIconHover');
    }
    catch
    {
        return false;
    }
}

function _onPointerMove(event)
{
    if (!_enabled())
    {
        _clear();
        return;
    }
    const world = event.getLocalPosition(canvas.stage);
    let hit = null;
    const pad = canvas.dimensions?.size ?? 100;
    for (const token of canvas.tokens?.placeables ?? [])
    {
        if (token.destroyed || !token.visible)
            continue;
        if (world.x < token.x - pad || world.x > token.x + token.w + pad
            || world.y < token.y - pad || world.y > token.y + token.h + pad)
            continue;
        hit = _hitSprite(token, world);
        if (hit)
            break;
    }
    if (!hit)
    {
        _clear();
        return;
    }
    if (_hover?.sprite !== hit.sprite)
    {
        _clear();
        _grow(hit.token, hit.sprite);
        _tip = _buildTooltip(hit.token, hit.effect);
        playUiSound('statusHover');
    }
    if (_tip)
        _moveTip(event.clientX ?? 0, event.clientY ?? 0);
}

function _hitSprite(token, world)
{
    const temporaryEffects = token.actor?.temporaryEffects;
    if (!temporaryEffects?.length || !token.effects?.children)
        return null;
    const bg = token.effects.bg;
    const overlay = token.effects.overlay;
    for (const child of token.effects.children)
    {
        if (child === bg || child === overlay || !(child instanceof PIXI.Sprite))
            continue;
        const effect = temporaryEffects[child.zIndex];
        if (!effect)
            continue;
        const center = _spriteCenterWorld(token, child);
        const radius = Math.max(child.width, child.height) / 2;
        if ((world.x - center.x) ** 2 + (world.y - center.y) ** 2 <= radius * radius)
            return { token, sprite: child, effect };
    }
    return null;
}

function _spriteCenterWorld(token, sprite)
{
    const anchorX = sprite.anchor?.x ?? 0;
    const anchorY = sprite.anchor?.y ?? 0;
    return {
        x: token.x + (token.effects?.x ?? 0) + sprite.x + (0.5 - anchorX) * sprite.width,
        y: token.y + (token.effects?.y ?? 0) + sprite.y + (0.5 - anchorY) * sprite.height
    };
}

function _grow(token, sprite)
{
    const container = token.effects;
    const anchorX = sprite.anchor?.x ?? 0;
    const anchorY = sprite.anchor?.y ?? 0;
    _hover = {
        sprite,
        baseWidth: sprite.width,
        baseHeight: sprite.height,
        baseX: sprite.x,
        baseY: sprite.y,
        container,
        // perf-optim bakes token.effects; the bake would hide the resize
        cacheWas: container.cacheAsBitmap === true
    };
    if (_hover.cacheWas)
        container.cacheAsBitmap = false;
    sprite.width = _hover.baseWidth * HOVER_SCALE;
    sprite.height = _hover.baseHeight * HOVER_SCALE;
    sprite.x = _hover.baseX - (0.5 - anchorX) * (sprite.width - _hover.baseWidth);
    sprite.y = _hover.baseY - (0.5 - anchorY) * (sprite.height - _hover.baseHeight);
}

function _clear()
{
    if (_hover)
    {
        const { sprite, baseWidth, baseHeight, baseX, baseY, container, cacheWas } = _hover;
        if (!sprite.destroyed)
        {
            sprite.width = baseWidth;
            sprite.height = baseHeight;
            sprite.x = baseX;
            sprite.y = baseY;
        }
        if (cacheWas && container && !container.destroyed)
            container.cacheAsBitmap = true;
        _hover = null;
    }
    if (_tip)
    {
        _tip.remove();
        _tip = null;
    }
}

function _buildTooltip(token, effect)
{
    const el = document.createElement('div');
    el.classList.add('la-status-tooltip');
    const parts = [`<div class="la-status-tooltip-name">${effect.name ?? ''}</div>`];
    const duration = _durationText(effect);
    if (duration)
        parts.push(`<div class="la-status-tooltip-duration">${duration}</div>`);
    const bonus = _bonusText(token, effect);
    if (bonus)
        parts.push(`<div class="la-status-tooltip-bonus">${bonus}</div>`);
    const description = _descriptionHtml(effect);
    if (description)
        parts.push(`<div class="la-status-tooltip-desc">${description}</div>`);
    el.innerHTML = parts.join('');
    document.body.appendChild(el);
    return el;
}

function _moveTip(clientX, clientY)
{
    const rect = _tip.getBoundingClientRect();
    let left = clientX + 14;
    let top = clientY + 14;
    if (left + rect.width > window.innerWidth - 4)
        left = clientX - rect.width - 14;
    if (top + rect.height > window.innerHeight - 4)
        top = clientY - rect.height - 14;
    _tip.style.left = `${left}px`;
    _tip.style.top = `${top}px`;
}

function _durationText(effect)
{
    const flags = effect.flags?.['lancer-automations'];
    const entries = [flags?.duration, ...(flags?.durationEntries ?? [])].filter(Boolean);
    let best = null;
    for (const entry of entries)
    {
        if ((entry.label === 'end' || entry.label === 'start') && Number(entry.turns) > 0)
        {
            if (!best || Number(entry.turns) < best.turns)
                best = { label: entry.label, turns: Number(entry.turns) };
        }
    }
    if (best)
        return `${best.turns} turn${best.turns > 1 ? 's' : ''} (${best.label} of turn)`;
    const first = entries[0];
    if (first?.label === 'permanent')
        return 'Permanent';
    if (first?.label === 'indefinite')
        return 'Indefinite';
    if (first?.label === 'round')
    {
        const rounds = Number(first.rounds ?? first.turns);
        if (rounds > 0)
            return `${rounds} round${rounds > 1 ? 's' : ''}`;
    }
    return '';
}

function _bonusText(token, effect)
{
    const linkedBonusId = effect.flags?.['lancer-automations']?.linkedBonusId;
    if (!linkedBonusId)
        return '';
    const bonus = getGlobalBonuses(token.actor).find(entry => entry.id === linkedBonusId);
    if (!bonus)
        return '';
    if (bonus.type === 'multi' && Array.isArray(bonus.bonuses))
        return bonus.bonuses.map(getBonusDetailString).join(' | ');
    return getBonusDetailString(bonus);
}

function _descriptionHtml(effect)
{
    if (effect.description)
        return effect.description;
    for (const id of effect.statuses ?? [])
    {
        const config = CONFIG.statusEffects.find(entry => entry.id === id);
        if (config?.description)
            return game.i18n.localize(config.description);
    }
    return '';
}
