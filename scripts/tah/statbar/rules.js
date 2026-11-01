import { getIsoStateForToken } from '../../setup/iso-settings.js';
import { isTokenInCombat, isTokenVisible } from '../../utils/lancer-token.js';
import { isActorScannedForUser } from '../../tools/scan-lookup.js';
import {
    SETTING_ENABLED, SETTING_DEFAULT_HIDDEN, SETTING_DEFAULT_COMBAT_ONLY, SETTING_DEFAULT_ALWAYS_SHOW, SETTING_DEFAULT_ROW_HEIGHT,
    SETTING_VIS_OUT_OF_COMBAT, SETTING_VIS_IN_COMBAT, SETTING_FLASH_FOLLOWS_VIS, SETTING_DEFAULT_PILOT_STRESS,
    VIS_ALL, VIS_OWNER, VIS_NONE, VIS_SCANNED, SHOW_ALWAYS, SHOW_HOVER,
    ISO_SETTING_STATBAR,
    FLAG_HIDDEN, FLAG_DISABLED, FLAG_COMBAT_ONLY, FLAG_SHOW_MODE, FLAG_ROW_HEIGHT, FLAG_VIS_OUT_OF_COMBAT, FLAG_VIS_IN_COMBAT,
    FLAG_PILOT_STRESS, SETTING_TOKEN_WIDTH,
} from './config.js';
import { isAltHeld, _flashingTokens, _overlayHubs, getOriginalDrawBars } from './state.js';
import { getModuleSetting } from '../../tools/settings-utils.js';
import { getLAFlag } from '../../tools/flag-utils.js';

export function isEnabled()
{
    return getModuleSetting(SETTING_ENABLED);
}

export function _getIsoState(token, settingKey = ISO_SETTING_STATBAR)
{
    return getIsoStateForToken(token, settingKey);
}

export function getWorldSetting(key, fallback)
{
    return getModuleSetting(key) ?? fallback;
}

export function followsTokenWidth(actor)
{
    const key = SETTING_TOKEN_WIDTH[actor?.type];
    return !!key && getWorldSetting(key, false) === true;
}

// Per-token boolean flag; token override wins, else the world setting.
function tokenBoolFlag(tokenDoc, flag, settingKey)
{
    const value = getLAFlag(tokenDoc,flag);
    if (value === true || value === false)
        return value;
    return getWorldSetting(settingKey, false) === true;
}

export function statBarHidden(tokenDoc)
{
    return tokenBoolFlag(tokenDoc, FLAG_HIDDEN, SETTING_DEFAULT_HIDDEN);
}
export function statBarDisabled(tokenDoc)
{
    return getLAFlag(tokenDoc,FLAG_DISABLED) === true;
}
export function statBarCombatOnly(tokenDoc)
{
    return tokenBoolFlag(tokenDoc, FLAG_COMBAT_ONLY, SETTING_DEFAULT_COMBAT_ONLY);
}
export function statBarAlwaysShown(tokenDoc)
{
    const mode = getLAFlag(tokenDoc, FLAG_SHOW_MODE);
    if (mode === SHOW_ALWAYS || mode === SHOW_HOVER)
        return mode === SHOW_ALWAYS;
    return getWorldSetting(SETTING_DEFAULT_ALWAYS_SHOW, false) === true;
}
export function showsPilotStress(tokenDoc)
{
    return tokenBoolFlag(tokenDoc, FLAG_PILOT_STRESS, SETTING_DEFAULT_PILOT_STRESS);
}

export function statBarRowHeight(tokenDoc)
{
    const flagValue = getLAFlag(tokenDoc,FLAG_ROW_HEIGHT);
    if (Number.isFinite(flagValue) && flagValue > 0)
        return Number(flagValue);
    const fallback = getWorldSetting(SETTING_DEFAULT_ROW_HEIGHT, 0);
    return Number.isFinite(fallback) && fallback > 0 ? Number(fallback) : 0;
}

// Per-combat-state visibility mode: per-token flag wins, else the matching world setting.
function resolveVisibilityMode(tokenDoc, inCombat)
{
    const flagKey = inCombat ? FLAG_VIS_IN_COMBAT : FLAG_VIS_OUT_OF_COMBAT;
    const settingKey = inCombat ? SETTING_VIS_IN_COMBAT : SETTING_VIS_OUT_OF_COMBAT;
    const mode = getLAFlag(tokenDoc,flagKey);
    if (mode === VIS_ALL || mode === VIS_OWNER || mode === VIS_NONE || mode === VIS_SCANNED)
        return mode;
    return getWorldSetting(settingKey, VIS_ALL);
}

export function passesVisibilityMode(token, inCombat)
{
    const mode = resolveVisibilityMode(token.document, inCombat);
    if (mode === VIS_NONE)
        return !!token.controlled;
    if (mode === VIS_OWNER && !token.actor?.isOwner)
        return false;
    if (mode === VIS_SCANNED && !_scanRevealedToUser(token.actor))
        return false;
    return true;
}

export function isStatBarActive()
{
    return !!getOriginalDrawBars() && !!isEnabled();
}

export function statBarAccess(token)
{
    if (!token)
        return null;
    if (statBarDisabled(token.document))
        return null;
    if (statBarHidden(token.document))
        return null;
    const inCombat = isTokenInCombat(token);
    if (statBarCombatOnly(token.document) && !inCombat)
        return null;
    if (passesVisibilityMode(token, inCombat))
        return 'full';
    // Flash override beats every mode, unless the flash follows visibility.
    if (_flashingTokens.has(token.id) && !getModuleSetting(SETTING_FLASH_FOLLOWS_VIS))
        return 'flash';
    return null;
}

export function shouldShowBars(token)
{
    if (!statBarAccess(token))
        return false;
    if (_flashingTokens.has(token.id) || token.controlled || token.hover)
        return true;
    if (token.targeted?.has(game.user))
        return true;
    if ((isAltHeld() || statBarAlwaysShown(token.document)) && isTokenVisible(token))
        return true;
    return false;
}

// Token-local y just below the bar stack, same anchor the nameplate uses; null when bars are off.
export function belowBarsY(token)
{
    const entry = _overlayHubs.get(token.id);
    if (!entry || !shouldShowBars(token))
        return null;
    return token.h + 10 + (entry.totalHeight ?? 0) * ((entry.wrapper?.scale?.y ?? 1) - 1);
}

// Scanned for `user`: the scannedByAll flag, or an OBSERVER-or-better scan journal.
export function _isActorScannedByUser(actor, user)
{
    if (!actor || !user)
        return false;
    try
    {
        return isActorScannedForUser(actor, user);
    }
    catch
    { /* ignore */ }
    return false;
}

// 'scanned' visibility: own-side actors reveal to everyone (no scan concept); NPC/deployable need a scan.
function _scanRevealedToUser(actor)
{
    if (game.user?.isGM || actor?.isOwner)
        return true;
    if (actor?.type === 'pilot' || actor?.type === 'mech')
        return true;
    return _isActorScannedByUser(actor, game.user);
}
