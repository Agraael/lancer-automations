import { MODULE_ID } from '../tools/constants.js';

export function initDestroyedMeshGuard()
{
    Hooks.once('setup', () =>
    {
        if (typeof libWrapper === 'undefined')
            return;
        libWrapper.register(MODULE_ID, 'foundry.canvas.primary.PrimarySpriteMesh.prototype.render', function (wrapped, renderer)
        {
            if (this.destroyed)
                return;
            return wrapped(renderer);
        }, 'MIXED');
    });
}
