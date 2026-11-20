import { CLIPS } from './clips.js';
import {
    gridSize, Recipe, place, polar, dist, angleOf, jitter, seeded, pickFt,
    muzzlePlace, nativePlace, meleePlace, reachTime, coneArt, stackLine, fan,
} from './engine.js';

const IMPACT_AS = { kinetic: 'impact-orange', explosive: 'impact-orange', energy: 'static-blue' };
const NEXUS_FILTER = 'hue-rotate(70deg) blur(1.5px)';

const minOf = times => (times.length ? Math.min(...times) : 0);

const CONE = {
    kinetic: (recipe, scene) =>
    {
        const pellets = scene.shape.length / gridSize > 5 ? 12 : 7;
        const lands = fan(scene, pellets, 7).map((point, index) => recipe.proj('bullet', scene.shape.origin, point, index * (pellets > 7 ? 22 : 30)));
        recipe.hit = Math.max(...lands);
        recipe.impact = 'impact-orange';
        recipe.sound('shotgun_fire', 0).sound('shotgun_impact', recipe.hit);
    },
    explosive: (recipe, scene) =>
    {
        coneArt(recipe, scene, 'cone5e-orangeyellow');
        recipe.impact = 'impact-orange';
        recipe.sound('AirBurst', 0);
    },
    energy: (recipe, scene) =>
    {
        coneArt(recipe, scene, 'cone5e-lightning', 600, 2.25);
        recipe.impact = 'static-blue';
        recipe.sound('PPC2', 0);
    },
};

const LINE = {
    kinetic: (recipe, scene) =>
    {
        const fire = 1260;
        recipe.add('muzzle-burst', fire, muzzlePlace(CLIPS['muzzle-burst'], scene.shape.origin, scene.shape.angle, 1.8 * gridSize));
        stackLine(recipe, scene, 'piercing-line-orange', fire, 0);
        recipe.proj('snipe', scene.shape.origin, scene.end, fire);
        recipe.circle('smoke-ring', polar(scene.shape.origin, scene.shape.angle, 0.6 * gridSize), 1.1 * gridSize, fire + 60);
        recipe.impact = 'impact-orange';
        recipe.sound('Annihilator_Charge', 0).sound('AMR_Fire', fire).sound('AMR_Impact', fire);
    },
    explosive: (recipe, scene) =>
    {
        for (let reach = 1.3, index = 0; reach <= scene.shape.length / gridSize - 0.4; reach += 1.4, index++)
        {
            recipe.circle('explosion-01-orange', polar(scene.shape.origin, scene.shape.angle, reach * gridSize), 1.6 * gridSize, index * 90);
            recipe.sound(index % 2 ? 'DirectHitExplosion2' : 'DirectHitExplosion1', index * 90);
        }

        recipe.hit = 200;
        recipe.impact = null;
    },
    energy: (recipe, scene) =>
    {
        const src = `rbeam-${pickFt('rbeam', scene.shape.length)}`;
        recipe.proj('rbeam', scene.shape.origin, scene.end, 0);
        const scale = scene.shape.length / (CLIPS[src].w - 400);
        recipe.hitTimes = scene.hits.map(target => reachTime(src, 200 + dist(scene.shape.origin, target) / scale));
        recipe.hit = minOf(recipe.hitTimes);
        recipe.impact = 'static-blue';
        recipe.sound('Annihilator_Charge', 0).sound('Annihilator', 1100);
    },
};

const BLAST = {
    kinetic: (recipe, scene, t0, diameter) =>
    {
        [[-0.35, -0.3], [0.4, -0.2], [0.05, 0.4], [-0.15, 0.05]].forEach(([dx, dy], index) =>
        {
            const point = { x: scene.center.x + dx * diameter / 2, y: scene.center.y + dy * diameter / 2 };
            recipe.circle('explosion-04-orange', point, diameter * 0.28, t0 + index * 90);
            recipe.circle('shrapnel-bomb-grey', point, diameter * 0.55, t0 + index * 90 + 30);
        });
        recipe.circle('smoke-ring', scene.center, diameter, t0 + 200);
        recipe.hit = t0 + 150;
        recipe.impact = 'impact-orange';
        recipe.sound('AirBurst', t0);
    },
    explosive: (recipe, scene, t0, diameter) =>
    {
        recipe.circle('explosion-01-orange', scene.center, diameter, t0);
        recipe.hit = t0 + 150;
        recipe.impact = null;
        recipe.sound('DirectHitExplosion1', t0);
    },
    energy: (recipe, scene, t0, diameter) =>
    {
        recipe.circle('explosion-02-blue', scene.center, diameter, t0);
        recipe.hit = t0 + 150;
        recipe.impact = 'static-blue';
        recipe.sound('Nexus_Impact', t0);
    },
};

