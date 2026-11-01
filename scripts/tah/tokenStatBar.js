// Custom multi-bar hub drawn under Lancer tokens + resource grid in token HUD.
// Replaces vanilla bar1/bar2 for mech/npc/deployable actors. Disabled by default.

import {
    isLancerActor as isLancerCombatant,
    resolvePilot,
} from '../utils/lancer-token.js';
import { isExecutorGM } from '../tools/misc-tools.js';
import * as altFlags from '../integrations/alt-sheets-flags.js';

import {
    MODULE_ID,
    SETTING_ENABLED, SETTING_DEFAULT_HIDDEN, SETTING_DEFAULT_COMBAT_ONLY, SETTING_DEFAULT_ALWAYS_SHOW, SETTING_DEFAULT_ROW_HEIGHT,
    SETTING_VIS_OUT_OF_COMBAT, SETTING_VIS_IN_COMBAT, SETTING_FLASH_FOLLOWS_VIS, SETTING_EFFECT_ICON_SCALE, SETTING_MIN_ZOOM_SCALE, SETTING_ELEVATION_BADGE_SCALE,
    SETTING_DEFAULT_PILOT_STRESS, SETTING_SHOW_VALUES, SETTING_TOKEN_WIDTH, SETTING_AUTO_INJECT_TALENTS, SETTING_AUTO_INJECT_BOND_XP,
    SETTING_AUTO_INJECT_TALENT_COLOR, SETTING_AUTO_INJECT_TALENT_WIDTH, SETTING_AUTO_INJECT_TALENT_FEEDBACK,
    SETTING_AUTO_INJECT_CUSTOM_FLAGS,
    VIS_OWNER, VIS_SCANNED,
    ISO_SETTING_RETICLE, ISO_SETTING_HITZONE,
    FLAG_HIDDEN, FLAG_COMBAT_ONLY, FLAG_ROW_HEIGHT, FLAG_VIS_OUT_OF_COMBAT, FLAG_VIS_IN_COMBAT,
    FLAG_EXTRAS,
} from './statbar/config.js';

import {
    isAltHeld, setAltHeld,
    _lastValues, _overlayHubs,
    getHubOverlay, resetHubOverlay,
    setOriginalDrawBars,
} from './statbar/state.js';
import { isEnabled, _getIsoState, getWorldSetting, statBarCombatOnly, statBarAlwaysShown, shouldShowBars } from './statbar/rules.js';
import { _autoInjectCounters, _onCustomFlagsChanged } from './statbar/extras.js';
import { snapshotValues } from './statbar/model.js';
import { renderConfigHandler } from './statbar/token-config-tab.js';
import { injectLancerHud } from './statbar/token-hud-inputs.js';
import { refreshVisibleLancerTokens, fadeBars, scheduleFlashFade, flashChangedExtras, animateActorChanges } from './statbar/animations.js';
import { _elevationBadgeGrowth, _placeElevationBadge, drawElevationBadge } from './statbar/elevation-badge.js';
import { _removeOverlayHub, _syncHubPosition, drawStatHub } from './statbar/render.js';
export { isStatBarActive, statBarAccess, belowBarsY } from './statbar/rules.js';
export { getStatHubModel } from './statbar/model.js';
export { _resolveExtraBarValues, _defaultExtraBar, reinjectAutoBarsForActor, reinjectAutoBarsOnAllTokens, updateExtraBarValue, addExtraBar, removeExtraBar, getExtraBars, ExtraBarsAPI } from './statbar/extras.js';

import { getModuleSetting } from "../tools/settings-utils.js";
import { localize, localizeFormat } from "../tools/string-utils.js";

export { FLAG_EXTRAS };

// Settings registration

function redrawAllBars()
{
    if (!isEnabled() || !canvas?.tokens)
        return;
    for (const tok of canvas.tokens.placeables)
    {
        if (!isLancerCombatant(tok.actor))
            continue;
        try
        {
            tok.drawBars();
        }
        catch
        { /* ignore */ }
    }
}

