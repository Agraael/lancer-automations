/* global Hooks, game, canvas, libWrapper, Token, document, CONST */

import { LancerHUD } from './hud.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlags } from '../tools/flag-utils.js';
import { playUiSound, WAYPOINT_ADD_SOUND, WAYPOINT_REMOVE_SOUND } from './sound.js';
import { forceHideStatHint } from './tokenStatHint.js';
import { getSettingEnabled } from '../setup/settings-register.js';

import { MODULE_ID } from '../tools/constants.js';
const SETTING = 'tahEnabled';

const hud = new LancerHUD();
export { hud };

function enabled()
{
    return getSettingEnabled(SETTING);
}

/** True if actor is any bound token's actor OR its linked pilot. */
function isRelevantActor(actorId)
{
    if (hud._actor?.id === actorId)
        return true;
    return (hud._tokens ?? []).some(token =>
        token.actor?.id === actorId ||
        token.actor?.system?.pilot?.value?.id === actorId
    );
}

const SETTING_ABOVE_SHEETS = 'tah.aboveActorSheets';

function _isAboveSheetsEnabled()
{
    return !!getModuleSetting(SETTING_ABOVE_SHEETS, true);
}

function _updateTahZIndex()
{
    const hudEl = document.getElementById('la-hud');
    if (!hudEl)
        return;
    if (!_isAboveSheetsEnabled())
    {
        hudEl.style.zIndex = '';
        return;
    }
    let maxZ = 0;
    const sheetEls = Array.from(document.querySelectorAll('.window-app.sheet.actor, .application.sheet.actor'));
    for (const el of sheetEls)
    {
        const z = parseInt(/** @type {HTMLElement} */ (el).style.zIndex || '0');
        if (z > maxZ)
            maxZ = z;
    }
    hudEl.style.zIndex = maxZ > 0 ? String(maxZ + 1) : '';
}

let _zRescheduled = false;
function _scheduleTahZUpdate()
{
    if (_zRescheduled)
        return;
    _zRescheduled = true;
    requestAnimationFrame(() =>
    {
        _zRescheduled = false;
        _updateTahZIndex();
    });
}

