import { MODULE_ID } from "./constants.js";
import { getLAFlag, getLAFlags } from "./flag-utils.js";
import { getModuleSetting } from "./settings-utils.js";
import { isExecutorGM } from "../utils/lancer-token.js";

const TEMPLATE_FOLDER_NAME = "Lancer Automations";

function hardCoverLosFlags()
{
    const flagOnly = getModuleSetting('lancerLosFlagOnly') === true;
    return { blocksLineOfSight: !flagOnly, blocksLaLosOnly: flagOnly };
}

const TEMPLATE_DEFINITIONS = {
    throw: {
        version: 1,
        data: () => ({
            name: "Template Throw",
            type: 'deployable',
            img: 'systems/lancer/assets/icons/white/melee.svg',
            system: {
                hp: { value: 5, max: 5, min: 0 },
                evasion: 5,
                edef: 5,
                armor: 0,
                size: 0.5,
                activations: 0
            },
            ownership: { default: 0 },
            prototypeToken: {
                name: "Template Throw",
                texture: { src: 'systems/lancer/assets/icons/white/melee.svg' },
                width: 1,
                height: 1,
                displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
                displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
                disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
                bar1: { attribute: 'hp' },
                flags: { [MODULE_ID]: { awarenessMode: 'simple' } }
            }
        })
    },
    hardCover: {
        version: 1,
        data: () => ({
            name: "Template Hard Cover",
            type: 'deployable',
            img: "modules/lancer-automations/icons/stone-pile.svg",
            system: {
                hp: { value: 10, max: 10, min: 0 },
                stats: { hp: 10, evasion: 5, edef: 5, armor: 0, size: 1, speed: 0, save: 10, heatcap: 0 },
                activations: 0
            },
            ownership: { default: 0 },
            prototypeToken: {
                name: "Template Hard Cover",
                texture: { src: "modules/lancer-automations/icons/stone-pile.svg" },
                width: 1,
                height: 1,
                displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
                displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
                disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
                bar1: { attribute: 'hp' },
                flags: { [MODULE_ID]: { awarenessMode: 'simple', solid: true, ...hardCoverLosFlags() } }
            }
        })
    },
    wreck: {
        version: 1,
        data: () => ({
            name: "Template Wreck",
            type: 'deployable',
            img: `modules/${MODULE_ID}/icons/tombstone.svg`,
            ownership: { default: 0 },
            prototypeToken: {
                actorLink: false,
                displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
                displayName: CONST.TOKEN_DISPLAY_MODES.NONE,
                texture: { src: `modules/${MODULE_ID}/icons/tombstone.svg` },
                flags: { [MODULE_ID]: { awarenessMode: 'simple' } },
            },
        })
    },
    environment: {
        version: 1,
        data: () => ({
            name: "Environment",
            type: 'deployable',
            img: 'modules/lancer-automations/icons/world.svg',
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
            prototypeToken: {
                name: "Environment",
                texture: { src: 'modules/lancer-automations/icons/world.svg' },
                disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL
            }
        })
    }
};

export async function getTemplateFolder()
{
    const folder = game.folders.find(candidate => candidate.type === 'Actor' && getLAFlag(candidate, 'templateFolder'));
    if (folder || !game.user.isGM)
        return folder ?? null;
    return Folder.create(/** @type {any} */ ({ name: TEMPLATE_FOLDER_NAME, type: 'Actor', flags: { [MODULE_ID]: { templateFolder: true } } }));
}

function findTemplateActor(key, name)
{
    return game.actors.find(candidate => candidate.type === 'deployable' && getLAFlag(candidate, 'templateActor') === key)
        ?? game.actors.find(candidate => candidate.type === 'deployable' && candidate.name === name);
}

function withTemplateFlags(data, key, version)
{
    return foundry.utils.mergeObject(data, { flags: { [MODULE_ID]: { templateActor: key, templateVersion: version } } }, { inplace: false });
}

export function isTemplateActor(actor)
{
    return !!getLAFlag(actor, 'templateActor');
}

export function isEnvironmentActor(actor)
{
    return getLAFlag(actor, 'templateActor') === 'environment';
}

export function getEnvironmentActor()
{
    return getOrCreateTemplateActor('environment');
}

export async function getOrCreateTemplateActor(key)
{
    const definition = TEMPLATE_DEFINITIONS[key];
    const data = definition.data();
    const actor = findTemplateActor(key, data.name);

    if (!actor)
    {
        const folder = await getTemplateFolder();
        const ownership = game.user.isGM ? data.ownership : { ...data.ownership, [game.user.id]: data.ownership.default };
        return Actor.create(/** @type {any} */ ({ ...withTemplateFlags(data, key, definition.version), ownership, folder: folder?.id ?? null }));
    }

    if (!game.user.isGM)
        return actor;

    const folder = actor.folder ? null : await getTemplateFolder();

    const update = {
        ...(getLAFlag(actor, 'templateActor') === key ? {} : { [`flags.${MODULE_ID}.templateActor`]: key }),
        ...(folder ? { folder: folder.id } : {})
    };

    if (Object.keys(update).length > 0)
        await actor.update(update);
    return actor;
}

export async function syncTemplateActors({ force = false } = {})
{
    if (!game.user.isGM)
        return;

    for (const [key, definition] of Object.entries(TEMPLATE_DEFINITIONS))
    {
        const data = definition.data();
        const actor = findTemplateActor(key, data.name);

        if (!actor || (!force && (getLAFlag(actor, 'templateVersion') ?? 0) >= definition.version))
            continue;

        const update = withTemplateFlags(data, key, definition.version);
        delete update.type;
        await actor.update(update);
    }
}

export async function ensureTemplateActors()
{
    if (!game.user.isGM)
        return;

    for (const key of Object.keys(TEMPLATE_DEFINITIONS))
        await getOrCreateTemplateActor(key);
}

export async function syncHardCoverFlags()
{
    if (!game.user.isGM)
        return;

    const actor = findTemplateActor('hardCover', TEMPLATE_DEFINITIONS.hardCover.data().name);
    if (!actor)
        return;

    const wanted = { ...hardCoverLosFlags(), solid: true };
    const current = getLAFlags(actor.prototypeToken) ?? {};
    const changed = Object.entries(wanted).filter(([key, value]) => !!current[key] !== value);
    if (!changed.length)
        return;

    await actor.update(Object.fromEntries(changed.map(([key, value]) => [`prototypeToken.flags.${MODULE_ID}.${key}`, value])));
}

Hooks.once('setup', () =>
{
    if (game.user.isGM)
        return;
    const actors = /** @type {any} */ (game.actors);
    const visibleContents = actors._getVisibleTreeContents.bind(actors);
    actors._getVisibleTreeContents = (...args) => visibleContents(...args).filter(actor => !isEnvironmentActor(actor));
    actors.initializeTree();
});

Hooks.once('ready', async () =>
{
    if (!isExecutorGM())
        return;
    await syncTemplateActors();
    await ensureTemplateActors();
    await syncHardCoverFlags();
});

export const TemplateActorsAPI = { syncTemplateActors, getEnvironmentActor };
