import { MODULE_ID } from '../tools/constants.js';
import { getLAFlag, unsetLAFlag } from '../tools/flag-utils.js';
import { isExecutorGM } from '../utils/lancer-token.js';

export const ARRIVAL_FLAG = 'arrival';
export const DEPARTURE_FLAG = 'departure';

const SLIDE_MS = 1300;
const DEPART_MARGIN_MS = 200;
const FLAG_CLEAR_MS = 5000;
const TOKEN_SORT_LAYER = 700;

const pending = new Set();
const landing = new Set();
const departing = new Set();

/** @typedef {PIXI.Sprite & { elevation: number, sortLayer: number, sort: number }} ArrivalSprite */

export function nearestEdge(rect, point)
{
    const edges = [
        { key: 'west', distance: point.x - rect.x },
        { key: 'east', distance: rect.right - point.x },
        { key: 'north', distance: point.y - rect.y },
        { key: 'south', distance: rect.bottom - point.y },
    ];
    return edges.sort((a, b) => a.distance - b.distance)[0].key;
}

function edgePoint(token)
{
    const rect = canvas.dimensions.sceneRect;
    const { x, y } = token.center;
    switch (nearestEdge(rect, token.center))
    {
        case 'west':
            return { x: rect.x - token.w, y };
        case 'east':
            return { x: rect.right + token.w, y };
        case 'north':
            return { x, y: rect.y - token.h };
        default:
            return { x, y: rect.bottom + token.h };
    }
}

function setShown(token, shown)
{
    token.renderable = shown;
    if (token.mesh)
        token.mesh.renderable = shown;
}

function slideSprite(token, from, to, arriving)
{
    const mesh = token.mesh;
    const sprite = /** @type {ArrivalSprite} */ (new PIXI.Sprite(mesh.texture));
    sprite.anchor.set(0.5);
    sprite.scale.copyFrom(mesh.scale);
    sprite.elevation = token.document.elevation ?? 0;
    sprite.sortLayer = TOKEN_SORT_LAYER;
    sprite.sort = token.document.sort ?? 0;
    sprite.alpha = arriving ? 0 : 1;
    sprite.position.set(from.x, from.y);
    canvas.primary.addChild(sprite);

    const began = performance.now();

    return new Promise((resolve) =>
    {
        const tick = () =>
        {
            if (sprite.destroyed)
            {
                canvas.app.ticker.remove(tick);
                resolve(sprite);
                return;
            }

            const progress = Math.min(1, (performance.now() - began) / SLIDE_MS);
            const ease = arriving ? 1 - (1 - progress) ** 3 : progress ** 3;
            sprite.position.set(from.x + (to.x - from.x) * ease, from.y + (to.y - from.y) * ease);
            sprite.alpha = Math.min(1, (arriving ? progress : 1 - progress) * 3);

            if (progress < 1)
                return;
            canvas.app.ticker.remove(tick);
            resolve(sprite);
        };

        canvas.app.ticker.add(tick);
    });
}

async function playEdgeArrival(token)
{
    const mesh = token.mesh;
    if (!mesh?.texture || !token.isVisible)
        return;

    landing.add(token.id);
    setShown(token, false);
    const sprite = await slideSprite(token, edgePoint(token), { x: mesh.x, y: mesh.y }, true);

    landing.delete(token.id);
    if (!token.destroyed)
    {
        setShown(token, true);
        token.renderFlags.set({ refreshVisibility: true });
        token.applyRenderFlags();
    }
    if (!sprite.destroyed)
        sprite.destroy();
}

async function playEdgeDeparture(token)
{
    const mesh = token.mesh;
    const visible = !!mesh?.texture && token.isVisible;

    departing.add(token.id);
    setShown(token, false);
    if (!visible)
        return;

    const sprite = await slideSprite(token, { x: mesh.x, y: mesh.y }, edgePoint(token), false);
    if (!sprite.destroyed)
        sprite.destroy();
}

export async function departToEdge(tokenDocs)
{
    const byScene = new Map();
    for (const doc of tokenDocs)
    {
        if (!byScene.has(doc.parent))
            byScene.set(doc.parent, []);
        byScene.get(doc.parent).push({ _id: doc.id, [`flags.${MODULE_ID}.${DEPARTURE_FLAG}`]: 'edge' });
    }

    for (const [scene, updates] of byScene)
        await scene.updateEmbeddedDocuments('Token', updates);
    await new Promise(resolve => setTimeout(resolve, SLIDE_MS + DEPART_MARGIN_MS));
}

export function initArrivalFx()
{
    Hooks.on('createToken', (tokenDoc) =>
    {
        if (getLAFlag(tokenDoc, ARRIVAL_FLAG) !== 'edge')
            return;

        pending.add(tokenDoc.id);
        if (!isExecutorGM())
            return;

        setTimeout(() =>
        {
            if (tokenDoc.parent?.tokens.has(tokenDoc.id))
                unsetLAFlag(tokenDoc, ARRIVAL_FLAG);
        }, FLAG_CLEAR_MS);
    });

    Hooks.on('updateToken', (tokenDoc, changed) =>
    {
        if (foundry.utils.getProperty(changed, `flags.${MODULE_ID}.${DEPARTURE_FLAG}`) !== 'edge' || !tokenDoc.object)
            return;
        playEdgeDeparture(tokenDoc.object);
    });

    Hooks.on('deleteToken', (tokenDoc) =>
    {
        departing.delete(tokenDoc.id);
    });

    Hooks.on('refreshToken', (token) =>
    {
        if (landing.has(token.id) || departing.has(token.id))
        {
            setShown(token, false);
            return;
        }

        if (!pending.delete(token.id))
            return;
        playEdgeArrival(token);
    });
}
