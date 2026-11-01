import { localize } from './string-utils.js';

export function cancelButton(callback)
{
    return { icon: '<i class="fas fa-times"></i>', label: localize('LA.common.cancel'), callback };
}
