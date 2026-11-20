import { getModuleSetting } from '../tools/settings-utils.js';
import { getHexCenter, pixelToOffset, getMinGridDistance } from '../combat/grid-helpers.js';
import { _basicAttackContext, _suppressNextLwfxFor } from '../activations/flow-steps-extra.js';
import { setGridSize, gridSize, polar, angleOf } from './engine.js';
import { buildArea, buildMeleeArea, buildLaunch, buildMelee, buildGeneric } from './recipes.js';
import { playRecipe } from './play.js';
import { LA_INLINE_ATTACK_FX } from '../fx/actionFX.js';
import {
    loadLwfxKnownIds, lwfxListReady, lwfxHasOwnEffect, lwfxPlaysFallback, lwfxBasicHasCustomEffect, lwfxPlaysBasicDefault,
    weaponProfile, isMachineGun,
} from './lwfx.js';

export { loadLwfxKnownIds };

const DAMAGE_CLASS = { Kinetic: 'kinetic', Explosive: 'explosive', Energy: 'energy', Burn: 'explosive', Heat: 'energy', Variable: 'kinetic' };
const SUFFIX = { kinetic: 'Kinetic', explosive: 'Explosive', energy: 'Energy' };
const SHOT_SEQUENCE = { cannon: 'shotKinetic', missile: 'shotExplosive', laser: 'shotEnergy', nexus: 'shotNexus', melee: 'shotMelee' };

const centerOf = token => token?.center ?? token?.object?.center ?? null;
const basicProfile = state => ({ type: state.data?.attack_type === 'Melee' ? 'Melee' : 'Basic', damage: 'Kinetic', range: null, size: null, basic: true });

function shotFor(profile, damage)
{
    if (profile.type === 'Nexus')
        return 'nexus';
    if (profile.type === 'Melee')
        return 'melee';
    return { energy: 'laser', explosive: 'missile' }[damage] ?? 'cannon';
}

function genericKind(profile, item)
{
    const energy = profile.damage === 'Energy';
    const heavy = ['Heavy', 'Superheavy'].includes(profile.size);

    switch (profile.type)
    {
        case 'CQB':
            if (energy)
                return 'cqbEnergy';
            return profile.range === 'Cone' || /\bshotgun\b/i.test(item.name ?? '') ? 'cqbShotgun' : 'cqbOther';
        case 'Rifle':
            if (energy)
                return heavy ? 'rifleEnergyHeavy' : 'rifleEnergy';
            if (isMachineGun(item))
                return heavy ? 'machineGunHeavy' : 'machineGun';
            return 'rifleOther';
        case 'Cannon':
            if (energy)
                return 'cannonEnergy';
            return isMachineGun(item) ? 'machineGunHeavy' : 'cannonOther';
        case 'Nexus': return 'nexus';
        default: return null;
    }
}

function areaShape(area, attackerCenter)
{
    if (area.pattern === 'blast' || area.pattern === 'burst')
    {
        const host = area.pattern === 'burst' ? canvas.tokens.placeables.find(token => token.center.x === area.center.x && token.center.y === area.center.y) : null;
        const hostSize = Number(host?.document?.width) || 1;
        const radius = (area.pattern === 'burst' ? area.areaRange + hostSize / 2 : area.areaRange) * gridSize;
        return { shape: { type: 'circle', origin: area.center, radius }, center: area.center, burst: area.pattern === 'burst' };
    }

    const centers = area.cells.map(key =>
    {
        const [col, row] = key.split(',').map(Number);
        return getHexCenter(col, row);
    });

    const centroid = {
        x: centers.reduce((sum, point) => sum + point.x, 0) / Math.max(1, centers.length),
        y: centers.reduce((sum, point) => sum + point.y, 0) / Math.max(1, centers.length),
    };

    const cursor = pixelToOffset(area.center.x, area.center.y);
    const spread = Math.hypot(centroid.x - area.center.x, centroid.y - area.center.y) > 1;
    const rough = spread ? angleOf(area.center, centroid) : angleOf(attackerCenter, area.center);
    const inside = area.cells.includes(`${cursor.col},${cursor.row}`);
    const origin = inside ? polar(area.center, rough, -gridSize) : { ...area.center };
    const angle = spread ? angleOf(origin, centroid) : rough;
    const length = area.areaRange * gridSize;
    const shape = area.pattern === 'cone' ? { type: 'cone', origin, angle, length, spread: 59 } : { type: 'ray', origin, angle, length };
    return { shape, end: polar(origin, angle, length) };
}

