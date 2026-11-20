import { MODULE_ID } from "../tools/constants.js";
import { getLAFlag } from "../tools/flag-utils.js";
import { getModuleSetting } from "../tools/settings-utils.js";

const ACTIVATIONS = ['None', 'Passive', 'Quick', 'Quick Tech', 'Invade', 'Full', 'Full Tech', 'Other', 'Reaction', 'Protocol', 'Free'];
const DEPLOYABLE_TYPES = ['Deployable', 'Drone', 'Mine'];
const STAT_KEYS = ['armor', 'edef', 'evasion', 'heatcap', 'save', 'size', 'speed'];

const TYPE_ICONS = {
    Deployable: 'systems/lancer/assets/icons/deployable.svg',
    Drone: 'systems/lancer/assets/icons/drone.svg',
    Mine: 'systems/lancer/assets/icons/mine.svg'
};

const registry = new Map();

async function deployableFolderId(ownerFolderId)
{
    const parent = ownerFolderId ? game.folders.get(ownerFolderId) : null;
    const parentId = parent?.id ?? null;
    const name = String(getModuleSetting('deployableFolderName') ?? '').trim();

    if (!name || (parent && parent.ancestors.length + 1 >= CONST.FOLDER_MAX_DEPTH))
        return parentId;

    const existing = game.folders.find(folder => folder.type === 'Actor' && folder.name === name && (folder.folder?.id ?? null) === parentId);
    if (existing)
        return existing.id;

    const created = await Folder.create(/** @type {any} */ ({ name, type: 'Actor', folder: parentId }));
    return created?.id ?? parentId;
}

export async function createActorInDeployableFolder(actorData, ownerFolderId)
{
    const LancerActor = game.lancer?.LancerActor || Actor;
    return LancerActor.create({ ...actorData, folder: await deployableFolderId(ownerFolderId) });
}

export function encodeSpecKey(lid)
{
    return String(lid).replace(/\./g, '$DOT$');
}

export function normalizeDeployableSpec(spec)
{
    const lid = spec?.lid || `la_dep_${String(spec?.name ?? 'deployable').trim().replace(/[:\\/\-\s]+/g, '_').toLowerCase()}`;
    return { ...spec, lid };
}

export function deployableSpecHash(spec)
{
    const text = JSON.stringify(normalizeDeployableSpec(spec));
    let hash = 0;
    for (let index = 0; index < text.length; index++)
        hash = (hash * 31 + text.charCodeAt(index)) | 0;
    return (hash >>> 0).toString(16);
}

function repairActivation(value, fallback)
{
    if (value == null || value === '')
        return fallback;

    const text = String(value).trim().toLowerCase();
    const bare = text.replace(/\s+action$/, '');
    return ACTIVATIONS.find(activation => activation.toLowerCase() === text || activation.toLowerCase() === bare) ?? fallback;
}

function buildAction(action)
{
    return {
        activation: repairActivation(action.activation, 'Quick'),
        cost: action.cost ?? 0,
        damage: (action.damage ?? []).map(damage => ({ type: damage.type?.capitalize(), val: damage.val?.toString() ?? '1' })),
        detail: action.detail ?? '',
        frequency: action.frequency ?? '',
        heat_cost: action.heat_cost ?? 0,
        init: action.init ?? '',
        lid: action.id ?? action.lid ?? '',
        mech: action.mech ?? true,
        name: action.name ?? 'Action',
        pilot: action.pilot ?? false,
        range: (action.range ?? []).map(range => ({ type: range.type?.capitalize() ?? 'Range', val: Number.parseInt(range.val?.toString() ?? '0') || 0 })),
        synergy_locations: action.synergy_locations ?? [],
        terse: action.terse ?? '',
        trigger: action.trigger ?? '',
        tech_attack: action.tech_attack ?? false
    };
}

function buildCounter(counter)
{
    const start = counter.default_value ?? counter.min ?? 0;
    return { default_value: start, value: start, lid: counter.id ?? counter.lid, max: counter.max ?? 6, min: counter.min ?? 0, name: counter.name };
}

export function deployableTypeIcon(type)
{
    return TYPE_ICONS[type] ?? TYPE_ICONS.Deployable;
}

export function buildDeployableData(spec)
{
    const normalized = normalizeDeployableSpec(spec);
    const hpFormula = String(normalized.hp ?? 5).replaceAll('{ll}', '@level').replaceAll('{grit}', '@grit');
    const hp = Number.parseInt(hpFormula) || 5;
    const stats = { hp: hpFormula };

    for (const key of STAT_KEYS)
    {
        const value = Number(normalized[key]);
        if (normalized[key] != null && normalized[key] !== '' && Number.isFinite(value))
            stats[key] = value;
    }

    const typeText = String(normalized.type ?? '').toLowerCase();
    const type = DEPLOYABLE_TYPES.find(candidate => candidate.toLowerCase() === typeText) ?? 'Deployable';
    const img = normalized.img || deployableTypeIcon(type);
    return {
        name: normalized.name ?? 'Deployable',
        type: 'deployable',
        img,
        system: {
            lid: normalized.lid,
            type,
            detail: normalized.detail ?? '',
            activation: repairActivation(normalized.activation, 'Quick'),
            deactivation: repairActivation(normalized.deactivation, null),
            recall: repairActivation(normalized.recall, null),
            redeploy: repairActivation(normalized.redeploy, null),
            instances: normalized.instances ?? 1,
            cost: normalized.cost ?? 1,
            avail_mounted: normalized.mech ?? true,
            avail_unmounted: normalized.pilot ?? false,
            stats,
            hp: { min: 0, max: hp, value: hp },
            actions: (normalized.actions ?? []).map(buildAction),
            tags: (normalized.tags ?? []).map(tag => ({ lid: tag.lid ?? tag.id, val: (tag.val ?? '').toString() })),
            counters: (normalized.counters ?? []).map(buildCounter)
        },
        prototypeToken: { texture: { src: normalized.tokenImg || img } },
        flags: {
            [MODULE_ID]: {
                deployableSpec: { hash: deployableSpecHash(normalized) },
                ...(normalized.extraActions?.length ? { extraActions: foundry.utils.deepClone(normalized.extraActions) } : {})
            }
        }
    };
}

export function buildDeployablePreview(spec)
{
    const DocumentClass = /** @type {any} */ (CONFIG.Actor.documentClass);
    return new DocumentClass({ ...buildDeployableData(spec), _id: foundry.utils.randomID() });
}

export function registerDeployables(specs)
{
    for (const [lid, spec] of Object.entries(specs ?? {}))
    {
        const normalized = normalizeDeployableSpec({ ...spec, lid: spec?.lid ?? lid });
        registry.set(normalized.lid, normalized);
    }
}

export function findDeployableSpec(lid, { item = null, actor = null } = {})
{
    if (!lid || typeof lid !== 'string')
        return null;

    const key = encodeSpecKey(lid);

    for (const holder of [item, actor, ...(actor?.items ?? [])])
    {
        const spec = holder ? getLAFlag(holder, 'deployableSpecs')?.[key] : null;
        if (spec)
            return spec;
    }

    return registry.get(lid) ?? null;
}
