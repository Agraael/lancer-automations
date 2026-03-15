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
        name: 'Token Action HUD [BETA]',
        hint: 'Show a cascading action HUD when a token is selected. This is a beta feature — expect rough edges.',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false,
        requiresReload: true,
        onChange: en => {
            if (!en)
                hud.unbind();
        },
    });
    game.settings.register(MODULE, 'tah.clickToOpen', {
        name: 'TAH: Click to Open',
        hint: 'Open HUD categories and sub-menus on click instead of hover. Takes effect on next HUD render.',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false,
    });
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

// ── Manual force-refresh (fired by lancer-automations flows and TAH lancer) ──

Hooks.on('forceUpdateTokenActionHud', () => {
    if (!enabled())
        return;
    if (hud._token)
        hud.refresh();
});
