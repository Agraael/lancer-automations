import { MODULE_ID } from '../tools/constants.js';

function _deltaIsBuilt(tokenDoc)
{
    const own = Object.getOwnPropertyDescriptor(tokenDoc, 'delta');
    return !!own && 'value' in own;
}

function _rawHasStatus(tokenDoc, statusId)
{
    const effects = tokenDoc._source?.delta?.effects ?? [];
    return effects.some(effect => !effect.disabled && Array.isArray(effect.statuses) && effect.statuses.includes(statusId));
}

export function initDeltaStatusGuard()
{
    Hooks.once('setup', () =>
    {
        if (typeof libWrapper === 'undefined')
            return;
        libWrapper.register(MODULE_ID, 'foundry.documents.TokenDocument.prototype.hasStatusEffect', function (wrapped, statusId)
        {
            if (!this.actorLink && !_deltaIsBuilt(this))
                return _rawHasStatus(this, statusId);
            return wrapped(statusId);
        }, 'MIXED');
    });
}