function planAreas(profile, context, areas)
{
    const damage = DAMAGE_CLASS[profile.damage] ?? 'kinetic';
    const melee = profile.type === 'Melee';
    const attackerCenter = centerOf(context.sourceToken);

    return areas.map(area =>
    {
        const inside = context.targetTokens.filter(token => area.tokenIds.includes(token.id));
        const targets = inside.map(centerOf);
        const hits = inside.filter(token => !context.targetsMissed.has(token.id)).map(centerOf);
        const scene = { ...areaShape(area, attackerCenter), origin: attackerCenter, targets, hits };

        if (melee && area.pattern !== 'blast')
        {
            const id = { cone: 'meleeCone', line: 'meleeLine', burst: 'meleeBurst' }[area.pattern];
            return { recipe: buildMeleeArea(area.pattern, damage, scene), cues: [id] };
        }

        if (area.pattern === 'cone' || area.pattern === 'line')
            return { recipe: buildArea(area.pattern, damage, scene), cues: [`${area.pattern}${SUFFIX[damage]}`] };

        const shot = shotFor(profile, damage);
        const cues = scene.burst ? [`blast${SUFFIX[damage]}`] : [`blast${SUFFIX[damage]}`, SHOT_SEQUENCE[shot]];
        return { recipe: buildArea('blast', damage, scene, shot), cues };
    });
}

function planSingle(profile, item, context)
{
    const damage = DAMAGE_CLASS[profile.damage] ?? 'kinetic';
    const tokens = context.targetTokens.filter(token => centerOf(token));

    if (!tokens.length)
        return [];

    const scene = {
        origin: centerOf(context.sourceToken),
        targets: tokens.map(centerOf),
        missed: tokens.map(token => context.targetsMissed.has(token.id)),
        reach: tokens.map(token => getMinGridDistance(context.sourceToken, token?.object ?? token)),
    };

    if (profile.type === 'Melee' && !(profile.basic && Math.min(...scene.reach) > 1))
        return [{ recipe: buildMelee(scene, damage), cues: [scene.reach.some(reach => reach > 1) ? 'meleeReach' : 'melee'] }];

    if (profile.type === 'Launcher')
    {
        const close = scene.reach.every(reach => reach <= 1);
        const id = damage === 'energy' ? 'launcherEnergy' : close ? 'launcherAdjacent' : 'launcher';
        return [{ recipe: buildLaunch(scene, damage, close), cues: [id] }];
    }

    const kind = profile.basic ? 'cqbOther' : genericKind(profile, item);
    return kind ? [{ recipe: buildGeneric(kind, scene), cues: [kind] }] : [];
}

function planWeaponFx(state)
{
    if (!getModuleSetting('weaponFxDefaults') || !state.__laAttackShape || state.la_extraData?.is_throw)
        return [];
    if (!globalThis.Sequencer || !game.modules.get('lancer-weapon-fx')?.active || !lwfxListReady())
        return [];

    const profile = state.item ? weaponProfile(state.item) : basicProfile(state);
    if (!profile || (!state.item && LA_INLINE_ATTACK_FX[state.data?.title]))
        return [];

    const context = _basicAttackContext(state);
    if (!centerOf(context.sourceToken))
        return [];

    const areas = (state.__laAttackShape.placedAreas ?? []).filter(area => area.pattern && area.pattern !== 'target');
    const ownEffect = state.item ? lwfxHasOwnEffect(state) : lwfxBasicHasCustomEffect(state);

    if (ownEffect && !(areas.length && !context.targetTokens.length))
        return [];

    setGridSize(canvas.grid.size);
    const builds = areas.length ? planAreas(profile, context, areas) : planSingle(profile, state.item, context);
    const lwfxPlays = ownEffect || (state.item ? lwfxPlaysFallback(state.item) : lwfxPlaysBasicDefault(state));
    return builds.map(build => ({ ...build, lwfxPlays }));
}

export async function playWeaponFxDefault(state)
{
    try
    {
        const builds = planWeaponFx(state).filter(build => build.recipe.steps.length);

        if (builds.length)
        {
            state.__laWeaponFxPlayed = true;
            if (builds[0].lwfxPlays)
                _suppressNextLwfxFor(state.actor);
            for (const build of builds)
                playRecipe(build.recipe, build.cues).catch(error => console.error('lancer-automations | weapon FX failed:', error));
        }
    }
    catch (error)
    {
        console.error('lancer-automations | weapon FX failed:', error);
    }

    return true;
}
