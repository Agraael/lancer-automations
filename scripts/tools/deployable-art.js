import { MODULE_ID } from './constants.js';
import { getModuleSetting } from './settings-utils.js';
import { getLAFlags } from './flag-utils.js';
import { localize, localizeFormat } from './string-utils.js';
import { isExecutorGM } from '../utils/lancer-token.js';

const ART_ROOT = `modules/${MODULE_ID}/assets/tokens`;
const IMAGE_FILE = /\.(png|webp|jpe?g|gif|svg|avif)$/i;

const WEAPON_SIZE_POOLS = {
    Auxiliary: 'weapon/small',
    Main: 'weapon/main',
    Heavy: 'weapon/heavy',
    Superheavy: 'weapon/superheavy'
};

export const WEAPON_ART_ANCHOR_Y = 0.6;

const DEFAULT_IMAGE_ROOTS =['systems/lancer/assets/icons/', `modules/${MODULE_ID}/icons/`];

function isDefaultImage(src)
{
    return typeof src === 'string'
        && (src === 'icons/svg/mystery-man.svg' || DEFAULT_IMAGE_ROOTS.some(root => src.startsWith(root)));
}

export function deployableArtEnabled()
{
    return !!getModuleSetting('defaultDeployableArt');
}

function categoryKey(folderName)
{
    return decodeURIComponent(folderName).toLowerCase().replace(/[^a-z]/g, '');
}

async function scanArtFolder(picker, dir, parentKey, pools)
{
    const key = (parentKey ? `${parentKey}/` : '') + categoryKey(dir.split('/').pop());
    const listing = await picker.browse('data', dir);
    const files = (listing.files ?? []).filter(file => IMAGE_FILE.test(file));

    if (files.length)
        pools[key] = files;
    for (const sub of listing.dirs ?? [])
        await scanArtFolder(picker, sub, key, pools);
}

async function scanDeployableArt()
{
    const picker = foundry.applications.apps.FilePicker.implementation;
    const pools = {};

    try
    {
        const root = await picker.browse('data', ART_ROOT);
        for (const dir of root.dirs ?? [])
            await scanArtFolder(picker, dir, '', pools);
    }
    catch (error)
    {
        console.warn('lancer-automations | deployable art folder scan failed', error);
        return;
    }

    if (!foundry.utils.objectsEqual(pools, getModuleSetting('deployableArtPools') ?? {}))
        await game.settings.set(MODULE_ID, 'deployableArtPools', pools);
}

function hasDroneTag(actor)
{
    const tags = actor?.system?.tags;
    return Array.isArray(tags) && tags.some(tag => /drone/i.test(tag?.lid ?? '') || /drone/i.test(tag?.id ?? ''));
}

function deployableArtCategory(actor)
{
    if (actor?.type !== 'deployable')
        return null;

    const template = getLAFlags(actor)?.templateActor;
    if (template === 'hardCover')
        return 'hardcover';
    if (template === 'throw')
        return WEAPON_SIZE_POOLS.Main;
    if (/turret/i.test(actor.name ?? ''))
        return 'turret';

    const type = String(actor.system?.type ?? '');
    if (/mine/i.test(type))
        return 'mine';
    if (/drone/i.test(type) || hasDroneTag(actor))
        return 'drone';
    return null;
}

/**
 * Random art from the thrown weapon's size folder, null to keep the throw template's own art.
 * @param {any} weapon Thrown weapon item.
 * @returns {string|null}
 */