const SHOT = {
    cannon: { family: 'bullet2', scale: 1.5, sound: 'BR_Fire', muzzle: true },
    missile: { family: 'missile', sound: 'Missile_Launch' },
    laser: { family: 'laser', scale: 1.5, sound: 'Laser_Fire' },
    nexus: { family: 'bullet', sound: 'NexusFire', volley: 3, filter: NEXUS_FILTER },
    melee: { family: 'wave', sound: 'bladeswing' },
};

export function buildArea(pattern, damage, scene, shotKind)
{
    const recipe = new Recipe();

    if (pattern === 'cone')
        CONE[damage](recipe, scene);
    else if (pattern === 'line')
        LINE[damage](recipe, scene);
    else
    {
        let t0 = 0;
        const shot = !scene.burst && SHOT[shotKind];

        if (shot)
        {
            const family = shot.family === 'wave' && damage === 'energy' ? 'wavee' : shot.family;
            const rng = seeded(41);

            for (let round = 0; round < (shot.volley ?? 1); round++)
            {
                t0 = recipe.proj(family, scene.origin, round ? jitter(scene.center, 0.6, rng) : scene.center, round * 150, shot.scale);
                if (shot.filter)
                    recipe.filter(shot.filter);
                recipe.sound(shot.sound, round * 150);
            }

            if (shot.muzzle)
                recipe.add('muzzle-single', 0, muzzlePlace(CLIPS['muzzle-single'], scene.origin, angleOf(scene.origin, scene.center), 1.3 * gridSize));
        }

        recipe.t0 = t0;
        BLAST[damage](recipe, scene, t0, scene.shape.radius * 2);
    }

    if (recipe.impact)
    {
        const impact = IMPACT_AS[damage];
        scene.hits.forEach((target, index) => recipe.circle(impact, target, (impact === 'static-blue' ? 1.2 : 1) * gridSize, recipe.hitTimes?.[index] ?? recipe.hit + index * 120));
    }

    return recipe;
}

const MELEE_AREA = {
    cone: (recipe, scene, damage) =>
    {
        const src = damage === 'energy' ? 'trail03' : 'trail03-orange';
        const meta = CLIPS[src];
        const cx = (meta.vis[0] + meta.vis[2]) / 2;
        const cy = (meta.vis[1] + meta.vis[3]) / 2;

        for (const [fraction, at] of [[0.35, 0], [0.62, 120], [0.88, 240]])
        {
            const width = 2 * fraction * scene.shape.length * Math.sin(29.5 * Math.PI / 180);
            const scale = width / (meta.vis[2] - meta.vis[0]);
            const center = polar(scene.shape.origin, scene.shape.angle, fraction * scene.shape.length);
            recipe.add(src, at, place(center.x - cx * scale, center.y - cy * scale, meta.w * scale, meta.h * scale, cx * scale, cy * scale, scene.shape.angle - 90));
        }

        recipe.hitTimes = scene.hits.map(target =>
        {
            const fraction = dist(scene.shape.origin, target) / scene.shape.length;
            return 600 + (fraction < 0.49 ? 0 : fraction < 0.75 ? 120 : 240);
        });
        recipe.hit = minOf(recipe.hitTimes);
        recipe.sound('bladeswing', 300);
    },
    line: (recipe, scene, damage) =>
    {
        const land = recipe.proj(damage === 'energy' ? 'wavee' : 'wave', scene.shape.origin, scene.end, 0);
        recipe.hitTimes = scene.hits.map(target => Math.round(land * dist(scene.shape.origin, target) / scene.shape.length));
        recipe.hit = minOf(recipe.hitTimes);
        recipe.sound('bladeswing', 0);
    },
    burst: (recipe, scene, damage) =>
    {
        recipe.circle(damage === 'energy' ? 'whirl-blue' : 'whirl-orange', scene.center, scene.shape.radius * 2, 0).startTime(800);
        recipe.hit = 600;
        recipe.sound('bladeswing', 0);
    },
};

export function buildMeleeArea(pattern, damage, scene)
{
    const recipe = new Recipe();
    MELEE_AREA[pattern](recipe, scene, damage);
    const landed = new Set();

    scene.hits.forEach((target, index) =>
    {
        const at = recipe.hitTimes?.[index] ?? recipe.hit;
        recipe.circle(IMPACT_AS[damage], target, (damage === 'energy' ? 1.2 : 1) * gridSize, at);
        landed.add(at);
    });
    [...landed].sort((left, right) => left - right).forEach(at => recipe.sound('bladehit', at));
    return recipe;
}

