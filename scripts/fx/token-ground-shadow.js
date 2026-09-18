// Casts each token's own silhouette on the ground, thrown further the higher it stands.

import { getModuleSetting } from '../tools/settings-utils.js';
import { getMaxGroundHeightUnderToken } from '../combat/terrain-utils.js';

const THT_ID = 'terrain-height-tools';

// Sizes are authored against this grid and scaled to the scene's
const BASE_GRID = 100;

// Between terrain (490/510) and tokens (700), so shadows land on the ground and under every token
const SHADOW_SORT_LAYER = 600;

const FALLBACK_BEARING = 225;

/** @typedef {PIXI.Sprite & { elevation: number, sortLayer: number, sort: number }} GroundShadow */

/** @type {Map<string, GroundShadow>} */
const shadows = new Map();

function isEnabled()
{
    return !!getModuleSetting('tokenGroundShadow');
}

/** Compass bearing the light comes from, shared with Terrain Height Tools when it is there. */
function lightDirection()
{
    let bearing = FALLBACK_BEARING;
    try
    {
        if (game.modules.get(THT_ID)?.active)
        {
            const angle = game.settings.get(THT_ID, 'terrainExtrusionSunAngle');
            bearing = typeof angle === 'number' ? angle : FALLBACK_BEARING;
        }
    }
    catch
    { /* THT without the fork does not register it */ }

    const radians = (bearing * Math.PI) / 180;
    return { x: -Math.sin(radians), y: Math.cos(radians) };
}

/** How far the token stands above whatever is under it, in grid cells. Solid terrain counts as ground. */
function cellsAboveGround(token)
{
    const elevation = token.document?.elevation ?? 0;

    // A token on the floor is already down, so the terrain under it is never looked up
    if (elevation <= 0)
        return 0;

    const perCell = canvas.scene?.grid?.distance || 1;
    return (elevation - getMaxGroundHeightUnderToken(token, globalThis.terrainHeightTools)) / perCell;
}

function removeShadow(id)
{
    const shadow = shadows.get(id);
    if (!shadow)
        return;
    shadow.parent?.removeChild(shadow);
    if (!shadow.destroyed)
        shadow.destroy();
    shadows.delete(id);
}

export function clearGroundShadows()
{
    for (const id of [...shadows.keys()])
        removeShadow(id);
}

export function refreshGroundShadow(token)
{
    const id = token?.document?.id;
    if (!id)
        return;

    const texture = token.mesh?.texture;
    const cells = cellsAboveGround(token);

    // Standing on whatever is under it casts nothing: the shadow is the elevation cue, not decoration
    if (!isEnabled() || cells <= 0 || !texture?.valid || token.document.hidden || !token.visible)
    {
        removeShadow(id);
        return;
    }

    const scale = canvas.grid.size / BASE_GRID;
    const throwBy = (getModuleSetting('tokenGroundShadowThrow') ?? 9) * scale * cells;

    let shadow = shadows.get(id);
    if (!shadow || shadow.texture !== texture)
    {
        removeShadow(id);
        shadow = /** @type {GroundShadow} */ (new PIXI.Sprite(texture));
        shadow.anchor.set(0.5);
        shadow.tint = 0x000000;

        // The primary group compares all three, and is inconsistent for every other child if any is missing
        shadow.elevation = token.document.elevation ?? 0;
        shadow.sortLayer = SHADOW_SORT_LAYER;
        shadow.sort = token.document.sort ?? 0;

        canvas.primary.addChild(shadow);
        shadows.set(id, shadow);
    }

    const light = lightDirection();
    const mesh = token.mesh;

    shadow.elevation = token.document.elevation ?? 0;
    shadow.sort = token.document.sort ?? 0;
    shadow.width = Math.abs(mesh.width);
    shadow.height = Math.abs(mesh.height);
    shadow.rotation = mesh.rotation;
    shadow.alpha = (getModuleSetting('tokenGroundShadowOpacity') ?? 0.55) * (token.mesh?.alpha ?? 1);
    shadow.position.set(
        mesh.position.x - (light.x * throwBy),
        mesh.position.y - (light.y * throwBy));

    // Softer the further it is thrown, which is what makes the height read rather than the offset alone
    const blur = Math.max(1, (2 + cells * 1.5) * scale);
    const existing = shadow.filters?.[0];
    if (existing instanceof PIXI.BlurFilter)
        existing.blur = blur;
    else
        shadow.filters = [new PIXI.BlurFilter(blur, 3)];
}

export function refreshAllGroundShadows()
{
    for (const token of canvas.tokens?.placeables ?? [])
        refreshGroundShadow(token);
}

Hooks.on('refreshToken', refreshGroundShadow);
Hooks.on('destroyToken', token => removeShadow(token?.document?.id));
Hooks.on('canvasTearDown', clearGroundShadows);
Hooks.on('canvasReady', () => refreshAllGroundShadows());

// THT loads its terrain after our canvasReady, and nothing else re-runs the ground lookup.
Hooks.on(`${THT_ID}.updateTerrain`, () => refreshAllGroundShadows());
