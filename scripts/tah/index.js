/* global Hooks, game, canvas, libWrapper, Token, document */

import { LancerHUD } from './hud.js';
import { playUiSound } from './sound.js';

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
        name: 'Weapon Range Preview',
        hint: 'Show weapon range on the map when hovering items in the HUD. Requires Grid Aware Auras.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE, 'tah.uiSoundVolume', {
        name: 'UI Sound Volume',
        hint: 'Volume of TAH hover/click sounds. Set to 0 to disable.',
        scope: 'client',
        config: false,
        type: Number,
        default: 0,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE, 'tah.tokenFeedbackVolume', {
        name: 'Token Feedback Volume',
        hint: 'Volume of canvas token feedback sounds (hover, select, target, drag, move, elevation key). Set to 0 to disable.',
        scope: 'client',
        config: false,
        type: Number,
        default: 0,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE, 'tah.damageSoundVolume', {
        name: 'Damage / Stat Sound Volume',
        hint: 'Volume of damage, HP/heat/burn/overshield/infection feedback sounds. Set to 0 to disable.',
        scope: 'client',
        config: false,
        type: Number,
        default: 0,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE, 'tah.auraUseAltKey', {
        name: 'Aura: THT Ruler on Alt Press & Targeted',
        hint: "Show Terrain Height Tools rulers on auras only while Alt is held and tokens are targeted. Requires the grid-aware-auras fork (see lancer-automations README).",
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE, 'tah.showDisposition', {
        name: 'Show Team / Disposition Indicator',
        hint: 'Colored stripe on the title bar. Shows team name if Token Factions advanced teams is active, otherwise shows disposition.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    // Persistent aura colors + opacity
    game.settings.register(MODULE, 'tah.auraColorThreat', {
        name: 'Threat Aura Color',
        hint: 'Color of the Max Threat range aura.',
        scope: 'client', config: false, type: String, default: '#9514ff',
    });
    game.settings.register(MODULE, 'tah.auraColorSensor', {
        name: 'Sensor Aura Color',
        hint: 'Color of the Sensor range aura.',
        scope: 'client', config: false, type: String, default: '#549eff',
    });
    game.settings.register(MODULE, 'tah.auraColorRange', {
        name: 'Weapon Range Aura Color',
        hint: 'Color of the Weapon Range aura.',
        scope: 'client', config: false, type: String, default: '#ff0000',
    });
    game.settings.register(MODULE, 'tah.auraOpacityThreat', {
        name: 'Threat Aura Opacity',
        scope: 'client', config: false, type: Number, default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    game.settings.register(MODULE, 'tah.auraOpacitySensor', {
        name: 'Sensor Aura Opacity',
        scope: 'client', config: false, type: Number, default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    game.settings.register(MODULE, 'tah.auraOpacityRange', {
        name: 'Weapon Range Aura Opacity',
        scope: 'client', config: false, type: Number, default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    // Default toggle mode per aura
    const auraDefaultChoices = { none: 'None', combat: 'In Combat', all: 'Always' };
    game.settings.register(MODULE, 'tah.auraDefaultThreat', {
        name: 'Threat Aura Default',
        hint: 'When to auto-enable the Threat aura.',
        scope: 'client', config: false, type: String, default: 'none',
        choices: auraDefaultChoices,
    });
    game.settings.register(MODULE, 'tah.auraDefaultSensor', {
        name: 'Sensor Aura Default',
        hint: 'When to auto-enable the Sensor aura.',
        scope: 'client', config: false, type: String, default: 'none',
        choices: auraDefaultChoices,
    });
    game.settings.register(MODULE, 'tah.auraDefaultRange', {
        name: 'Weapon Range Aura Default',
        hint: 'When to auto-enable the Weapon Range aura.',
        scope: 'client', config: false, type: String, default: 'none',
        choices: auraDefaultChoices,
    });
    game.settings.register(MODULE, 'tah.auraColorCustom', {
        name: 'Custom Measure Aura Color',
        hint: 'Color of the custom measure aura.',
        scope: 'client', config: false, type: String, default: '#ff8800',
    });
    game.settings.register(MODULE, 'tah.auraOpacityCustom', {
        name: 'Custom Measure Aura Opacity',
        scope: 'client', config: false, type: Number, default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    game.settings.register(MODULE, 'tah.position', {
        scope: 'client',
        config: false,
        type: Object,
        default: null,
    });
});

// ── Token selection ──────────────────────────────────────────────────────────

Hooks.on('hoverToken', (token, hovered) => {
    if (hovered && !token?.controlled)
        playUiSound('tokenHover');
});

Hooks.on('targetToken', (_user, _token, targeted) => {
    playUiSound(targeted ? 'tokenTarget' : 'tokenUntarget');
});

Hooks.on('updateToken', (_doc, change) => {
    if (change.x !== undefined || change.y !== undefined || change.elevation !== undefined)
        playUiSound('tokenMove');
});

Hooks.once('ready', () => {
    if (!game.modules.get('elevationruler')?.active)
        return;
    const actionIds = [
        'incrementElevation', 'decrementElevation',
        'addWaypoint', 'removeWaypoint',
        'addWaypointTokenRuler', 'removeWaypointTokenRuler',
        'togglePathfinding', 'forceToGround', 'teleport',
        'freeMovement', 'debugMovement'
    ];
    const getBoundKeys = () => {
        const set = new Set();
        const bindings = /** @type {any} */ (game.keybindings)?.bindings;
        if (!bindings?.get)
            return set;
        for (const id of actionIds) {
            const list = bindings.get(`elevationruler.${id}`) ?? [];
            for (const b of list) {
                if (b?.key)
                    set.add(b.key);
            }
        }
        return set;
    };
    let boundKeys = getBoundKeys();
    Hooks.on('renderKeybindingsConfig', () => { boundKeys = getBoundKeys(); });
    document.addEventListener('keydown', (ev) => {
        if (ev.repeat)
            return;
        if (!boundKeys.has(ev.code))
            return;
        const tag = /** @type {any} */ (ev.target)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || /** @type {any} */ (ev.target)?.isContentEditable)
            return;
        const ruler = /** @type {any} */ (canvas?.controls?.ruler);
        if (!ruler?.active)
            return;
        playUiSound('elevationKey');
    });
});

// Per-grid-cell drag tick: uses libWrapper on _onDragLeftMove so we get every
// mousemove during drag, then deduplicates by the preview clone's grid offset.
const _dragLastCell = new WeakMap();
Hooks.once('ready', () => {
    if (!game.modules.get('lib-wrapper')?.active)
        return;
    libWrapper.register('lancer-automations', 'Token.prototype._onDragLeftMove', function (wrapped, event) {
        const result = wrapped.call(this, event);
        try {
            const clones = event?.interactionData?.clones ?? [];
            const gridSize = canvas.grid.size;
            for (const clone of clones) {
                const doc = clone.document;
                const cx = doc.x + (doc.width * gridSize / 2);
                const cy = doc.y + (doc.height * gridSize / 2);
                const off = canvas.grid.getOffset({ x: cx, y: cy });
                const key = `${off.i},${off.j}`;
                const prev = _dragLastCell.get(clone);
                if (prev !== key) {
                    _dragLastCell.set(clone, key);
                    if (prev !== undefined)
                        playUiSound('tokenDrag');
                }
            }
        } catch { /* ignore */ }
        return result;
    }, 'WRAPPER');
});

let _pendingDeselect = null;
Hooks.on('controlToken', (_token, controlled) => {
    if (controlled) {
        if (_pendingDeselect) {
            clearTimeout(_pendingDeselect);
            _pendingDeselect = null;
        }
        playUiSound('tokenSelect');
    } else {
        if (_pendingDeselect)
            clearTimeout(_pendingDeselect);
        _pendingDeselect = setTimeout(() => {
            _pendingDeselect = null;
            playUiSound('tokenDeselect');
        }, 50);
    }
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
    if ((hud._tokens ?? []).some(t => t.document?.id === combatant.tokenId)) {
        hud._updateCombatBar?.();
    }
    if (isRelevantActor(combatant.actorId))
        hud.scheduleRefresh();
});

// ── Action tracker changes (combat bar in-place update) ─────────────────

Hooks.on('updateActor', (actor, change) => {
    if (!enabled())
        return;
    if (change.system?.action_tracker && isRelevantActor(actor.id)) {
        hud._updateCombatBar?.();
    }
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

Hooks.on('createToken', (tokenDoc) => {
    const tok = canvas.tokens?.get(tokenDoc.id);
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