export function registerTokenStatBarSettings()
{
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true,
    });
    game.settings.register(MODULE_ID, SETTING_DEFAULT_HIDDEN, {
        scope: 'world', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, SETTING_DEFAULT_COMBAT_ONLY, {
        scope: 'world', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, SETTING_DEFAULT_ALWAYS_SHOW, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => refreshVisibleLancerTokens(),
    });
    game.settings.register(MODULE_ID, SETTING_DEFAULT_ROW_HEIGHT, {
        scope: 'world', config: false, type: Number, default: 0,
    });
    game.settings.register(MODULE_ID, SETTING_DEFAULT_PILOT_STRESS, {
        scope: 'world', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_CUSTOM_FLAGS, {
        scope: 'world', config: false, type: Boolean, default: true,
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_BOND_XP, {
        scope: 'world', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, SETTING_SHOW_VALUES, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: redrawAllBars,
    });
    for (const [actorType, key] of Object.entries(SETTING_TOKEN_WIDTH))
    {
        game.settings.register(MODULE_ID, key, {
            scope: 'world',
            config: false,
            type: Boolean,
            default: actorType === 'deployable',
            onChange: redrawAllBars,
        });
    }
    game.settings.register(MODULE_ID, SETTING_VIS_OUT_OF_COMBAT, {
        scope: 'world', config: false, type: String, default: VIS_OWNER,
    });
    game.settings.register(MODULE_ID, SETTING_VIS_IN_COMBAT, {
        scope: 'world', config: false, type: String, default: VIS_SCANNED,
    });
    game.settings.register(MODULE_ID, SETTING_FLASH_FOLLOWS_VIS, {
        scope: 'world', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, SETTING_EFFECT_ICON_SCALE, {
        name: 'LA.settings.statBarEffectIconScale.name',
        hint: 'LA.settings.statBarEffectIconScale.hint',
        scope: 'world',
        config: false,
        type: Number,
        default: 0.75,
        range: { min: 0.3, max: 2, step: 0.05 },
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true })),
    });

    game.settings.register(MODULE_ID, SETTING_MIN_ZOOM_SCALE, {
        scope: 'world',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 4, step: 0.1 },
    });
    game.settings.register(MODULE_ID, SETTING_ELEVATION_BADGE_SCALE, {
        scope: 'world',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0.5, max: 3, step: 0.05 },
        onChange: () =>
        {
            for (const token of /** @type {any[]} */ (canvas?.tokens?.placeables ?? []))
            {
                if (!token._laBadge)
                    continue;
                token._laBadgeElev = undefined;
                drawElevationBadge(token);
            }
        },
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_TALENTS, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: () =>
        {
            if (!isExecutorGM() || !canvas?.ready)
                return;
            for (const token of canvas.tokens?.placeables ?? [])
            {
                if (isLancerCombatant(token.actor))
                    _autoInjectCounters(token.document);
            }
        },
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_TALENT_COLOR, {
        scope: 'world',
        config: false,
        type: String,
        default: '#196161',
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_TALENT_WIDTH, {
        scope: 'world',
        config: false,
        type: Number,
        default: 32,
        range: { min: 1, max: 100, step: 1 },
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_TALENT_FEEDBACK, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });

}

export async function applyDefaultsToCurrentScene()
{
    if (!canvas?.scene)
    {
        ui.notifications?.warn(localize('LA.notify.noActiveScene'));
        return;
    }
    const defaultHidden = getWorldSetting(SETTING_DEFAULT_HIDDEN, false);
    const defaultCombatOnly = getWorldSetting(SETTING_DEFAULT_COMBAT_ONLY, false);
    const defaultRowHeight = getWorldSetting(SETTING_DEFAULT_ROW_HEIGHT, 0);
    const updates = [];
    for (const tok of canvas.tokens?.placeables ?? [])
    {
        if (!isLancerCombatant(tok.actor))
            continue;
        updates.push({
            _id: tok.document.id,
            [`flags.${MODULE_ID}.${FLAG_HIDDEN}`]: defaultHidden,
            [`flags.${MODULE_ID}.${FLAG_COMBAT_ONLY}`]: defaultCombatOnly,
            [`flags.${MODULE_ID}.${FLAG_ROW_HEIGHT}`]: defaultRowHeight || null,
            // Clear per-token visibility overrides so the world setting applies.
            [`flags.${MODULE_ID}.-=${FLAG_VIS_OUT_OF_COMBAT}`]: null,
            [`flags.${MODULE_ID}.-=${FLAG_VIS_IN_COMBAT}`]: null,
        });
    }
    if (updates.length === 0)
    {
        ui.notifications?.info(localize('LA.notify.noLancerTokensOnThisScene'));
        return;
    }
    try
    {
        await canvas.scene.updateEmbeddedDocuments('Token', updates);
        ui.notifications?.info(localizeFormat('LA.notify.appliedDefaults', { count: updates.length }));
    }
    catch (e)
    {
        console.warn(`${MODULE_ID} | apply defaults failed`, e);
        ui.notifications?.error(localize('LA.notify.failedToApplyDefaultsSeeTheConsole'));
    }
}

