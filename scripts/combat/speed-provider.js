/* global Hooks, game, Color, CONST */

const MODULE_ID = 'lancer-automations';
const ENABLED = 'enableBuiltinSpeedProvider';
const COLOR_STANDARD = 'speedProvider.colorStandard';
const COLOR_BOOST = 'speedProvider.colorBoost';
const COLOR_OVER_BOOST = 'speedProvider.colorOverBoost';

import { getModuleSetting } from "../tools/settings-utils.js";
import { getMovementBands } from "../movement/move-tracking.js";

export { tokenSpeed } from "../movement/move-tracking.js";

function isEnabled()
{
    return getModuleSetting(ENABLED);
}

function conflictModuleActive()
{
    return !!game.modules.get('lancer-speed-provider')?.active;
}

function getColor(key, fallback)
{
    try
    {
        const rawColor = game.settings.get(MODULE_ID, key);
        return Color.from(rawColor ?? fallback);
    }
    catch
    {
        return Color.from(fallback);
    }
}

/**
 * Speed tier ranges for a token: cumulative max distances in grid units.
 * Used by LancerTokenRuler to color segments.
 */
export function getSpeedRanges(token)
{
    const colors = {
        'standard': () => getColor(COLOR_STANDARD, '#1e88e5'),
        'boost': () => getColor(COLOR_BOOST, '#ffc107'),
        'over-boost': () => getColor(COLOR_OVER_BOOST, '#d81b60')
    };
    return getMovementBands(token)
        .filter(band => band.size > 0)
        .map(band => ({ name: band.name, color: colors[band.name]?.() ?? getColor(COLOR_STANDARD, '#1e88e5'), max: band.max, granted: band.granted }));
}

function registerSettings()
{
    game.settings.register(MODULE_ID, ENABLED, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true
    });
    game.settings.register(MODULE_ID, COLOR_STANDARD, {
        name: 'Speed Color: Standard', scope: 'client', type: String, default: '#1e88e5', config: false
    });
    game.settings.register(MODULE_ID, COLOR_BOOST, {
        name: 'Speed Color: Boost', scope: 'client', type: String, default: '#ffc107', config: false
    });
    game.settings.register(MODULE_ID, COLOR_OVER_BOOST, {
        name: 'Speed Color: Over-boost', scope: 'client', type: String, default: '#d81b60', config: false
    });
    game.settings.register(MODULE_ID, 'speedProvider.colorFreeMovement', {
        name: 'Speed Color: Free Movement', scope: 'client', type: String, default: '#ffffff', config: false
    });
    game.settings.register(MODULE_ID, 'speedProvider.colorForceMovement', {
        name: 'Speed Color: Force Movement', scope: 'client', type: String, default: '#8B5CF6', config: false
    });
}

Hooks.once('init', () =>
{
    registerSettings();
});

Hooks.on('preCreateActiveEffect', (effect) =>
{
    if (!isEnabled() || conflictModuleActive())
        return;
    const MODES = CONST.ACTIVE_EFFECT_MODES;
    const frameLid = effect?.parent?.system?.loadout?.frame?.value?.system?.lid ?? null;

    if (effect.statuses?.size === 1 && effect.statuses.has('dangerzone') && frameLid === 'mf_tokugawa_alt_enkidu')
    {
        const changes = [...effect.changes, { key: 'system.speed', value: '3', mode: MODES.ADD, priority: 100 }];
        effect.updateSource({ changes });
    }
    else if (effect.statuses?.size === 1 && effect.statuses.has('core_power_active') && frameLid === 'mf_lycan')
    {
        const changes = [...effect.changes, { key: 'system.speed', value: '3', mode: MODES.ADD, priority: 100 }];
        effect.updateSource({ changes });
    }
});

Hooks.on('updateCombat', (combat, change) =>
{
    if (!isEnabled() || conflictModuleActive())
        return;
    if (!('turn' in change) || !combat.current?.tokenId)
        return;
    const token = game.canvas?.tokens?.get(combat.current.tokenId);
    if (!token?.isOwner)
        return;
    const combatant = combat.combatants?.get(combat.current.combatantId);
    if (!combatant?.isOwner)
        return;
    const conditionIds = Array.from(token.actor?.statuses ?? []);
    combatant.setFlag(MODULE_ID, 'speedProvider.turn-status', conditionIds);
});

Hooks.on('preDeleteCombatant', (combatant) =>
{
    if (!isEnabled() || conflictModuleActive())
        return;
    if (combatant.actor?.statuses?.has('core_power_active'))
        combatant.actor.toggleStatusEffect('core_power_active', { active: false });
});

Hooks.on('preDeleteCombat', (combat) =>
{
    if (!isEnabled() || conflictModuleActive())
        return;
    for (const combatant of combat.combatants ?? [])
    {
        if (combatant.actor?.statuses?.has('core_power_active'))
            combatant.actor.toggleStatusEffect('core_power_active', { active: false });
    }
});
