import { getModuleSetting } from './settings-utils.js';
import { MODULE_ID } from './constants.js';

export const TOKEN_HEIGHT_AUTO_FLAG = 'tokenHeightAuto';

export function tokenHeightKind(actor)
{
    const squad = !!getModuleSetting('autoTokenHeightSquad');
    const vehicle = !!getModuleSetting('autoTokenHeightVehicle');
    if (!squad && !vehicle)
        return 'standard';

    const items = Array.from(actor?.items ?? []);
    if (squad && items.some(item => item.system?.lid === 'npcc_squad'))
        return 'squad';
    if (vehicle && items.some(item => item.system?.lid === 'npct_vehicle'))
        return 'vehicle';
    return 'standard';
}

export function heightForSize(size, kind)
{
    if (kind === 'squad')
        return 0.6;
    if (kind === 'vehicle')
        return size <= 1 ? 0.6 : Math.min(size - 1, 4) + 0.1;
    return size + 0.1;
}

export function actorSize(actor)
{
    return Number(actor?.system?.size ?? actor?.prototypeToken?.width ?? 1) || 1;
}

/**
 * Height LA writes into the wall-height flag: SIZE plus the 0.1 peek that lets equal heights see
 * over each other, lowered for squads and vehicles when their settings are on.
 * @param {Actor} actor
 * @returns {number}
 */
export function getDesiredWallHeight(actor)
{
    return heightForSize(actorSize(actor), tokenHeightKind(actor));
}

export function isTokenHeightAuto(tokenData, actor)
{
    const flag = tokenData?.flags?.[MODULE_ID]?.[TOKEN_HEIGHT_AUTO_FLAG];
    if (typeof flag === 'boolean')
        return flag;

    const height = Number(tokenData?.flags?.['wall-height']?.tokenHeight) || 0;
    return height === 0 || Math.abs(height - getDesiredWallHeight(actor)) < 1e-6;
}

export function autoTokenHeightFlags(tokenData, actor)
{
    if (!isTokenHeightAuto(tokenData, actor))
        return null;

    const desired = getDesiredWallHeight(actor);
    const current = Number(tokenData?.flags?.['wall-height']?.tokenHeight) || 0;
    const marked = tokenData?.flags?.[MODULE_ID]?.[TOKEN_HEIGHT_AUTO_FLAG] === true;

    if (marked && Math.abs(current - desired) < 1e-6)
        return null;
    return { 'wall-height': { tokenHeight: desired }, [MODULE_ID]: { [TOKEN_HEIGHT_AUTO_FLAG]: true } };
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
