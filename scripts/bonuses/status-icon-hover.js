import { effectTooltipData, showStatusTooltip, moveStatusTooltip } from './status-tooltip.js';
import { getModuleSetting } from '../tools/settings-utils.js';
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
        return !!getModuleSetting('statusIconHover');
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
        _tip = showStatusTooltip(effectTooltipData(hit.token.actor, hit.effect));
        playUiSound('statusHover');
    }
    if (_tip)
        moveStatusTooltip(_tip, event.clientX ?? 0, event.clientY ?? 0);
}

function _hitSprite(token, world)
{
    const temporaryEffects = token.actor?.temporaryEffects;
    if (!temporaryEffects?.length || !token.effects?.children)
        return null;
    const bg = token.effects.bg;
    const overlay = token.effects.overlay;
    token.effects.transform?.updateLocalTransform();
    const matrix = token.effects.localTransform ?? null;
    const scaleX = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
    const scaleY = matrix ? Math.hypot(matrix.c, matrix.d) : 1;
    for (const child of token.effects.children)
    {
        if (child === bg || child === overlay || !(child instanceof PIXI.Sprite))
            continue;
        const effect = temporaryEffects[child.zIndex];
        if (!effect)
            continue;
        const center = _spriteCenterWorld(token, child, matrix);
        const radius = Math.max(child.width * scaleX, child.height * scaleY) / 2;
        if ((world.x - center.x) ** 2 + (world.y - center.y) ** 2 <= radius * radius)
            return { token, sprite: child, effect };
    }
    return null;
}

function _spriteCenterWorld(token, sprite, matrix)
{
    const anchorX = sprite.anchor?.x ?? 0;
    const anchorY = sprite.anchor?.y ?? 0;
    const localX = sprite.x + (0.5 - anchorX) * sprite.width;
    const localY = sprite.y + (0.5 - anchorY) * sprite.height;
    // The matrix carries the iso rotation/skew/scale; plain offsets would land off the icon.
    if (matrix)
    {
        const point = matrix.apply(new PIXI.Point(localX, localY));
        return { x: token.x + point.x, y: token.y + point.y };
    }
    return {
        x: token.x + (token.effects?.x ?? 0) + localX,
        y: token.y + (token.effects?.y ?? 0) + localY
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

