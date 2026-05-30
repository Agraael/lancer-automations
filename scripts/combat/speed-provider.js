/* global Hooks, game, Color, CONST */

const MODULE_ID = 'lancer-automations';
const ENABLED = 'enableBuiltinSpeedProvider';
const COLOR_STANDARD = 'speedProvider.colorStandard';
const COLOR_BOOST = 'speedProvider.colorBoost';
const COLOR_OVER_BOOST = 'speedProvider.colorOverBoost';

const STUNNED_SET = ['stunned', 'immobilized', 'shutdown', 'downandout'];

function isEnabled() {
    try {
        return game.settings.get(MODULE_ID, ENABLED);
    } catch {
        return false;
    }
}

function conflictModuleActive() {
    return !!game.modules.get('lancer-speed-provider')?.active;
}

function isImmuneToStatus(actor, statusId) {
    const api = game.modules.get('lancer-automations')?.api;
    return !!api?.checkEffectImmunities?.(actor, statusId)?.length;
}

function hasActiveStatus(actor, statusId) {
    if (!actor?.statuses?.has(statusId))
        return false;
    return !isImmuneToStatus(actor, statusId);
}

function isStunned(token) {
    return STUNNED_SET.some(s => hasActiveStatus(token.actor, s));
}

/**
 * Sum of any "boost-leg only" speed bonuses from the lancer-automations bonus system.
 * Queries global + constant bonuses with type === 'speed_boost_extra'.
 */
function getBoostLegBonus(actor) {
    if (!actor)
        return 0;
    const api = game.modules.get('lancer-automations')?.api;
    const all = [
        ...(api?.getGlobalBonuses?.(actor) ?? []),
        ...(api?.getConstantBonuses?.(actor) ?? [])
    ];
    let bonus = nerveweaveBoostBonus(actor);
    for (const b of all) {
        if (b.type === 'speed_boost_extra')
            bonus += Number(b.val) || 0;
    }
    return bonus;
}

const LIMITLESS_LIDS = new Set([
    'npcf_limitless_ultra',
    'npcf_limitless_veteran',
    'npc-rebake_npcf_limitless_ultra',
    'npc-rebake_npcf_limitless_veteran'
]);

function canOvercharge(actor) {
    if (actor?.is_npc?.()) {
        const extras = actor.getFlag?.('lancer-automations', 'extraActions') || [];
        if (extras.some(a => a.name === 'Overcharge (NPC)'))
            return true;
        return actor.itemTypes?.npc_feature?.some(i => LIMITLESS_LIDS.has(i.system?.lid));
    }
    return !!actor?.is_mech?.();
}

function nerveweaveBoostBonus(actor) {
    if (!actor?.is_mech?.())
        return 0;
    const pilot = actor.system?.pilot?.value;
    if (pilot?.items?.some(i => i.system?.lid === 'cb_integrated_nerveweave'))
        return 2;
    return 0;
}

function tokenSpeed(token) {
    const actor = token.actor;
    let speed = actor?.system?.speed ?? 0;
    if (actor?.statuses?.has('prone'))
        speed = Math.floor(speed / 2);
    return speed;
}

function getColor(key, fallback) {
    try {
        const v = game.settings.get(MODULE_ID, key);
        return Color.from(v ?? fallback);
    } catch {
        return Color.from(fallback);
    }
}

/**
 * Speed tier ranges for a token: cumulative max distances in grid units.
 * Used by LancerTokenRuler to color segments. Returns [] if the token can't move.
 */
export function getSpeedRanges(token) {
    const actor = token?.actor;
    if (!actor || isStunned(token)) return [];
    const speed = tokenSpeed(token);
    if (!speed) return [];
    const boost = getBoostLegBonus(actor);

    const prone = hasActiveStatus(actor, 'prone');
    const startedStatuses = token.combatant?.getFlag(MODULE_ID, 'speedProvider.turn-status') ?? [];
    const startedProne = startedStatuses.some(e => typeof e === 'string' && e.endsWith('prone'));
    const slowed = prone || hasActiveStatus(actor, 'slow');

    const ranges = [];
    let acc = 0;
    if (prone || !startedProne) {
        acc += speed;
        ranges.push({ name: 'standard', color: getColor(COLOR_STANDARD, '#1e88e5'), max: acc });
    }
    if (!slowed) {
        acc += speed + boost;
        ranges.push({ name: 'boost', color: getColor(COLOR_BOOST, '#ffc107'), max: acc });
    }
    if (!slowed && canOvercharge(actor)) {
        acc += speed + boost;
        ranges.push({ name: 'over-boost', color: getColor(COLOR_OVER_BOOST, '#d81b60'), max: acc });
    }
    return ranges;
}

function registerSettings() {
    game.settings.register(MODULE_ID, ENABLED, {
        name: 'Built-in Speed Provider',
        hint: 'Color the token ruler with Lancer speed tiers (standard / boost / over-boost). Disable the standalone "lancer-speed-provider" module if active.',
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
}

Hooks.once('init', () => {
    registerSettings();
});

Hooks.once('lancer.registerFlows', (steps, flows) => {
    if (!isEnabled() || conflictModuleActive())
        return;
    steps.set('addCorePowerSE', async ({ actor }) => {
        if (actor.statuses?.has('core_power_active'))
            return true;
        actor.toggleStatusEffect('core_power_active', { active: true });
        return true;
    });
    flows.get('CoreActiveFlow')?.insertStepAfter('consumeCorePower', 'addCorePowerSE');
});

Hooks.on('preCreateActiveEffect', (effect) => {
    if (!isEnabled() || conflictModuleActive())
        return;
    const MODES = CONST.ACTIVE_EFFECT_MODES;
    const frameLid = effect?.parent?.system?.loadout?.frame?.value?.system?.lid ?? null;

    if (effect.statuses?.size === 1 && effect.statuses.has('dangerzone') && frameLid === 'mf_tokugawa_alt_enkidu') {
        const changes = [...effect.changes, { key: 'system.speed', value: '3', mode: MODES.ADD, priority: 100 }];
        effect.updateSource({ changes });
    } else if (effect.statuses?.size === 1 && effect.statuses.has('core_power_active') && frameLid === 'mf_lycan') {
        const changes = [...effect.changes, { key: 'system.speed', value: '3', mode: MODES.ADD, priority: 100 }];
        effect.updateSource({ changes });
    }
});

Hooks.on('updateCombat', (combat, change) => {
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

Hooks.on('preDeleteCombatant', (combatant) => {
    if (!isEnabled() || conflictModuleActive())
        return;
    combatant.actor?.toggleStatusEffect('core_power_active', { active: false });
});

Hooks.on('preDeleteCombat', (combat) => {
    if (!isEnabled() || conflictModuleActive())
        return;
    for (const c of combat.combatants ?? []) {
        c.actor?.toggleStatusEffect('core_power_active', { active: false });
    }
});
