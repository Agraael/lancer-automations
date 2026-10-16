import { MODULE_ID } from "./constants.js";
import { getLAFlag } from "./flag-utils.js";

const TEMPLATE_FOLDER_NAME = "Lancer Automations";

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
                flags: { [MODULE_ID]: { awarenessMode: 'simple' } }
            }
        })
    },
    wreck: {
        version: 1,
        data: () => ({
            name: "Template Wreck",
            type: 'deployable',
            img: `modules/${MODULE_ID}/icons/tombstone.svg`,
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

async function getTemplateFolder()
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
        return Actor.create(/** @type {any} */ ({ ...withTemplateFlags(data, key, definition.version), folder: folder?.id ?? null }));
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

Hooks.once('ready', async () =>
{
    if (!game.users.activeGM?.isSelf)
        return;
    await syncTemplateActors();
    await getEnvironmentActor();
});

export const TemplateActorsAPI = { syncTemplateActors, getEnvironmentActor };
