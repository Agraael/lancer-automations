// MAT replaces the tile sheet class during "ready", dropping the tab iso pushed onto the old one.

const ISO_ID = 'isometric-perspective';
const MAT_ID = 'monks-active-tiles';

export function reapplyIsometricTileTab()
{
    if (!game.modules.get(ISO_ID)?.active || !game.modules.get(MAT_ID)?.active) return;

    setTimeout(async () =>
    {
        try
        {
            const { createTileIsometricTab } = await import(`/modules/${ISO_ID}/scripts/tile.js`);
            createTileIsometricTab();
        }
        catch (e)
        {
            console.warn('lancer-automations | could not re-apply the isometric tile tab', e);
        }
    }, 0);
}