Hooks.on('init', () =>
{
    game.settings.register(MODULE_ID, SETTING, {
        name: 'LA.settings.tahEnabled.name',
        hint: 'LA.settings.tahEnabled.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true,
        onChange: isEnabled =>
        {
            if (!isEnabled)
                hud.unbind();
        },
    });
    game.settings.register(MODULE_ID, SETTING_ABOVE_SHEETS, {
        name: 'LA.settings.tah.aboveActorSheets.name',
        hint: 'LA.settings.tah.aboveActorSheets.hint',
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
    game.keybindings.register(MODULE_ID, 'tah.toggleSearch', {
        name: 'LA.keybindings.tah.toggleSearch.name',
        hint: 'LA.keybindings.tah.toggleSearch.hint',
        editable: [{ key: 'KeyF', modifiers: ['Shift'] }],
        onDown: () =>
        {
            if (!enabled())
                return false;
            if (!hud.toggleSearch())
                return false;
            return true;
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register(MODULE_ID, 'tah.toggleFavorites', {
        name: 'LA.keybindings.tah.toggleFavorites.name',
        hint: 'LA.keybindings.tah.toggleFavorites.hint',
        editable: [{ key: 'KeyX', modifiers: ['Shift'] }],
        onDown: () =>
        {
            if (!enabled())
                return false;
            if (!hud.toggleFavorites())
                return false;
            return true;
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register(MODULE_ID, 'tah.toggleStatuses', {
        name: 'LA.keybindings.tah.toggleStatuses.name',
        hint: 'LA.keybindings.tah.toggleStatuses.hint',
        editable: [{ key: 'KeyZ', modifiers: ['Shift'] }],
        onDown: () =>
        {
            if (!enabled())
                return false;
            if (!hud.toggleStatuses())
                return false;
            return true;
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.settings.register(MODULE_ID, 'tah.clickToOpen', {
        name: 'LA.settings.tah.clickToOpen.name',
        hint: 'LA.settings.tah.clickToOpen.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, 'tah.narrativeMode', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
        onChange: () =>
        {
            const tokens = (canvas?.tokens?.controlled ?? []).filter(token =>
                ['mech', 'npc', 'pilot', 'deployable'].includes(token.actor?.type) && token.actor?.isOwner);
            if (tokens.length === 0)
            {
                if (getModuleSetting('tah.narrativeMode'))
                    hud.bindNarrative();
                else
                    hud.unbind();
            }
        },
    });
    game.settings.register(MODULE_ID, 'tah.narrativeLinkedActorUuid', {
        name: 'LA.settings.tah.narrativeLinkedActorUuid.name',
        scope: 'client',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register(MODULE_ID, 'tah.areaElevationAware', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, 'tah.hoverCloseDelay', {
        name: 'LA.settings.tah.hoverCloseDelay.name',
        hint: 'LA.settings.tah.hoverCloseDelay.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 0.5,
        range: { min: 0, max: 3, step: 0.5 },
    });
    game.settings.register(MODULE_ID, 'tah.keyboardNav', {
        name: 'LA.settings.tah.keyboardNav.name',
        hint: 'LA.settings.tah.keyboardNav.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, 'tah.keyboardNavResetDelay', {
        name: 'LA.settings.tah.keyboardNavResetDelay.name',
        hint: 'LA.settings.tah.keyboardNavResetDelay.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 5,
        range: { min: 1, max: 10, step: 0.5 },
    });
    game.settings.register(MODULE_ID, 'tah.preventWasdMovement', {
        name: 'LA.settings.tah.preventWasdMovement.name',
        hint: 'LA.settings.tah.preventWasdMovement.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, 'tah.maxColumnItems', {
        name: 'LA.settings.tah.maxColumnItems.name',
        hint: 'LA.settings.tah.maxColumnItems.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 0,
        range: { min: 0, max: 50, step: 1 },
    });
    game.settings.register(MODULE_ID, 'tah.wheelRadiusOffset', {
        name: 'LA.settings.tah.wheelRadiusOffset.name',
        hint: 'LA.settings.tah.wheelRadiusOffset.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 0,
        range: { min: -40, max: 120, step: 5 },
    });
    game.settings.register(MODULE_ID, 'tah.rangePreview', {
        name: 'LA.settings.tah.rangePreview.name',
        hint: 'LA.settings.tah.rangePreview.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, 'tah.uiScale', {
        name: 'LA.settings.tah.uiScale.name',
        hint: 'LA.settings.tah.uiScale.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0.6, max: 1.6, step: 0.05 },
        onChange: () => Hooks.callAll('forceUpdateTokenActionHud'),
    });
    game.settings.register(MODULE_ID, 'tah.statusFavorites', {
        scope: 'client',
        config: false,
        type: Array,
        default: [],
    });
    game.settings.register(MODULE_ID, 'tah.showAidHandleInteractSqueeze', {
        name: 'LA.settings.tah.showAidHandleInteractSqueeze.name',
        hint: 'LA.settings.tah.showAidHandleInteractSqueeze.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, 'tah.rangePreviewOnAttackCard', {
        name: 'LA.settings.tah.rangePreviewOnAttackCard.name',
        hint: 'LA.settings.tah.rangePreviewOnAttackCard.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, 'tah.uiSoundVolume', {
        name: 'LA.settings.tah.uiSoundVolume.name',
        hint: 'LA.settings.tah.uiSoundVolume.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE_ID, 'tah.tokenFeedbackVolume', {
        name: 'LA.settings.tah.tokenFeedbackVolume.name',
        hint: 'LA.settings.tah.tokenFeedbackVolume.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE_ID, 'tah.damageSoundVolume', {
        name: 'LA.settings.tah.damageSoundVolume.name',
        hint: 'LA.settings.tah.damageSoundVolume.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE_ID, 'tah.actionFxVolume', {
        name: 'LA.settings.tah.actionFxVolume.name',
        hint: 'LA.settings.tah.actionFxVolume.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE_ID, 'battleLogEnabled', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, 'tah.battleLogVolume', {
        name: 'LA.settings.tah.battleLogVolume.name',
        hint: 'LA.settings.tah.battleLogVolume.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1, step: 0.05 },
    });
    for (const soundKey of ['fadeIn', 'fadeOut', 'loopBackground', 'typingLoop', 'displayList', 'longResult', 'shortResult', 'resultImpact', 'resultImpactGood', 'resultImpactBad', 'logOpen', 'incomingTrans', 'confirm', 'denied', 'fail'])
    {
        game.settings.register(MODULE_ID, `tah.battleLog.${soundKey}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const key of ['themeDefault', 'themeVictory', 'themeDefeat', 'themePartial'])
    {
        game.settings.register(MODULE_ID, `tah.battleLog.${key}`, {
            scope: 'world', config: false, type: String, default: '',
        });
    }
    game.settings.register(MODULE_ID, 'tah.battleLog.themeVolume', {
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0.5, max: 2, step: 0.05 },
    });
    game.settings.register(MODULE_ID, 'tah.battleLog.themeLoop', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, 'tah.battleLog.themeStart', {
        scope: 'world',
        config: false,
        type: String,
        default: 'intro',
        choices: {
            intro: 'LA.settings.tah.battleLog.themeStart.choices.intro',
            result: 'LA.settings.tah.battleLog.themeStart.choices.result',
        },
    });
    game.settings.register(MODULE_ID, 'tah.telemetryFriendlyMechAsSquad', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, 'tah.disableAwards', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, 'tah.telemetryDebug', {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });

    for (const soundKey of ['hover', 'open', 'details', 'toggle', 'statusHover', 'battleLogHover', 'battleLogClick'])
    {
        game.settings.register(MODULE_ID, `tah.uiSound.${soundKey}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const soundKey of ['tokenHover', 'tokenSelect', 'tokenDeselect', 'tokenTarget',
        'tokenUntarget', 'tokenDrag', 'tokenMove', 'elevationKey', 'targeting', 'targetingConfirm'])
    {
        game.settings.register(MODULE_ID, `tah.tokenSound.${soundKey}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const damageType of ['kinetic', 'energy', 'explosive', 'variable', 'heat', 'burn',
        'infection', 'armor', 'hit_overshield', 'overshield'])
    {
        game.settings.register(MODULE_ID, `tah.damageSound.${damageType}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const statKey of ['hp_loss', 'hp_heal', 'heat_clean', 'stress_hit', 'stress_heal', 'xp_gain', 'xp_loss', 'miss', 'hit', 'crit', 'success', 'fail', 'generic_stat'])
    {
        game.settings.register(MODULE_ID, `tah.statSound.${statKey}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const sfxKey of ['bonus', 'status'])
    {
        game.settings.register(MODULE_ID, `tah.statusSfx.${sfxKey}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const actionKey of ['skirmish', 'eject', 'selfDestruct', 'teleport', 'bootUp',
        'dismount', 'mount', 'disengage', 'deployable', 'freeAction', 'corePower',
        'protocol', 'activation', 'reaction', 'fullAction', 'quickAction', 'standingUp',
        'prepare', 'interact', 'handle', 'fullTech', 'quickTech', 'invade',
        'grapple', 'ram', 'jockey', 'barrage', 'boost', 'overchargeNpc', 'hide',
        'shutDown', 'fall', 'fallImpact', 'search', 'scan', 'targetSuccess',
        'defaultThrow', 'targetFail', 'reload', 'fight', 'mineDetonation',
        'profile', 'mod', 'attack', 'damage', 'hase', 'skill'])
    {
        game.settings.register(MODULE_ID, `tah.actionFxSound.${actionKey}`, {
            scope: 'client', config: false, type: Boolean, default: true,
        });
    }
    for (const focusKey of ['activation', 'attack', 'damage', 'hase', 'skill', 'profile', 'mod', 'tech'])
    {
        game.settings.register(MODULE_ID, `autoFocusAction.${focusKey}`, {
            scope: 'client', config: false, type: Boolean, default: focusKey !== 'profile',
        });
    }
    game.settings.register(MODULE_ID, 'tah.showDisposition', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, 'tah.position', {
        scope: 'client',
        config: false,
        type: Object,
        default: null,
    });
    game.settings.register(MODULE_ID, 'tah.portrait.mode', {
        name: 'LA.settings.tah.portrait.mode.name',
        hint: 'LA.settings.tah.portrait.mode.hint',
        scope: 'client',
        config: false,
        type: String,
        choices: {
            off: 'LA.settings.tah.portrait.mode.choices.off',
            token: 'LA.settings.tah.portrait.mode.choices.token',
            actor: 'LA.settings.tah.portrait.mode.choices.actor',
        },
        default: 'off',
        onChange: () =>
        {
            game.settings.set(MODULE_ID, 'tah.position', null);
            Hooks.callAll('forceUpdateTokenActionHud');
        },
    });
    game.settings.register(MODULE_ID, 'tah.portrait.scope', {
        name: 'LA.settings.tah.portrait.scope.name',
        hint: 'LA.settings.tah.portrait.scope.hint',
        scope: 'client',
        config: false,
        type: String,
        choices: {
            mechPilot: 'LA.settings.tah.portrait.scope.choices.mechPilot',
            all: 'LA.settings.tah.portrait.scope.choices.all',
        },
        default: 'mechPilot',
        onChange: () => Hooks.callAll('forceUpdateTokenActionHud'),
    });
    game.settings.register(MODULE_ID, 'tah.portrait.mechUsePilot', {
        name: 'LA.settings.tah.portrait.mechUsePilot.name',
        hint: 'LA.settings.tah.portrait.mechUsePilot.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => Hooks.callAll('forceUpdateTokenActionHud'),
    });
    game.settings.register(MODULE_ID, 'tah.portrait.trim', {
        name: 'LA.settings.tah.portrait.trim.name',
        hint: 'LA.settings.tah.portrait.trim.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => Hooks.callAll('forceUpdateTokenActionHud'),
    });
    game.settings.register(MODULE_ID, 'tah.portrait.scale', {
        name: 'LA.settings.tah.portrait.scale.name',
        hint: 'LA.settings.tah.portrait.scale.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0.5, max: 2.5, step: 0.05 },
        onChange: () =>
        {
            game.settings.set(MODULE_ID, 'tah.position', null);
            Hooks.callAll('forceUpdateTokenActionHud');
        },
    });
    // Per-client macro shortcuts for the TAH "Macros" category: { macroId, name, icon }.
    game.settings.register(MODULE_ID, 'tah.macroList', {
        scope: 'client',
        config: false,
        type: Array,
        default: [],
    });
});

Hooks.on('hoverToken', (token, hovered) =>
{
    if (hovered && !token?.controlled)
        playUiSound('tokenHover');
});

Hooks.on('targetToken', (user, _token, targeted) =>
{
    if (user?.id !== game.userId)
        return;
    playUiSound(targeted ? 'tokenTarget' : 'tokenUntarget');
});

Hooks.on('updateToken', (_doc, change, options) =>
{
    if (options?.teleport)
        return;
    if (change.x !== undefined || change.y !== undefined || change.elevation !== undefined)
        playUiSound('tokenMove');
});

Hooks.once('ready', () =>
{
    const actionIds = [
        'freeMovement', 'debugMovement'
    ];
    const getBoundKeys = () =>
    {
        const set = new Set();
        const bindings = /** @type {any} */ (game.keybindings)?.bindings;
        if (!bindings?.get)
            return set;
        for (const id of actionIds)
        {
            const list = bindings.get(`lancer-automations.${id}`) ?? [];
            for (const binding of list)
            {
                if (binding?.key)
                    set.add(binding.key);
            }
        }
        return set;
    };
    let boundKeys = getBoundKeys();
    Hooks.on('renderKeybindingsConfig', () =>
    {
        boundKeys = getBoundKeys();
    });
    document.addEventListener('keydown', (ev) =>
    {
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

    // document-bubble: after tools' capture (already stopped), before Foundry's window-bubble movement.
    const WASD_QE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
    const ELEVATION_KEYS = new Set(['KeyQ', 'KeyE']);
    document.addEventListener('keydown', (ev) =>
    {
        if (!getModuleSetting('tah.preventWasdMovement'))
            return;
        if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey || ev.repeat)
            return;
        if (!WASD_QE.has(ev.code))
            return;
        // Let Q/E through mid-drag (token or template preview) so elevation adjustments still work.
        if (ELEVATION_KEYS.has(ev.code) && (_activeTokenDrags > 0 || (canvas.templates?.preview?.children?.length ?? 0) > 0))
            return;
        const tag = /** @type {any} */ (ev.target)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || /** @type {any} */ (ev.target)?.isContentEditable)
            return;
        ev.preventDefault();
        ev.stopPropagation();
    }, false);
});

// v13's MouseInteractionManager captures callbacks at construction; wrapping Token._onDragLeftMove never fires.
const _dragLastCell = new WeakMap();
let _activeTokenDrags = 0;
Hooks.once('ready', () =>
{
    if (!game.modules.get('lib-wrapper')?.active)
        return;
    libWrapper.register(MODULE_ID,'MouseInteractionManager.prototype.callback', function (wrapped, action, event, ...args)
    {
        if (this.object instanceof foundry.canvas.placeables.Token)
        {
            if (action === 'dragLeftStart')
            {
                _activeTokenDrags++;
                forceHideStatHint();
            }
            else if (action === 'dragLeftDrop' || action === 'dragLeftCancel')
            {
                if (_activeTokenDrags > 0)
                    _activeTokenDrags--;
            }
            if (action === 'dragLeftMove')
            {
                forceHideStatHint();
                try
                {
                    const dest = event?.interactionData?.destination;
                    if (dest)
                    {
                        const gridOffset = canvas.grid.getOffset(dest);
                        const key = `${gridOffset.i},${gridOffset.j}`;
                        const prev = _dragLastCell.get(this.object);
                        if (prev !== key)
                        {
                            _dragLastCell.set(this.object, key);
                            if (prev !== undefined)
                                playUiSound('tokenDrag');
                        }
                    }
                }
                catch
                { /* ignore */ }
            }
        }
        return wrapped.call(this, action, event, ...args);
    }, 'WRAPPER');

    // Waypoint feedback on token drag (F key / Ctrl+click add, right-click remove), matching the ruler.
    libWrapper.register(MODULE_ID,'foundry.canvas.placeables.Token.prototype._addDragWaypoint', function (wrapped, ...args)
    {
        const before = _sumDragWaypoints(this);
        const result = wrapped.call(this, ...args);
        if (_sumDragWaypoints(this) > before)
            playUiSound(WAYPOINT_ADD_SOUND);
        return result;
    }, 'WRAPPER');
    libWrapper.register(MODULE_ID,'foundry.canvas.placeables.Token.prototype._removeDragWaypoint', function (wrapped, ...args)
    {
        const before = _sumDragWaypoints(this);
        const result = wrapped.call(this, ...args);
        if (before > 0 && _sumDragWaypoints(this) < before)
            playUiSound(WAYPOINT_REMOVE_SOUND);
        return result;
    }, 'WRAPPER');
});

function _sumDragWaypoints(token)
{
    const contexts = token?.mouseInteractionManager?.interactionData?.contexts;
    if (!contexts)
        return 0;
    let total = 0;
    for (const context of Object.values(contexts))
        total += context?.waypoints?.length ?? 0;
    return total;
}

let _pendingDeselect = null;
let _pendingSelectSound = false;
let _pendingHudUpdate = false;
Hooks.on('controlToken', (_token, controlled) =>
{
    if (controlled)
    {
        if (_pendingDeselect)
        {
            clearTimeout(_pendingDeselect);
            _pendingDeselect = null;
        }
        if (!_pendingSelectSound)
        {
            _pendingSelectSound = true;
            requestAnimationFrame(() =>
            {
                _pendingSelectSound = false;
                playUiSound('tokenSelect');
            });
        }
    }
    else
    {
        if (_pendingDeselect)
            clearTimeout(_pendingDeselect);
        _pendingDeselect = setTimeout(() =>
        {
            _pendingDeselect = null;
            playUiSound('tokenDeselect');
        }, 50);
    }
    if (!enabled())
        return;
    if (_pendingHudUpdate)
        return;
    _pendingHudUpdate = true;
    requestAnimationFrame(() =>
    {
        _pendingHudUpdate = false;
        const ownedTokens = /** @type {any[]} */ (canvas?.tokens?.controlled ?? []).filter(token =>
            ['mech', 'npc', 'pilot', 'deployable'].includes(token.actor?.type) && token.actor?.isOwner
        );
        if (ownedTokens.length > 0)
            hud.bind(ownedTokens);
        else if (getModuleSetting('tah.narrativeMode'))
            hud.bindNarrative();
        else
            hud.unbind();
    });
});

Hooks.on('canvasReady', () =>
{
    if (!enabled())
        return;
    if ((canvas?.tokens?.controlled ?? []).length > 0)
        return;
    if (getModuleSetting('tah.narrativeMode'))
        hud.bindNarrative();
});

// Actor stat change: update the stats bar in place, leave sub-columns open.
Hooks.on('updateActor', (actor, change) =>
{
    if (!enabled())
        return;
    if (!isRelevantActor(actor.id))
        return;
    if (getLAFlags(change)?.lockedActions !== undefined)
        hud.scheduleRefresh();
    else if (change?.system?.core_energy !== undefined)
        hud.scheduleRefresh();
    else
        hud.updateStatsInPlace();
});

// Item change: full debounced refresh so availability indicators update.
Hooks.on('updateItem', (item) =>
{
    if (!enabled())
        return;
    if (isRelevantActor(item.parent?.id))
        hud.scheduleRefresh();
});

Hooks.on('createItem', (item) =>
{
    if (!enabled())
        return;
    if (isRelevantActor(item.parent?.id))
        hud.scheduleRefresh();
});

Hooks.on('deleteItem', (item) =>
{
    if (!enabled())
        return;
    if (isRelevantActor(item.parent?.id))
        hud.scheduleRefresh();
});

Hooks.on('createActiveEffect', (effect) =>
{
    if (!enabled())
        return;
    if (isRelevantActor(effect.parent?.id))
        hud.scheduleRefresh();
});

Hooks.on('deleteActiveEffect', (effect) =>
{
    if (!enabled())
        return;
    if (isRelevantActor(effect.parent?.id))
        hud.scheduleRefresh();
});

Hooks.on('updateToken', (tokenDoc) =>
{
    if (!enabled())
        return;
    if ((hud._tokens ?? []).some(token => token.id === tokenDoc.id))
    {
        hud.scheduleRefresh();
        hud.updateStatsInPlace();
    }
});

Hooks.on('updateCombat', () =>
{
    if (!enabled())
        return;
    if (hud._token)
        hud.scheduleRefresh(250);
});

Hooks.on('updateCombatant', (combatant) =>
{
    if (!enabled())
        return;
    if ((hud._tokens ?? []).some(token => token.document?.id === combatant.tokenId))
        hud._updateCombatBar?.();
    if (isRelevantActor(combatant.actorId))
        hud.scheduleRefresh();
});

// Action tracker change: in-place combat-bar update only.
Hooks.on('updateActor', (actor, change) =>
{
    if (!enabled())
        return;
    if (change.system?.action_tracker && isRelevantActor(actor.id))
        hud._updateCombatBar?.();
});

Hooks.on('createCombat', () =>
{
    if (!enabled())
        return;
    if (hud._token)
        hud.scheduleRefresh();
});

Hooks.on('deleteCombat', () =>
{
    if (!enabled())
        return;
    if (hud._token)
        hud.scheduleRefresh();
});

import { activateRangePreview, deactivateRangePreview, getAttackRange, getRangeGlowForAction, usesLineOfSight, FIXED_MELEE_ACTIONS } from './hover.js';
import { getMaxItemRanges_WithBonus, weaponPulseRange } from '../tools/misc-tools.js';
import { rangePulse, RANGE_PULSE_PRIORITY, RANGE_GLOW } from '../interactive/canvas.js';

// One-shot cleanup: strip legacy LA_* range-preview aura entries left by the old GAA-based system.
const _LA_LEGACY_AURA_IDS = new Set(['LA_max_Threat', 'LA_Sensor', 'LA_max_range', 'LA_custom_measure']);
const _LA_LEGACY_AURA_NAME_PREFIXES = ['LA_max_Threat', 'LA_Sensor', 'LA_max_range', 'LA_custom_measure'];
let _legacyAuraCleanupDone = false;
async function _cleanupLegacyLARangeAuras()
{
    if (_legacyAuraCleanupDone || !game.user?.isGM)
        return;
    _legacyAuraCleanupDone = true;
    const stripLegacy = (entries) => entries.filter(entry =>
    {
        const id = String(entry?.id ?? '');
        if (_LA_LEGACY_AURA_IDS.has(id))
            return false;
        const name = String(entry?.name ?? '');
        return !_LA_LEGACY_AURA_NAME_PREFIXES.some(prefix => name === prefix || name.startsWith(`${prefix}__t`));
    });
    for (const scene of game.scenes ?? [])
    {
        for (const tokenDoc of scene.tokens ?? [])
        {
            const auras = tokenDoc.getFlag('grid-aware-auras', 'auras');
            if (!Array.isArray(auras) || !auras.length)
                continue;
            const kept = stripLegacy(auras);
            if (kept.length !== auras.length)
            {
                try
                {
                    await tokenDoc.setFlag('grid-aware-auras', 'auras', kept);
                }
                catch (err)
                {
                    console.warn('lancer-automations | legacy aura strip (scene token) failed:', err);
                }
            }
        }
    }
    for (const actor of game.actors ?? [])
    {
        const proto = actor.prototypeToken;
        const auras = proto?.getFlag?.('grid-aware-auras', 'auras');
        if (!Array.isArray(auras) || !auras.length)
            continue;
        const kept = stripLegacy(auras);
        if (kept.length !== auras.length)
        {
            try
            {
                await proto.setFlag('grid-aware-auras', 'auras', kept);
            }
            catch (err)
            {
                console.warn('lancer-automations | legacy aura strip (prototype) failed:', err);
            }
        }
    }
}
Hooks.on('canvasReady', () =>
{
    _cleanupLegacyLARangeAuras();
});

Hooks.on('forceUpdateTokenActionHud', () =>
{
    if (!enabled())
        return;
    if (hud._token || hud._narrativeMode)
        hud.refresh();
});

// Knob-only repaint: a full refresh would close/reopen the columns (and is suppressed mid-toggle anyway).
Hooks.on('lancer-automations.advancedMeasureStateChange', () =>
{
    if (!enabled())
        return;
    if (hud?._token)
        hud.syncToggleCells();
});

const BASIC_MELEE_NAMES = new Set(['ram', 'ramming speed', 'grapple', 'improvised attack', 'pickup weapon', 'pick up weapon']);

function _getSensorRange(actor)
{
    if (!actor)
        return 10;
    if (actor.type === 'pilot')
        return 5;
    return actor.system?.sensor_range ?? 10;
}

async function _computeAttackHudRange(state)
{
    const actor = state.actor;
    const item = state.item;
    const actionName = (state.data?.action?.name ?? state.data?.title ?? '').toLowerCase().trim();

    if (item)
    {
        const ranges = await getMaxItemRanges_WithBonus(item, actor);
        // throw-aware (unlike the TAH hover preview which shows the max)
        const throwDist = ranges['Thrown'] ?? 0;
        if (state.data?.acc_diff?.weapon?.thrown && throwDist > 0)
            return Math.max(1, throwDist);
        const shape = Math.max(0, ranges['Blast'] ?? 0, ranges['Cone'] ?? 0, ranges['Line'] ?? 0, ranges['Burst'] ?? 0);
        // Range/Threat switch (accdiff button): follow the chosen mode when both exist and differ.
        const rangeVal = ranges['Range'] ?? 0;
        const threatVal = ranges['Threat'] ?? 0;
        if (rangeVal > 0 && threatVal > 0 && rangeVal !== threatVal)
            return Math.max(1, (state.__laUseThreat ? threatVal : rangeVal) + shape);
        const max = weaponPulseRange(ranges);
        if (max > 0)
            return Math.max(1, max);
    }

    if (BASIC_MELEE_NAMES.has(actionName))
        return 1;

    if (_isTechAttackState(state, actionName))
        return _getSensorRange(actor);

    return null;
}

function _isTechAttackState(state, actionName)
{
    return state.item?.system?.tech_attack === true
        || !!state.data?.invade
        || /invade|tech/i.test(state.data?.action?.activation ?? '')
        || /invade|tech/i.test(actionName);
}

function _computeAttackHudGlow(state)
{
    const actionName = (state.data?.action?.name ?? state.data?.title ?? '').toLowerCase().trim();
    if (_isTechAttackState(state, actionName))
        return RANGE_GLOW.sensor;
    if (state.item || BASIC_MELEE_NAMES.has(actionName))
        return RANGE_GLOW.weapon;
    return RANGE_GLOW.manual;
}

Hooks.once('ready', () =>
{
    const original = game.lancer?.flowSteps?.get?.('showAttackHUD');
    if (!original)
        return;
    game.lancer.flowSteps.set('showAttackHUD', async function(state, options)
    {
        let poll = null;
        const token = getModuleSetting('tah.rangePreviewOnAttackCard')
            ? state.actor?.getActiveTokens?.()[0]
            : null;
        const redraw = async () =>
        {
            const range = await _computeAttackHudRange(state);
            if (range != null && range > 0)
                rangePulse.setRange('tah-attack-card', { token, range, includeSelf: true, priority: RANGE_PULSE_PRIORITY.ATTACK_CARD, glowColor: _computeAttackHudGlow(state), los: state.__laLosPulse !== false && usesLineOfSight(null, state.item ?? null, null) });
            else
                rangePulse.clear('tah-attack-card');
        };
        const onRangeMode = (changedState) =>
        {
            if (changedState === state)
                redraw();
        };
        try
        {
            if (token)
            {
                await redraw();
                Hooks.on('lancer-automations.attackRangeMode', onRangeMode);
                let lastThrown = !!state.data?.acc_diff?.weapon?.thrown;
                poll = setInterval(() =>
                {
                    const isThrown = !!state.data?.acc_diff?.weapon?.thrown;
                    if (isThrown !== lastThrown)
                    {
                        lastThrown = isThrown;
                        redraw();
                    }
                }, 200);
            }
            return await original(state, options);
        }
        finally
        {
            Hooks.off('lancer-automations.attackRangeMode', onRangeMode);
            if (poll)
                clearInterval(poll);
            rangePulse.clear('tah-attack-card');
        }
    });

    const origPrint = game.lancer?.flowSteps?.get?.('printActionUseCard');
    if (origPrint)
    {
        game.lancer.flowSteps.set('printActionUseCard', async function(state, options)
        {
            try
            {
                if (getModuleSetting('tah.rangePreviewOnAttackCard'))
                {
                    const actor = state.actor;
                    const actionName = state.data?.action?.name ?? state.data?.title ?? '';
                    const token = actor?.getActiveTokens?.()[0];
                    if (token && actionName && !FIXED_MELEE_ACTIONS.has(actionName.toLowerCase().trim()))
                    {
                        const range = await getAttackRange(actionName, actor, null);
                        if (range != null && range > 0)
                        {
                            rangePulse.setRange('tah-action-card-print', { token, range, includeSelf: true, priority: RANGE_PULSE_PRIORITY.ATTACK_CARD, glowColor: getRangeGlowForAction(null, actionName, null) });
                            setTimeout(() => rangePulse.clear('tah-action-card-print'), 3500);
                        }
                    }
                }
            }
            catch (err)
            { /* non-fatal */ }
            return await origPrint(state, options);
        });
    }
});
