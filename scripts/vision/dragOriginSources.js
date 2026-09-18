import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';

const SETTING = 'dragSuppressOriginSources';

// The preview only carries sources when core's Token Drag Preview is on, and core disables them
// while the path is unreachable. Leave the origin lit in both cases or the drag goes dark.
function _previewCarriesSources(token)
{
    if (!game.settings.get('core', 'tokenDragPreview'))
        return false;
    const preview = token._preview;
    // clearPreviewContainer detaches before _onDragEnd, so a parentless preview means the drag ended.
    if (!preview || preview.destroyed || !preview.parent)
        return false;
    const context = token.layer?._draggedToken?.mouseInteractionManager?.interactionData?.contexts?.[token.document?.id];
    if (!context)
        return false;
    return (context.unreachableWaypoints?.length ?? 0) === 0;
}

function _isSuppressed(token)
{
    if (!token.hasPreview || token.isPreview)
        return false;
    if (!getModuleSetting(SETTING))
        return false;
    return _previewCarriesSources(token);
}

function _reconcile(token)
{
    if (!token || token.destroyed)
        return;
    if ((!!token.light !== token._isLightSource()) || (!!token.vision !== token._isVisionSource()))
        token.initializeSources();
}

export function initDragOriginSources()
{
    game.settings.register(MODULE_ID, SETTING, {
        name: 'LA.settings.dragSuppressOriginSources.name',
        hint: 'LA.settings.dragSuppressOriginSources.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    Hooks.once('ready', () =>
    {
        if (typeof libWrapper === 'undefined')
            return;

        for (const method of ['_isLightSource', '_isVisionSource'])
        {
            libWrapper.register(MODULE_ID, `foundry.canvas.placeables.Token.prototype.${method}`, function (wrapped, ...args)
            {
                if (_isSuppressed(this))
                    return false;
                return wrapped.apply(this, args);
            }, 'MIXED');
        }

        // Drag start and every reachability flip reach us through the preview's own source refresh,
        // the only point where the drag context exists and the origin can follow it.
        libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype.initializeLightSource', function (wrapped, ...args)
        {
            const result = wrapped.apply(this, args);
            if (this.isPreview && !args[0]?.deleted && getModuleSetting(SETTING))
                _reconcile(this._original);
            return result;
        }, 'WRAPPER');
    });
}
