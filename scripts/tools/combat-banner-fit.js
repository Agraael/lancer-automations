const MODULE_ID = 'lancer-automations';

function applyBannerFit()
{
    const container = document.getElementById('yourTurnContainer');
    if (!container)
        return;

    let offset = 0;
    let zIndex = null;
    const hudEl = document.getElementById('la-hud');
    if (hudEl)
    {
        const rect = hudEl.getBoundingClientRect();
        // saved position beats the rect: the hud may still be mid slide-in
        const savedLeft = game.settings.get(MODULE_ID, 'tah.position')?.left;
        const left = typeof savedLeft === 'number' ? savedLeft : rect.left;
        if (rect.width && left < 300 && rect.top < 400)
        {
            offset = Math.ceil(left + rect.width);
            const hudZ = Number.parseInt(getComputedStyle(hudEl).zIndex, 10);
            zIndex = String(Math.max((Number.isNaN(hudZ) ? 70 : hudZ) - 1, 1));
        }
    }

    container.style.zIndex = zIndex ?? '100';

    const turnBanner = document.getElementById('yourTurnBanner');
    if (turnBanner)
    {
        turnBanner.style.left = offset ? `${offset}px` : '';
        turnBanner.style.width = offset ? `calc(100% - ${offset}px)` : '';
    }
    const turnImg = document.getElementById('yourTurnImageId');
    if (turnImg)
        turnImg.style.left = offset ? `${offset}px` : '';
}

export function initCombatBannerFit()
{
    const watchBanner = () =>
    {
        const container = document.getElementById('yourTurnContainer');
        if (!container)
            return false;
        new MutationObserver(() => applyBannerFit()).observe(container, { childList: true });
        return true;
    };

    // la-hud is a direct body child; refit when it appears or goes away
    new MutationObserver(mutations =>
    {
        const touchesHud = mutations.some(mutation =>
            [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)]
                .some(node => /** @type {any} */ (node)?.id === 'la-hud'));
        if (touchesHud)
            applyBannerFit();
    }).observe(document.body, { childList: true });

    // banner container is created in lancer-combat-banner's ready hook, possibly after ours
    if (!watchBanner())
    {
        const host = document.getElementById('interface') ?? document.body;
        const containerWatch = new MutationObserver(() =>
        {
            if (watchBanner())
                containerWatch.disconnect();
        });
        containerWatch.observe(host, { childList: true });
    }
}
