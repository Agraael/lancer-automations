/* global Hooks, game, canvas, libWrapper, Token, document, CONST */

import { LancerHUD } from './hud.js';
import { playUiSound } from './sound.js';
import { forceHideStatHint } from './tokenStatHint.js';

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

const SETTING_ABOVE_SHEETS = 'tah.aboveActorSheets';

function _isAboveSheetsEnabled() {
    try {
        return !!game.settings.get(MODULE, SETTING_ABOVE_SHEETS);
    } catch {
        return true;
    }
}

function _updateTahZIndex() {
    const hudEl = document.getElementById('la-hud');
    if (!hudEl)
        return;
    if (!_isAboveSheetsEnabled()) {
        hudEl.style.zIndex = '';
        return;
    }
    let maxZ = 0;
    const sheetEls = Array.from(document.querySelectorAll('.window-app.sheet.actor, .application.sheet.actor'));
    for (const el of sheetEls) {
        const z = parseInt(/** @type {HTMLElement} */ (el).style.zIndex || '0');
        if (z > maxZ)
            maxZ = z;
    }
    hudEl.style.zIndex = maxZ > 0 ? String(maxZ + 1) : '';
}

let _zRescheduled = false;
function _scheduleTahZUpdate() {
    if (_zRescheduled)
        return;
    _zRescheduled = true;
    requestAnimationFrame(() => {
        _zRescheduled = false;
        _updateTahZIndex();
    });
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
    game.settings.register(MODULE, SETTING_ABOVE_SHEETS, {
        name: 'TAH Above Actor Sheets',
        hint: 'Keep the TAH on top of open actor sheets.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
        onChange: _scheduleTahZUpdate,
    });
    Hooks.on('renderActorSheet', _scheduleTahZUpdate);
    Hooks.on('renderActorSheetV2', _scheduleTahZUpdate);
    Hooks.on('closeActorSheet', _scheduleTahZUpdate);
    Hooks.on('closeActorSheetV2', _scheduleTahZUpdate);
    document.addEventListener('mousedown', _scheduleTahZUpdate, { capture: true });
    game.keybindings.register(MODULE, 'tah.toggleSearch', {
        name: 'TAH: Toggle Search',
        hint: 'Open or close the Token Action HUD search bar.',
        editable: [{ key: 'KeyF', modifiers: ['Alt'] }],
        onDown: () => {
            if (!enabled())
                return false;
            if (!hud.toggleSearch())
                return false;
            return true;
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
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
    game.settings.register(MODULE, 'tah.maxColumnItems', {
        name: 'Max items per column',
        hint: 'Cap category and sub-columns to this many rows; columns with more items become scrollable. 0 disables the cap. The top menu is never capped.',
        scope: 'client',
        config: false,
        type: Number,
        default: 0,
        range: { min: 0, max: 50, step: 1 },
    });
    game.settings.register(MODULE, 'tah.rangePreview', {
        name: 'Weapon Range Preview',
        hint: 'Show weapon range on the map when hovering items in the HUD. Requires Grid Aware Auras.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE, 'tah.showAidHandleInteractSqueeze', {
        name: 'Aid / Handle / Interact / Squeeze Actions',
        hint: 'Show these four basic actions in the Actions category.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE, 'tah.rangePreviewOnAttackCard', {
        name: 'Range Preview on Attack Card',
        hint: 'Pulse the attacker\'s weapon/tech range on the canvas when an attack card prints.',
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
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE, 'tah.tokenFeedbackVolume', {
        name: 'Token Feedback Volume',
        hint: 'Volume of canvas token feedback sounds (hover, select, target, drag, move, elevation key). Set to 0 to disable.',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE, 'tah.damageSoundVolume', {
        name: 'Damage / Stat Sound Volume',
        hint: 'Volume of damage, HP/heat/burn/overshield/infection feedback sounds. Set to 0 to disable.',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE, 'tah.actionFxVolume', {
        name: 'Action FX Volume',
        hint: 'Master multiplier for all action FX audio (skirmish, barrage, ram, ...). 0 = silent, 1 = full.',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });

    for (const v of ['hover', 'open', 'details', 'toggle', 'statusHover']) {
        game.settings.register(MODULE, `tah.uiSound.${v}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const v of ['tokenHover', 'tokenSelect', 'tokenDeselect', 'tokenTarget',
        'tokenUntarget', 'tokenDrag', 'tokenMove', 'elevationKey']) {
        game.settings.register(MODULE, `tah.tokenSound.${v}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const t of ['kinetic', 'energy', 'explosive', 'variable', 'heat', 'burn',
        'infection', 'armor', 'hit_overshield', 'overshield']) {
        game.settings.register(MODULE, `tah.damageSound.${t}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const e of ['hp_loss', 'hp_heal', 'heat_clean', 'stress_hit', 'stress_heal', 'miss', 'hit', 'crit', 'success', 'fail']) {
        game.settings.register(MODULE, `tah.statSound.${e}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const e of ['bonus']) {
        game.settings.register(MODULE, `tah.statusSfx.${e}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const a of ['skirmish', 'eject', 'selfDestruct', 'teleport', 'bootUp',
        'dismount', 'mount', 'disengage', 'deployable', 'freeAction', 'corePower',
        'protocol', 'reaction', 'fullAction', 'quickAction', 'standingUp',
        'prepare', 'interact', 'handle', 'fullTech', 'quickTech', 'invade',
        'grapple', 'ram', 'jockey', 'barrage', 'boost', 'overchargeNpc', 'hide',
        'shutDown', 'fall', 'fallImpact', 'search', 'scan', 'targetSuccess',
        'defaultThrow', 'targetFail', 'reload', 'fight']) {
        game.settings.register(MODULE, `tah.actionFxSound.${a}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
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
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    // Persistent aura colors + opacity
    game.settings.register(MODULE, 'tah.auraColorThreat', {
        name: 'Threat Aura Color',
        hint: 'Color of the Max Threat range aura.',
        scope: 'client',
        config: false,
        type: String,
        default: '#9514ff',
    });
    game.settings.register(MODULE, 'tah.auraColorSensor', {
        name: 'Sensor Aura Color',
        hint: 'Color of the Sensor range aura.',
        scope: 'client',
        config: false,
        type: String,
        default: '#549eff',
    });
    game.settings.register(MODULE, 'tah.auraColorRange', {
        name: 'Weapon Range Aura Color',
        hint: 'Color of the Weapon Range aura.',
        scope: 'client',
        config: false,
        type: String,
        default: '#ff0000',
    });
    game.settings.register(MODULE, 'tah.auraOpacityThreat', {
        name: 'Threat Aura Opacity',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    game.settings.register(MODULE, 'tah.auraOpacitySensor', {
        name: 'Sensor Aura Opacity',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    game.settings.register(MODULE, 'tah.auraOpacityRange', {
        name: 'Weapon Range Aura Opacity',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    // Default toggle mode per aura
    const auraDefaultChoices = { none: 'None', combat: 'In Combat', all: 'Always' };
    game.settings.register(MODULE, 'tah.auraDefaultThreat', {
        name: 'Threat Aura Default',
        hint: 'When to auto-enable the Threat aura.',
        scope: 'world',
        config: false,
        type: String,
        default: 'none',
        choices: auraDefaultChoices,
    });
    game.settings.register(MODULE, 'tah.auraDefaultSensor', {
        name: 'Sensor Aura Default',
        hint: 'When to auto-enable the Sensor aura.',
        scope: 'world',
        config: false,
        type: String,
        default: 'none',
        choices: auraDefaultChoices,
    });
    game.settings.register(MODULE, 'tah.auraDefaultRange', {
        name: 'Weapon Range Aura Default',
        hint: 'When to auto-enable the Weapon Range aura.',
        scope: 'world',
        config: false,
        type: String,
        default: 'none',
        choices: auraDefaultChoices,
    });
    game.settings.register(MODULE, 'tah.auraColorCustom', {
        name: 'Custom Measure Aura Color',
        hint: 'Color of the custom measure aura.',
        scope: 'client',
        config: false,
        type: String,
        default: '#ff8800',
    });
    game.settings.register(MODULE, 'tah.auraOpacityCustom', {
        name: 'Custom Measure Aura Opacity',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.1 },
    });
    game.settings.register(MODULE, 'tah.position', {
        scope: 'client',
        config: false,
        type: Object,
        default: null,
    });
    // Per-client macro shortcuts shown in the TAH "Macros" category.
    // Each entry: { macroId, name, icon }
    game.settings.register(MODULE, 'tah.macroList', {
        scope: 'client',
        config: false,
        type: Array,
        default: [],
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

Hooks.on('updateToken', (_doc, change, options) => {
    if (options?.teleport)
        return;
    if (change.x !== undefined || change.y !== undefined || change.elevation !== undefined)
        playUiSound('tokenMove');
});

Hooks.once('ready', () => {
    const actionIds = [
        'freeMovement', 'debugMovement'
    ];
    const getBoundKeys = () => {
        const set = new Set();
        const bindings = /** @type {any} */ (game.keybindings)?.bindings;
        if (!bindings?.get)
            return set;
        for (const id of actionIds) {
            const list = bindings.get(`lancer-automations.${id}`) ?? [];
            for (const b of list) {
                if (b?.key)
                    set.add(b.key);
            }
        }
        return set;
    };
    let boundKeys = getBoundKeys();
    Hooks.on('renderKeybindingsConfig', () => {
        boundKeys = getBoundKeys();
    });
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

// v13's MouseInteractionManager captures callbacks at construction; wrapping Token._onDragLeftMove never fires.
const _dragLastCell = new WeakMap();
Hooks.once('ready', () => {
    if (!game.modules.get('lib-wrapper')?.active)
        return;
    libWrapper.register('lancer-automations', 'MouseInteractionManager.prototype.callback', function (wrapped, action, event, ...args) {
        if (this.object instanceof foundry.canvas.placeables.Token) {
            if (action === 'dragLeftStart' || action === 'dragLeftMove') {
                forceHideStatHint();
            }
            if (action === 'dragLeftMove') {
                try {
                    const dest = event?.interactionData?.destination;
                    if (dest) {
                        const off = canvas.grid.getOffset(dest);
                        const key = `${off.i},${off.j}`;
                        const prev = _dragLastCell.get(this.object);
                        if (prev !== key) {
                            _dragLastCell.set(this.object, key);
                            if (prev !== undefined)
                                playUiSound('tokenDrag');
                        }
                    }
                } catch { /* ignore */ }
            }
        }
        return wrapped.call(this, action, event, ...args);
    }, 'WRAPPER');
});

let _pendingDeselect = null;
let _pendingSelectSound = false;
let _pendingHudUpdate = false;
Hooks.on('controlToken', (_token, controlled) => {
    if (controlled) {
        if (_pendingDeselect) {
            clearTimeout(_pendingDeselect);
            _pendingDeselect = null;
        }
        if (!_pendingSelectSound) {
            _pendingSelectSound = true;
            requestAnimationFrame(() => {
                _pendingSelectSound = false;
                playUiSound('tokenSelect');
            });
        }
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
    if (_pendingHudUpdate)
        return;
    _pendingHudUpdate = true;
    requestAnimationFrame(() => {
        _pendingHudUpdate = false;
        const all = /** @type {any[]} */ (canvas?.tokens?.controlled ?? []).filter(t =>
            ['mech', 'npc', 'pilot', 'deployable'].includes(t.actor?.type) && t.actor?.isOwner
        );
        if (all.length > 0)
            hud.bind(all);
        else
            hud.unbind();
    });
});

// ── Actor data changed (HP, heat, structure, action tracker…) ────────────────
// Update only the stats bar — sub-columns stay open.

Hooks.on('updateActor', (actor, change) => {
    if (!enabled())
        return;
    if (!isRelevantActor(actor.id))
        return;
    if (change?.flags?.['lancer-automations']?.lockedActions !== undefined)
        hud.scheduleRefresh();
    else
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

import { applyDefaultAuras, disableCombatAuras, updatePersistentAuraRadii, activateRangePreview, deactivateRangePreview, getAttackRange } from './hover.js';
import { getMaxItemRanges_WithBonus } from '../tools/misc-tools.js';
import { createPulsingRangeHighlight } from '../interactive/canvas.js';

Hooks.on('combatStart', (combat) => {
    for (const c of combat.combatants) {
        const tok = c.token ? canvas.tokens?.get(c.token.id) : null;
        if (tok)
            applyDefaultAuras(tok);
    }
});

Hooks.on('createCombatant', (combatant) => {
    if (!game.users.activeGM?.isSelf)
        return;
    const tok = combatant.token ? canvas.tokens?.get(combatant.token.id) : null;
    if (tok)
        applyDefaultAuras(tok);
});

Hooks.on('createToken', (tokenDoc) => {
    if (!game.users.activeGM?.isSelf)
        return;
    const tok = canvas.tokens?.get(tokenDoc.id);
    if (tok)
        applyDefaultAuras(tok);
});

Hooks.on('deleteCombat', (combat) => {
    if (!game.users.activeGM?.isSelf)
        return;
    for (const c of combat.combatants) {
        const tok = c.token ? canvas.tokens?.get(c.token.id) : null;
        if (tok)
            disableCombatAuras(tok);
    }
});

Hooks.on('deleteCombatant', (/** @type {any} */ combatant) => {
    if (!game.users.activeGM?.isSelf)
        return;
    const tok = combatant.token ? canvas.tokens?.get(combatant.token.id) : null;
    if (!tok)
        return;
    // if token is still in another active combat, leave auras alone
    let stillInCombat = false;
    for (const c of (game.combats?.contents ?? [])) {
        /** @type {any} */
        const combat = c;
        if (!combat.active)
            continue;
        if (combat.combatants?.some?.((/** @type {any} */ x) => x.token?.id === tok.id)) {
            stillInCombat = true;
            break;
        }
    }
    if (stillInCombat)
        return;
    disableCombatAuras(tok);
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

// ── Range preview during attack AccDiff HUD ───────────────────────────────────

const BASIC_MELEE_NAMES = new Set(['ram', 'ramming speed', 'grapple', 'improvised attack', 'pickup weapon', 'pick up weapon']);

function _getSensorRange(actor) {
    if (!actor)
        return 10;
    if (actor.type === 'pilot')
        return 5;
    return actor.system?.sensor_range ?? 10;
}

async function _computeAttackHudRange(state) {
    const actor = state.actor;
    const item = state.item;
    const actionName = (state.data?.action?.name ?? state.data?.title ?? '').toLowerCase().trim();

    if (item) {
        const ranges = await getMaxItemRanges_WithBonus(item, actor);
        const ALL = ['Range', 'Line', 'Cone', 'Blast', 'Burst', 'Threat', 'Thrown'];
        const max = Math.max(0, ...ALL.map(t => ranges[t] ?? 0));
        if (max > 0)
            return Math.max(1, max);
    }

    if (BASIC_MELEE_NAMES.has(actionName))
        return 1;

    const isTech = !!state.data?.invade
        || /invade|tech/i.test(state.data?.action?.activation ?? '')
        || /invade|tech/i.test(actionName);
    if (isTech)
        return _getSensorRange(actor);

    return null;
}

Hooks.once('ready', () => {
    const original = game.lancer?.flowSteps?.get?.('showAttackHUD');
    if (!original)
        return;
    game.lancer.flowSteps.set('showAttackHUD', async function(state, options) {
        let destroy = null;
        try {
            if (game.settings.get(MODULE, 'tah.rangePreviewOnAttackCard')) {
                const token = state.actor?.getActiveTokens?.()[0];
                if (token) {
                    const range = await _computeAttackHudRange(state);
                    if (range != null && range > 0) {
                        destroy = createPulsingRangeHighlight(token, range, { includeSelf: true });
                    }
                }
            }
            return await original(state, options);
        } finally {
            if (destroy)
                destroy();
        }
    });

    const origPrint = game.lancer?.flowSteps?.get?.('printActionUseCard');
    if (origPrint) {
        game.lancer.flowSteps.set('printActionUseCard', async function(state, options) {
            try {
                if (game.settings.get(MODULE, 'tah.rangePreviewOnAttackCard')) {
                    const actor = state.actor;
                    const actionName = state.data?.action?.name ?? state.data?.title ?? '';
                    const token = actor?.getActiveTokens?.()[0];
                    if (token && actionName) {
                        const range = await getAttackRange(actionName, actor, null);
                        if (range != null && range > 0) {
                            const destroy = createPulsingRangeHighlight(token, range, { includeSelf: true });
                            setTimeout(() => destroy(), 3500);
                        }
                    }
                }
            } catch (e) { /* non-fatal */ }
            return await origPrint(state, options);
        });
    }
});
