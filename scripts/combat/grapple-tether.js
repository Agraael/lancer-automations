import { getLAFlags } from '../tools/flag-utils.js';
import { createTokenTether } from '../interactive/canvas-helpers.js';
import { grappleState } from './grapple-state.js';

const GRAPPLE_RED = 0xe72124;

let tether = null;
let links = [];

function collectLinks()
{
    links = [];
    for (const token of canvas.tokens?.placeables ?? [])
    {
        for (const heldId of grappleState(token).grappledIds ?? [])
            links.push([token.id, heldId]);
    }
}

function refreshPairs()
{
    const pairs = [];
    for (const [holderId, heldId] of links)
    {
        const holder = canvas.tokens?.get(holderId);
        const held = canvas.tokens?.get(heldId);
        if (holder?.isVisible && held?.isVisible)
            pairs.push([holder, held]);
    }

    if (!pairs.length)
    {
        tether?.destroy();
        tether = null;
        return;
    }

    tether ??= createTokenTether({ color: GRAPPLE_RED });
    tether.setPairs(pairs);
}

function syncGrappleTether()
{
    if (!canvas?.ready)
        return;
    collectLinks();
    refreshPairs();
}

export function initGrappleTether()
{
    Hooks.on('canvasReady', syncGrappleTether);

    Hooks.on('canvasTearDown', () =>
    {
        tether?.destroy();
        tether = null;
        links = [];
    });

    Hooks.on('updateToken', (tokenDoc, change) =>
    {
        const laChange = getLAFlags(change) ?? {};
        if ('grappleState' in laChange || '-=grappleState' in laChange || 'hidden' in change)
            syncGrappleTether();
    });

    Hooks.on('deleteToken', tokenDoc =>
    {
        if (!canvas?.ready)
            return;
        collectLinks();
        links = links.filter(link => !link.includes(tokenDoc.id));
        refreshPairs();
    });

    Hooks.on('sightRefresh', () =>
    {
        if (links.length)
            refreshPairs();
    });

    syncGrappleTether();
}
