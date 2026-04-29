/* global Hooks, game, Color, CONFIG, dragRuler, ui, CONST */

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

function applyElevationRulerCategories() {
    if (!CONFIG.elevationruler?.SPEED)
        return;
    CONFIG.elevationruler.SPEED.ATTRIBUTES.WALK = 'actor.system.speed';
    CONFIG.elevationruler.SPEED.CATEGORIES = [
        { name: 'lancer-automations.speed.standard', color: getColor(COLOR_STANDARD, '#1e88e5'), multiplier: 1 },
        { name: 'lancer-automations.speed.boost', color: getColor(COLOR_BOOST, '#ffc107'), multiplier: 2 },
        { name: 'lancer-automations.speed.over-boost', color: getColor(COLOR_OVER_BOOST, '#d81b60'), multiplier: 3 },
        { name: 'Unreachable', color: Color.from(0), multiplier: Number.POSITIVE_INFINITY }
    ];
    CONFIG.elevationruler.SPEED.tokenSpeed = tokenSpeed;
    CONFIG.elevationruler.SPEED.maximumCategoryDistance = maximumCategoryDistance;
}

function maximumCategoryDistance(token, speedCategory, ts) {
    const tSpeed = ts ?? CONFIG.elevationruler.SPEED.tokenSpeed(token);
    const CATS = CONFIG.elevationruler.SPEED.CATEGORIES;
    if (speedCategory.name === 'Unreachable')
        return tSpeed * Number.POSITIVE_INFINITY;
    const idx = CATS.indexOf(speedCategory);

    const startedProne = token.combatant
        ?.getFlag(MODULE_ID, 'speedProvider.turn-status')
        ?.includes('prone');
    const prone = hasActiveStatus(token.actor, 'prone');
    const firstMove = prone || !startedProne;
    const slowed = hasActiveStatus(token.actor, 'slow');

    if (
        isStunned(token)
        || (idx === 2 && !canOvercharge(token.actor))
        || (idx > 0 && (prone || slowed))
        || (idx === 0 && !firstMove)
    )
        return 0;

    const accum = idx > 0 ? maximumCategoryDistance(token, CATS[idx - 1], tSpeed) : 0;
    return accum + tSpeed + (idx > 0 ? getBoostLegBonus(token.actor) : 0);
}

function registerSettings() {
    game.settings.register(MODULE_ID, ENABLED, {
        name: 'Built-in Speed Provider',
        hint: 'Provide drag-ruler / elevation-ruler tiers from this module. Disable the standalone "lancer-speed-provider" module if active.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true
    });

    const refreshColor = (catName) => (val) => {
        if (!CONFIG.elevationruler?.SPEED?.CATEGORIES)
            return;
        const c = CONFIG.elevationruler.SPEED.CATEGORIES.find(x => x.name === catName);
        if (c)
            c.color = Color.from(val);
    };

    game.settings.register(MODULE_ID, COLOR_STANDARD, {
        name: 'Speed Color: Standard',
        scope: 'client',
        type: String,
        default: '#1e88e5',
        config: false,
        onChange: refreshColor('lancer-automations.speed.standard')
    });
    game.settings.register(MODULE_ID, COLOR_BOOST, {
        name: 'Speed Color: Boost',
        scope: 'client',
        type: String,
        default: '#ffc107',
        config: false,
        onChange: refreshColor('lancer-automations.speed.boost')
    });
    game.settings.register(MODULE_ID, COLOR_OVER_BOOST, {
        name: 'Speed Color: Over-boost',
        scope: 'client',
        type: String,
        default: '#d81b60',
        config: false,
        onChange: refreshColor('lancer-automations.speed.over-boost')
    });
}

Hooks.once('init', () => {
    registerSettings();
    if (!isEnabled())
        return;

    if (conflictModuleActive()) {
        Hooks.once('ready', () => {
            ui.notifications.warn('lancer-automations: built-in speed provider is on but lancer-speed-provider is also active. Disable one of them.');
        });
        return;
    }

    if (game.modules.get('elevationruler')?.active)
        applyElevationRulerCategories();
});

Hooks.once('dragRuler.ready', (SpeedProvider) => {
    if (!isEnabled() || conflictModuleActive())
        return;

    class LancerAutoSpeedProvider extends SpeedProvider {
        get colors() {
            return [
                { id: 'standard', default: 0x1e88e5, name: 'Standard' },
                { id: 'boost', default: 0xffc107, name: 'Boost' },
                { id: 'over-boost', default: 0xd81b60, name: 'Over-boost' }
            ];
        }

        get defaultUnreachableColor() {
            return 0x000000;
        }

        getRanges(token) {
            const actor = token.actor;
            const speed = tokenSpeed(token);
            const boostBonus = getBoostLegBonus(actor);
            if (isStunned(token))
                return [{ range: -1, color: 'standard' }];

            const prone = hasActiveStatus(actor, 'prone');
            const startedStatuses = token.combatant
                ?.getFlag(MODULE_ID, 'speedProvider.turn-status') ?? [];
            const startedProne = startedStatuses.some(e => e.endsWith('prone'));
            const slowed = prone || hasActiveStatus(actor, 'slow');

            let range = speed;
            const ranges = [];
            if (prone || !startedProne) {
                ranges.push({ range, color: 'standard' });
                range += speed + boostBonus;
            }
            if (!slowed) {
                ranges.push({ range, color: 'boost' });
                range += speed + boostBonus;
            }
            if (!slowed && canOvercharge(actor)) {
                ranges.push({ range, color: 'over-boost' });
            }
            return ranges;
        }
    }

    /** @type {any} */ (globalThis).dragRuler.registerModule(MODULE_ID, LancerAutoSpeedProvider);
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