export function buildLaunch(scene, damage, close)
{
    const recipe = new Recipe();
    const count = scene.targets.length;
    const energy = damage === 'energy';
    const rng = seeded(13);

    scene.targets.forEach((spot, index) =>
    {
        if (close)
        {
            const at = index * 150;
            recipe.add('muzzle-burst', at, muzzlePlace(CLIPS['muzzle-burst'], scene.origin, angleOf(scene.origin, spot), 0.9 * gridSize));
            if (energy)
                recipe.filter('hue-rotate(190deg)');
            recipe.circle(energy ? 'explosion-02-blue' : 'explosion-01-orange', spot, (count === 1 ? 1.8 : 1.5) * gridSize, at + 90);
            recipe.sound('Missile_Launch', at).sound(energy ? 'Nexus_Impact' : 'Missile_Impact', at + 90);
            return;
        }

        const at = index * 250;

        if (!energy)
        {
            const land = recipe.proj('missile', scene.origin, spot, at);
            recipe.circle('explosion-01-orange', spot, (count === 1 ? 1.8 : 1.5) * gridSize, land);
            recipe.sound('Missile_Launch', at).sound('Missile_Impact', land);
            return;
        }

        let first = null;

        ['mma', 'mmb'].forEach((family, round) =>
        {
            const land = recipe.proj(family, scene.origin, round ? jitter(spot, 0.4, rng) : spot, at + round * 120);
            recipe.sound('Missile_Launch', at + round * 120);
            first ??= land;
        });
        recipe.circle('explosion-02-blue', spot, (count === 1 ? 1.6 : 1.3) * gridSize, first);
        recipe.sound('Nexus_Impact', first);
    });
    return recipe;
}

export function buildMelee(scene, damage)
{
    const recipe = new Recipe();
    const slash = damage === 'energy' ? 'slash-blue' : 'slash-orange';

    scene.targets.forEach((spot, index) =>
    {
        const angle = angleOf(scene.origin, spot);
        const atReach = scene.reach[index] > 1;
        const at = atReach ? recipe.proj(damage === 'energy' ? 'wavee' : 'wave', scene.origin, spot, index * 200) - 120 : index * 200;
        const from = atReach ? polar(spot, angle, -1.2 * gridSize) : polar(scene.origin, angle, -0.2 * gridSize);
        recipe.add(slash, at, meleePlace(CLIPS[slash], from, spot));
        recipe.sound('bladeswing', index * 200);
        if (scene.missed[index])
            return;

        const peak = at + CLIPS[slash].peak;
        if (damage === 'energy')
            recipe.circle('static-blue', spot, 1.2 * gridSize, peak);
        else
            recipe.circle('impact-orange', spot, gridSize, peak);
        recipe.sound('bladehit', peak);
    });
    return recipe;
}

const missedAt = (scene, index) => !!scene.missed[index];
const endOf = (scene, index) => (missedAt(scene, index) ? polar(scene.targets[index], angleOf(scene.origin, scene.targets[index]) + 75, 0.9 * gridSize) : scene.targets[index]);
const lastMs = recipe => recipe.last.ms;

function burst(sound, scale, leadWait, repeats, gap)
{
    return (recipe, scene, rng) =>
    {
        scene.targets.forEach((target, index) =>
        {
            const start = index * 300;
            const end = endOf(scene, index);
            recipe.sound(sound, start);
            const land = recipe.proj('bullet', scene.origin, end, start, scale);
            const volley = Math.max(start, start + lastMs(recipe) + leadWait);

            for (let round = 0; round < repeats; round++)
                recipe.proj('bullet', scene.origin, jitter(end, 0.4, rng), volley + round * gap, scale);
            if (!missedAt(scene, index))
                recipe.circle('impact-orange', target, 1.2 * gridSize, land);
        });
    };
}

function bolt({ family, scale = 1, stagger = 250, sound = null, landSound = null })
{
    return (recipe, scene) =>
    {
        scene.targets.forEach((target, index) =>
        {
            const at = index * stagger;
            if (sound)
                recipe.sound(sound, at);

            const land = recipe.proj(family, scene.origin, endOf(scene, index), at, scale);
            if (landSound)
                recipe.sound(landSound, land);
            if (!missedAt(scene, index))
                recipe.circle('static-blue', target, 1.2 * gridSize, land);
        });
    };
}

