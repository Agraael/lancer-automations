function releaseMarkerVideoOnDestroy(marker)
{
    const sprite = marker?.sprite;
    const texture = sprite?.texture;
    if (!sprite || sprite.destroyed || !(texture?.baseTexture?.resource?.source instanceof HTMLVideoElement))
        return;
    sprite.once('destroyed', () =>
    {
        if (texture.baseTexture)
            texture.destroy(true);
    });
}

export function initCombatBoosterMarkerGuard()
{
    Hooks.once('setup', () =>
    {
        if (!game.modules.get('combatbooster')?.active)
            return;
        if (typeof TurnMarker === 'undefined' || typeof StartTurnMarker === 'undefined')
            return;

        for (const markerClass of [TurnMarker, StartTurnMarker])
        {
            const prototype = markerClass.prototype;
            if (!Object.hasOwn(prototype, 'setAnimation'))
                continue;
            const setAnimation = prototype.setAnimation;
            prototype.setAnimation = function (...args)
            {
                releaseMarkerVideoOnDestroy(this);
                return setAnimation.apply(this, args);
            };
        }
    });
}
