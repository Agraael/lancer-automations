import { VARIABLE, storedVariableType } from '../bonuses/variable-type.js';

const LWFX_ID = 'lancer-weapon-fx';
const SIZE_PREFIX = /^(Superheavy|Heavy|Main|Auxiliary) /;

let _known = null;

const searchString = text => String(text ?? '').toLowerCase().trim();

function lwfxSetting(key)
{
    try
    {
        return /** @type {any} */ (game.settings.get(LWFX_ID, key));
    }
    catch
    {
        return undefined;
    }
}

function extractIds(text, name)
{
    const start = text.indexOf(`${name} = {`);
    if (start < 0)
        return null;

    const open = text.indexOf('{', start);
    let depth = 0;

    for (let index = open; index < text.length; index++)
    {
        if (text[index] === '{')
            depth++;
        else if (text[index] === '}' && --depth === 0)
        {
            const ids = new Set();

            for (const match of text.slice(open, index + 1).matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g))
            {
                if (match[2])
                    ids.add(match[1]);
            }

            return ids;
        }
    }

    return null;
}

export async function loadLwfxKnownIds()
{
    _known = null;
    const weaponFx = game.modules.get(LWFX_ID);
    if (!weaponFx?.active)
        return;

    for (const script of weaponFx.esmodules ?? [])
    {
        const relative = String(script).replace(/^\.\//, '');
        const path = relative.startsWith('modules/') ? relative : `modules/${LWFX_ID}/${relative}`;

        try
        {
            const text = await (await fetch(foundry.utils.getRoute(path))).text();
            const wear = extractIds(text, 'EFFECTS_WEAR_AND_TEAR');
            const gear = extractIds(text, 'EFFECTS_GEAR');

            if (wear && gear)
            {
                _known = { wear, gear };
                return;
            }
        }
        catch (error)
        {
            console.warn(`lancer-automations | could not read ${path}:`, error);
        }
    }

    console.warn('lancer-automations | could not read the lancer-weapon-fx effect list, LA default weapon effects stay off');
}

export const lwfxListReady = () => !!_known;

function damageTypeOf(item, type)
{
    return type === VARIABLE ? (storedVariableType(item) ?? type) : type;
}

export function weaponProfile(item)
{
    if (!item?.system)
        return null;

    if (item.type === 'npc_feature')
    {
        const typeLine = item.system.weapon_type || '';
        return {
            type: typeLine.replace(SIZE_PREFIX, ''),
            damage: damageTypeOf(item, item.system.damage?.[0]?.[0]?.type ?? null),
            range: item.system.range?.[0]?.type ?? null,
            size: SIZE_PREFIX.exec(typeLine)?.[1] ?? null,
        };
    }

    const profile = item.system.active_profile;
    if (!profile)
        return null;
    return { type: profile.type, damage: damageTypeOf(item, profile.all_damage?.[0]?.type ?? null), range: profile.all_range?.[0]?.type ?? null, size: item.system.size ?? null };
}

export const isMachineGun = item => /\b(?:assault|lmg|hmg|machine gun|minigun)\b/i.test(item?.name ?? '');

export function weaponCategory(item)
{
    const profile = weaponProfile(item);
    if (!profile)
        return null;

    const energy = profile.damage === 'Energy';
    const heavy = ['Heavy', 'Superheavy'].includes(profile.size);

    switch (profile.type)
    {
        case 'Melee': return 'melee';
        case 'CQB':
            if (energy)
                return 'cqb_energy';
            return profile.range === 'Cone' || /\bshotgun\b/i.test(item.name ?? '') ? 'cqb_shotgun' : 'cqb_other';
        case 'Rifle':
            if (energy)
                return 'rifle_energy';
            if (isMachineGun(item))
                return heavy ? 'rifle_mg' : 'rifle_ar';
            return 'rifle_other';
        case 'Launcher': return 'launcher';
        case 'Cannon':
            if (energy)
                return 'cannon_energy';
            return isMachineGun(item) ? 'cannon_mg' : 'cannon_other';
        case 'Nexus': return 'nexus';
        default: return null;
    }
}

export function lwfxPlaysFallback(item)
{
    return lwfxSetting('isWeaponHeuristicActive') !== false && !!weaponCategory(item);
}

function hasCustomEffect(state, fallbackId)
{
    const customState = lwfxSetting('effectsManagerState');
    const effects = Object.values(customState?.effects ?? {});

    if (!effects.length)
        return false;

    const actorUuid = state.actor?.token?.baseActor?.uuid || state.actor?.uuid;
    const wanted = [state.item?.name, state.item?.system?.lid, fallbackId].map(searchString).filter(Boolean);

    return effects.some(effect =>
    {
        if (!searchString(effect.macroUuid))
            return false;

        const folderActor = effect.folderId ? customState.folders?.[effect.folderId]?.actorUuid : null;
        if (folderActor && actorUuid && folderActor !== actorUuid)
            return false;
        return wanted.includes(searchString(effect.itemName)) || wanted.includes(searchString(effect.itemLid));
    });
}

const basicDefaultId = state => (state.data?.attack_type === 'Melee' ? 'lwfx_default_melee' : 'lwfx_default_ranged');

export function lwfxBasicHasCustomEffect(state)
{
    return hasCustomEffect(state, basicDefaultId(state));
}

export function lwfxPlaysBasicDefault(state)
{
    return lwfxSetting('isPlayDefaultEffectsGear') !== false && !!_known?.gear.has(basicDefaultId(state));
}

export function lwfxHasOwnEffect(state)
{
    const lid = state.item?.system?.lid;
    const gear = lwfxSetting('isPlayDefaultEffectsGear') !== false && _known?.gear.has(lid);
    const wear = lwfxSetting('isPlayDefaultEffectsWearAndTear') !== false && _known?.wear.has(lid);
    const category = weaponCategory(state.item);
    return !!(lid && (gear || wear)) || hasCustomEffect(state, category ? `lwfx_heuristic_${category}` : null);
}