const GENERIC = {
    cqbEnergy: (recipe, scene) =>
    {
        scene.targets.forEach((target, index) =>
        {
            const land = recipe.proj('chainp', scene.origin, endOf(scene, index), index * 120, 0.7);
            recipe.sound('PPC2', 400 + index * 120);
            if (!missedAt(scene, index))
                recipe.circle('static-blue', target, 1.2 * gridSize, land);
        });
    },
    cqbShotgun: (recipe, scene, rng) =>
    {
        recipe.sound('shotgun_cycle', 0);
        scene.targets.forEach((target, index) =>
        {
            const at = 500 + index * 200;
            recipe.sound('shotgun_fire', at);
            let land = at;

            for (let pellet = 0; pellet < 6; pellet++)
                land = recipe.proj('bullet', scene.origin, jitter(endOf(scene, index), 0.7, rng), at, 0.9);

            if (!missedAt(scene, index))
            {
                recipe.circle('impact-orange', target, 1.2 * gridSize, land);
                recipe.sound('shotgun_impact', land);
            }
        });
    },
    cqbOther: (recipe, scene, rng) =>
    {
        scene.targets.forEach((target, index) =>
        {
            const at = index * 250;
            let first = null;

            for (let round = 0; round < 3; round++)
            {
                recipe.sound('pistol_fire', at + round * 400);
                const land = recipe.proj('bullet', scene.origin, jitter(endOf(scene, index), 0.4, rng), at + round * 400, 0.5);
                first ??= land;
            }

            if (!missedAt(scene, index))
                recipe.circle('impact-orange', target, 1.2 * gridSize, first);
        });
    },
    rifleEnergy: (recipe, scene) =>
    {
        recipe.sound('WeaponBeep', 0);
        scene.targets.forEach((target, index) =>
        {
            const start = index * 300;
            recipe.sound('Thermal_Rifle_Fire', start + 400);
            recipe.proj('beam', scene.origin, endOf(scene, index), start, 1.25);
            recipe.startTime(1500);
            recipe.sound('Thermal_Rifle_Hit', start + 700);
            if (!missedAt(scene, index))
                recipe.add('impact-orange', start + 700, nativePlace('impact-orange', target, 0.375, angleOf(target, scene.origin) + 230));
        });
    },
    rifleEnergyHeavy: bolt({ family: 'eblast', stagger: 250, sound: 'Plasma_Fire', landSound: 'Nexus_Impact' }),
    machineGunHeavy: burst('AssaultCannonFire', 0.5, -800, 7, 50),
    machineGun: burst('AR_Fire', 1, -550, 3, 100),
    rifleOther: (recipe, scene) =>
    {
        recipe.sound('WeaponClick', 0);
        scene.targets.forEach((target, index) =>
        {
            const fire = 412 + index * 250;
            recipe.sound('AMR_Fire', fire);
            recipe.proj('snipeb', scene.origin, endOf(scene, index), fire);
            recipe.filter('hue-rotate(200deg)');
            if (missedAt(scene, index))
                return;

            recipe.sound('AMR_Impact', fire + 75);
            recipe.add('impact-orange', fire + 75, nativePlace('impact-orange', target, 0.375, angleOf(target, scene.origin) + 230));
        });
    },
    cannonEnergy: bolt({ family: 'fbolt', scale: 1.5, stagger: 200, sound: 'Annihilator', landSound: 'Nexus_Impact' }),
    cannonOther: (recipe, scene) =>
    {
        scene.targets.forEach((target, index) =>
        {
            const at = index * 250;
            const end = endOf(scene, index);
            recipe.sound('Mortar_Launch', at);
            const arrive = recipe.proj('bullet2', scene.origin, end, at) - at;
            recipe.playbackRate(0.7);
            const land = at + arrive / 0.7;
            recipe.circle('explosion-08-orange', end, (missedAt(scene, index) ? 1.2 : 1.8) * gridSize, land);
            recipe.sound('Mortar_Impact', land);
        });
    },
    nexus: (recipe, scene, rng) =>
    {
        recipe.sound('NexusReady', 0);
        scene.targets.forEach((target, index) =>
        {
            const fire = 600 + index * 200;
            const end = endOf(scene, index);
            recipe.sound('NexusFire', fire);
            let land = fire;

            for (let round = 0; round < 3; round++)
            {
                land = recipe.proj('bullet', scene.origin, jitter(end, 0.3, rng), fire + round * 120);
                recipe.filter(NEXUS_FILTER);
            }

            if (missedAt(scene, index))
                return;

            for (let ping = 0; ping < 3; ping++)
            {
                recipe.add('impact-004-blue', land + ping * 100, nativePlace('impact-004-blue', jitter(target, 0.5, rng), 0.5));
                recipe.filter('hue-rotate(235deg) brightness(0.5)');
            }

            recipe.sound('NexusConfirm', land);
        });
    },
};

export function buildGeneric(kind, scene)
{
    const recipe = new Recipe();
    GENERIC[kind](recipe, scene, seeded(29));
    return recipe;
}
