// filled in even when the toggle is off, so callers can tell "opted out" from "typo"
let additionalStatusKeys = null;

/** @param {any} nameOrId */
export function isAdditionalStatusUnavailable(nameOrId)
{
    if (typeof nameOrId !== 'string' || !additionalStatusKeys?.has(nameOrId))
        return false;
    return !CONFIG.statusEffects?.some(status => status.id === nameOrId || status.name === nameOrId);
}

Hooks.on('lancer.statusesReady', () =>
{
    // infection is always needed by StatusFX, even when additionalStatuses is off
    if (!CONFIG.statusEffects.find(s => s.id === 'infection'))
    {
        CONFIG.statusEffects.push({
            id: "infection",
            name: "Infection",
            img: "modules/lancer-automations/icons/infection.svg",
            description: "Like Burn, but applies Heat instead of damage. Characters immediately take Heat equal to the Infection received, and the value stacks if Infection is already present. At the end of their turn, they roll a Systems check: on success they clear all Infection, otherwise they take Heat equal to the current Infection. Anything that clears Burn (e.g. Stabilize) also clears Infection."
        });
    }

    if (!CONFIG.statusEffects.find(s => s.id === 'guardian'))
    {
        CONFIG.statusEffects.push({
            id: "guardian",
            name: "Guardian",
            img: "modules/lancer-automations/icons/guarded-tower.svg",
            description: "Allied characters adjacent to this character can use them as hard cover."
        });
    }

    if (!CONFIG.statusEffects.find(s => s.id === 'bulwark'))
    {
        CONFIG.statusEffects.push({
            id: "bulwark",
            name: "Bulwark",
            img: "modules/lancer-automations/icons/brick-wall.svg",
            description: "This character is treated as hard cover and blocks line of sight."
        });
    }

    if (!CONFIG.statusEffects.find(status => status.id === 'phasing'))
    {
        CONFIG.statusEffects.push({
            id: "phasing",
            name: "Phasing",
            img: "modules/lancer-automations/icons/back-forth.svg",
            description: "This character can move through other characters, but still cannot end its movement on them."
        });
    }

    // fallback for users without csm-lancer-qol; that module normally provides these
    if (!game.modules.get('csm-lancer-qol')?.active)
    {
        const qolStatusEffects = [
            { id: "dangerzone", name: "Danger Zone", img: "systems/lancer/assets/icons/white/status_dangerzone.svg" },
            { id: "burn", name: "Burn", img: "icons/svg/fire.svg" },
            { id: "overshield", name: "Overshield", img: "modules/lancer-automations/icons/overshield.svg" },
            { id: "engaged", name: "Engaged", img: "systems/lancer/assets/icons/white/status_engaged.svg" },
            { id: "cascading", name: "Cascading", img: "icons/svg/paralysis.svg" },
            { id: "bolster", name: "Bolstered", img: "systems/lancer/assets/icons/white/accuracy.svg" },
            { id: "mia", name: "M.I.A.", img: "modules/lancer-automations/icons/mia_lg.svg" }
        ];
        for (const eff of qolStatusEffects)
        {
            if (!CONFIG.statusEffects.find(s => s.id === eff.id))
                CONFIG.statusEffects.push(eff);
        }
    }

    // stripped (Dead Rings LCP): no armor
    const stripped = CONFIG.statusEffects.find(effect => effect.id === 'DeadRings_statuses_stripped');
    const strippedChanges = /** @type {any[]} */ (stripped?.changes ?? []);
    if (stripped && !strippedChanges.some(change => change.key === 'system.armor'))
    {
        stripped.changes = /** @type {any} */ ([
            ...strippedChanges,
            { key: "system.armor", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0" }
        ]);
    }

    // shredded: no armor, no resistances
    const shredded = CONFIG.statusEffects.find(effect => effect.id === 'shredded');
    const shreddedChanges = /** @type {any[]} */ (shredded?.changes ?? []);
    if (shredded && !shreddedChanges.some(change => change.key === 'system.armor'))
    {
        shredded.changes = /** @type {any} */ ([
            ...shreddedChanges,
            { key: "system.armor", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "0" },
            { key: "system.resistances.burn", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
            { key: "system.resistances.energy", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
            { key: "system.resistances.explosive", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
            { key: "system.resistances.heat", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
            { key: "system.resistances.kinetic", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
            { key: "system.resistances.infection", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" }
        ]);
    }

    const additional = [{
        id: "resistance_all",
        name: "Resist All",
        img: "modules/lancer-automations/icons/resist_all.svg",
        description: "You count as having RESISTANCE to all damage, burn, and heat: take half, rounded up.",
        changes: /** @type {any[]} */ ([
            { key: "system.resistances.burn", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.energy", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.explosive", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.heat", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.kinetic", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.infection", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" }
        ])
    }, {
        id: "immovable",
        name: "Immovable",
        img: "modules/lancer-automations/icons/immovable.svg",
        description: "Cannot be moved"
    }, {
        id: "disengage",
        name: "Disengage",
        img: "modules/lancer-automations/icons/disengage.svg",
        description: "You ignore engagement and your movement does not provoke reactions"
    }, {
        id: "destroyed",
        name: "Destroyed",
        img: "modules/lancer-automations/icons/destroyed.svg",
        description: "You are destroyed"
    }, {
        id: "grappling",
        name: "Grappling",
        img: "modules/lancer-automations/icons/grappling.svg",
        description: "You are grappling in a grapple contest",
        changes: /** @type {any[]} */ ([
            { key: "system.statuses.engaged", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.action_tracker.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
        ])
    }, {
        id: "grappled",
        name: "Grappled",
        img: "modules/lancer-automations/icons/grappled.svg",
        description: "You are grappled in a grapple contest",
        changes: /** @type {any[]} */ ([
            { key: "system.statuses.engaged", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.action_tracker.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
        ])
    }, {
        id: "falling",
        name: "Falling",
        img: "modules/lancer-automations/icons/falling.svg",
        description: "Characters take damage when they fall 3 or more spaces and cannot recover before hitting the ground. Characters fall 10 spaces per round in normal gravity, but can't fall in zero-G or very low-G environments. They take 3 Kinetic AP (armour piercing) damage for every three spaces fallen, to a maximum of 9 Kinetic AP. Falling is a type of involuntary movement."
    }, {
        id: "throttled",
        name: "Throttled",
        img: "modules/lancer-automations/icons/throttled.svg",
        description: "Deals Half damage, heat, and burn on attacks"
    }, {
        id: "blinded",
        name: "Blinded",
        img: "modules/lancer-automations/icons/blinded.svg",
        description: "Light of sight reduced to 1"
    }, {
        id: "climber",
        name: "Climber",
        img: "modules/lancer-automations/icons/mountain-climbing.svg",
        description: "You ignore effect of climbing terrain"
    }, {
        id: "hover",
        name: "Hover",
        img: "modules/lancer-automations/icons/hover.svg",
        description: "You hover above the ground: same movement rules as Flying."
    }, {
        id: "terrain_immunity",
        name: "Terrain Immunity",
        img: "modules/lancer-automations/icons/metal-boot.svg",
        description: "You ignore difficult and dangerous terrain"
    }, {
        id: "surefoot",
        name: "Surefoot",
        img: "modules/lancer-automations/icons/running-shoe.svg",
        description: "You ignore difficult terrain. Dangerous terrain still applies."
    }, {
        id: "reactor_meltdown",
        name: "Reactor Meltdown",
        img: "modules/lancer-automations/icons/mushroom-cloud.svg",
        description: "You are in a reactor meltdown"
    },
    {
        id: "aided",
        name: "Aided",
        img: "modules/lancer-automations/icons/health-capsule.svg",
        description: "You can Stabilize as a quick action"
    },
    {
        id: "brace",
        name: "Brace",
        img: "modules/lancer-automations/icons/brace.svg",
        description: "You resist the triggering attack, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions."
    },
    {
        id: "core_power_active",
        name: "Core Power Active",
        img: "systems/lancer/assets/icons/white/corepower.svg",
        description: "Your core is active",
        changes: /** @type {any[]} */ ([
            { key: "system.statuses.core_power_active", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" }
        ])
    },
    //these effect also exist in prototype-pattern-groups-data-1.16.0.lcp
    {
        id: "dazed",
        name: "Dazed",
        img: "modules/lancer-automations/icons/dazed.svg",
        description: "DAZED mechs can only take one quick action – they cannot OVERCHARGE, move normally, nor take full actions, reactions, or free actions."
    },
    {
        id: "overheated",
        name: "Overheated",
        img: "modules/lancer-automations/icons/overheated.svg",
        description: "An OVERHEATED mech cannot take any actions or activate abilities that would inflict Heat upon themselves, including OVERCHARGE and systems with the HEAT X (SELF) tag. Weapons with OVERKILL lose the tag while OVERHEATED. Cleared by STABILIZE."
    }];

    additionalStatusKeys = new Set(additional.flatMap(status => [status.id, status.name]));

    if (!game.settings.get('lancer-automations', 'additionalStatuses'))
        return;

    for (const status of additional)
    {
        if (!CONFIG.statusEffects.find(existing => existing.id === status.id))
            CONFIG.statusEffects.push(status);
    }
});
