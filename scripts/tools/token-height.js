import { getModuleSetting } from './settings-utils.js';

/**
 * Height LA writes into the wall-height flag: SIZE plus the 0.1 peek that lets equal heights see
 * over each other, lowered for squads and vehicles when that setting is on.
 * @param {Actor} actor
 * @returns {number}
 */
export function getDesiredWallHeight(actor)
{
    const size = Number(actor.system?.size ?? actor.prototypeToken?.width ?? 1) || 1;
    const vsEnabled = !!getModuleSetting('autoTokenHeightVehicleSquad');
    if (vsEnabled)
    {
        const items = Array.from(actor.items ?? []);
        if (items.some(item => item.system?.lid === 'npcc_squad'))
            return 0.5;
        if (items.some(item => /vehicle/i.test(item.system?.lid ?? '')))
        {
            if (size <= 1)
                return 0.5;
            return Math.min(size - 1, 4) + 0.1;
        }
    }
    return size + 0.1;
}

/**
 * Line-of-sight height of a token in grid units, peek included.
 *
 * Reads the wall-height `tokenHeight` flag when it is set (LA writes SIZE + 0.1 there, see
 * getDesiredWallHeight). When the flag is missing or 0, returns what LA would have written, so
 * a size 3 mech is 3.1 tall for sight whether or not Auto Token Height is on.
 * Use for anything that decides what a token sees or peeks over.
 * @param {TokenDocument} tokenDoc
 * @returns {number}
 */
export function laTokenHeight(tokenDoc)
{
    const flagged = Number(tokenDoc?.flags?.['wall-height']?.tokenHeight);
    if (flagged > 0)
        return flagged;
    if (tokenDoc?.actor)
        return getDesiredWallHeight(tokenDoc.actor);
    return (Number(tokenDoc?.height) || 1) + 0.1;
}

/**
 * Gameplay height of a token: laTokenHeight snapped to the closest Lancer SIZE (0.5, 1, 2, 3, ...),
 * so 2.1 reads 2 and 0.5 stays 0.5.
 * Use for anything physical: fitting under terrain, zone traversal, wreck terrain height.
 * @param {TokenDocument} tokenDoc
 * @returns {number}
 */
export function laTokenGameplayHeight(tokenDoc)
{
    const height = laTokenHeight(tokenDoc);
    if (height < 0.75)
        return 0.5;
    return Math.max(1, Math.round(height));
}
