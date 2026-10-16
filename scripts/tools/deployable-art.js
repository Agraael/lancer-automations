import { MODULE_ID } from './constants.js';
import { getModuleSetting } from './settings-utils.js';
import { getLAFlags } from './flag-utils.js';
import { localize, localizeFormat } from './string-utils.js';

const ART_ROOT = `modules/${MODULE_ID}/assets/tokens`;
const IMAGE_FILE = /\.(png|webp|jpe?g|gif|svg|avif)$/i;

const DEFAULT_IMAGES = new Set([
    'icons/svg/mystery-man.svg',
    'systems/lancer/assets/icons/deployable.svg',
    'systems/lancer/assets/icons/mine.svg',
    'systems/lancer/assets/icons/drone.svg',
    'systems/lancer/assets/icons/white/deployable.svg',
    'systems/lancer/assets/icons/white/mine.svg',
    'systems/lancer/assets/icons/white/drone.svg',
    `modules/${MODULE_ID}/icons/stone-pile.svg`
]);

export function deployableArtEnabled()
{
    return !!getModuleSetting('defaultDeployableArt');
}

function categoryKey(folderName)
{
    return decodeURIComponent(folderName).toLowerCase().replace(/[^a-z]/g, '');
}

async function scanDeployableArt()
{
    const picker = foundry.applications.apps.FilePicker.implementation;
    const pools = {};
    try
    {
        const root = await picker.browse('data', ART_ROOT);
        for (const dir of root.dirs ?? [])
        {
            const listing = await picker.browse('data', dir);
            const files = (listing.files ?? []).filter(file => IMAGE_FILE.test(file));
            if (files.length)
                pools[categoryKey(dir.split('/').pop())] = files;
        }
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
    if (getLAFlags(actor)?.templateActor === 'hardCover')
        return 'hardcover';
    if (/turret/i.test(actor.name ?? ''))
        return 'turret';
    const type = String(actor.system?.type ?? '');
    if (/mine/i.test(type))
        return 'mine';
    if (/drone/i.test(type) || hasDroneTag(actor))
        return 'drone';
    return null;
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
    if (DEFAULT_IMAGES.has(texture?.src))
    {
        const scale = Number(getModuleSetting('deployableArtScale')) || 1;
        Object.assign(original, { src: texture.src, scaleX: texture.scaleX ?? 1, scaleY: texture.scaleY ?? 1 });
        changes['prototypeToken.texture.src'] = art;
        changes['prototypeToken.texture.scaleX'] = scale;
        changes['prototypeToken.texture.scaleY'] = scale;
    }
    if (DEFAULT_IMAGES.has(actor.img))
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
    const confirmed = await foundry.applications.api.DialogV2.confirm(/** @type {any} */ ({
        modal: true,
        rejectClose: false,
        window: { title: localize('LA.deployableArt.applyTitle') },
        position: { width: 400 },
        content: `<p>${localize(enabled ? 'LA.deployableArt.applyPrompt' : 'LA.deployableArt.revertPrompt')}</p>`
    }));
    if (!confirmed)
        return;
    if (enabled)
    {
        await scanDeployableArt();
        const count = await updateWorldDeployables(deployableArtChanges);
        ui.notifications.info(localizeFormat('LA.deployableArt.applied', { count }));
        return;
    }
    const count = await updateWorldDeployables(deployableArtRevertChanges);
    ui.notifications.info(localizeFormat('LA.deployableArt.reverted', { count }));
}

Hooks.once('ready', () =>
{
    if (game.users.activeGM?.isSelf)
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
