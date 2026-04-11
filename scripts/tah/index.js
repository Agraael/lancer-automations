/* global Hooks, game */

import { LancerHUD } from './hud.js';

const MODULE = 'lancer-automations';
const SETTING = 'tahEnabled';

const hud = new LancerHUD();

function enabled() {
    return game.settings.get(MODULE, SETTING);
}

/** True if actor is any bound token's actor OR its linked pilot. */
function isRelevantActor(actorId) {
    return (hud._tokens ?? []).some(t =>
        t.actor?.id === actorId ||
        t.actor?.system?.pilot?.value?.id === actorId
    );
}

Hooks.on('init', () => {
    game.settings.register(MODULE, SETTING, {
        name: 'Token Action HUD',
        hint: 'Show a cascading action HUD when a token is selected. Requires reload.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true,
        onChange: en => {
            if (!en)
                hud.unbind();
        },
    });
    game.settings.register(MODULE, 'tah.clickToOpen', {
        name: 'Click to Open',
        hint: 'Open categories on click instead of hover.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE, 'tah.hoverCloseDelay', {
        name: 'Hover Close Delay (seconds)',
        hint: 'How long the HUD stays open after the mouse leaves.',
        scope: 'client',
        config: false,
        type: Number,
        default: 0.5,
        range: { min: 0, max: 3, step: 0.5 },
    });
    game.settings.register(MODULE, 'tah.rangePreview', {
        name: 'TAH: Weapon Range Preview',
        hint: 'Show weapon range on the map when hovering items in the HUD. Requires Grid Aware Auras.',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true,
    });
    // Persistent aura colors + opacity
    game.settings.register(MODULE, 'tah.auraColorThreat', {
        name: 'Threat Aura Color',
        hint: 'Color of the Max Threat range aura.',
        scope: 'client', config: true, type: String, default: '#9514ff',
    });
    game.settings.register(MODULE, 'tah.auraColorSensor', {
        name: 'Sensor Aura Color',
        hint: 'Color of the Sensor range aura.',
        scope: 'client', config: true, type: String, default: '#549eff',
    });
    game.settings.register(MODULE, 'tah.auraColorRange', {
        name: 'Max Range Aura Color',
        hint: 'Color of the Max Range aura.',
        scope: 'client', config: true, type: String, default: '#ff7b00',
    });
    game.settings.register(MODULE, 'tah.auraOpacityThreat', {
        name: 'Threat Aura Opacity',
        scope: 'client', config: true, type: Number, default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    game.settings.register(MODULE, 'tah.auraOpacitySensor', {
        name: 'Sensor Aura Opacity',
        scope: 'client', config: true, type: Number, default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    game.settings.register(MODULE, 'tah.auraOpacityRange', {
        name: 'Max Range Aura Opacity',
        scope: 'client', config: true, type: Number, default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    // Default toggle mode per aura
    const auraDefaultChoices = { none: 'None', combat: 'In Combat', all: 'Always' };
    game.settings.register(MODULE, 'tah.auraDefaultThreat', {
        name: 'Threat Aura Default',
        hint: 'When to auto-enable the Threat aura.',
        scope: 'client', config: true, type: String, default: 'none',
        choices: auraDefaultChoices,
    });
    game.settings.register(MODULE, 'tah.auraDefaultSensor', {
        name: 'Sensor Aura Default',
        hint: 'When to auto-enable the Sensor aura.',
        scope: 'client', config: true, type: String, default: 'none',
        choices: auraDefaultChoices,
    });
    game.settings.register(MODULE, 'tah.auraDefaultRange', {
        name: 'Max Range Aura Default',
        hint: 'When to auto-enable the Max Range aura.',
        scope: 'client', config: true, type: String, default: 'none',
        choices: auraDefaultChoices,
    });
    game.settings.register(MODULE, 'tah.position', {
        scope: 'client',
        config: false,
        type: Object,
        default: null,
    });
});

// ── Reset TAH position button in settings ────────────────────────────────────
Hooks.on('renderSettingsConfig', (app, html) => {
    const tahField = html.find(`[name="${MODULE}.tah.hoverCloseDelay"]`).closest('.form-group');
    if (!tahField.length) return;
    const btn = $(`<button type="button" style="margin-top:4px;"><i class="fas fa-undo"></i> Reset TAH Position</button>`);
    btn.on('click', async (ev) => {
        ev.preventDefault();
        await game.settings.set(MODULE, 'tah.position', null);
        ui.notifications.info('TAH position reset to default. Re-select a token to see the change.');
    });
    tahField.after($('<div class="form-group"></div>').append(btn));
});

// ── Token selection ──────────────────────────────────────────────────────────

Hooks.on('controlToken', () => {
    if (!enabled())
        return;
    const all = /** @type {any[]} */ (canvas?.tokens?.controlled ?? []).filter(t =>
        ['mech', 'npc', 'pilot', 'deployable'].includes(t.actor?.type) && t.actor?.isOwner
    );
    if (all.length > 0)
        hud.bind(all);
    else
        hud.unbind();
});

// ── Actor data changed (HP, heat, structure, action tracker…) ────────────────
// Update only the stats bar — sub-columns stay open.

Hooks.on('updateActor', (actor) => {
    if (!enabled())
        return;
    if (isRelevantActor(actor.id))
        hud.updateStatsInPlace();
});

// ── Item changed (loaded, charged, limited uses, talent counters…) ───────────
// Full debounced refresh so availability indicators update.

Hooks.on('updateItem', (item) => {
    if (!enabled())
        return;
    if (isRelevantActor(item.parent?.id))
        hud.scheduleRefresh();
});

Hooks.on('createItem', (item) => {
    if (!enabled())
        return;
    if (isRelevantActor(item.parent?.id))
        hud.scheduleRefresh();
});

Hooks.on('deleteItem', (item) => {
    if (!enabled())
        return;
    if (isRelevantActor(item.parent?.id))
        hud.scheduleRefresh();
});

// ── Active effects (conditions) ──────────────────────────────────────────────

Hooks.on('createActiveEffect', (effect) => {
    if (!enabled())
        return;
    if (isRelevantActor(effect.parent?.id))
        hud.scheduleRefresh();
});

Hooks.on('deleteActiveEffect', (effect) => {
    if (!enabled())
        return;
    if (isRelevantActor(effect.parent?.id))
        hud.scheduleRefresh();
});

// ── Token updated (name, disposition…) ──────────────────────────────────────

Hooks.on('updateToken', (tokenDoc) => {
    if (!enabled())
        return;
    if ((hud._tokens ?? []).some(t => t.id === tokenDoc.id)) {
        hud.scheduleRefresh();
        hud.updateStatsInPlace();
    }
});

// ── Combat (turn/round advance resets action tracker) ────────────────────────

Hooks.on('updateCombat', () => {
    if (!enabled())
        return;
    if (hud._token)
        hud.scheduleRefresh(250);
});

Hooks.on('updateCombatant', (combatant) => {
    if (!enabled())
        return;
    if (isRelevantActor(combatant.actorId))
        hud.scheduleRefresh();
});

Hooks.on('createCombat', () => {
    if (!enabled())
        return;
    if (hud._token)
        hud.scheduleRefresh();
});

Hooks.on('deleteCombat', () => {
    if (!enabled())
        return;
    if (hud._token)
        hud.scheduleRefresh();
});

// ── Persistent range auras — combat auto-toggle + data refresh ─────────────

import { applyDefaultAuras, disableCombatAuras, updatePersistentAuraRadii } from './hover.js';

Hooks.on('combatStart', (combat) => {
    for (const c of combat.combatants) {
        const tok = c.token ? canvas.tokens?.get(c.token.id) : null;
        if (tok) applyDefaultAuras(tok);
    }
});

Hooks.on('createCombatant', (combatant) => {
    const tok = combatant.token ? canvas.tokens?.get(combatant.token.id) : null;
    if (tok) applyDefaultAuras(tok);
});

Hooks.on('deleteCombat', (combat) => {
    for (const c of combat.combatants) {
        const tok = c.token ? canvas.tokens?.get(c.token.id) : null;
        if (tok) disableCombatAuras(tok);
    }
});

Hooks.on('updateActor', (actor) => {
    for (const tok of actor.getActiveTokens()) {
        updatePersistentAuraRadii(tok);
    }
});

// ── Manual force-refresh (fired by lancer-automations flows and TAH lancer) ──

Hooks.on('forceUpdateTokenActionHud', () => {
    if (!enabled())
        return;
    if (hud._token)
        hud.refresh();
});
