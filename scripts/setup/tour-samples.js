import { localize } from '../tools/string-utils.js';

export const FALLBACK_ART = 'icons/svg/mystery-man.svg';
const SUBJECT_TYPES = ['mech', 'npc'];

export const cssColor = (value) => foundry.utils.Color.from(value).css;

export function artOf(actor)
{
    const src = actor?.prototypeToken?.texture?.src;
    return src && !src.includes('*') ? src : (actor?.img || FALLBACK_ART);
}

export function unitOf(actor, fallbackKey)
{
    return actor ? { name: actor.prototypeToken?.name || actor.name, img: artOf(actor) } : { name: localize(fallbackKey), img: FALLBACK_ART };
}

export function worldUnits(test, keys)
{
    const actors = game.actors.filter(actor => actor.visible && test(actor));
    return keys.map((key, index) => unitOf(actors[index], key));
}

export function sampleUnits()
{
    return worldUnits(actor => actor.type === 'npc', ['LA.tour.demo.unitA', 'LA.tour.demo.unitB']);
}

export function ownUnit()
{
    const token = canvas.tokens?.controlled?.[0]?.document;
    if (token?.actor)
        return { name: token.name, img: token.texture?.src || FALLBACK_ART };
    return unitOf(game.actors.find(actor => actor.type === 'mech' && actor.isOwner && actor.hasPlayerOwner), 'LA.tour.demo.mech');
}

export function subjectToken()
{
    const usable = token => SUBJECT_TYPES.includes(token.actor?.type) && token.isOwner;
    const tokens = canvas.tokens?.placeables ?? [];
    return canvas.tokens?.controlled?.find(usable) ?? tokens.find(token => usable(token) && token.actor.hasPlayerOwner) ?? tokens.find(usable) ?? null;
}

export function corners(center, radius)
{
    return Array.from({ length: 6 }, (unused, index) =>
    {
        const angle = Math.PI / 180 * (60 * index - 30);
        return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
    });
}

export function hexPoints(center, radius)
{
    return corners(center, radius).map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
}

export const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
