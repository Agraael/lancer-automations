// filled in even when the toggle is off, so callers can tell "opted out" from "typo"
import { getModuleSetting } from '../tools/settings-utils.js';
import { localize } from '../tools/string-utils.js';

let additionalStatusKeys = null;

// LCP status items point at system icons the system never shipped; the module carries those
const SYSTEM_ICON_DIR = 'systems/lancer/assets/icons/white/';
const MODULE_ICON_DIR = 'modules/lancer-automations/icons/system/';
const SHIPPED_SYSTEM_ICONS = new Set([
    'condition_dazed.svg',
    'condition_DeadRings_statuses_staggered.svg',
    'condition_DeadRings_statuses_stripped.svg',
    'condition_DeadRings_statuses_vulnerable.svg',
    'status_overheated.svg'
]);

function remapShippedSystemIcons()
{
    for (const status of CONFIG.statusEffects)
    {
        for (const key of ['img', 'icon'])
        {
            const path = status[key];
            if (typeof path !== 'string' || !path.startsWith(SYSTEM_ICON_DIR))
                continue;
            const file = path.slice(SYSTEM_ICON_DIR.length);
            if (SHIPPED_SYSTEM_ICONS.has(file))
                status[key] = MODULE_ICON_DIR + file;
        }
    }
}

/** @param {any} nameOrId */
export function isAdditionalStatusUnavailable(nameOrId)
{
    if (typeof nameOrId !== 'string' || !additionalStatusKeys?.has(nameOrId))
        return false;
    return !CONFIG.statusEffects?.some(status => status.id === nameOrId || status.name === nameOrId);
}

Hooks.on('lancer.statusesReady', () =>
{
    remapShippedSystemIcons();

    if (getModuleSetting('enableInfectionDamageIntegration')
        && !CONFIG.statusEffects.find(status => status.id === 'infection'))
    {
        CONFIG.statusEffects.push({
            id: "infection",
            name: "Infection",
            img: "modules/lancer-automations/icons/infection.svg",
            description: localize('LA.status.infection.description')
        });
    }

    if (getModuleSetting('additionalStatuses'))
    {
        if (!CONFIG.statusEffects.find(status => status.id === 'guardian'))
        {
            CONFIG.statusEffects.push({
                id: "guardian",
                name: "Guardian",
                img: "modules/lancer-automations/icons/guarded-tower.svg",
                description: localize('LA.status.guardian.description')
            });
        }

        if (!CONFIG.statusEffects.find(status => status.id === 'bulwark'))
        {
            CONFIG.statusEffects.push({
                id: "bulwark",
                name: "Bulwark",
                img: "modules/lancer-automations/icons/brick-wall.svg",
                description: localize('LA.status.bulwark.description')
            });
        }

        if (!CONFIG.statusEffects.find(status => status.id === 'phasing'))
        {
            CONFIG.statusEffects.push({
                id: "phasing",
                name: "Phasing",
                img: "modules/lancer-automations/icons/back-forth.svg",
                description: localize('LA.status.phasing.description')
            });
        }
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
            { id: "bolster", name: "Bolster", img: "systems/lancer/assets/icons/white/accuracy.svg" },
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
        description: localize('LA.status.resistance_all.description'),
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
        description: localize('LA.status.immovable.description')
    }, {
        id: "disengage",
        name: "Disengage",
        img: "modules/lancer-automations/icons/disengage.svg",
        description: localize('LA.status.disengage.description')
    }, {
        id: "destroyed",
        name: "Destroyed",
        img: "modules/lancer-automations/icons/destroyed.svg",
        description: localize('LA.status.destroyed.description')
    }, {
        id: "grappling",
        name: "Grappling",
        img: "modules/lancer-automations/icons/grappling.svg",
        description: localize('LA.status.grappling.description'),
        changes: /** @type {any[]} */ ([
            { key: "system.statuses.engaged", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.action_tracker.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
        ])
    }, {
        id: "grappled",
        name: "Grappled",
        img: "modules/lancer-automations/icons/grappled.svg",
        description: localize('LA.status.grappled.description'),
        changes: /** @type {any[]} */ ([
            { key: "system.statuses.engaged", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.action_tracker.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
        ])
    }, {
        id: "falling",
        name: "Falling",
        img: "modules/lancer-automations/icons/falling.svg",
        description: localize('LA.status.falling.description')
    }, {
        id: "throttled",
        name: "Throttled",
        img: "modules/lancer-automations/icons/throttled.svg",
        description: localize('LA.status.throttled.description')
    }, {
        id: "blinded",
        name: "Blinded",
        img: "modules/lancer-automations/icons/blinded.svg",
        description: localize('LA.status.blinded.description')
    }, {
        id: "climber",
        name: "Climber",
        img: "modules/lancer-automations/icons/mountain-climbing.svg",
        description: localize('LA.status.climber.description')
    }, {
        id: "hover",
        name: "Hover",
        img: "modules/lancer-automations/icons/hover.svg",
        description: localize('LA.status.hover.description')
    }, {
        id: "terrain_immunity",
        name: "Terrain Immunity",
        img: "modules/lancer-automations/icons/metal-boot.svg",
        description: localize('LA.status.terrain_immunity.description')
    }, {
        id: "surefoot",
        name: "Surefoot",
        img: "modules/lancer-automations/icons/running-shoe.svg",
        description: localize('LA.status.surefoot.description')
    }, {
        id: "reactor_meltdown",
        name: "Reactor Meltdown",
        img: "modules/lancer-automations/icons/mushroom-cloud.svg",
        description: localize('LA.status.reactor_meltdown.description')
    },
    {
        id: "aided",
        name: "Aided",
        img: "modules/lancer-automations/icons/health-capsule.svg",
        description: localize('LA.status.aided.description')
    },
    {
        id: "brace",
        name: "Brace",
        img: "modules/lancer-automations/icons/brace.svg",
        description: localize('LA.status.brace.description')
    },
    {
        id: "core_power_active",
        name: "Core Power Active",
        img: "systems/lancer/assets/icons/white/corepower.svg",
        description: localize('LA.status.core_power_active.description'),
        changes: /** @type {any[]} */ ([
            { key: "system.statuses.core_power_active", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" }
        ])
    },
    //these effect also exist in prototype-pattern-groups-data-1.16.0.lcp
    {
        id: "dazed",
        name: "Dazed",
        img: "modules/lancer-automations/icons/dazed.svg",
        description: localize('LA.status.dazed.description')
    },
    {
        id: "overheated",
        name: "Overheated",
        img: "modules/lancer-automations/icons/overheated.svg",
        description: localize('LA.status.overheated.description')
    }];

    additionalStatusKeys = new Set([
        ...additional.flatMap(status => [status.id, status.name]),
        'bulwark', 'Bulwark', 'phasing', 'Phasing', 'guardian', 'Guardian'
    ]);

    if (!getModuleSetting('additionalStatuses'))
        return;

    for (const status of additional)
    {
        if (!CONFIG.statusEffects.find(existing => existing.id === status.id))
            CONFIG.statusEffects.push(status);
    }
});
