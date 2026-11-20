import { getModuleSetting } from '../tools/settings-utils.js';

const IMPACT_CLIPS = new Set(['impact-orange', 'static-blue', 'impact-004-blue', 'impact-010-orange']);
const BASE_VOLUME = 0.5;

export const WEAPON_FX_CUES = {
    coneKinetic: [
        { id: 'fire', match: 'shotgun_fire', src: 'modules/lancer-automations/FX/audio/weaponFx/cone_kinetic.wav', shift: 0 },
        { id: 'hit', match: 'shotgun_impact', src: 'modules/lancer-automations/FX/audio/weaponFx/bullet_impact.wav', shift: 0 },
    ],
    coneExplosive: [
        { id: 'fire', match: 'AirBurst', src: 'modules/lancer-automations/FX/audio/weaponFx/cone_explosive.wav', shift: 0 },
        { id: 'hit', match: 'DirectHitExplosion2', src: 'modules/lancer-weapon-fx/soundfx/DirectHitExplosion2.ogg', shift: -100, hits: true },
    ],
    coneEnergy: [
        { id: 'fire', match: 'PPC2', src: 'modules/lancer-automations/FX/audio/weaponFx/cone_energy.wav', shift: 0 },
        { id: 'hit', match: 'Nexus_Impact', src: 'modules/lancer-automations/FX/audio/weaponFx/energy_hit.wav', shift: 0, hits: true },
    ],
    lineKinetic: [
        { id: 'charge', match: 'Annihilator_Charge', src: 'modules/lancer-weapon-fx/soundfx/Annihilator_Charge.ogg', shift: 0 },
        { id: 'fire', match: 'AMR_Fire', src: 'modules/lancer-automations/FX/audio/weaponFx/line_kinetic.wav', shift: -140 },
        { id: 'hit', match: 'AMR_Impact', src: 'modules/lancer-weapon-fx/soundfx/AMR_Impact.ogg', shift: 0 },
    ],
    lineExplosive: [
        { id: 'first', match: 'DirectHitExplosion1', src: 'modules/lancer-weapon-fx/soundfx/DirectHitExplosion1.ogg', shift: 0 },
        { id: 'second', match: 'DirectHitExplosion2', src: 'modules/lancer-weapon-fx/soundfx/DirectHitExplosion2.ogg', shift: 0 },
    ],
    lineEnergy: [
        { id: 'charge', match: 'Annihilator_Charge', src: 'modules/lancer-weapon-fx/soundfx/Annihilator_Charge.ogg', shift: 70 },
        { id: 'fire', match: 'Annihilator', src: 'modules/lancer-weapon-fx/soundfx/Annihilator.ogg', shift: -100 },
    ],
    blastKinetic: [
        { id: 'burst', match: 'AirBurst', src: 'modules/lancer-automations/FX/audio/weaponFx/blast_kinetic.wav', shift: 0 },
    ],
    blastExplosive: [
        { id: 'blast', match: 'DirectHitExplosion1', src: 'modules/lancer-weapon-fx/soundfx/DirectHitExplosion1.ogg', shift: 0 },
    ],
    blastEnergy: [
        { id: 'blast', match: 'Nexus_Impact', src: 'modules/lancer-weapon-fx/soundfx/Nexus_Impact.ogg', shift: 0 },
    ],
    shotKinetic: [
        { id: 'fire', match: 'BR_Fire', src: 'modules/lancer-weapon-fx/soundfx/BR_Fire.ogg', shift: 0 },
    ],
    shotExplosive: [
        { id: 'fire', match: 'Missile_Launch', src: 'modules/lancer-weapon-fx/soundfx/Missile_Launch.ogg', shift: 0 },
    ],
    shotEnergy: [
        { id: 'fire', match: 'Laser_Fire', src: 'modules/lancer-weapon-fx/soundfx/Laser_Fire.ogg', shift: 0 },
    ],
    shotNexus: [
        { id: 'fire', match: 'NexusFire', src: 'modules/lancer-weapon-fx/soundfx/NexusFire.ogg', shift: 0 },
    ],
    shotMelee: [
        { id: 'fire', match: 'bladeswing', src: 'modules/lancer-weapon-fx/soundfx/bladeswing.ogg', shift: 0 },
    ],
    meleeCone: [
        { id: 'swing', match: 'bladeswing', src: 'modules/lancer-weapon-fx/soundfx/bladeswing.ogg', shift: 0 },
        { id: 'hit', match: 'bladehit', src: 'modules/lancer-weapon-fx/soundfx/bladehit.ogg', shift: 0 },
    ],
    meleeLine: [
        { id: 'swing', match: 'bladeswing', src: 'modules/lancer-weapon-fx/soundfx/bladeswing.ogg', shift: 0 },
        { id: 'hit', match: 'bladehit', src: 'modules/lancer-weapon-fx/soundfx/bladehit.ogg', shift: 0 },
    ],
    meleeBurst: [
        { id: 'swing', match: 'bladeswing', src: 'modules/lancer-weapon-fx/soundfx/bladeswing.ogg', shift: 0 },
        { id: 'hit', match: 'bladehit', src: 'modules/lancer-weapon-fx/soundfx/bladehit.ogg', shift: 0 },
    ],
    launcher: [
        { id: 'launch', match: 'Missile_Launch', src: 'modules/lancer-weapon-fx/soundfx/Missile_Launch.ogg', shift: 0 },
        { id: 'hit', match: 'Missile_Impact', src: 'modules/lancer-weapon-fx/soundfx/Missile_Impact.ogg', shift: 0 },
    ],
    launcherAdjacent: [
        { id: 'launch', match: 'Missile_Launch', src: 'modules/lancer-weapon-fx/soundfx/Missile_Launch.ogg', shift: 0 },
        { id: 'hit', match: 'Missile_Impact', src: 'modules/lancer-weapon-fx/soundfx/Missile_Impact.ogg', shift: 0 },
    ],
    launcherEnergy: [
        { id: 'launch', match: 'Missile_Launch', src: 'modules/lancer-automations/FX/audio/weaponFx/energy_missile_launch.wav', shift: 0 },
        { id: 'hit', match: 'Nexus_Impact', src: 'modules/lancer-automations/FX/audio/weaponFx/energy_missile_impact.wav', shift: 0 },
    ],
    melee: [
        { id: 'swing', match: 'bladeswing', src: 'modules/lancer-weapon-fx/soundfx/bladeswing.ogg', shift: 0 },
        { id: 'hit', match: 'bladehit', src: 'modules/lancer-weapon-fx/soundfx/bladehit.ogg', shift: 0 },
    ],
    meleeReach: [
        { id: 'wave', match: 'bladeswing', src: 'modules/lancer-weapon-fx/soundfx/bladeswing.ogg', shift: 0 },
        { id: 'hit', match: 'bladehit', src: 'modules/lancer-weapon-fx/soundfx/bladehit.ogg', shift: 0 },
    ],
    cqbEnergy: [
        { id: 'fire', match: 'PPC2', src: 'modules/lancer-weapon-fx/soundfx/PPC2.ogg', shift: 0 },
        { id: 'hit', match: 'Nexus_Impact', src: 'modules/lancer-automations/FX/audio/weaponFx/energy_hit.wav', shift: 0, hits: true },
    ],
    cqbShotgun: [
        { id: 'pump', match: 'shotgun_cycle', src: 'modules/lancer-weapon-fx/soundfx/shotgun_cycle.ogg', shift: 0 },
        { id: 'fire', match: 'shotgun_fire', src: 'modules/lancer-weapon-fx/soundfx/shotgun_fire.ogg', shift: 0 },
        { id: 'hit', match: 'shotgun_impact', src: 'modules/lancer-weapon-fx/soundfx/shotgun_impact.ogg', shift: 0 },
    ],
    cqbOther: [
        { id: 'fire', match: 'pistol_fire', src: 'modules/lancer-weapon-fx/soundfx/pistol_fire.ogg', shift: 0 },
        { id: 'hit', match: 'KineticImpact', src: 'modules/lancer-automations/FX/audio/weaponFx/bullet_impact_3.wav', shift: 0, hits: true },
    ],
    rifleEnergy: [
        { id: 'beep', match: 'WeaponBeep', src: 'modules/lancer-weapon-fx/soundfx/WeaponBeep.ogg', shift: 0 },
        { id: 'fire', match: 'Thermal_Rifle_Fire', src: 'modules/lancer-weapon-fx/soundfx/Thermal_Rifle_Fire.ogg', shift: 0 },
        { id: 'hit', match: 'Thermal_Rifle_Hit', src: 'modules/lancer-weapon-fx/soundfx/Thermal_Rifle_Hit.ogg', shift: 0 },
    ],
    rifleEnergyHeavy: [
        { id: 'fire', match: 'Plasma_Fire', src: 'modules/lancer-weapon-fx/soundfx/Annihilator_Charge.ogg', shift: 0 },
        { id: 'hit', match: 'Nexus_Impact', src: 'modules/lancer-weapon-fx/soundfx/Nexus_Impact.ogg', shift: 100 },
    ],
    machineGunHeavy: [
        { id: 'fire', match: 'AssaultCannonFire', src: 'modules/lancer-weapon-fx/soundfx/AssaultCannonFire.ogg', shift: 0 },
        { id: 'hit', match: 'KineticImpact', src: 'modules/lancer-automations/FX/audio/weaponFx/bullet_impact_2.wav', shift: 0, hits: true },
    ],
    machineGun: [
        { id: 'fire', match: 'AR_Fire', src: 'modules/lancer-automations/FX/audio/weaponFx/AR_Fire2.wav', shift: 0 },
        { id: 'hit', match: 'KineticImpact', src: 'modules/lancer-automations/FX/audio/weaponFx/bullet_impact.wav', shift: 0, hits: true },
    ],
    rifleOther: [
        { id: 'click', match: 'WeaponClick', src: 'modules/lancer-weapon-fx/soundfx/WeaponClick.ogg', shift: 0 },
        { id: 'fire', match: 'AMR_Fire', src: 'modules/lancer-weapon-fx/soundfx/AMR_Fire.ogg', shift: 0 },
        { id: 'hit', match: 'AMR_Impact', src: 'modules/lancer-weapon-fx/soundfx/AMR_Impact.ogg', shift: 0 },
    ],
    cannonEnergy: [
        { id: 'fire', match: 'Annihilator', src: 'modules/lancer-automations/FX/audio/weaponFx/cannon_energy.wav', shift: 0 },
        { id: 'hit', match: 'Nexus_Impact', src: 'modules/lancer-automations/FX/audio/weaponFx/plasma_1.wav', shift: 0 },
    ],
    cannonOther: [
        { id: 'launch', match: 'Mortar_Launch', src: 'modules/lancer-weapon-fx/soundfx/Mortar_Launch.ogg', shift: 0 },
        { id: 'hit', match: 'Mortar_Impact', src: 'modules/lancer-weapon-fx/soundfx/Mortar_Impact.ogg', shift: 0 },
    ],
    nexus: [
        { id: 'ready', match: 'NexusReady', src: 'modules/lancer-weapon-fx/soundfx/NexusReady.ogg', shift: 0 },
        { id: 'fire', match: 'NexusFire', src: 'modules/lancer-weapon-fx/soundfx/NexusFire.ogg', shift: 0 },
        { id: 'hit', match: 'NexusConfirm', src: 'modules/lancer-weapon-fx/soundfx/NexusConfirm.ogg', shift: 0 },
    ],
};

export function weaponFxVolume()
{
    const weaponFx = /** @type {any} */ (game.modules.get('lancer-weapon-fx'));
    const master = Number(getModuleSetting('tah.weaponFxVolume'));
    const base = weaponFx?.active && weaponFx.api?.getEffectVolume ? weaponFx.api.getEffectVolume(BASE_VOLUME) : BASE_VOLUME;
    return base * (Number.isFinite(master) ? master : 1);
}

export function cueEvents(sequence, recipe)
{
    const hitTimes = recipe.steps.filter(step => IMPACT_CLIPS.has(step.src)).map(step => step.at);
    const events = [];

    for (const cue of WEAPON_FX_CUES[sequence] ?? [])
    {
        let times = recipe.sounds.filter(entry => entry.file === cue.match).map(entry => entry.at);
        if (!times.length && cue.hits)
            times = hitTimes;
        for (const time of times)
            events.push({ at: Math.max(0, time + cue.shift), src: cue.src });
    }

    return events;
}