// Init

function _laHitContains(token, x, y)
{
    if (token.shape?.contains?.(x, y))
        return true;
    if (!token.mesh)
        return false;
    const lx = token.mesh.position.x - token.position.x;
    const ly = token.mesh.position.y - token.position.y;
    const hw = (token.w ?? 0) / 2;
    const hh = (token.h ?? 0) / 2;
    return x >= lx - hw && x <= lx + hw && y >= ly - hh && y <= ly + hh;
}

// Refresh visibility + position sync.
function refreshLancerToken(token)
{
    if (!isEnabled() || !isLancerCombatant(token?.actor))
        return;

    // Create hub if missing.
    if (!_overlayHubs.has(token.id))
    {
        try
        {
            token.drawBars();
        }
        catch (e)
        {
            console.warn(`${MODULE_ID} | drawBars on refresh failed`, e);
        }
    }
    if (!_overlayHubs.has(token.id))
        return;
    // Position sync (updates wrapper.position to active mesh.position).
    _syncHubPosition(token);

    // Must run after _syncHubPosition so the badge reads the fresh wrapper.position.
    drawElevationBadge(token);

    const show = shouldShowBars(token);
    fadeBars(token, show ? 1 : 0);

    const entry = _overlayHubs.get(token.id);
    const nameplate = token.nameplate;
    if (nameplate)
    {
        const iso = _getIsoState(token);
        // Only cache base when iso is off; otherwise we'd trap an iso-shifted position.
        if (!iso)
        {
            if (token._laBaseNameplateY === undefined)
                token._laBaseNameplateY = nameplate.position.y;
            if (token._laBaseNameplateX === undefined)
                token._laBaseNameplateX = nameplate.position.x;
            if (nameplate.anchor && token._laBaseNameplateAnchorX === undefined)
            {
                token._laBaseNameplateAnchorX = nameplate.anchor.x;
                token._laBaseNameplateAnchorY = nameplate.anchor.y;
            }
        }
        if (iso && token.mesh && entry?.wrapper && entry?.hub)
        {
            nameplate.anchor?.set(0.5, 0.5);
            nameplate.rotation = iso.reverseRotation;
            nameplate.skew.set(iso.reverseSkewX, iso.reverseSkewY);
            const isoScale = 0.76;
            nameplate.scale.set(isoScale, 1 / isoScale);
            entry.wrapper.transform.updateLocalTransform();
            const localBelow = show
                ? new PIXI.Point(0, entry.hub.position.y + (entry.hub.height || 0) + 8)
                : new PIXI.Point(0, (token.h ?? 0) / 2 + 8);
            const wp = entry.wrapper.localTransform.apply(localBelow);
            nameplate.position.set(wp.x - token.position.x, wp.y - token.position.y);
        }
        else
        {
            if (nameplate.anchor && token._laBaseNameplateAnchorX !== undefined)
                nameplate.anchor.set(token._laBaseNameplateAnchorX, token._laBaseNameplateAnchorY);
            nameplate.rotation = 0;
            nameplate.skew.set(0, 0);
            nameplate.scale.set(1, 1);
            if (nameplate.visible && entry)
            {
                nameplate.position.x = token.w / 2;
                nameplate.position.y = show
                    ? token.h + 10 + (entry.totalHeight ?? 0) * (entry.wrapper.scale.y - 1)
                    : token.h + 2;
            }
        }
    }

    // Status effect icons, plus the badge container that has to ride the same transform.
    for (const [effects, baseKey] of [[token.effects, '_laBaseEffects'], [token.effectCounters, '_laBaseEffectCounters']])
    {
        if (!effects || effects.destroyed)
            continue;
        if (token[`${baseKey}X`] === undefined)
        {
            token[`${baseKey}X`] = effects.position.x;
            token[`${baseKey}Y`] = effects.position.y;
        }
        const isoFx = _getIsoState(token);
        if (isoFx && token.mesh)
        {
            effects.pivot.set(0, 0);
            effects.rotation = isoFx.reverseRotation;
            effects.skew.set(isoFx.reverseSkewX, isoFx.reverseSkewY);
            const isoScale = 0.76;
            effects.scale.set(isoScale, 1 / isoScale);
            const cosR = Math.cos(isoFx.reverseRotation);
            const sinR = Math.sin(isoFx.reverseRotation);
            const localX = -(token.w ?? 0) / 2;
            const localY = -(token.h ?? 0) / 2;
            const offX = (cosR * isoScale * localX) + (-sinR * (1 / isoScale) * localY);
            const offY = (sinR * isoScale * localX) + (cosR * (1 / isoScale) * localY);
            const worldX = token.mesh.position.x + offX;
            const worldY = token.mesh.position.y + offY;
            effects.position.set(worldX - token.position.x, worldY - token.position.y);
        }
        else
        {
            effects.rotation = 0;
            effects.skew.set(0, 0);
            effects.scale.set(1, 1);
            effects.position.set(token[`${baseKey}X`], token[`${baseKey}Y`]);
        }
    }

    // Reticle would draw under our overlay bars, so move it into the overlay. In iso, also re-center it.
    const isoTgt = _getIsoState(token, ISO_SETTING_RETICLE);
    const tgtOverlay = getHubOverlay();
    for (const graphic of [token.targetArrows, token.targetPips])
    {
        if (!graphic || graphic.destroyed)
            continue;
        if (tgtOverlay)
        {
            if (graphic.parent !== tgtOverlay)
                tgtOverlay.addChild(graphic);
            graphic.zIndex = 1;
        }
        if (isoTgt && token.mesh)
        {
            graphic.rotation = isoTgt.reverseRotation;
            graphic.skew.set(isoTgt.reverseSkewX, isoTgt.reverseSkewY);
            const isoScale = 0.76;
            graphic.scale.set(isoScale, 1 / isoScale);
            const cosR = Math.cos(isoTgt.reverseRotation);
            const sinR = Math.sin(isoTgt.reverseRotation);
            const cx = (cosR * isoScale * ((token.w ?? 0) / 2)) - (sinR * (1 / isoScale) * ((token.h ?? 0) / 2));
            const cy = (sinR * isoScale * ((token.w ?? 0) / 2)) + (cosR * (1 / isoScale) * ((token.h ?? 0) / 2));
            graphic.position.set(token.mesh.position.x - cx, token.mesh.position.y - cy);
        }
        else
        {
            graphic.rotation = 0;
            graphic.skew.set(0, 0);
            graphic.scale.set(1, 1);
            // overlay is in canvas.tokens space, so token.position lands at the native cell
            graphic.position.set(token.position.x, token.position.y);
        }
    }

    const isoHit = _getIsoState(token, ISO_SETTING_HITZONE);
    if (isoHit && token.mesh)
    {
        if (!token._laHitArea)
            token._laHitArea = { contains: (x, y) => _laHitContains(token, x, y) };
        if (token.hitArea !== token._laHitArea)
            token.hitArea = token._laHitArea;
    }
    else if (token.shape && token.hitArea !== token.shape)
        token.hitArea = token.shape;
}