export function thrownWeaponArt(weapon)
{
    if (!deployableArtEnabled())
        return null;

    const pools = getModuleSetting('deployableArtPools') ?? {};
    const pool = pools[WEAPON_SIZE_POOLS[weapon?.system?.size] ?? WEAPON_SIZE_POOLS.Main];
    return pool?.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function pickArt(pool, key)
{
    let hash = 0;
    for (const char of String(key ?? ''))
        hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return pool[Math.abs(hash) % pool.length];
}

function specialArt(lid, specials)
{
    if (!lid || !specials?.length)
        return null;
    return specials.find(path => decodeURIComponent(path.split('/').pop()).replace(/\.[^.]+$/, '') === lid) ?? null;
}

/**
 * Image and prototype token changes for a deployable still wearing system or LA default art, stable per LID.
 * @param {any} actor Actor document or plain actor data.
 * @returns {Object|null} Update data, null when nothing is default or no art folder matches.
 */
export function deployableArtChanges(actor)
{
    if (actor?.type !== 'deployable')
        return null;

    const pools = getModuleSetting('deployableArtPools') ?? {};
    const category = deployableArtCategory(actor);
    const pool = category ? pools[category] : null;

    const art = specialArt(actor.system?.lid, pools.special)
        ?? (pool?.length ? pickArt(pool, actor.system?.lid || actor.name) : null);

    if (!art)
        return null;

    const changes = {};
    const original = {};
    const texture = actor.prototypeToken?.texture;

    if (isDefaultImage(texture?.src))
    {
        const scale = Number(getModuleSetting('deployableArtScale')) || 1;
        Object.assign(original, { src: texture.src, scaleX: texture.scaleX ?? 1, scaleY: texture.scaleY ?? 1 });
        changes['prototypeToken.texture.src'] = art;
        changes['prototypeToken.texture.scaleX'] = scale;
        changes['prototypeToken.texture.scaleY'] = scale;

        if (category?.startsWith('weapon/'))
        {
            original.anchorY = texture.anchorY ?? 0.5;
            changes['prototypeToken.texture.anchorY'] = WEAPON_ART_ANCHOR_Y;
        }
    }

    if (isDefaultImage(actor.img))
    {
        original.img = actor.img;
        changes.img = art;
    }

    if (!Object.keys(changes).length)
        return null;
    changes[`flags.${MODULE_ID}.deployableArtOriginal`] = original;
    return changes;
}

function isDeployableArt(src)
{
    return typeof src === 'string' && src.startsWith(`${ART_ROOT}/`);
}

function deployableArtRevertChanges(actor)
{
    if (actor?.type !== 'deployable')
        return null;

    const original = getLAFlags(actor)?.deployableArtOriginal ?? {};

    const fallback = getLAFlags(actor)?.templateActor === 'hardCover'
        ? `modules/${MODULE_ID}/icons/stone-pile.svg`
        : 'systems/lancer/assets/icons/deployable.svg';

    const changes = {};

    if (isDeployableArt(actor.prototypeToken?.texture?.src))
    {
        changes['prototypeToken.texture.src'] = original.src ?? fallback;
        changes['prototypeToken.texture.scaleX'] = original.scaleX ?? 1;
        changes['prototypeToken.texture.scaleY'] = original.scaleY ?? 1;
        if (original.anchorY != null)
            changes['prototypeToken.texture.anchorY'] = original.anchorY;
    }

    if (isDeployableArt(actor.img))
        changes.img = original.img ?? fallback;
    if (!Object.keys(changes).length)
        return null;
    changes[`flags.${MODULE_ID}.-=deployableArtOriginal`] = null;
    return changes;
}

async function updateWorldDeployables(buildChanges)
{
    const updates = [];

    for (const actor of game.actors)
    {
        const changes = buildChanges(actor);
        if (changes)
            updates.push({ _id: actor.id, ...changes });
    }

    if (updates.length)
        await Actor.implementation.updateDocuments(updates);
    return updates.length;
}

export async function onDeployableArtToggled(enabled, userId)
{
    if (userId !== game.userId || !game.user.isGM)
        return;
    if (enabled)
        await scanDeployableArt();

    const buildChanges = enabled ? deployableArtChanges : deployableArtRevertChanges;

    if (!game.actors.some(actor => buildChanges(actor)))
    {
        ui.notifications.info(localize('LA.deployableArt.nothingToUpdate'));
        return;
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
        modal: true,
        rejectClose: false,
        window: { title: localize('LA.deployableArt.applyTitle') },
        position: { width: 400 },
        content: `<p>${localize(enabled ? 'LA.deployableArt.applyPrompt' : 'LA.deployableArt.revertPrompt')}</p>`
    }));

    if (!confirmed)
        return;

    const count = await updateWorldDeployables(buildChanges);
    ui.notifications.info(enabled
        ? localizeFormat('LA.deployableArt.applied', { count })
        : localizeFormat('LA.deployableArt.reverted', { count }));
}

Hooks.once('ready', () =>
{
    if (isExecutorGM())
        scanDeployableArt();
});

Hooks.on('preCreateActor', (actor, _data, _options, userId) =>
{
    if (userId !== game.userId || !deployableArtEnabled())
        return;

    const changes = deployableArtChanges(actor);
    if (changes)
        actor.updateSource(changes);
});

Hooks.on('preCreateToken', (tokenDoc, _data, _options, userId) =>
{
    if (userId !== game.userId || !deployableArtEnabled())
        return;

    const texture = tokenDoc.texture;
    if (!isDeployableArt(texture?.src) || Math.random() < 0.5)
        return;
    tokenDoc.updateSource({ 'texture.scaleX': -(texture.scaleX ?? 1) });
});