export function initTokenStatBar()
{
    // Skip if Bar Brawl is active.
    if (game.modules.get('barbrawl')?.active)
    {
        console.log(`${MODULE_ID} | Bar Brawl detected — skipping custom token stat bar registration.`);
        return;
    }

    setOriginalDrawBars(CONFIG.Token.objectClass.prototype.drawBars);

    if (game.modules.get('lib-wrapper')?.active)
    {
        // MIXED: short-circuit on Lancer actors, chain otherwise.
        libWrapper.register(MODULE_ID, 'CONFIG.Token.objectClass.prototype.drawBars',
            function (wrapped, ...args)
            {
                if (isEnabled() && isLancerCombatant(this.actor))
                    return drawStatHub.call(this);
                return wrapped(...args);
            }, 'MIXED');

        // Neutralise vanilla bar attribute lookups.
        libWrapper.register(MODULE_ID, 'CONFIG.Token.documentClass.prototype.getBarAttribute',
            function (wrapped, ...args)
            {
                if (isEnabled() && isLancerCombatant(this.actor))
                    return null;
                return wrapped(...args);
            }, 'MIXED');
    }
    else
    {
        const origDrawBars = CONFIG.Token.objectClass.prototype.drawBars;
        CONFIG.Token.objectClass.prototype.drawBars = function (...args)
        {
            if (isEnabled() && isLancerCombatant(this.actor))
                return drawStatHub.call(this);
            return origDrawBars.call(this, ...args);
        };
        const origGetBarAttribute = CONFIG.Token.documentClass.prototype.getBarAttribute;
        CONFIG.Token.documentClass.prototype.getBarAttribute = function (...args)
        {
            if (isEnabled() && isLancerCombatant(this.actor))
                return null;
            return origGetBarAttribute.call(this, ...args);
        };
    }

    Hooks.on('updateActor', (actor, change) =>
    {
        if (!isEnabled() || !isLancerCombatant(actor))
            return;
        if (!change?.system)
            return;
        animateActorChanges(actor);
    });

    const onActorEffectChange = (effect) =>
    {
        const actor = effect?.parent;
        if (!isEnabled() || actor?.documentName !== 'Actor' || !isLancerCombatant(actor))
            return;
        animateActorChanges(actor);
    };
    Hooks.on('createActiveEffect', onActorEffectChange);
    Hooks.on('updateActiveEffect', onActorEffectChange);
    Hooks.on('deleteActiveEffect', onActorEffectChange);

    Hooks.on('refreshToken', refreshLancerToken);

    Hooks.on('canvasPan', () =>
    {
        const growth = _elevationBadgeGrowth();
        for (const token of /** @type {any[]} */ (canvas.tokens?.placeables ?? []))
        {
            const badge = token._laBadge;
            if (!badge || badge.destroyed || badge._laGrowth === growth)
                continue;
            _placeElevationBadge(token, badge, token._laBadgeIso ? _getIsoState(token) : null);
        }
    });

    // Alt-key peek.
    window.addEventListener('keydown', (ev) =>
    {
        if (ev.key !== 'Alt' || isAltHeld())
            return;
        setAltHeld(true);
        refreshVisibleLancerTokens(true);
    });
    window.addEventListener('keyup', (ev) =>
    {
        if (ev.key !== 'Alt' || !isAltHeld())
            return;
        setAltHeld(false);
        refreshVisibleLancerTokens();
    });
    window.addEventListener('blur', () =>
    {
        if (!isAltHeld())
            return;
        setAltHeld(false);
        refreshVisibleLancerTokens();
    });

    // Sweep: canvasReady may have fired before our ready hook.
    const sweepLancerTokens = () =>
    {
        // Clear stale overlay hubs from previous canvas.
        for (const [, entry] of _overlayHubs)
        {
            if (!entry.wrapper.destroyed)
                entry.wrapper.destroy({ children: true });
        }
        _overlayHubs.clear();
        resetHubOverlay();
        if (!isEnabled())
            return;
        for (const tok of canvas.tokens?.placeables ?? [])
        {
            if (!isLancerCombatant(tok.actor))
                continue;
            try
            {
                tok.drawBars();
                refreshLancerToken(tok);
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | drawBars sweep failed`, e);
            }
        }
    };
    if (canvas?.ready)
        sweepLancerTokens();
    Hooks.on('canvasReady', sweepLancerTokens);

    // Rebuild bars when an iso flag toggles so they pick up the new transform.
    Hooks.on('updateScene', (scene, changes) =>
    {
        if (scene.id !== canvas.scene?.id)
            return;
        const touchesIso = foundry.utils.hasProperty(changes, 'flags.isometric-perspective')
            || foundry.utils.hasProperty(changes, 'flags.grape_juice-isometrics');
        if (!touchesIso)
            return;
        requestAnimationFrame(() =>
        {
            for (const tok of canvas.tokens?.placeables ?? [])
            {
                if (!isLancerCombatant(tok.actor))
                    continue;
                try
                {
                    tok.drawBars();
                    refreshLancerToken(tok);
                }
                catch (e)
                {
                    console.warn(`${MODULE_ID} | iso refresh`, e);
                }
            }
        });
    });

    // Cleanup on token removal.
    Hooks.on('destroyToken', (token) =>
    {
        _removeOverlayHub(token.id);
        // reticle lives in the overlay now, so the token's own destroy won't reach it
        for (const graphic of [token.targetArrows, token.targetPips])
        {
            if (graphic && !graphic.destroyed && graphic.parent && graphic.parent !== token)
            {
                graphic.parent.removeChild(graphic);
                graphic.destroy();
            }
        }
    });

    Hooks.on('drawToken', (token) =>
    {
        if (!isEnabled() || !isLancerCombatant(token?.actor))
            return;
        try
        {
            token.drawBars();
        }
        catch (e)
        {
            console.warn(`${MODULE_ID} | drawBars on drawToken failed`, e);
        }
    });

    // Force displayBars=NONE on new Lancer tokens.
    Hooks.on('preCreateToken', (tokenDoc, data) =>
    {
        if (!isEnabled())
            return;
        const actor = tokenDoc.actor ?? game.actors?.get(data?.actorId);
        if (!isLancerCombatant(actor))
            return;
        tokenDoc.updateSource({ displayBars: CONST.TOKEN_DISPLAY_MODES.NONE });
    });

    // Fix existing tokens that predate the setting.
    const sweepDisplayBars = async () =>
    {
        if (!isEnabled() || !canvas?.scene || !game.user?.isGM)
            return;
        const updates = [];
        for (const tok of canvas.tokens?.placeables ?? [])
        {
            if (!isLancerCombatant(tok.actor))
                continue;
            if (tok.document.displayBars !== CONST.TOKEN_DISPLAY_MODES.NONE)
            {
                updates.push({
                    _id: tok.document.id,
                    displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
                });
            }
        }
        if (updates.length > 0)
        {
            try
            {
                await canvas.scene.updateEmbeddedDocuments('Token', updates);
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | sweep displayBars failed`, e);
            }
        }
    };
    if (canvas?.ready)
        sweepDisplayBars();
    Hooks.on('canvasReady', sweepDisplayBars);

    // Auto-inject talent / frame core counters as extras (GM-only).
    const _sweepAutoInjectCounters = () =>
    {
        if (!isEnabled() || !canvas?.scene)
            return;
        if (!isExecutorGM())
            return;
        const talentsOn = getModuleSetting(SETTING_AUTO_INJECT_TALENTS);
        const flagsOn = altFlags.isActive() && getModuleSetting(SETTING_AUTO_INJECT_CUSTOM_FLAGS);
        if (!talentsOn && !flagsOn)
            return;
        for (const token of canvas.tokens?.placeables ?? [])
        {
            if (isLancerCombatant(token.actor))
                _autoInjectCounters(token.document);
        }
    };
    if (canvas?.ready)
        _sweepAutoInjectCounters();
    Hooks.on('canvasReady', _sweepAutoInjectCounters);

    Hooks.on('createToken', (tokenDoc) =>
    {
        if (!isEnabled())
            return;
        if (!isLancerCombatant(tokenDoc?.actor))
            return;
        _autoInjectCounters(tokenDoc);
    });

    Hooks.on('updateActor', (actor, changes, options) =>
    {
        if (!isEnabled() || !isLancerCombatant(actor))
            return;
        if (altFlags.flagsChanged(changes) || altFlags.barLinkChanged(changes))
            _onCustomFlagsChanged(actor, changes, options);
        const touched = !!(changes?.system?.loadout
            || changes?.items
            || foundry.utils.hasProperty(changes ?? {}, 'system.pilot'));
        if (!touched)
            return;
        for (const tok of actor.getActiveTokens())
            _autoInjectCounters(tok.document);
    });

    // updateItem doesn't bubble to updateActor; relay it here.
    Hooks.on('updateItem', (item) =>
    {
        if (!isEnabled())
            return;
        if (item?.type !== 'talent' && item?.type !== 'frame')
            return;
        const parentActor = item.parent;
        if (!parentActor)
            return;
        const actors = [];
        if (isLancerCombatant(parentActor))
            actors.push(parentActor);
        // Mechs that have this pilot also see the change.
        for (const otherActor of game.actors ?? [])
        {
            if (otherActor.type === 'mech' && resolvePilot(otherActor)?.id === parentActor.id)
                actors.push(otherActor);
        }
        for (const affectedActor of actors)
        {
            for (const tok of affectedActor.getActiveTokens())
            {
                const prev = _lastValues.get(tok.id) ?? { extras: {} };
                _autoInjectCounters(tok.document);
                try
                {
                    tok.drawBars();
                }
                catch (err)
                {
                    console.warn(`${MODULE_ID} | updateItem drawBars`, err);
                }
                const next = snapshotValues(affectedActor, tok.document);
                const flashed = flashChangedExtras(tok, prev, next);
                _lastValues.set(tok.id, next);
                if (flashed)
                    scheduleFlashFade(tok);
            }
        }
    });

    Hooks.on('renderTokenConfig', renderConfigHandler);
    Hooks.on('renderPrototypeTokenConfig', renderConfigHandler);

    // Re-evaluate when per-token flags change.
    Hooks.on('updateToken', (tokenDoc, change) =>
    {
        if (!isEnabled())
            return;
        if (!isLancerCombatant(tokenDoc?.actor))
            return;
        const touchesFlags = foundry.utils.hasProperty(change, `flags.${MODULE_ID}`);
        const touchesElevation = change.elevation !== undefined;
        if (!touchesFlags && !touchesElevation)
            return;
        const tok = tokenDoc.object;
        if (!tok)
            return;
        if (touchesElevation)
        {
            try
            {
                drawElevationBadge(tok);
            }
            catch
            { /* ignore */ }
        }
        // Manual-value edits to extras: diff vs the seeded snapshot, then redraw.
        const extrasTouched = foundry.utils.hasProperty(change, `flags.${MODULE_ID}.${FLAG_EXTRAS}`);
        const prev = _lastValues.get(tok.id) ?? { extras: {} };
        if (!touchesFlags)
            return;
        try
        {
            tok.drawBars();
        }
        catch (e)
        {
            console.warn(`${MODULE_ID} | drawBars on flag update failed`, e);
        }
        if (extrasTouched)
        {
            const next = snapshotValues(tokenDoc.actor, tokenDoc);
            const flashed = flashChangedExtras(tok, prev, next);
            _lastValues.set(tok.id, next);
            if (flashed)
                scheduleFlashFade(tok);
        }
        fadeBars(tok, shouldShowBars(tok) ? 1 : 0);
    });

    // Combat lifecycle → refresh combat-only and always-shown tokens.
    const refreshAllForCombat = () =>
    {
        if (!isEnabled())
            return;
        for (const tok of canvas.tokens?.placeables ?? [])
        {
            if (!isLancerCombatant(tok.actor))
                continue;
            if (!statBarCombatOnly(tok.document) && !statBarAlwaysShown(tok.document))
                continue;
            fadeBars(tok, shouldShowBars(tok) ? 1 : 0);
        }
    };
    Hooks.on('combatStart', refreshAllForCombat);
    Hooks.on('deleteCombat', refreshAllForCombat);
    Hooks.on('createCombatant', refreshAllForCombat);
    Hooks.on('deleteCombatant', refreshAllForCombat);

    Hooks.on('renderTokenHUD', (hud, html, _data) =>
    {
        if (!isEnabled())
            return;
        const actor = hud.object?.actor;
        if (!isLancerCombatant(actor))
            return;
        injectLancerHud(hud, html, actor);
    });
}
