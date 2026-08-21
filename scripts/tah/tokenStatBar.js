// Custom multi-bar hub drawn under Lancer tokens + resource grid in token HUD.
// Replaces vanilla bar1/bar2 for mech/npc/deployable actors. Disabled by default.

import { getIsoStateForToken } from '../setup/iso-settings.js';
import {
    isLancerActor as isLancerCombatant,
    hasMechStats,
    hasReaction,
    isTokenInCombat,
    isTokenVisible,
} from '../utils/lancer-token.js';
import { setTokenFlag } from '../socket.js';
import { playStatsSound } from './sound.js';
import { isActorScannedForUser } from '../tools/scan-lookup.js';
import { linkTierGate } from '../interactive/deployables.js';
import * as altFlags from '../integrations/alt-sheets-flags.js';

import {
    MODULE_ID,
    SETTING_ENABLED, SETTING_DEFAULT_HIDDEN, SETTING_DEFAULT_COMBAT_ONLY, SETTING_DEFAULT_ROW_HEIGHT,
    SETTING_VIS_OUT_OF_COMBAT, SETTING_VIS_IN_COMBAT, SETTING_EFFECT_ICON_SCALE, SETTING_MIN_ZOOM_SCALE,
    SETTING_DEFAULT_PILOT_STRESS, SETTING_SHOW_VALUES, SETTING_AUTO_INJECT_TALENTS, SETTING_AUTO_INJECT_BOND_XP,
    SETTING_AUTO_INJECT_TALENT_COLOR, SETTING_AUTO_INJECT_TALENT_WIDTH, SETTING_AUTO_INJECT_TALENT_FEEDBACK,
    SETTING_AUTO_INJECT_CUSTOM_FLAGS,
    VIS_ALL, VIS_OWNER, VIS_NONE, VIS_SCANNED,
    FLASH_HOLD_MS, FLASH_SHRINK_MS, FLASH_TOTAL_MS, FLASH_LINGER_MS,
    MAX_BAR_WIDTH, REF_GRID_SIZE, REF_ROW_HEIGHT,
    ISO_SETTING_STATBAR, ISO_SETTING_RETICLE, ISO_SETTING_HITZONE,
    FLAG_HIDDEN, FLAG_COMBAT_ONLY, FLAG_ROW_HEIGHT, FLAG_VIS_OUT_OF_COMBAT, FLAG_VIS_IN_COMBAT,
    FLAG_PILOT_STRESS, FLAG_EXTRAS, FLAG_AUTO_KEYS, FLAG_TEMPLATES,
    DEFAULT_EXTRA_BAR_ICON,
} from './statbar/config.js';

import {
    isAltHeld, setAltHeld,
    _lastValues, _flashingTokens, _fadeState, _overlayHubs,
    getHubOverlay, resetHubOverlay,
} from './statbar/state.js';

// Module-level state

let originalDrawBars = null;

// Bar definitions

const BAR_DEFS = [
    {
        id: 'hp',
        label: 'HP',
        color: 0x66cc66,
        getValue: actor => ({ value: actor.system?.hp?.value ?? 0, max: getEffectiveMax(actor, 'hp') }),
        editPath: 'system.hp.value',
    },
    {
        id: 'heat',
        label: 'Heat',
        color: 0xcc4422,
        getValue: actor => ({ value: actor.system?.heat?.value ?? 0, max: getEffectiveMax(actor, 'heat') }),
        editPath: 'system.heat.value',
    },
    {
        id: 'structure',
        label: 'STR',
        color: 0xffd633,
        getValue: actor => ({ value: actor.system?.structure?.value ?? 0, max: actor.system?.structure?.max ?? 0 }),
        editPath: 'system.structure.value',
        pips: true,
    },
    {
        id: 'stress',
        label: 'Stress',
        color: 0xff8822,
        getValue: actor => ({ value: actor.system?.stress?.value ?? 0, max: actor.system?.stress?.max ?? 0 }),
        editPath: 'system.stress.value',
        pips: true,
    },
    {
        id: 'overshield',
        label: 'OS',
        color: 0x48dee0,
        getValue: actor => ({ value: actor.system?.overshield?.value ?? 0, max: actor.system?.overshield?.max ?? 0 }),
        editPath: 'system.overshield.value',
        hideWhenZero: true,
    },
    {
        id: 'burn',
        label: 'Burn',
        color: 0xcc1a1a,
        getValue: actor => ({ value: actor.system?.burn ?? 0, max: 0 }),
        editPath: 'system.burn',
        softMax: 10,
        hideWhenZero: true,
    },
    {
        id: 'infection',
        label: 'Inf',
        color: 0x1a8844,
        getValue: actor => ({ value: actor.system?.infection ?? 0, max: 0 }),
        editPath: 'system.infection',
        softMax: 10,
        hideWhenZero: true,
    },
    {
        // Pilot-only bond stress; renders as a horizontal bar (no pips) in the heat slot.
        id: 'pilotStress',
        label: 'Stress',
        color: 0xd9b800,
        getValue: actor => ({
            value: actor.system?.bond_state?.stress?.value ?? 0,
            max: actor.system?.bond_state?.stress?.max ?? 8,
        }),
        editPath: 'system.bond_state.stress.value',
    },
];


import { getModuleSetting } from "../tools/settings-utils.js";

function isEnabled()
{
    return getModuleSetting(SETTING_ENABLED);
}

function _getIsoState(token, settingKey = ISO_SETTING_STATBAR)
{
    try
    {
        if (!game.settings.get(MODULE_ID, settingKey))
            return null;
    }
    catch
    {
        return null;
    }
    return getIsoStateForToken(token);
}

export { FLAG_EXTRAS };

// Accepts Token (placeable), TokenDocument, scene-local token id, or uuid. Returns TokenDocument or null.
async function _resolveTokenDocument(arg)
{
    if (!arg)
        return null;
    if (typeof arg === 'string')
    {
        try
        {
            if (arg.includes('.'))
            {
                const doc = /** @type {any} */ (await fromUuid(arg));
                return doc?.documentName === 'Token' ? doc : (doc?.token ?? null);
            }
            for (const scene of game.scenes)
            {
                const tokenDoc = scene.tokens.get(arg);
                if (tokenDoc)
                    return tokenDoc;
            }
            return canvas?.tokens?.get(arg)?.document ?? null;
        }
        catch
        {
            return null;
        }
    }
    return /** @type {any} */ (arg).document ?? arg;
}

function getWorldSetting(key, fallback)
{
    try
    {
        const value = game.settings.get(MODULE_ID, key);
        return value ?? fallback;
    }
    catch
    {
        return fallback;
    }
}

// Per-token boolean flag; token override wins, else the world setting.
function tokenBoolFlag(tokenDoc, flag, settingKey)
{
    const value = tokenDoc?.getFlag?.(MODULE_ID, flag);
    if (value === true || value === false)
        return value;
    return getWorldSetting(settingKey, false) === true;
}

function statBarHidden(tokenDoc)
{
    return tokenBoolFlag(tokenDoc, FLAG_HIDDEN, SETTING_DEFAULT_HIDDEN);
}
function statBarCombatOnly(tokenDoc)
{
    return tokenBoolFlag(tokenDoc, FLAG_COMBAT_ONLY, SETTING_DEFAULT_COMBAT_ONLY);
}
function showsPilotStress(tokenDoc)
{
    return tokenBoolFlag(tokenDoc, FLAG_PILOT_STRESS, SETTING_DEFAULT_PILOT_STRESS);
}

function statBarRowHeight(tokenDoc)
{
    const flagValue = tokenDoc?.getFlag?.(MODULE_ID, FLAG_ROW_HEIGHT);
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
    const mode = tokenDoc?.getFlag?.(MODULE_ID, flagKey);
    if (mode === VIS_ALL || mode === VIS_OWNER || mode === VIS_NONE || mode === VIS_SCANNED)
        return mode;
    return getWorldSetting(settingKey, VIS_ALL);
}

function shouldShowBars(token)
{
    if (!token)
        return false;
    if (statBarHidden(token.document))
        return false;
    const inCombat = isTokenInCombat(token);
    if (statBarCombatOnly(token.document) && !inCombat)
        return false;
    // Flash override beats every mode.
    if (_flashingTokens.has(token.id))
        return true;
    const mode = resolveVisibilityMode(token.document, inCombat);
    if (mode === VIS_NONE)
        return !!token.controlled;
    if (mode === VIS_OWNER && !token.actor?.isOwner)
        return false;
    if (mode === VIS_SCANNED && !_scanRevealedToUser(token.actor))
        return false;
    if (token.controlled || token.hover)
        return true;
    if (token.targeted?.has(game.user))
        return true;
    if (isAltHeld() && isTokenVisible(token))
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

function getVisibleBars(actor, tokenDoc = null)
{
    if (!actor)
        return [];
    const mechStats = hasMechStats(actor);
    const isPilot = actor.type === 'pilot';
    return BAR_DEFS.filter(def =>
    {
        // Pilots & deployables don't get structure/stress at all.
        if (!mechStats && (def.id === 'structure' || def.id === 'stress'))
            return false;
        // Pilots can't take heat or infection mechanically.
        if (isPilot && (def.id === 'heat' || def.id === 'infection'))
            return false;
        // pilotStress is pilot-only and gated on per-token / world setting.
        if (def.id === 'pilotStress' && (!isPilot || !showsPilotStress(tokenDoc)))
            return false;
        const barValue = def.getValue(actor);
        const value = barValue.value ?? 0;
        const max = barValue.max ?? 0;
        if (def.pips && max <= 0)
            return false;
        // No native heat track: show the heat bar only if heat or infection is non-zero.
        if (def.id === 'heat' && (actor.system?.heat?.max ?? 0) <= 0)
        {
            const infection = actor.system?.infection ?? 0;
            if (value <= 0 && infection <= 0)
                return false;
        }
        if (def.hideWhenZero && value <= 0)
            return false;
        if (def.hideWhenFull && max > 0 && value >= max)
            return false;
        return true;
    });
}

// Effective max: bar grows if value or overshield exceeds nominal max.
function getEffectiveMax(actor, statKey)
{
    const sys = actor?.system;
    if (!sys)
        return 0;
    if (statKey === 'hp')
    {
        const max = sys.hp?.max ?? 0;
        const value = Math.max(0, sys.hp?.value ?? 0);
        const os = Math.max(0, sys.overshield?.value ?? 0);
        // Largest of max, HP, or overshield. OS doesn't stack on HP for sizing.
        return Math.max(max, value, os);
    }
    if (statKey === 'heat')
    {
        const ownMax = sys.heat?.max ?? 0;
        const value = Math.max(0, sys.heat?.value ?? 0);
        const fallbackMax = ownMax > 0 ? ownMax : (sys.hp?.max ?? 0);
        return Math.max(fallbackMax, value);
    }
    return 0;
}

// Parse "#rrggbb" into a 0xrrggbb integer (PIXI fill format). Falls back to gray.
function _parseHex(hex)
{
    if (typeof hex !== 'string')
        return 0x888888;
    const stripped = hex.trim().replace(/^#/, '');
    const parsed = parseInt(stripped, 16);
    return Number.isFinite(parsed) ? (parsed & 0xffffff) : 0x888888;
}

// Path resolver: supports normal actor-rooted paths plus two special prefixes
// used by auto-injected counter bars:
//   "items.{id}.{rest}"        â†’ walks actor.items.get(id) (e.g. frame on a mech)
//   "pilotItems.{id}.{rest}"   â†’ walks actor.system.pilot.value.items.get(id) when
//                                 the actor is a mech, otherwise falls back to actor.items
//                                 (talents live on the pilot for mechs, on the pilot actor itself otherwise)
function _readActorPath(actor, path)
{
    if (!actor || !path)
        return undefined;
    let match = /^items\.([^.]+)\.(.+)$/.exec(path);
    if (match)
    {
        const item = actor.items?.get?.(match[1]);
        if (!item)
            return undefined;
        return foundry.utils.getProperty(item, match[2]);
    }
    match = /^pilotItems\.([^.]+)\.(.+)$/.exec(path);
    if (match)
    {
        const pilot = actor.system?.pilot?.value ?? actor;
        const item = pilot?.items?.get?.(match[1]);
        if (!item)
            return undefined;
        return foundry.utils.getProperty(item, match[2]);
    }
    return foundry.utils.getProperty(actor, path);
}

// Scanned for `user`: the scannedByAll flag, or an OBSERVER-or-better scan journal.
function _isActorScannedByUser(actor, user)
{
    if (!actor || !user)
        return false;
    if (actor.getFlag?.(MODULE_ID, 'scannedByAll'))
        return true;
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

// Resolve visibility from the 3-mode field. Falls back to legacy ownerOnly, then 'scanned'.
function _resolveExtraBarVisibility(actor, entry)
{
    let mode = entry?.visibility;
    if (!mode)
        mode = entry?.ownerOnly === true ? 'owner' : entry?.ownerOnly === false ? 'all' : 'scanned';
    if (mode === 'all')
        return true;
    if (game.user?.isGM || actor?.isOwner)
        return true;
    if (mode === 'owner')
        return false;
    // 'scanned': own-side actors always reveal to non-owners (no scan concept); NPC/deployable need a scan.
    if (actor?.type === 'pilot' || actor?.type === 'mech')
        return true;
    return _isActorScannedByUser(actor, game.user);
}

export function _resolveExtraBarValues(actor, entry)
{
    const read = (src) =>
    {
        if (!src)
            return 0;
        if (src.kind === 'manual')
            return Number(src.value) || 0;
        if (src.kind === 'path' && actor)
            return Number(_readActorPath(actor, src.path)) || 0;
        return 0;
    };
    const value = read(entry?.valueSource);
    const rawMax = read(entry?.maxSource);
    const max = rawMax > 0 ? rawMax : (entry?.segmented ? Math.max(1, Number(entry?.segments) || 1) : 1);
    const ownerOk = _resolveExtraBarVisibility(actor, entry);
    return { value, max, ownerOk };
}

// Enumerates talent rank + frame core counters; returns items.{id}.rest-style paths.
function _enumerateAutoCounters(actor)
{
    const out = [];
    if (!actor)
        return out;
    const pilot = actor.system?.pilot?.value ?? actor;
    const talentItems = pilot?.items
        ? [...pilot.items.values()].filter(/** @type {any} */ item => item.type === 'talent')
        : [];
    for (const talent of talentItems)
    {
        const lid = /** @type {any} */ (talent).system?.lid ?? talent.id;
        const ranks = /** @type {any} */ (talent).system?.ranks ?? [];
        const currRank = /** @type {any} */ (talent).system?.curr_rank ?? ranks.length;
        const lastIdx = Math.min(currRank, ranks.length);
        // Counters keyed by lid/name supersede across ranks: keep only the highest rank.
        const byKey = new Map();
        for (let rankIdx = 0; rankIdx < lastIdx; rankIdx++)
        {
            const counters = ranks[rankIdx]?.counters ?? [];
            for (let counterIdx = 0; counterIdx < counters.length; counterIdx++)
            {
                const counter = counters[counterIdx];
                const key = counter?.lid || counter?.name || `r${rankIdx}c${counterIdx}`;
                byKey.set(key, { rankIdx, counterIdx, counter });
            }
        }
        for (const { rankIdx, counterIdx, counter } of byKey.values())
        {
            out.push({
                autoKey: `talent:${lid}:r${rankIdx}:c${counterIdx}`,
                label: counter?.name ?? 'Counter',
                valuePath: `pilotItems.${talent.id}.system.ranks.${rankIdx}.counters.${counterIdx}.value`,
                maxPath: `pilotItems.${talent.id}.system.ranks.${rankIdx}.counters.${counterIdx}.max`,
            });
        }
    }
    const frame = actor.system?.loadout?.frame?.value;
    const csCounters = frame?.system?.core_system?.counters ?? [];
    for (let counterIdx = 0; counterIdx < csCounters.length; counterIdx++)
    {
        const counter = csCounters[counterIdx];
        const lid = frame.system?.lid ?? frame.id;
        out.push({
            autoKey: `frame:${lid}:c${counterIdx}`,
            label: counter?.name ?? 'Core Counter',
            valuePath: `items.${frame.id}.system.core_system.counters.${counterIdx}.value`,
            maxPath: `items.${frame.id}.system.core_system.counters.${counterIdx}.max`,
        });
    }
    return out;
}

// GM-only, idempotent: adds counter bars, skipping autoKeys already live or tombstoned in FLAG_AUTO_KEYS so user-deleted bars stay deleted.
async function _autoInjectCounters(tokenDoc)
{
    try
    {
        if (!game.users?.activeGM?.isSelf)
            return;
        const doc = /** @type {any} */ (tokenDoc)?.document ?? tokenDoc;
        if (!doc)
            return;
        const actor = doc.actor;
        if (!actor || !['mech', 'pilot', 'npc', 'deployable'].includes(actor.type))
            return;

        const existing = doc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
        const seen = doc.getFlag(MODULE_ID, FLAG_AUTO_KEYS) ?? {};
        const liveKeys = new Set(existing.filter(/** @type {any} */ entry => entry?.autoKey).map(/** @type {any} */ entry => entry.autoKey));

        // Talent/frame counters (gated by world setting).
        let toAddCounters = [];
        let counterStyle = null;
        if (game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENTS))
        {
            counterStyle = {
                color: game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_COLOR) || '#196161',
                widthPct: Math.max(1, Math.min(100, Number(game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_WIDTH)) || 100)),
                feedback: !!game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_FEEDBACK),
            };
            const counters = _enumerateAutoCounters(actor);
            toAddCounters = counters.filter(counter => !liveKeys.has(counter.autoKey) && !seen[counter.autoKey]);
        }

        // User-linked templates on the actor + items. Always processed.
        const templates = _enumerateLinkedTemplates(actor);
        const toAddTemplates = templates.filter(template => !liveKeys.has(template.autoKey) && !seen[template.autoKey]);

        // alt-sheets fraction custom flags -> derived path-bound bars.
        let toAddFlags = [];
        if (altFlags.isActive() && game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_CUSTOM_FLAGS))
        {
            toAddFlags = altFlags.listLinkedFractionFlags(actor)
                .map(flag => _buildCustomFlagBar(actor, flag))
                .filter(bar => !liveKeys.has(bar.autoKey) && !seen[bar.autoKey]);
        }

        // Bond XP bar on bonded pilots (gated by world setting).
        let toAddBondXp = [];
        if (actor.type === 'pilot' && game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_BOND_XP)
            && actor.items.some(/** @type {any} */ ownedItem => ownedItem.type === 'bond')
            && !liveKeys.has('bondXp') && !seen['bondXp'])
        {
            toAddBondXp = [{
                ..._defaultExtraBar(),
                id: foundry.utils.randomID(),
                autoKey: 'bondXp',
                label: 'XP',
                layoutMode: 'newLine',
                widthPct: 100,
                color: { kind: 'solid', stops: ['#00b8d4'] },
                icon: 'mdi mdi-head-cog-outline',
                valueSource: { kind: 'path', path: 'system.bond_state.xp.value', value: 0 },
                maxSource: { kind: 'path', path: 'system.bond_state.xp.max', value: 8 },
                segmented: true,
                showLabelInHint: false,
                hideInHint: true,
                visibility: 'scanned',
                audioTextFeedback: false,
            }];
        }

        if (!toAddCounters.length && !toAddTemplates.length && !toAddFlags.length && !toAddBondXp.length)
            return;

        const next = existing.slice();
        const seenNext = { ...seen };
        for (const counter of toAddCounters)
        {
            next.push(_buildAutoInjectedEntry(counter, counterStyle.color, counterStyle.widthPct, counterStyle.feedback));
            seenNext[counter.autoKey] = true;
        }
        for (const template of toAddTemplates)
        {
            next.push(_materializeLinkedTemplate(template));
            seenNext[template.autoKey] = true;
        }
        for (const bar of toAddFlags)
        {
            next.push(bar);
            seenNext[bar.autoKey] = true;
        }
        for (const bar of toAddBondXp)
        {
            next.push(bar);
            seenNext[bar.autoKey] = true;
        }
        await setTokenFlag(doc, MODULE_ID, FLAG_EXTRAS, next);
        await setTokenFlag(doc, MODULE_ID, FLAG_AUTO_KEYS, seenNext);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | _autoInjectCounters failed`, err);
    }
}

// Build an auto-injected entry from an enumerated counter + style settings.
function _buildAutoInjectedEntry(counter, color, widthPct, feedback = true)
{
    const base = _defaultExtraBar();
    return {
        ...base,
        id: foundry.utils.randomID(),
        autoKey: counter.autoKey,
        label: counter.label,
        layoutMode: 'newLine',
        widthPct,
        color: { kind: 'solid', stops: [color] },
        icon: DEFAULT_EXTRA_BAR_ICON,
        valueSource: { kind: 'path', path: counter.valuePath, value: 0 },
        maxSource: { kind: 'path', path: counter.maxPath, value: 1 },
        segmented: true,
        showLabelInHint: true,
        visibility: 'scanned',
        audioTextFeedback: feedback,
    };
}

// Derived bar for a fraction custom flag. Deterministic id keeps row identity across reinjects.
function _buildCustomFlagBar(actor, flag)
{
    const base = _defaultExtraBar();
    const key = altFlags.flagKeyForActor(actor);
    return {
        ...base,
        id: `laflag-${flag.id}`,
        autoKey: `flag:${key}:${flag.id}`,
        label: flag.name || 'Custom',
        layoutMode: 'newLine',
        widthPct: 100,
        color: { kind: 'solid', stops: [flag.color || '#ffffff'] },
        icon: flag.icon || DEFAULT_EXTRA_BAR_ICON,
        valueSource: { kind: 'path', path: flag.valuePath, value: 0 },
        maxSource: { kind: 'path', path: flag.maxPath, value: 1 },
        segmented: false,
        showLabelInHint: true,
        visibility: flag.showInSidebar ? 'all' : 'scanned',
    };
}

// React to alt-sheets custom-flag changes: reinject on structural change, else just redraw; refresh TAH.
async function _onCustomFlagsChanged(actor, changes, options)
{
    const structural = altFlags.barLinkChanged(changes)
        || (!options?.laFlagValueWrite && altFlags.structuralChange(changes));
    for (const tok of actor.getActiveTokens())
    {
        if (structural && game.users?.activeGM?.isSelf)
            await _resetAutoInjectedExtras(tok.document);
        try
        {
            tok.drawBars();
        }
        catch
        { /* ignore */ }
    }
    try
    {
        Hooks.callAll('forceUpdateTokenActionHud');
    }
    catch
    { /* ignore */ }
}

// Single setFlag write avoids read-after-write race; works without active-GM gating.
async function _resetAutoInjectedExtras(tokenDoc)
{
    try
    {
        const doc = /** @type {any} */ (tokenDoc)?.document ?? tokenDoc;
        if (!doc)
            return false;
        const existing = doc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
        const kept = existing.filter(/** @type {any} */ entry => !entry?.autoKey);
        const fresh = [];
        const nextSeen = {};
        const actor = doc.actor;
        const isLancer = actor && ['mech', 'pilot', 'npc'].includes(actor.type);
        if (isLancer && game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENTS))
        {
            const color = game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_COLOR) || '#196161';
            const widthPct = Math.max(1, Math.min(100, Number(game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_WIDTH)) || 100));
            const feedback = !!game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_FEEDBACK);
            for (const counter of _enumerateAutoCounters(actor))
            {
                fresh.push(_buildAutoInjectedEntry(counter, color, widthPct, feedback));
                nextSeen[counter.autoKey] = true;
            }
        }
        if (actor)
        {
            for (const template of _enumerateLinkedTemplates(actor))
            {
                fresh.push(_materializeLinkedTemplate(template));
                nextSeen[template.autoKey] = true;
            }
            if (altFlags.isActive() && game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_CUSTOM_FLAGS))
            {
                for (const flag of altFlags.listLinkedFractionFlags(actor))
                {
                    const bar = _buildCustomFlagBar(actor, flag);
                    fresh.push(bar);
                    nextSeen[bar.autoKey] = true;
                }
            }
        }
        await setTokenFlag(doc, MODULE_ID, FLAG_EXTRAS, [...kept, ...fresh]);
        await setTokenFlag(doc, MODULE_ID, FLAG_AUTO_KEYS, nextSeen);
        return true;
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | _resetAutoInjectedExtras failed`, err);
        return false;
    }
}

// Group extras into lines respecting layoutMode + 100% width cap. Overflow wraps.
function _groupExtrasIntoLines(extras)
{
    const lines = [];
    let currentLine = null;
    for (const extra of extras ?? [])
    {
        const widthPct = Math.max(1, Math.min(100, Number(extra?.widthPct) || 100));
        const breaks = !currentLine || extra?.layoutMode === 'newLine' || (currentLine.used + widthPct) > 100;
        if (breaks)
        {
            currentLine = { entries: [], used: 0 };
            lines.push(currentLine);
        }
        currentLine.entries.push({ entry: extra, width: widthPct });
        currentLine.used += widthPct;
    }
    return lines;
}

export function _defaultExtraBar()
{
    return {
        id: foundry.utils.randomID(),
        label: '',
        layoutMode: 'newLine',
        widthPct: 100,
        valueSource: { kind: 'path', path: 'system.hp.value', value: 0 },
        maxSource: { kind: 'path', path: 'system.hp.max', value: 1 },
        segmented: true,
        segments: 4,
        color: { kind: 'solid', stops: ['#66cc66'] },
        visibility: 'scanned',
        icon: DEFAULT_EXTRA_BAR_ICON,
        showLabelInHint: true,
        linkedItemUuid: '',
        audioTextFeedback: true,
    };
}

// Polymorphic target: Token / Item / Actor / uuid / id â†’ { kind, doc } or null.
async function _resolveTarget(target)
{
    if (!target)
        return null;
    if (typeof target === 'string')
    {
        try
        {
            if (target.includes('.'))
            {
                const doc = /** @type {any} */ (await fromUuid(target));
                if (!doc)
                    return null;
                if (doc.documentName === 'Token')
                    return { kind: 'token', doc };
                if (doc.documentName === 'Item')
                    return { kind: 'item', doc };
                if (doc.documentName === 'Actor')
                    return { kind: 'actor', doc };
                if (doc.token)
                    return { kind: 'token', doc: doc.token };
                return null;
            }
            const tokenDoc = await _resolveTokenDocument(target);
            return tokenDoc ? { kind: 'token', doc: tokenDoc } : null;
        }
        catch
        {
            return null;
        }
    }
    const documentName = /** @type {any} */ (target).documentName;
    if (documentName === 'Item')
        return { kind: 'item', doc: target };
    if (documentName === 'Actor')
        return { kind: 'actor', doc: target };
    if (documentName === 'Token')
        return { kind: 'token', doc: target };
    const inner = /** @type {any} */ (target).document;
    if (inner?.documentName === 'Token')
        return { kind: 'token', doc: inner };
    return null;
}

// Walk actor + its items for extraBarTemplates. Returns [{ autoKey, sourceUuid, entry }].
function _enumerateLinkedTemplates(actor)
{
    const out = [];
    if (!actor)
        return out;
    const actorList = /** @type {any} */ (actor).getFlag?.(MODULE_ID, FLAG_TEMPLATES) ?? [];
    const actorSrc = `actor:${actor.id}`;
    for (const record of actorList)
    {
        if (!record?.id || !record.entry || !linkTierGate(record.entry, actor))
            continue;
        out.push({ autoKey: `linked:${record.id}:${actorSrc}`, sourceUuid: actor.uuid, entry: record.entry });
    }
    for (const item of actor.items ?? [])
    {
        const itemList = /** @type {any} */ (item).getFlag?.(MODULE_ID, FLAG_TEMPLATES) ?? [];
        for (const record of itemList)
        {
            if (!record?.id || !record.entry || !linkTierGate(record.entry, actor, item))
                continue;
            out.push({ autoKey: `linked:${record.id}:${item.uuid}`, sourceUuid: item.uuid, entry: record.entry });
        }
    }
    return out;
}

function _materializeLinkedTemplate(record)
{
    const merged = foundry.utils.mergeObject(_defaultExtraBar(), record.entry ?? {}, { inplace: false });
    // Fall back to the auto-inject world settings for fields the template didn't specify.
    if (record.entry?.widthPct === undefined)
        merged.widthPct = Math.max(1, Math.min(100, Number(game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_WIDTH)) || 100));
    if (record.entry?.color === undefined)
        merged.color = { kind: 'solid', stops: [game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_COLOR) || '#196161'] };
    if (record.entry?.audioTextFeedback === undefined)
        merged.audioTextFeedback = !!game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_FEEDBACK);
    merged.id = foundry.utils.randomID();
    merged.autoKey = record.autoKey;
    merged.linkedItemUuid = merged.linkedItemUuid || record.sourceUuid;
    return merged;
}

// Scoped reinject (one actor's tokens + prototype). Callers: link/unlink/update.
export async function reinjectAutoBarsForActor(actor)
{
    if (!actor)
        return 0;
    let count = 0;
    for (const scene of game.scenes ?? [])
    {
        for (const tokenDoc of scene.tokens ?? [])
        {
            if (tokenDoc.actor?.id !== actor.id)
                continue;
            if (await _resetAutoInjectedExtras(tokenDoc))
                count++;
        }
    }
    const proto = /** @type {any} */ (actor.prototypeToken ?? actor.token);
    if (proto && await _resetAutoInjectedExtras(proto))
        count++;
    return count;
}

// value: number | numeric string | delta string ("+2"/"-3"). Delta ignored if currentBase is null.
function _coerceValueOrDelta(value, currentBase)
{
    if (typeof value === 'string')
    {
        const raw = value.trim();
        const num = Number(raw);
        if (!Number.isFinite(num))
            return null;
        return (raw.startsWith('+') || raw.startsWith('-')) && currentBase !== null
            ? (Number(currentBase) || 0) + num
            : num;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * @returns {Promise<number|null>} the new value, or null on failure.
 */
export async function updateExtraBarValue(target, entryId, value)
{
    const resolved = await _resolveTarget(target);
    if (!resolved || !entryId)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: invalid target or entryId`);
        return null;
    }
    if (resolved.kind === 'token')
        return _updateExtraBarValueOnToken(resolved.doc, entryId, value);
    return _updateExtraBarValueOnTemplate(resolved.doc, entryId, value);
}

/**
 * @returns {Promise<string|null>} the new entry / template id, or null on failure.
 */
export async function addExtraBar(target, partial = {})
{
    const resolved = await _resolveTarget(target);
    if (!resolved)
    {
        console.warn(`${MODULE_ID} | addExtraBar: invalid target`);
        return null;
    }
    if (partial && typeof partial !== 'object')
    {
        console.warn(`${MODULE_ID} | addExtraBar: partial must be an object`);
        return null;
    }
    if (resolved.kind === 'token')
        return _addExtraBarToToken(resolved.doc, partial);
    return _addExtraBarToTemplate(resolved.doc, partial);
}

/**
 * @returns {Promise<boolean>} true if removed.
 */
export async function removeExtraBar(target, entryId)
{
    const resolved = await _resolveTarget(target);
    if (!resolved || !entryId)
    {
        console.warn(`${MODULE_ID} | removeExtraBar: invalid target or entryId`);
        return false;
    }
    if (resolved.kind === 'token')
        return _removeExtraBarFromToken(resolved.doc, entryId);
    return _removeExtraBarFromTemplate(resolved.doc, entryId);
}

// Token â†’ statBarExtras entries. Item/Actor â†’ template records [{ id, entry }].
/** @returns {Array<any>} Extra bar entries on the document */
export function getExtraBars(target)
{
    if (!target)
        return [];
    const documentName = /** @type {any} */ (target).documentName;
    if (documentName === 'Item' || documentName === 'Actor')
        return /** @type {any} */ (target).getFlag?.(MODULE_ID, FLAG_TEMPLATES) ?? [];
    if (documentName === 'Token')
        return /** @type {any} */ (target).getFlag?.(MODULE_ID, FLAG_EXTRAS) ?? [];
    const inner = /** @type {any} */ (target).document;
    if (inner?.documentName === 'Token')
        return inner.getFlag?.(MODULE_ID, FLAG_EXTRAS) ?? [];
    return [];
}

async function _updateExtraBarValueOnToken(tokenDoc, entryId, value)
{
    const extras = foundry.utils.deepClone(/** @type {any} */ (tokenDoc).getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);
    const entry = extras.find(/** @type {any} */ item => item.id === entryId);
    if (!entry)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: entry ${entryId} not found on token`);
        return null;
    }
    // Custom-flag bars: the value lives in the alt-sheets flag, so write it there.
    if (entry.autoKey?.startsWith('flag:'))
    {
        const flagActor = /** @type {any} */ (tokenDoc).actor;
        const flagId = entry.autoKey.split(':')[2];
        return flagActor && flagId ? altFlags.writeFlagValue(flagActor, flagId, value) : null;
    }
    // Path-bound bars are read-only via this API (the source path owns the value).
    if (entry.valueSource?.kind !== 'manual')
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: entry ${entryId} is not manual`);
        return null;
    }
    const next = _coerceValueOrDelta(value, entry.valueSource.value);
    if (next === null)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: NaN value "${value}"`);
        return null;
    }
    entry.valueSource.value = next;
    try
    {
        await /** @type {any} */ (tokenDoc).setFlag(MODULE_ID, FLAG_EXTRAS, extras);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: setFlag failed`, err);
        return null;
    }
    return next;
}

async function _updateExtraBarValueOnTemplate(sourceDoc, templateId, value)
{
    const list = foundry.utils.deepClone(/** @type {any} */ (sourceDoc).getFlag(MODULE_ID, FLAG_TEMPLATES) ?? []);
    const record = list.find(/** @type {any} */ item => item.id === templateId);
    if (!record)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: template ${templateId} not found`);
        return null;
    }
    const valueSource = record.entry?.valueSource ?? {};
    if (valueSource.kind === 'manual')
    {
        const next = _coerceValueOrDelta(value, valueSource.value);
        if (next === null)
            return null;
        valueSource.value = next;
        record.entry.valueSource = valueSource;
        try
        {
            await /** @type {any} */ (sourceDoc).setFlag(MODULE_ID, FLAG_TEMPLATES, list);
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | updateExtraBarValue: template setFlag failed`, err);
            return null;
        }
        const actor = sourceDoc.documentName === 'Actor' ? sourceDoc : sourceDoc.actor;
        await reinjectAutoBarsForActor(actor);
        return next;
    }
    if (valueSource.kind === 'path' && valueSource.path)
    {
        const next = _coerceValueOrDelta(value, foundry.utils.getProperty(sourceDoc, valueSource.path));
        if (next === null)
            return null;
        try
        {
            await sourceDoc.update({ [valueSource.path]: next });
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | updateExtraBarValue: path update failed`, err);
            return null;
        }
        return next;
    }
    console.warn(`${MODULE_ID} | updateExtraBarValue: template has unsupported valueSource`);
    return null;
}

async function _addExtraBarToToken(tokenDoc, partial)
{
    const extras = foundry.utils.deepClone(/** @type {any} */ (tokenDoc).getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);
    const base = { ..._defaultExtraBar(), visibility: 'scanned', audioTextFeedback: true };
    const entry = foundry.utils.mergeObject(base, partial ?? {}, { inplace: false });
    if (!entry.id || extras.some(/** @type {any} */ item => item.id === entry.id))
        entry.id = foundry.utils.randomID();
    extras.push(entry);
    try
    {
        await /** @type {any} */ (tokenDoc).setFlag(MODULE_ID, FLAG_EXTRAS, extras);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | addExtraBar: setFlag failed`, err);
        return null;
    }
    return entry.id;
}

async function _addExtraBarToTemplate(sourceDoc, partial)
{
    const list = foundry.utils.deepClone(/** @type {any} */ (sourceDoc).getFlag(MODULE_ID, FLAG_TEMPLATES) ?? []);
    // Templates store ONLY user-authored fields; settings + _defaultExtraBar fill the rest at inject time.
    const entry = { ...(partial ?? {}) };
    if (!entry.valueSource)
        entry.valueSource = { kind: 'manual', value: 0 };
    if (!entry.maxSource)
        entry.maxSource = { kind: 'manual', value: 1 };
    if (entry.visibility === undefined)
        entry.visibility = 'scanned';
    const templateId = foundry.utils.randomID();
    list.push({ id: templateId, entry });
    try
    {
        await /** @type {any} */ (sourceDoc).setFlag(MODULE_ID, FLAG_TEMPLATES, list);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | addExtraBar: template setFlag failed`, err);
        return null;
    }
    const actor = sourceDoc.documentName === 'Actor' ? sourceDoc : sourceDoc.actor;
    await reinjectAutoBarsForActor(actor);
    return templateId;
}

async function _removeExtraBarFromToken(tokenDoc, entryId)
{
    const extras = foundry.utils.deepClone(/** @type {any} */ (tokenDoc).getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);
    const removed = extras.find(/** @type {any} */ item => item.id === entryId);
    const next = extras.filter(/** @type {any} */ item => item.id !== entryId);
    if (next.length === extras.length)
        return false;
    try
    {
        await /** @type {any} */ (tokenDoc).setFlag(MODULE_ID, FLAG_EXTRAS, next);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | removeExtraBar: setFlag failed`, err);
        return false;
    }
    // Custom-flag bars are derived; removing the bar just unlinks it (the flag stays on the sheet).
    if (removed?.autoKey?.startsWith('flag:'))
    {
        const flagActor = /** @type {any} */ (tokenDoc).actor;
        const flagId = removed.autoKey.split(':')[2];
        if (flagActor && flagId)
        {
            try
            {
                await altFlags.setBarLink(flagActor, flagId, false);
            }
            catch
            { /* ignore */ }
        }
    }
    return true;
}

async function _removeExtraBarFromTemplate(sourceDoc, templateId)
{
    const list = /** @type {any} */ (sourceDoc).getFlag(MODULE_ID, FLAG_TEMPLATES) ?? [];
    const next = list.filter(/** @type {any} */ record => record.id !== templateId);
    if (next.length === list.length)
        return false;
    try
    {
        await /** @type {any} */ (sourceDoc).setFlag(MODULE_ID, FLAG_TEMPLATES, next);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | removeExtraBar: template setFlag failed`, err);
        return false;
    }
    const actor = sourceDoc.documentName === 'Actor' ? sourceDoc : sourceDoc.actor;
    const sourceUuid = sourceDoc.documentName === 'Actor' ? `actor:${sourceDoc.id}` : sourceDoc.uuid;
    const autoKey = `linked:${templateId}:${sourceUuid}`;
    for (const scene of game.scenes ?? [])
    {
        for (const tokenDoc of scene.tokens ?? [])
        {
            if (tokenDoc.actor?.id !== actor?.id)
                continue;
            const cur = tokenDoc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
            if (!cur.some(/** @type {any} */ entry => entry.autoKey === autoKey))
                continue;
            const pruned = cur.filter(/** @type {any} */ entry => entry.autoKey !== autoKey);
            try
            {
                await tokenDoc.setFlag(MODULE_ID, FLAG_EXTRAS, pruned);
                const seen = { ...(tokenDoc.getFlag(MODULE_ID, FLAG_AUTO_KEYS) ?? {}) };
                delete seen[autoKey];
                await tokenDoc.setFlag(MODULE_ID, FLAG_AUTO_KEYS, seen);
            }
            catch (err)
            {
                console.warn(`${MODULE_ID} | removeExtraBar: prune failed`, err);
            }
        }
    }
    return true;
}

export const ExtraBarsAPI = { updateExtraBarValue, addExtraBar, removeExtraBar, getExtraBars };

function _escAttr(str)
{
    return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _renderExtraBarRowHtml(entry, idx, overflow, collapsed)
{
    const valueSource = entry.valueSource ?? {};
    const maxSource = entry.maxSource ?? {};
    const stops = entry.color?.stops ?? ['#888888'];
    const summary = entry.label || (valueSource.kind === 'path' ? (valueSource.path || 'unset') : `${valueSource.value ?? 0}`);
    return `
        <div class="la-extra-bar-row${collapsed ? ' collapsed' : ''}" data-idx="${idx}" data-id="${entry.id}">
            <div class="la-extra-bar-header">
                <span class="la-extra-bar-drag" draggable="true" title="Drag to reorder">â‰¡</span>
                <button type="button" class="la-extra-bar-toggle" title="${collapsed ? 'Expand' : 'Collapse'}">
                    <i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i>
                </button>
                <input type="text" class="la-extra-bar-label" data-field="label" value="${_escAttr(entry.label ?? '')}" placeholder="Label" maxlength="14">
                <span class="la-extra-bar-summary" title="${_escAttr(summary)}">${_escAttr(summary)}</span>
                <input type="number" data-field="widthPct" value="${entry.widthPct}" min="1" max="100" step="1" title="Width %" class="la-extra-bar-width" style="${overflow ? 'border-color:#c33;color:#c33;' : ''}">
                <span class="la-extra-bar-pct">%</span>
                ${(() =>
                {
                    const vis = entry.visibility ?? (entry.ownerOnly === true ? 'owner' : entry.ownerOnly === false ? 'all' : 'scanned');
                    return `<select class="la-extra-bar-vis" data-field="visibility" title="Visibility: who sees this bar">
                        <option value="owner" ${vis === 'owner' ? 'selected' : ''}>Owner only</option>
                        <option value="scanned" ${vis === 'scanned' ? 'selected' : ''}>Scanned</option>
                        <option value="all" ${vis === 'all' ? 'selected' : ''}>All</option>
                    </select>`;
                })()}
                <button type="button" class="la-extra-bar-del" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
            <div class="la-extra-bar-body" style="${collapsed ? 'display:none;' : ''}">
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Layout</span>
                    <select data-field="layoutMode">
                        <option value="newLine" ${entry.layoutMode === 'newLine' ? 'selected' : ''}>New line</option>
                        <option value="sameLine" ${entry.layoutMode === 'sameLine' ? 'selected' : ''}>Same line</option>
                    </select>
                </div>
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Value</span>
                    <select data-field="valueSource.kind">
                        <option value="path" ${valueSource.kind === 'path' ? 'selected' : ''}>Path</option>
                        <option value="manual" ${valueSource.kind === 'manual' ? 'selected' : ''}>Manual</option>
                    </select>
                    <input type="text" data-field="valueSource.path" value="${_escAttr(valueSource.path ?? '')}" placeholder="system.hp.value" class="la-extra-bar-grow" style="${valueSource.kind !== 'path' ? 'display:none;' : ''}">
                    <input type="number" data-field="valueSource.value" value="${valueSource.value ?? 0}" step="1" style="${valueSource.kind !== 'manual' ? 'display:none;' : ''}">
                </div>
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Max</span>
                    <select data-field="maxSource.kind">
                        <option value="path" ${maxSource.kind === 'path' ? 'selected' : ''}>Path</option>
                        <option value="manual" ${maxSource.kind === 'manual' ? 'selected' : ''}>Manual</option>
                    </select>
                    <input type="text" data-field="maxSource.path" value="${_escAttr(maxSource.path ?? '')}" placeholder="system.hp.max" class="la-extra-bar-grow" style="${maxSource.kind !== 'path' ? 'display:none;' : ''}">
                    <input type="number" data-field="maxSource.value" value="${maxSource.value ?? 1}" step="1" style="${maxSource.kind !== 'manual' ? 'display:none;' : ''}">
                </div>
                <div class="la-extra-bar-line">
                    <label class="la-extra-bar-cb" title="Display as discrete pips using the max value as the segment count."><input type="checkbox" data-field="segmented" ${entry.segmented ? 'checked' : ''}><span>Segmented</span></label>
                    <span class="la-extra-bar-tag" style="margin-left:auto;">Color</span>
                    <input type="color" data-field="color.stops.0" value="${stops[0] ?? '#888888'}">
                </div>
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Icon</span>
                    <img class="la-extra-bar-icon-preview" src="${_escAttr(entry.icon ?? DEFAULT_EXTRA_BAR_ICON)}" alt="" onerror="this.style.opacity='0.3';">
                    <input type="text" data-field="icon" value="${_escAttr(entry.icon ?? DEFAULT_EXTRA_BAR_ICON)}" placeholder="${DEFAULT_EXTRA_BAR_ICON}" class="la-extra-bar-grow">
                    <button type="button" class="la-extra-bar-icon-pick" title="Browse files"><i class="fas fa-file-import"></i></button>
                    <label class="la-extra-bar-cb" title="Show label next to the icon in the hover stat hint"><input type="checkbox" data-field="showLabelInHint" ${entry.showLabelInHint ? 'checked' : ''}><span>Show label in hint</span></label>
                    <label class="la-extra-bar-cb" title="Float a +/- text over the token and play the generic_stat sound on value change"><input type="checkbox" data-field="audioTextFeedback" ${entry.audioTextFeedback ? 'checked' : ''}><span>Audio/Text Feedback</span></label>
                </div>
                ${entry.autoKey ? '' : `
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag" title="Right-click in TAH Resources opens this item's sheet.">Linked Item</span>
                    <input type="text" data-field="linkedItemUuid" value="${_escAttr(entry.linkedItemUuid ?? '')}" placeholder="Actor.X.Item.Y (UUID)" class="la-extra-bar-grow" readonly>
                    <button type="button" class="la-extra-bar-item-pick" title="Pick an item from the actor"><i class="fas fa-link"></i></button>
                    <button type="button" class="la-extra-bar-item-clear" title="Clear linked item"><i class="fas fa-times"></i></button>
                </div>`}
            </div>
        </div>
    `;
}

// Inject CSS once for the extra-bars editor.
function _ensureExtraBarsStyles()
{
    if (document.getElementById('la-extra-bars-styles'))
        return;
    const styleEl = document.createElement('style');
    styleEl.id = 'la-extra-bars-styles';
    styleEl.textContent = `
        /* Span both columns of the form grid and lay the section out vertically. */
        .la-extra-bars-group { grid-column: 1 / -1; display: block !important; }
        .la-extra-bars-group > label { display: block; margin-bottom: 4px; }
        .la-extra-bars-group > .notes { display: block; margin-top: 6px; }
        .la-extra-bars-list { display: flex; flex-direction: column; gap: 4px; margin: 4px 0; width: 100%; }
        .la-extra-bar-row { border: 1px solid #888; border-radius: 3px; background: rgba(0,0,0,0.04); width: 100%; box-sizing: border-box; }
        .la-extra-bar-row.dragging { opacity: 0.4; }
        .la-extra-bar-row.drag-over { border-color: var(--color-warm-1, #c97a2b); }
        .la-extra-bar-row.collapsed { background: rgba(0,0,0,0.02); }
        .la-extra-bar-header { display: flex; align-items: center; gap: 4px; padding: 4px 6px; width: 100%; box-sizing: border-box; }
        .la-extra-bar-body { display: flex; flex-direction: column; gap: 4px; padding: 4px 6px 6px; border-top: 1px dashed rgba(128,128,128,0.4); }
        .la-extra-bar-line { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; width: 100%; }
        .la-extra-bar-tag { font-size: 0.75em; text-transform: uppercase; opacity: 0.65; letter-spacing: 0.05em; min-width: 44px; flex-shrink: 0; }
        .la-extra-bar-drag { cursor: grab; user-select: none; padding: 0 2px; font-size: 1.1em; opacity: 0.55; flex-shrink: 0; }
        .la-extra-bar-drag:active { cursor: grabbing; }
        .la-extra-bar-toggle { background: none; border: none; cursor: pointer; padding: 2px 4px; color: inherit; opacity: 0.7; flex-shrink: 0; }
        .la-extra-bar-toggle:hover { opacity: 1; }
        .la-extra-bar-label { width: 110px; flex-shrink: 0; }
        .la-extra-bar-summary { font-size: 0.8em; opacity: 0.6; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 4px; font-family: var(--font-mono, monospace); }
        .la-extra-bar-row:not(.collapsed) .la-extra-bar-summary { display: none; }
        .la-extra-bar-width { width: 50px; flex-shrink: 0; }
        .la-extra-bar-pct { opacity: 0.55; font-size: 0.85em; margin-left: -2px; }
        .la-extra-bar-cb { display: inline-flex; align-items: center; gap: 3px; font-size: 0.85em; white-space: nowrap; flex-shrink: 0; }
        .la-extra-bar-cb input { margin: 0; width: auto; }
        .la-extra-bar-del { background: none; border: 1px solid #c33; color: #c33; padding: 2px 6px; border-radius: 3px; cursor: pointer; flex-shrink: 0; }
        .la-extra-bar-del:hover { background: #c33; color: #fff; }
        .la-extra-bar-stops { padding: 2px 6px; cursor: pointer; flex-shrink: 0; }
        .la-extra-bars-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px; }
        .la-extra-bars-add, .la-extra-bars-reset { padding: 4px 10px; cursor: pointer; }
        .la-extra-bars-reset { background: rgba(25, 97, 97, 0.18); border-color: #196161; }
        .la-extra-bars-reset:hover { background: rgba(25, 97, 97, 0.32); }
        /* Compact form controls so multiple fit on a line. */
        .la-extra-bar-row select, .la-extra-bar-row input[type="text"], .la-extra-bar-row input[type="number"] { height: 24px; padding: 0 4px; font-size: 0.9em; box-sizing: border-box; }
        .la-extra-bar-row select { width: auto; min-width: 90px; }
        .la-extra-bar-row input[type="number"] { width: 60px; }
        .la-extra-bar-grow { flex: 1; min-width: 100px; }
        .la-extra-bar-row input[type="color"] { width: 28px; height: 24px; padding: 0; cursor: pointer; flex-shrink: 0; border-radius: 3px; }
        .la-extra-bar-icon-preview { width: 22px; height: 22px; flex-shrink: 0; object-fit: contain; background: rgba(0,0,0,0.25); border: 1px solid #888; border-radius: 3px; padding: 1px; }
        .la-extra-bar-icon-pick { padding: 2px 6px; cursor: pointer; flex-shrink: 0; background: none; border: 1px solid #888; border-radius: 3px; color: inherit; height: 24px; }
        .la-extra-bar-icon-pick:hover { background: rgba(255,255,255,0.05); }
    `;
    document.head.appendChild(styleEl);
}

function _bindExtraBarsUI(root, tokenDoc, app, storeOverride = null)
{
    _ensureExtraBarsStyles();
    const listEl = root.querySelector?.('[data-extras]');
    const addBtn = root.querySelector?.('.la-extra-bars-add');
    const formEl = root.querySelector?.('form') ?? root.closest?.('form') ?? root;
    if (!listEl || !addBtn || !formEl)
        return;

    // Default reads/writes FLAG_EXTRAS; callers pass storeOverride for prototype config.
    const store = storeOverride ?? {
        read: () => tokenDoc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [],
        write: (working) => tokenDoc.setFlag(MODULE_ID, FLAG_EXTRAS, working),
        onReset: () => _resetAutoInjectedExtras(tokenDoc),
    };

    // Working copy. Persisted on form submit.
    let workingExtras = foundry.utils.deepClone(store.read());

    // Per-id collapsed state. Existing rows start collapsed so the list is scannable.
    const collapsedIds = new Set(workingExtras.map(/** @type {any} */ entry => entry?.id).filter(Boolean));

    const computeOverflow = () =>
    {
        const lines = _groupExtrasIntoLines(workingExtras);
        // Mark every entry whose requested width pushed it onto a new line.
        const overflowing = new Set();
        let currentLine = null;
        for (const extra of workingExtras)
        {
            const widthPct = Math.max(1, Math.min(100, Number(extra?.widthPct) || 100));
            const breaks = !currentLine || extra?.layoutMode === 'newLine' || (currentLine.used + widthPct) > 100;
            if (breaks)
            {
                if (currentLine && extra?.layoutMode === 'sameLine' && (currentLine.used + widthPct) > 100)
                    overflowing.add(extra.id);
                currentLine = { used: 0 };
            }
            currentLine.used += widthPct;
        }
        void lines;
        return overflowing;
    };

    const rerender = () =>
    {
        const overflowing = computeOverflow();
        listEl.innerHTML = workingExtras.map((entry, i) => _renderExtraBarRowHtml(entry, i, overflowing.has(entry.id), collapsedIds.has(entry.id))).join('');
        bindRow();
        if (typeof app.setPosition === 'function')
            app.setPosition({ height: 'auto' });
    };

    const setField = (entry, field, value) =>
    {
        if (field.includes('.'))
            foundry.utils.setProperty(entry, field, value);
        else
            entry[field] = value;
    };

    const bindRow = () =>
    {
        listEl.querySelectorAll('.la-extra-bar-row').forEach(/** @type {any} */(rowEl) =>
        {
            const idx = Number(rowEl.dataset.idx);
            const entry = workingExtras[idx];
            if (!entry)
                return;

            rowEl.querySelectorAll('[data-field]').forEach(/** @type {any} */(input) =>
            {
                input.addEventListener('change', () =>
                {
                    const field = input.dataset.field;
                    let value;
                    if (input.type === 'checkbox')
                        value = input.checked;
                    else if (input.type === 'number')
                        value = Number(input.value) || 0;
                    else
                        value = input.value;
                    setField(entry, field, value);
                    // Re-render on changes that affect visibility of dependent fields.
                    if (field === 'valueSource.kind' || field === 'maxSource.kind'
                        || field === 'segmented'
                        || field === 'layoutMode' || field === 'widthPct')

                        rerender();

                });
                input.addEventListener('input', () =>
                {
                    // Live-update on color pickers so the saved value reflects the last pick.
                    if (input.type === 'color')
                        setField(entry, input.dataset.field, input.value);
                });
            });

            rowEl.querySelector('.la-extra-bar-del')?.addEventListener('click', async () =>
            {
                if (entry.autoKey?.startsWith('flag:'))
                {
                    const flagId = entry.autoKey.split(':')[2];
                    if (tokenDoc.actor && flagId)
                        await altFlags.setBarLink(tokenDoc.actor, flagId, false);
                }
                collapsedIds.delete(entry.id);
                workingExtras.splice(idx, 1);
                rerender();
            });

            // Icon path â†’ live-update the preview img on input.
            const iconInput = /** @type {any} */ (rowEl.querySelector('input[data-field="icon"]'));
            const iconPreview = /** @type {any} */ (rowEl.querySelector('.la-extra-bar-icon-preview'));
            iconInput?.addEventListener('input', () =>
            {
                if (iconPreview)
                {
                    iconPreview.src = iconInput.value || DEFAULT_EXTRA_BAR_ICON;
                    iconPreview.style.opacity = '';
                }
            });

            // Icon picker button â†’ open Foundry's FilePicker rooted in modules/lancer-automations/icons.
            rowEl.querySelector('.la-extra-bar-icon-pick')?.addEventListener('click', () =>
            {
                const current = (entry.icon || DEFAULT_EXTRA_BAR_ICON);
                const fp = new FilePicker({
                    type: 'imagevideo',
                    current,
                    callback: (path) =>
                    {
                        entry.icon = path;
                        if (iconInput)
                            iconInput.value = path;
                        if (iconPreview)
                        {
                            iconPreview.src = path;
                            iconPreview.style.opacity = '';
                        }
                    },
                });
                fp.browse();
            });

            // Item picker â†’ choose an Item from the actor (or any actor) to link.
            rowEl.querySelector('.la-extra-bar-item-pick')?.addEventListener('click', async () =>
            {
                const actor = tokenDoc?.actor ?? tokenDoc?.parent?.actor;
                const pilot = actor?.system?.pilot?.value;
                const sources = [];
                if (actor)
                    sources.push({ label: actor.name ?? 'Actor', items: [...(actor.items?.values?.() ?? [])] });
                if (pilot && pilot !== actor)
                    sources.push({ label: `${pilot.name ?? 'Pilot'} (Pilot)`, items: [...(pilot.items?.values?.() ?? [])] });
                const optionGroups = sources.filter(source => source.items.length).map(source =>
                    `<optgroup label="${_escAttr(source.label)}">${source.items.map(item =>
                        `<option value="${_escAttr(item.uuid)}" ${entry.linkedItemUuid === item.uuid ? 'selected' : ''}>${_escAttr(item.name)} [${_escAttr(item.type)}]</option>`
                    ).join('')}</optgroup>`
                ).join('');
                const content = `<form><div class="form-group"><label>Linked Item</label><select name="uuid" style="width:100%;">${optionGroups || '<option value="">(no items found)</option>'}</select></div></form>`;
                const picked = await Dialog.prompt({
                    title: 'Link Item to Extra Bar',
                    content,
                    label: 'Link',
                    callback: (/** @type {any} */ html) =>
                    {
                        const sel = (html?.find?.('select[name="uuid"]')?.[0]) ?? html?.querySelector?.('select[name="uuid"]');
                        return sel?.value ?? '';
                    },
                    rejectClose: false,
                });
                if (typeof picked === 'string')
                {
                    entry.linkedItemUuid = picked;
                    rerender();
                }
            });
            rowEl.querySelector('.la-extra-bar-item-clear')?.addEventListener('click', () =>
            {
                entry.linkedItemUuid = '';
                rerender();
            });

            rowEl.querySelector('.la-extra-bar-toggle')?.addEventListener('click', () =>
            {
                if (collapsedIds.has(entry.id))
                    collapsedIds.delete(entry.id);
                else
                    collapsedIds.add(entry.id);
                rerender();
            });

            // HTML5 drag/drop reorder: dragstart fires from the handle only.
            const dragHandle = rowEl.querySelector('.la-extra-bar-drag');
            if (dragHandle)
            {
                dragHandle.addEventListener('dragstart', (/** @type {any} */ ev) =>
                {
                    rowEl.classList.add('dragging');
                    ev.dataTransfer.effectAllowed = 'move';
                    ev.dataTransfer.setData('text/plain', String(idx));
                });
                dragHandle.addEventListener('dragend', () => rowEl.classList.remove('dragging'));
            }
            rowEl.addEventListener('dragover', (/** @type {any} */ ev) =>
            {
                ev.preventDefault();
                rowEl.classList.add('drag-over');
            });
            rowEl.addEventListener('dragleave', () => rowEl.classList.remove('drag-over'));
            rowEl.addEventListener('drop', (/** @type {any} */ ev) =>
            {
                ev.preventDefault();
                rowEl.classList.remove('drag-over');
                const from = Number(ev.dataTransfer.getData('text/plain'));
                const to = idx;
                if (Number.isFinite(from) && from !== to)
                {
                    const moved = workingExtras.splice(from, 1)[0];
                    workingExtras.splice(to, 0, moved);
                    rerender();
                }
            });
        });
    };

    addBtn.addEventListener('click', () =>
    {
        const entry = _defaultExtraBar();
        workingExtras.push(entry);
        collapsedIds.add(entry.id);
        rerender();
    });

    // Re-syncs auto bars from talents/templates, or wipes them when the world setting is off.
    const resetBtn = root.querySelector?.('.la-extra-bars-reset');
    resetBtn?.addEventListener('click', async () =>
    {
        const settingOn = !!game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENTS);
        // Persist the in-memory edits first so user changes aren't blown away by races.
        try
        {
            await store.write(workingExtras);
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | reset auto: failed to persist current state`, err);
        }
        const ok = await store.onReset();
        if (!ok)
        {
            ui.notifications.warn('Reset failed, see the console.');
            return;
        }
        // Pull the fresh array back into the editor and re-render.
        workingExtras = foundry.utils.deepClone(store.read());
        for (const entry of workingExtras)
        {
            if (entry?.id && entry.autoKey)
                collapsedIds.add(entry.id);
        }
        rerender();
        ui.notifications.info(settingOn
            ? 'Auto-injected bars re-synced.'
            : 'Auto-injected bars removed.');
    });

    // Persist on form submit. Foundry's submit fires before close.
    formEl.addEventListener('submit', () =>
    {
        // Defer so this runs after Foundry's own form-data extraction.
        Promise.resolve().then(() =>
        {
            try
            {
                store.write(workingExtras);
            }
            catch (err)
            {
                console.warn(`${MODULE_ID} | failed to persist extra bars`, err);
            }
        });
    }, true);

    rerender();
}

// Prototype-config store adapter. _tid round-trips the template id via the entry object.
function _makeActorTemplateStore(actor)
{
    return {
        read: () => (actor.getFlag(MODULE_ID, FLAG_TEMPLATES) ?? [])
            .map(/** @type {any} */ record => ({ ...(record.entry ?? {}), _tid: record.id })),
        write: async (entries) =>
        {
            const records = (entries ?? []).map(/** @type {any} */ entry =>
            {
                const { _tid, ...rest } = entry;
                return { id: _tid ?? foundry.utils.randomID(), entry: rest };
            });
            await actor.setFlag(MODULE_ID, FLAG_TEMPLATES, records);
            await reinjectAutoBarsForActor(actor);
        },
        onReset: async () =>
        {
            await reinjectAutoBarsForActor(actor);
            return true;
        },
    };
}

// Scene-token adapter: manuals promote to actor templates; actor-linked rows round-trip via tid.
function _makeSceneTokenStore(actor, tokenDoc)
{
    const actorSrc = `actor:${actor.id}`;
    const linkedActorTid = (autoKey) =>
    {
        if (typeof autoKey !== 'string' || !autoKey.startsWith('linked:'))
            return null;
        if (!autoKey.endsWith(`:${actorSrc}`))
            return null;
        return autoKey.split(':')[1] || null;
    };
    const initialArr = tokenDoc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
    const initiallyVisibleTids = new Set(
        initialArr.map(/** @type {any} */ entry => linkedActorTid(entry?.autoKey)).filter(Boolean),
    );
    return {
        read: () => tokenDoc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [],
        write: async (working) =>
        {
            const workingTids = new Set();
            const newManuals = [];
            const templateUpdates = new Map();
            const tokenRows = [];
            for (const entry of working ?? [])
            {
                if (!entry)
                    continue;
                if (!entry.autoKey)
                {
                    const { _tid, autoKey, ...rest } = entry;
                    newManuals.push(rest);
                    continue;
                }
                const tid = linkedActorTid(entry.autoKey);
                if (tid)
                {
                    workingTids.add(tid);
                    const { _tid, autoKey, id, linkedItemUuid, ...rest } = entry;
                    templateUpdates.set(tid, rest);
                    continue;
                }
                tokenRows.push(entry);
            }
            const existing = actor.getFlag(MODULE_ID, FLAG_TEMPLATES) ?? [];
            const merged = [];
            for (const record of existing)
            {
                const wasVisible = initiallyVisibleTids.has(record.id);
                const stillVisible = workingTids.has(record.id);
                if (wasVisible && !stillVisible)
                    continue;
                if (templateUpdates.has(record.id))
                    merged.push({ id: record.id, entry: templateUpdates.get(record.id) });
                else
                    merged.push(record);
            }
            for (const rest of newManuals)
                merged.push({ id: foundry.utils.randomID(), entry: rest });
            await actor.setFlag(MODULE_ID, FLAG_TEMPLATES, merged);
            await tokenDoc.setFlag(MODULE_ID, FLAG_EXTRAS, tokenRows);
            await reinjectAutoBarsForActor(actor);
        },
        onReset: () => _resetAutoInjectedExtras(tokenDoc),
    };
}

function snapshotValues(actor, tokenDoc = null)
{
    const extras = tokenDoc?.getFlag?.(MODULE_ID, FLAG_EXTRAS) ?? [];
    const extrasSnap = {};
    for (const extra of extras)
    {
        if (!extra?.id)
            continue;
        extrasSnap[extra.id] = _resolveExtraBarValues(actor, extra).value;
    }
    return {
        hp: actor.system?.hp?.value ?? 0,
        heat: actor.system?.heat?.value ?? 0,
        structure: actor.system?.structure?.value ?? 0,
        stress: actor.system?.stress?.value ?? 0,
        pilotStress: actor.system?.bond_state?.stress?.value ?? 0,
        bondXp: actor.system?.bond_state?.xp?.value ?? 0,
        overshield: actor.system?.overshield?.value ?? 0,
        burn: actor.system?.burn ?? 0,
        infection: actor.system?.infection ?? 0,
        reaction: actor.system?.action_tracker?.reaction === true,
        extras: extrasSnap,
    };
}

function refreshVisibleLancerTokens()
{
    if (!isEnabled())
        return;
    if (!canvas?.tokens)
        return;
    for (const tok of canvas.tokens.placeables)
    {
        if (!isLancerCombatant(tok.actor))
            continue;
        if (!_overlayHubs.has(tok.id))
            continue;
        fadeBars(tok, shouldShowBars(tok) ? 1 : 0);
    }
}

// Fade + flash animations

function _getFadeTarget(token)
{
    const entry = _overlayHubs.get(token.id);
    return entry?.wrapper ?? token.bars;
}

function fadeBars(token, targetAlpha)
{
    const target = _getFadeTarget(token);
    if (!target)
        return;
    const id = token.id;
    const cur = _fadeState.get(id);
    if (cur && cur.target === targetAlpha)
        return;
    if (cur)
        canvas.app.ticker.remove(cur.tick);
    const startAlpha = target.alpha ?? 1;
    const duration = 150;
    const startTime = performance.now();

    const tick = () =>
    {
        const fadeTarget = _getFadeTarget(token);
        if (!fadeTarget || token.destroyed)
        {
            canvas.app.ticker.remove(tick);
            _fadeState.delete(id);
            return;
        }
        const progress = Math.min(1, (performance.now() - startTime) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        fadeTarget.alpha = startAlpha + (targetAlpha - startAlpha) * eased;
        if (progress >= 1)
        {
            canvas.app.ticker.remove(tick);
            _fadeState.delete(id);
        }
    };

    _fadeState.set(id, { target: targetAlpha, tick });
    canvas.app.ticker.add(tick);
}

function runFlashAnimation(token, name, drawAt)
{
    const flashGfx = new PIXI.Graphics();
    flashGfx.name = name;
    // Flash goes into the overlay hub if available.
    const entry = _overlayHubs.get(token.id);
    const parent = entry?.hub ?? token;
    parent.addChild(flashGfx);

    const flashStart = performance.now();
    const tick = () =>
    {
        if (!flashGfx || flashGfx.destroyed)
        {
            canvas.app.ticker.remove(tick);
            return;
        }
        const elapsed = performance.now() - flashStart;
        flashGfx.clear();
        if (elapsed < FLASH_HOLD_MS)
        {
            drawAt(flashGfx, 0);
            return;
        }
        const progress = Math.min(1, (elapsed - FLASH_HOLD_MS) / FLASH_SHRINK_MS);
        if (progress >= 1)
        {
            flashGfx.destroy();
            canvas.app.ticker.remove(tick);
            return;
        }
        const eased = 1 - Math.pow(1 - progress, 3);
        drawAt(flashGfx, eased);
    };
    canvas.app.ticker.add(tick);
}

function spawnFlash(token, barId, oldVal, newVal)
{
    const geom = token._laBarsGeom;
    if (!geom || oldVal === newVal)
        return;

    const { layoutOffsetX, pipColW, rowHeight, rowGap, startY, indicatorW, reactionExtension, rightColX, rightColW } = geom;
    const visibleIds = geom.visibleIds;

    if (barId === 'hp' || barId === 'heat' || barId === 'pilotStress')
    {
        if (!visibleIds.has(barId))
            return;
        const rowIdx = barId === 'hp' ? 0 : 1;
        const hostMax = barId === 'pilotStress'
            ? Math.max(token.actor?.system?.bond_state?.stress?.max ?? 8, oldVal, newVal)
            : Math.max(getEffectiveMax(token.actor, barId), oldVal, newVal);
        if (hostMax <= 0)
            return;
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const rowY = startY + rowIdx * (rowHeight + rowGap) + 1;
        const rowH = rowHeight - 2;

        const minVal = Math.min(oldVal, newVal);
        const maxVal = Math.max(oldVal, newVal);
        const isDamage = newVal < oldVal;
        const initialFlashX = barX + (minVal / hostMax) * barW;
        const initialFlashW = ((maxVal - minVal) / hostMax) * barW;
        if (initialFlashW <= 0)
            return;
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) =>
        {
            const remainingW = initialFlashW * (1 - eased);
            const drawX = isDamage
                ? initialFlashX
                : initialFlashX + (initialFlashW - remainingW);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'structure' || barId === 'stress')
    {
        if (!visibleIds.has(barId))
            return;
        const rowIdx = barId === 'structure' ? 0 : 1;
        const pipMax = barId === 'structure'
            ? (token.actor?.system?.structure?.max ?? 0)
            : (token.actor?.system?.stress?.max ?? 0);
        if (pipMax <= 0)
            return;
        const colX = layoutOffsetX;
        const colW = pipColW;
        const rowY = startY + rowIdx * (rowHeight + rowGap) + 1;
        const rowH = rowHeight - 2;

        const pipGapPx = 1;
        const innerW = colW - 2;
        const pipSegW = (innerW - pipGapPx * (pipMax - 1)) / pipMax;
        const oldEmpty = pipMax - oldVal;
        const newEmpty = pipMax - newVal;
        const startIdx = Math.min(oldEmpty, newEmpty);
        const endIdx = Math.max(oldEmpty, newEmpty);
        if (endIdx <= startIdx)
            return;
        const isDamage = newVal < oldVal;
        const flashStartX = colX + 1 + startIdx * (pipSegW + pipGapPx);
        const flashEndX = colX + 1 + endIdx * (pipSegW + pipGapPx) - pipGapPx;
        const initialFlashW = flashEndX - flashStartX;
        if (initialFlashW <= 0)
            return;
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) =>
        {
            const remainingW = initialFlashW * (1 - eased);
            // Pips drain left, so reversed direction.
            const drawX = isDamage
                ? flashStartX + (initialFlashW - remainingW)
                : flashStartX;
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'overshield')
    {
        if (!visibleIds.has('hp'))
            return;
        const hpMax = Math.max(getEffectiveMax(token.actor, 'hp'), oldVal, newVal);
        if (hpMax <= 0)
            return;
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const rowY = startY + 1;
        const rowH = rowHeight - 2;

        const minVal = Math.min(oldVal, newVal);
        const maxVal = Math.max(oldVal, newVal);
        const isDamage = newVal < oldVal;
        const initialFlashX = barX + (minVal / hpMax) * barW;
        const initialFlashW = ((maxVal - minVal) / hpMax) * barW;
        if (initialFlashW <= 0)
            return;
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) =>
        {
            const remainingW = initialFlashW * (1 - eased);
            const drawX = isDamage
                ? initialFlashX
                : initialFlashX + (initialFlashW - remainingW);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'burn' || barId === 'infection')
    {
        const hostId = barId === 'burn' ? 'hp' : 'heat';
        if (!visibleIds.has(hostId))
            return;
        const hostMax = Math.max(getEffectiveMax(token.actor, hostId), oldVal, newVal);
        if (hostMax <= 0)
            return;
        const hostVal = barId === 'burn'
            ? (token.actor?.system?.hp?.value ?? 0)
            : (token.actor?.system?.heat?.value ?? 0);
        const rowIdx = barId === 'burn' ? 0 : 1;
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const rowY = startY + rowIdx * (rowHeight + rowGap) + 1;
        const rowH = rowHeight - 2;

        const isReduction = newVal < oldVal;
        const fillPx = (Math.max(0, hostVal) / hostMax) * barW;

        let flashStartX;
        let flashW;
        if (barId === 'burn')
        {
            const oldEdge = barX + Math.max(0, fillPx - (oldVal / hostMax) * barW);
            const newEdge = barX + Math.max(0, fillPx - (newVal / hostMax) * barW);
            flashStartX = Math.min(oldEdge, newEdge);
            flashW = Math.abs(newEdge - oldEdge);
        }
        else
        {
            const oldEdge = barX + Math.min(barW, fillPx + (oldVal / hostMax) * barW);
            const newEdge = barX + Math.min(barW, fillPx + (newVal / hostMax) * barW);
            flashStartX = Math.min(oldEdge, newEdge);
            flashW = Math.abs(newEdge - oldEdge);
        }
        if (flashW <= 0)
            return;

        const initialFlashX = flashStartX;
        const initialFlashW = flashW;
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) =>
        {
            const remainingW = initialFlashW * (1 - eased);
            // Reversed vs host bar.
            let drawX;
            if (barId === 'burn')
            {
                drawX = isReduction
                    ? initialFlashX + (initialFlashW - remainingW)
                    : initialFlashX;
            }
            else
            {
                drawX = isReduction
                    ? initialFlashX
                    : initialFlashX + (initialFlashW - remainingW);
            }
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'reaction')
    {
        // Reaction hangs off the left edge.
        const rectX = -reactionExtension;
        const rectY = startY + 1;
        const width = indicatorW - 2;
        const height = rowHeight - 2;
        if (width <= 0 || height <= 0)
            return;
        runFlashAnimation(token, 'la-flash-reaction', (gfx, eased) =>
        {
            const remainingH = height * (1 - eased);
            const drawY = rectY + (height - remainingH);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(rectX + 1, drawY, width, remainingH);
            gfx.endFill();
        });
    }
}

// Audio + scrolling text. Fires even without a rendered hub.
function fireExtraFeedback(token, entryId, oldVal, newVal)
{
    if (oldVal === newVal)
        return;
    try
    {
        const extras = /** @type {any} */ (token).document?.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
        const entry = extras.find(/** @type {any} */ extra => extra?.id === entryId);
        if (!entry?.audioTextFeedback)
            return;
        const canSee = _resolveExtraBarVisibility(/** @type {any} */ (token).actor, entry);
        const delta = newVal - oldVal;
        const label = entry.label || 'Stat';
        const text = canSee ? `${delta > 0 ? '+' : ''}${delta} ${label}` : '???';
        if (canvas?.interface?.createScrollingText)
        {
            let showScroll = true;
            try
            {
                showScroll = !!game.settings.get('lancer', 'floatingNumbers');
            }
            catch
            { /* ignore */ }
            if (showScroll)
            {
                const primary = canSee ? (entry.color?.stops?.[0] ?? '#ffffff') : '#888888';
                const floatsUp = entry.autoKey === 'bondXp' ? delta > 0 : delta < 0;
                canvas.interface.createScrollingText(token.center, text, {
                    anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                    direction: floatsUp ? CONST.TEXT_ANCHOR_POINTS.TOP : CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                    fontSize: 28,
                    fill: primary,
                    stroke: 0,
                    strokeThickness: 4,
                    jitter: 0.25,
                });
            }
        }
        playStatsSound('generic_stat');
    }
    catch
    { /* ignore */ }
}

function spawnFlashExtra(token, entryId, oldVal, newVal)
{
    fireExtraFeedback(token, entryId, oldVal, newVal);
    const geom = token._laBarsGeom;
    if (!geom || !Array.isArray(geom.extras) || oldVal === newVal)
        return;
    let target = null;
    let lineY = 0;
    for (const line of geom.extras)
    {
        const found = line.entries.find(/** @type {any} */ entryGeom => entryGeom.entryId === entryId);
        if (found)
        {
            target = found;
            lineY = line.y;
            break;
        }
    }
    if (!target)
        return;

    const { rowHeight } = geom;
    const isDamage = newVal < oldVal;

    if (target.segmented)
    {
        const pipMax = Math.max(1, target.segments);
        const colX = target.x;
        const colW = target.w;
        const rowY = lineY + 1;
        const rowH = rowHeight - 2;
        const pipGapPx = 1;
        const innerW = colW - 2;
        const pipSegW = (innerW - pipGapPx * (pipMax - 1)) / pipMax;
        // LTR fill: changed pips sit between min(old,new) and max(old,new) from the left.
        const minVal = Math.max(0, Math.min(pipMax, Math.min(oldVal, newVal)));
        const maxVal = Math.max(0, Math.min(pipMax, Math.max(oldVal, newVal)));
        if (maxVal <= minVal)
            return;
        const flashStartX = colX + 1 + minVal * (pipSegW + pipGapPx);
        const flashEndX = colX + 1 + maxVal * (pipSegW + pipGapPx) - pipGapPx;
        const initialFlashW = flashEndX - flashStartX;
        if (initialFlashW <= 0)
            return;
        runFlashAnimation(token, `la-flash-extra-${entryId}`, (gfx, eased) =>
        {
            const remainingW = initialFlashW * (1 - eased);
            // Damage: pips drain from the right â†’ flash shrinks from the left.
            const drawX = isDamage
                ? flashStartX
                : flashStartX + (initialFlashW - remainingW);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    // Solid bar: flashes the changed slice; uses target.max for correct delta width.
    const hostMax = Math.max(1, Number(target.max) || 0, oldVal, newVal);
    const barX = target.x + 1;
    const barW = target.w - 2;
    const rowY = lineY + 1;
    const rowH = rowHeight - 2;
    const minVal = Math.min(oldVal, newVal);
    const maxVal = Math.max(oldVal, newVal);
    const initialFlashX = barX + (minVal / hostMax) * barW;
    const initialFlashW = ((maxVal - minVal) / hostMax) * barW;
    if (initialFlashW <= 0)
        return;
    runFlashAnimation(token, `la-flash-extra-${entryId}`, (gfx, eased) =>
    {
        const remainingW = initialFlashW * (1 - eased);
        const drawX = isDamage
            ? initialFlashX
            : initialFlashX + (initialFlashW - remainingW);
        gfx.beginFill(0xffffff, 1);
        gfx.drawRect(drawX, rowY, remainingW, rowH);
        gfx.endFill();
    });
}

// Rendering

const BAKE_RESOLUTION = 4;

// Swaps gfx for a baked sprite at the same z-slot; tracks texture for cleanup.
function bakeAndSwap(container, gfx, tokenId, { addAt } = {})
{
    const sprite = bakeGraphicsToTexture(gfx);
    if (!sprite)
        return false;
    container.removeChild(gfx);
    if (Number.isFinite(addAt))
        container.addChildAt(sprite, addAt);
    else
        container.addChild(sprite);
    gfx.destroy();
    const entry = _overlayHubs.get(tokenId);
    if (entry)
    {
        entry.bakedTextures = entry.bakedTextures || [];
        entry.bakedTextures.push(sprite._laBakedTexture);
    }
    return true;
}

// Bakes gfx to a high-res RenderTexture -> crisp Sprite at any zoom. Caller destroys gfx; texture kept on sprite._laBakedTexture for cleanup.
function bakeGraphicsToTexture(gfx, resolution = BAKE_RESOLUTION)
{
    if (!canvas?.app?.renderer || !gfx)
        return null;
    try
    {
        const bounds = gfx.getLocalBounds();
        if (bounds.width <= 0 || bounds.height <= 0)
            return null;
        const region = new PIXI.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
        const tex = canvas.app.renderer.generateTexture(gfx, {
            resolution,
            region,
            multisample: PIXI.MSAA_QUALITY?.HIGH ?? 4,
        });
        // Mipmaps: GPU uses pre-filtered downsamples instead of 1-of-N nearest sampling (the moirÃ© source).
        if (tex.baseTexture)
        {
            tex.baseTexture.mipmap = PIXI.MIPMAP_MODES?.ON ?? 1;
            tex.baseTexture.anisotropicLevel = 16;
            tex.baseTexture.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? 1;
            tex.baseTexture.update();
        }
        const sprite = new PIXI.Sprite(tex);
        sprite.position.set(bounds.x, bounds.y);
        sprite._laBakedTexture = tex;
        return sprite;
    }
    catch (e)
    {
        console.warn(`${MODULE_ID} | bakeGraphicsToTexture failed`, e);
        return null;
    }
}

function drawSegment(gfx, x, y, w, h, def, barValue, chromeScale = 1)
{
    const max = (barValue.max && barValue.max > 0) ? barValue.max : (def.softMax ?? 1);
    const value = Math.max(0, barValue.value ?? 0);
    const pct = Math.max(0, Math.min(1, value / max));

    gfx.lineStyle(0);
    gfx.beginFill(0x111111, 0.9);
    gfx.drawRect(x, y, w, h);
    gfx.endFill();
    gfx.beginFill(0x222222, 0.9);
    gfx.drawRect(x + chromeScale, y + chromeScale, w - 2 * chromeScale, h - 2 * chromeScale);
    gfx.endFill();

    if (def.pips)
    {
        // Drains left-first (STR/Stress) unless pipsLTR is set (extras fill left-first).
        const gap = chromeScale;
        const inner = w - 2 * chromeScale;
        const segW = (inner - gap * (max - 1)) / max;
        const filledCount = Math.max(0, Math.min(max, value));
        for (let s = 0; s < max; s++)
        {
            const filled = def.pipsLTR ? (s < filledCount) : (s >= max - filledCount);
            gfx.beginFill(filled ? def.color : 0x333333, filled ? 1 : 0.6);
            gfx.drawRect(x + chromeScale + s * (segW + gap), y + chromeScale, segW, h - 2 * chromeScale);
            gfx.endFill();
        }
    }
    else
    {
        const fillW = Math.max(0, (w - 2 * chromeScale) * pct);
        if (fillW > 0)
        {
            gfx.beginFill(def.color, 1);
            gfx.drawRect(x + chromeScale, y + chromeScale, fillW, h - 2 * chromeScale);
            gfx.endFill();
        }
    }
}

function _removeOverlayHub(tokenId)
{
    _removeSyncTicker(tokenId);
    const entry = _overlayHubs.get(tokenId);
    if (!entry)
        return;
    if (!entry.wrapper.destroyed)
        entry.wrapper.destroy({ children: true });
    if (entry.bakedTextures)
    {
        for (const tex of entry.bakedTextures)
        {
            try
            {
                tex.destroy(true);
            }
            catch
            { /* ignore */ }
        }
    }
    _overlayHubs.delete(tokenId);
}

// Per-frame position sync so the hub follows token drag.
const _syncTickers = new Map();

function _ensureSyncTicker(token)
{
    if (_syncTickers.has(token.id))
        return;
    const tick = () =>
    {
        const entry = _overlayHubs.get(token.id);
        if (!entry || token.destroyed)
        {
            canvas.app.ticker.remove(tick);
            _syncTickers.delete(token.id);
            return;
        }
        const active = _activeForId(token.id) ?? token;
        const iso = _getIsoState(active);
        if (iso && active.mesh)
            entry.wrapper.position.set(active.mesh.position.x, active.mesh.position.y);
        else
            entry.wrapper.position.set(active.position.x, active.position.y);
        const minZoom = getWorldSetting(SETTING_MIN_ZOOM_SCALE, 0);
        if (minZoom > 0 && !iso)
        {
            const zoom = canvas.stage?.scale?.x || 1;
            // Use effective bar width so sub-1x1 tokens don't get double-scaled.
            const effW = Math.max(entry.tokenW, entry.width);
            const kx = Math.max(1, (REF_GRID_SIZE * minZoom) / (effW * zoom));
            const ky = Math.max(1, (REF_ROW_HEIGHT * minZoom) / (entry.rowHeight * zoom));
            entry.wrapper.scale.set(kx, ky);
            entry.hub.position.set(
                (entry.tokenW / kx - entry.width) / 2,
                entry.startY / ky
            );
            // Undo non-uniform stretch on labels.
            for (const child of entry.hub.children)
            {
                if (child?.name === 'la-bar-label')
                    child.scale.set((ky / kx) / 8, 1 / 8);
            }
        }
        else if (minZoom > 0 && iso)
        {
            // local axes stay screen-aligned under the counter-transform, so per-axis growth is safe
            const zoom = canvas.stage?.scale?.x || 1;
            const effW = Math.max(entry.tokenW, entry.width);
            const kx = Math.max(1, (REF_GRID_SIZE * minZoom) / (effW * zoom));
            const ky = Math.max(1, (REF_ROW_HEIGHT * minZoom) / (entry.rowHeight * zoom));
            entry.wrapper.scale.set(iso.counterScale * kx, (1 / iso.counterScale) * ky);
            entry.hub.position.set(-entry.width / 2, ((entry.tokenH / 2) + 3 - entry.rowHeight) / ky);
            for (const child of entry.hub.children)
            {
                if (child?.name === 'la-bar-label')
                    child.scale.set((ky / kx) / 8, 1 / 8);
            }
        }
        // Keep the name below the live-scaled hub (non-iso; iso is set on refresh).
        const nameplate = token.nameplate;
        if (nameplate?.visible && !iso)
        {
            nameplate.position.x = token.w / 2;
            nameplate.position.y = shouldShowBars(token)
                ? token.h + 10 + (entry.totalHeight ?? 0) * (entry.wrapper.scale.y - 1)
                : token.h + 2;
        }
    };
    _syncTickers.set(token.id, tick);
    canvas.app.ticker.add(tick);
}

function _removeSyncTicker(tokenId)
{
    const tick = _syncTickers.get(tokenId);
    if (tick)
    {
        canvas.app.ticker.remove(tick);
        _syncTickers.delete(tokenId);
    }
}

// Returns drag preview if available, else source token (both share id in v13).
function _activeForId(tokenId)
{
    const previews = canvas.tokens?.preview?.children ?? [];
    for (const preview of previews)
    {
        if (preview?.document?.id === tokenId && preview.mesh)
            return preview;
    }
    return canvas.tokens?.get?.(tokenId) ?? null;
}

function _syncHubPosition(token)
{
    const entry = _overlayHubs.get(token.id);
    if (!entry)
        return;
    const active = _activeForId(token.id) ?? token;
    const iso = _getIsoState(active);
    if (iso && active.mesh)
        entry.wrapper.position.set(active.mesh.position.x, active.mesh.position.y);
    else
        entry.wrapper.position.set(active.position.x, active.position.y);
    _ensureSyncTicker(token);
}

function drawStatHub()
{
    const token = this;
    const actor = token?.actor;

    if (!token?.bars)
        return;

    token.bars.removeChildren();

    // Preserve flash children before destroying the old hub.
    const oldEntry = _overlayHubs.get(token.id);
    const savedFlashes = [];
    if (oldEntry?.hub)
    {
        for (const child of [...oldEntry.hub.children])
        {
            if (child.name?.startsWith('la-flash-'))
            {
                oldEntry.hub.removeChild(child);
                savedFlashes.push(child);
            }
        }
    }
    _removeOverlayHub(token.id);

    if (!isEnabled() || !isLancerCombatant(actor))
    {
        if (originalDrawBars)
            return originalDrawBars.call(token);
        return;
    }

    token.displayBars = CONST.TOKEN_DISPLAY_MODES.ALWAYS;

    const overlay = getHubOverlay();
    if (!overlay)
        return;

    const visibleIds = new Set(getVisibleBars(actor, token.document).map(def => def.id));
    const find = id => BAR_DEFS.find(def => def.id === id);
    const mechStats = hasMechStats(actor);
    const reactionEnabled = hasReaction(actor);

    const rows = [];
    if (mechStats)
    {
        if (visibleIds.has('structure') || visibleIds.has('hp'))
            rows.push([find('structure'), find('hp')]);
        // Stress is paired with heat: if heat is hidden, drop stress too so
        // we don't render an orphan row.
        if (visibleIds.has('heat'))
            rows.push([find('stress'), find('heat')]);
    }
    else
    {
        // Pilots / deployables: full-width HP row, plus a heat row if heat
        // somehow ended up on them (e.g. infection ticking on a deployable).
        if (visibleIds.has('hp'))
            rows.push([null, find('hp')]);
        if (visibleIds.has('pilotStress'))
            rows.push([null, find('pilotStress')]);
        else if (visibleIds.has('heat'))
            rows.push([null, find('heat')]);
    }

    if (rows.length === 0)
    {
        token.bars.visible = false;
        // Seed snapshot anyway: updateToken/updateActor still need it to diff extras.
        if (!_lastValues.has(token.id))
            _lastValues.set(token.id, snapshotValues(actor, /** @type {any} */ (token).document));
        return;
    }

    // Floor the bar at one grid cell so small tokens stay readable.
    const minBarW = canvas.dimensions?.size ?? token.w;
    const width = Math.min(MAX_BAR_WIDTH, Math.max(token.w, minBarW));
    const rowHeightOverride = statBarRowHeight(token.document);
    const rowHeight = rowHeightOverride > 0
        ? rowHeightOverride
        : Math.max(3, Math.round(canvas.dimensions.size * 0.07));
    const chromeScale = Math.max(0.5, rowHeight / REF_ROW_HEIGHT);
    const rowGap = chromeScale;
    const startY = token.h + Math.max(2, Math.round(rowHeight * 0.4)) - rowHeight;

    // Reaction extends left of the bar block.
    const indicatorW = reactionEnabled ? rowHeight : 0;
    const indicatorGap = reactionEnabled ? chromeScale : 0;
    const reactionExtension = indicatorW + indicatorGap;
    const layoutOffsetX = 0;

    const usableW = width;
    const colGap = mechStats ? chromeScale : 0;
    // Pip column shrinks with fewer pips, capped at 4 for sizing.
    let pipColW = 0;
    if (mechStats)
    {
        const baseColW = Math.floor(usableW * 0.32);
        const innerGap = chromeScale;
        const pipSlotW = (baseColW - 2 * chromeScale - innerGap * 3) / 4;
        const structMax = actor.system?.structure?.max ?? 0;
        const stressMax = actor.system?.stress?.max ?? 0;
        const pipCount = Math.min(4, Math.max(structMax, stressMax, 1));
        pipColW = Math.ceil(pipCount * pipSlotW + innerGap * (pipCount - 1) + 2 * chromeScale);
    }

    // Armor ticks: right of HP bar, GM/owners only.
    const canSeeArmor = game.user?.isGM || actor.isOwner;
    const armorVal = canSeeArmor ? Math.max(0, Math.min(8, actor.system?.armor ?? 0)) : 0;
    const armorTickW = chromeScale * 2;
    const armorTickGap = chromeScale;
    const armorW = armorVal > 0
        ? armorVal * armorTickW + (armorVal - 1) * armorTickGap + 2 * chromeScale
        : 0;
    const armorGap = armorVal > 0 ? colGap : 0;

    const rightColX = layoutOffsetX + pipColW + colGap;
    const rightColW = usableW - pipColW - colGap;

    const wrapper = new PIXI.Container();
    wrapper.name = `la-hub-wrapper-${token.id}`;
    overlay.addChild(wrapper);

    const container = new PIXI.Container();
    container.name = 'la-stat-hub';
    wrapper.addChild(container);

    const iso = _getIsoState(token);
    if (iso && token.mesh)
    {
        wrapper.position.set(token.mesh.position.x, token.mesh.position.y);
        wrapper.rotation = iso.reverseRotation;
        wrapper.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        // K = 1/sqrt(sqrt(3)) â‰ˆ 0.76 cancels the True Iso aspect change.
        const isoScale = 0.76;
        wrapper.scale.set(isoScale, 1 / isoScale);
        container.position.set(-width / 2, (token.h / 2) + 3 - rowHeight);
    }
    else
    {
        wrapper.position.set(token.position.x, token.position.y);
        wrapper.rotation = 0;
        wrapper.skew.set(0, 0);
        wrapper.scale.set(1, 1);
        container.position.set((token.w - width) / 2, startY);
    }

    _overlayHubs.set(token.id, { wrapper, hub: container, width, rowHeight, startY, tokenW: token.w, tokenH: token.h });

    const gfx = new PIXI.Graphics();
    container.addChild(gfx);

    gfx.lineStyle(0);
    // Reaction: hangs off the left edge. Skipped for deployables.
    if (reactionEnabled)
    {
        const reactionAvailable = actor.system?.action_tracker?.reaction === true;
        const reactionX = -reactionExtension;
        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(reactionX, 0, indicatorW, rowHeight);
        gfx.endFill();
        gfx.beginFill(reactionAvailable ? 0x9944cc : 0x333333, reactionAvailable ? 1 : 0.6);
        gfx.drawRect(reactionX + chromeScale, chromeScale, indicatorW - 2 * chromeScale, rowHeight - 2 * chromeScale);
        gfx.endFill();
    }

    rows.forEach((row, rowIdx) =>
    {
        const rowY = rowIdx * (rowHeight + rowGap);
        const [leftDef, rightDef] = row;
        if (leftDef && visibleIds.has(leftDef.id))
            drawSegment(gfx, layoutOffsetX, rowY, pipColW, rowHeight, leftDef, leftDef.getValue(actor), chromeScale);
        if (rightDef && visibleIds.has(rightDef.id))
            drawSegment(gfx, rightColX, rowY, rightColW, rowHeight, rightDef, rightDef.getValue(actor), chromeScale);
    });

    // Armor ticks (HP row, right extension).
    if (armorVal > 0 && visibleIds.has('hp'))
    {
        const armorX = rightColX + rightColW + armorGap;
        const innerH = rowHeight - 2 * chromeScale;
        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(armorX, 0, armorW, rowHeight);
        gfx.endFill();
        for (let i = 0; i < armorVal; i++)
        {
            const tx = armorX + chromeScale + i * (armorTickW + armorTickGap);
            gfx.beginFill(0xc8c8c8, 1);
            gfx.drawRect(tx, chromeScale, armorTickW, innerH);
            gfx.endFill();
        }
    }

    // Static chrome at the back of the z-stack so live overlays (OS, stripes, labels) sit on top.
    bakeAndSwap(container, gfx, token.id, { addAt: 0 });

    // Overshield overlay on HP row.
    const osVal = actor.system?.overshield?.value ?? 0;
    const hpMax = getEffectiveMax(actor, 'hp');
    if (osVal > 0 && hpMax > 0 && visibleIds.has('hp'))
    {
        const osPct = Math.min(1, osVal / hpMax);
        const osW = Math.max(0, Math.floor((rightColW - 2 * chromeScale) * osPct));
        const osX = rightColX + chromeScale;
        const osY = chromeScale;
        const osH = rowHeight - 2 * chromeScale;

        const osGfx = new PIXI.Graphics();
        osGfx.name = 'la-overshield';
        container.addChild(osGfx);

        const colorA = 0x2244ee;
        const colorB = 0x1133ee;
        const rA = (colorA >> 16) & 0xff, gA = (colorA >> 8) & 0xff, bA = colorA & 0xff;
        const rB = (colorB >> 16) & 0xff, gB = (colorB >> 8) & 0xff, bB = colorB & 0xff;
        const periodMs = 2200;

        const tick = () =>
        {
            if (osGfx.destroyed || !osGfx.parent)
            {
                canvas.app.ticker.remove(tick);
                return;
            }
            osGfx.clear();
            const phase = (performance.now() % periodMs) / periodMs;
            for (let pixelIdx = 0; pixelIdx < osW; pixelIdx++)
            {
                const base = osW > 1 ? pixelIdx / (osW - 1) : 0;
                let mix = (base + phase) % 1;
                if (mix > 0.5)
                    mix = 1 - mix;
                mix *= 2;
                const red = Math.round(rA + (rB - rA) * mix);
                const green = Math.round(gA + (gB - gA) * mix);
                const blue = Math.round(bA + (bB - bA) * mix);
                osGfx.beginFill((red << 16) | (green << 8) | blue, 0.75);
                osGfx.drawRect(osX + pixelIdx, osY, 1, osH);
                osGfx.endFill();
            }
            // Right-edge terminator
            osGfx.beginFill(0x000000, 1);
            osGfx.drawRect(osX + osW - chromeScale, osY, chromeScale, osH);
            osGfx.endFill();
        };
        canvas.app.ticker.add(tick);
        tick();
    }

    // Burn/Infection pulsing stripes.
    const drawCounterStripe = (rowIdx, def, hostId, direction) =>
    {
        if (!visibleIds.has(hostId))
            return;
        const counterV = def.getValue(actor);
        if ((counterV.value ?? 0) <= 0)
            return;
        const hostV = find(hostId).getValue(actor);
        const hostMax = hostV.max ?? 0;
        if (hostMax <= 0)
            return;
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const stripeY = rowIdx * (rowHeight + rowGap) + 1;
        const stripeH = rowHeight - 2;

        const fillPx = (Math.max(0, hostV.value ?? 0) / hostMax) * barW;
        const counterPx = Math.min(barW, (counterV.value / hostMax) * barW);

        let stripeX;
        let stripeW;
        if (direction === 'left')
        {
            stripeX = barX + Math.max(0, fillPx - counterPx);
            stripeW = Math.min(counterPx, fillPx);
        }
        else
        {
            stripeX = barX + fillPx;
            stripeW = Math.min(counterPx, barW - fillPx);
        }
        if (stripeW <= 0)
            return;

        const stripeGfx = new PIXI.Graphics();
        stripeGfx.name = `la-counter-${def.id}`;
        container.addChild(stripeGfx);
        stripeGfx.beginFill(def.color, 1);
        stripeGfx.drawRect(stripeX, stripeY, stripeW, stripeH);
        stripeGfx.endFill();

        // Separator edge.
        stripeGfx.beginFill(0x000000, 1);
        const delimX = direction === 'left' ? stripeX : stripeX + stripeW - chromeScale;
        stripeGfx.drawRect(delimX, stripeY, chromeScale, stripeH);
        stripeGfx.endFill();

        const periodMs = 900;
        const pulse = () =>
        {
            if (!stripeGfx || stripeGfx.destroyed)
            {
                canvas.app.ticker.remove(pulse);
                return;
            }
            const phase = (performance.now() % periodMs) / periodMs;
            stripeGfx.alpha = 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
        };
        canvas.app.ticker.add(pulse);
    };
    drawCounterStripe(0, find('burn'), 'hp', 'left');
    drawCounterStripe(1, find('infection'), 'heat', 'right');

    // Heat fill terminator + danger zone. Only for actors with a real heat max.
    if (visibleIds.has('heat') && (actor.system?.heat?.max ?? 0) > 0)
    {
        const heatBarX = rightColX + 1;
        const heatBarW = rightColW - 2;
        const heatRowY = rowHeight + rowGap;
        const heatV = find('heat').getValue(actor);
        const heatMax = heatV.max ?? 0;
        if (heatMax > 0)
        {
            const heatGfx = new PIXI.Graphics();
            heatGfx.name = 'la-heat-decorations';
            container.addChild(heatGfx);

            const heatPct = Math.max(0, Math.min(1, (heatV.value ?? 0) / heatMax));
            const fillW = heatBarW * heatPct;
            if (fillW > 0)
            {
                heatGfx.beginFill(0x000000, 1);
                heatGfx.drawRect(heatBarX + fillW - chromeScale, heatRowY + chromeScale, chromeScale, rowHeight - 2 * chromeScale);
                heatGfx.endFill();
            }
            // Danger Zone tick at 50%.
            const dangerX = heatBarX + heatBarW * 0.5 - Math.floor(chromeScale / 2);
            heatGfx.beginFill(0x882222, 0.8);
            heatGfx.drawRect(dangerX, heatRowY + chromeScale, chromeScale, rowHeight - 2 * chromeScale);
            heatGfx.endFill();

            bakeAndSwap(container, heatGfx, token.id);
        }
    }

    // Extra bars (user-defined via Resources tab): drawn live post-bake so value redraws don't invalidate the baked chrome.
    const extras = /** @type {any} */ (token).document?.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
    const visibleExtras = extras.filter(/** @type {any} */ extra => _resolveExtraBarValues(actor, extra).ownerOk);
    const extraLines = _groupExtrasIntoLines(visibleExtras);
    const extrasGeom = [];
    const extrasSeparator = extraLines.length > 0 && rows.length > 0
        ? Math.max(1, Math.round(chromeScale))
        : 0;
    if (extraLines.length > 0)
    {
        const extraGfx = new PIXI.Graphics();
        extraGfx.name = 'la-extras';
        container.addChild(extraGfx);
        const extrasStartY = rows.length * (rowHeight + rowGap) + extrasSeparator;
        const lineGap = Math.floor(chromeScale);
        const interGap = chromeScale;
        for (let li = 0; li < extraLines.length; li++)
        {
            const line = extraLines[li];
            const lineY = extrasStartY + li * (rowHeight + lineGap);
            let runningX = 0;
            const entryGeoms = [];
            for (let ei = 0; ei < line.entries.length; ei++)
            {
                const { entry, width } = line.entries[ei];
                const slot = Math.floor(usableW * (width / 100));
                const entryWidth = Math.max(2, slot - (ei < line.entries.length - 1 ? interGap : 0));
                const { value, max } = _resolveExtraBarValues(actor, entry);
                const stops = entry?.color?.stops?.length ? entry.color.stops : ['#888888'];
                const segCount = Math.max(1, Math.round(max));
                if (entry?.segmented)
                {
                    drawSegment(
                        extraGfx, runningX, lineY, entryWidth, rowHeight,
                        { color: _parseHex(stops[0]), pips: true, pipsLTR: true },
                        { value, max: segCount },
                        chromeScale
                    );
                }
                else
                {
                    drawSegment(
                        extraGfx, runningX, lineY, entryWidth, rowHeight,
                        { color: _parseHex(stops[0]), softMax: 1 },
                        { value, max },
                        chromeScale
                    );
                }
                entryGeoms.push({
                    entryId: entry.id,
                    x: runningX,
                    w: entryWidth,
                    segmented: !!entry.segmented,
                    segments: segCount,
                    max,
                    primaryColor: _parseHex(stops[0]),
                });
                runningX += slot;
            }
            extrasGeom.push({ y: lineY, entries: entryGeoms });
        }
        // Bake to match the chrome (raw Graphics look noticeably sharper).
        bakeAndSwap(container, extraGfx, token.id);
    }

    // Geometry for spawnFlash(). startY=0 because the container is already offset.
    token._laBarsGeom = {
        layoutOffsetX,
        pipColW,
        rowHeight,
        rowGap,
        startY: 0,
        visibleIds,
        indicatorW,
        reactionExtension,
        rightColX,
        rightColW,
        extras: extrasGeom,
    };

    // Seed snapshot; updateActor writes subsequent ones.
    if (!_lastValues.has(token.id))
        _lastValues.set(token.id, snapshotValues(actor, /** @type {any} */ (token).document));

    const extraLinesHeight = extraLines.length > 0
        ? extraLines.length * rowHeight + (extraLines.length - 1) * Math.floor(chromeScale) + Math.floor(chromeScale)
        : 0;
    const totalHeight = rows.length * (rowHeight + rowGap) - rowGap + extrasSeparator + extraLinesHeight;
    token.bars.visible = true;
    token.bars.height = totalHeight;
    const _hubEntry = _overlayHubs.get(token.id);
    if (_hubEntry)
        _hubEntry.totalHeight = totalHeight;
    // Zero alpha only on first draw so redraws don't flicker.
    if (wrapper.alpha === undefined || token._laFirstDraw !== false)
    {
        wrapper.alpha = 0;
        token._laFirstDraw = false;
    }

    // HP / Heat value labels.
    const hpLabelX = (armorVal > 0 && visibleIds.has('hp'))
        ? rightColX + rightColW + armorGap + armorW + 2
        : rightColX + rightColW + 2;
    _drawBarValueLabels(actor, rows, visibleIds, container, hpLabelX, hpLabelX, rowHeight, rowGap);

    // Re-attach saved flashes on top of everything.
    for (const flash of savedFlashes)
    {
        if (!flash.destroyed)
            container.addChild(flash);
    }

    // Elevation badge: replaces the vanilla "+N" tooltip text.
    drawElevationBadge(token);

    // Undo fvtt-perf-optim bitmap caching.
    const tok = token;
    setTimeout(() =>
    {
        if (tok.destroyed || !tok.bars)
            return;
        const undoCache = (node) =>
        {
            if (node instanceof PIXI.Graphics && node.cacheAsBitmap)
                node.cacheAsBitmap = false;
            if (node.children)
                node.children.forEach(undoCache);
        };
        undoCache(tok.bars);
    }, 0);
}

// HP / Heat value labels

function _drawBarValueLabels(actor, rows, visibleIds, container, hpLabelX, heatLabelX, rowHeight, rowGap)
{
    if (!game.user?.isGM && !actor.isOwner)
        return;
    if (getWorldSetting(SETTING_SHOW_VALUES, true) === false)
        return;
    const innerH = rowHeight - 2;
    const renderScale = 8;
    const renderFontSize = Math.max(8, (innerH + 2) * renderScale);
    const renderStroke = Math.max(1, Math.round(renderFontSize * 0.15));
    const txtResolution = 2;

    const makeStyle = (fill) => new PIXI.TextStyle({
        fontFamily: 'Signika, sans-serif',
        fontSize: renderFontSize,
        fontWeight: 'bold',
        fill,
        stroke: 0x000000,
        strokeThickness: renderStroke,
        align: 'left',
    });
    const whiteStyle = makeStyle(0xffffff);

    rows.forEach((row, rowIdx) =>
    {
        const rightDef = row[1];
        if (!rightDef || !visibleIds.has(rightDef.id))
            return;
        if (rightDef.id !== 'hp' && rightDef.id !== 'heat' && rightDef.id !== 'pilotStress')
            return;

        // Segments: value + optional colored OS/burn/infection suffixes.
        const segments = [];
        const barValue = rightDef.getValue(actor);
        segments.push({ text: `${barValue.value ?? 0}`, style: whiteStyle });

        if (rightDef.id === 'hp')
        {
            const os = actor.system?.overshield?.value ?? 0;
            const burn = actor.system?.burn ?? 0;
            if (os > 0)
                segments.push({ text: ` ${os}`, style: makeStyle(0x4488ff) });
            if (burn > 0)
                segments.push({ text: ` ${burn}`, style: makeStyle(0xff4444) });
        }
        else if (rightDef.id === 'heat')
        {
            const infection = actor.system?.infection ?? 0;
            if (infection > 0)
                segments.push({ text: ` ${infection}`, style: makeStyle(0x1a8844) });
        }

        const labelX = rightDef.id === 'hp' ? hpLabelX : heatLabelX;
        // pilotStress shares the heat slot: same label position as heat.
        const labelContainer = new PIXI.Container();
        labelContainer.name = 'la-bar-label';
        labelContainer.scale.set(1 / renderScale);
        labelContainer.position.set(
            labelX,
            rowIdx * (rowHeight + rowGap) + rowHeight / 2
        );
        labelContainer.eventMode = 'none';

        let cursorX = 0;
        for (const seg of segments)
        {
            const txt = new PIXI.Text(seg.text, seg.style);
            txt.resolution = txtResolution;
            txt.anchor.set(0, 0.5);
            txt.position.set(cursorX, 0);
            labelContainer.addChild(txt);
            cursorX += txt.width;
        }

        container.addChild(labelContainer);
    });
}

// Elevation badge: directional indicator, top-right of token

function drawElevationBadge(token)
{
    if (token.tooltip)
        token.tooltip.visible = false;

    const srcRaw = token.document?._source?.elevation;
    const derRaw = token.document?.elevation;
    let raw = Number.isFinite(srcRaw) && srcRaw !== derRaw ? srcRaw : derRaw;
    if (token?.isPreview && Number.isFinite(derRaw))
        raw = derRaw;
    const elevation = Number.isFinite(raw) ? Math.round(raw * 2) / 2 : raw;
    const noBadge = !Number.isFinite(elevation) || elevation === 0;

    const iso = _getIsoState(token);
    const isoActive = !!(iso && token.mesh);
    const cachedElev = token._laBadgeElev;
    const cachedIsoState = token._laBadgeIso;
    let prev = token._laBadge;
    if (prev && (prev.destroyed || prev.parent !== token))
        prev = token._laBadge = null;

    if (noBadge)
    {
        if (prev)
        {
            token.removeChild(prev);
            prev.destroy({ children: true });
            token._laBadge = null;
            token._laBadgeElev = undefined;
            token._laBadgeIso = undefined;
        }
        return;
    }

    if (prev && cachedElev === elevation && cachedIsoState === isoActive)
    {
        if (isoActive)
        {
            const cellW = prev._laCellW;
            const cellH = prev._laCellH;
            const cosTheta = Math.cos(iso.reverseRotation);
            const sinTheta = Math.sin(iso.reverseRotation);
            const isoScale = 0.76;
            const localX = token.w / 2 - cellW / 2;
            const localY = -token.h / 2 + cellH / 2;
            const offsetX = (cosTheta * isoScale * localX) + (-sinTheta * (1 / isoScale) * localY);
            const offsetY = (sinTheta * isoScale * localX) + (cosTheta * (1 / isoScale) * localY);
            const worldX = token.mesh.position.x + offsetX;
            const worldY = token.mesh.position.y + offsetY;
            prev.position.set(worldX - token.position.x, worldY - token.position.y);
        }
        return;
    }

    if (prev)
    {
        token.removeChild(prev);
        prev.destroy({ children: true });
        token._laBadge = null;
    }

    const isPositive = elevation > 0;
    const label = Math.abs(elevation).toString();

    // Sized to match effect icons (_shrinkEffectIcons).
    const gridPx = canvas.dimensions?.size ?? 100;
    const iconSize = Math.max(8, Math.round(gridPx * 0.1));
    const cellH = iconSize;
    const cellW = iconSize;
    let arrowH = Math.max(3, Math.round(cellH * 0.5));
    if (arrowH % 2 !== 0)
        arrowH += 1;
    const halfW = Math.round(cellW / 2);

    const badge = new PIXI.Container();
    badge.name = 'la-elevation-badge';
    badge.eventMode = 'none';

    const gfx = new PIXI.Graphics();
    badge.addChild(gfx);
    gfx.lineStyle(0);

    const arrowColor = isPositive ? 0x55aacc : 0xcc7744;

    if (isPositive)
    {
        // â–² arrow then dark cell
        gfx.beginFill(arrowColor, 1);
        gfx.moveTo(halfW, 0);
        gfx.lineTo(cellW, arrowH);
        gfx.lineTo(0, arrowH);
        gfx.closePath();
        gfx.endFill();

        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(0, arrowH, cellW, cellH);
        gfx.endFill();
        gfx.beginFill(arrowColor, 0.7);
        gfx.drawRect(1, arrowH, cellW - 2, 1);
        gfx.endFill();
    }
    else
    {
        // Dark cell then â–¼ arrow
        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(0, 0, cellW, cellH);
        gfx.endFill();
        gfx.beginFill(arrowColor, 0.7);
        gfx.drawRect(1, cellH - 1, cellW - 2, 1);
        gfx.endFill();

        gfx.beginFill(arrowColor, 1);
        gfx.moveTo(0, cellH);
        gfx.lineTo(cellW, cellH);
        gfx.lineTo(halfW, cellH + arrowH);
        gfx.closePath();
        gfx.endFill();
    }

    const fontSize = Math.max(7, Math.round(cellH * 0.85));
    const style = PreciseText.getTextStyle({
        fontFamily: CONFIG.canvasTextStyle?.fontFamily ?? 'Signika',
        fontSize,
        fontWeight: 'bold',
        fill: '#dddddd',
        align: 'center',
    });
    const txt = new PreciseText(label, style);
    txt.anchor.set(0.5, 0.5);
    const bodyCenterY = isPositive
        ? arrowH + Math.round(cellH / 2)
        : Math.round(cellH / 2);
    txt.position.set(halfW, bodyCenterY);
    badge.addChild(txt);

    badge._laCellW = cellW;
    badge._laCellH = cellH;

    const badgeY = isPositive ? -arrowH : 0;
    if (isoActive)
    {
        badge.pivot.set(cellW / 2, cellH / 2);
        badge.rotation = iso.reverseRotation;
        badge.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        const isoScale = 0.76;
        badge.scale.set(isoScale, 1 / isoScale);
        const cosTheta = Math.cos(iso.reverseRotation);
        const sinTheta = Math.sin(iso.reverseRotation);
        const localX = token.w / 2 - cellW / 2;
        const localY = -token.h / 2 + cellH / 2;
        const offsetX = (cosTheta * isoScale * localX) + (-sinTheta * (1 / isoScale) * localY);
        const offsetY = (sinTheta * isoScale * localX) + (cosTheta * (1 / isoScale) * localY);
        const worldX = token.mesh.position.x + offsetX;
        const worldY = token.mesh.position.y + offsetY;
        badge.position.set(worldX - token.position.x, worldY - token.position.y);
        token.addChild(badge);
    }
    else
    {
        badge.position.set(token.w - cellW, badgeY);
        token.addChild(badge);
    }

    token._laBadge = badge;
    token._laBadgeElev = elevation;
    token._laBadgeIso = isoActive;
}


function hex(colorInt)
{
    return '#' + colorInt.toString(16).padStart(6, '0');
}

function resourceCell({ name, value, color, title })
{
    const border = hex(color);
    return `<input type="text" name="${name}" value="${value}" title="${title}" class="la-hud-resource" style="width: 40%; height: 30px; font-size: 20px; margin: 2px; min-width: 40px; padding-inline: 1px; text-align: center; border: 1px solid ${border};" />`;
}

function injectLancerHud(hud, html, actor)
{
    const sys = actor.system;
    const $html = $(html);

    const findDef = id => BAR_DEFS.find(def => def.id === id);
    const COLORS = {
        hp: findDef('hp')?.color ?? 0x66cc66,
        heat: findDef('heat')?.color ?? 0xff7733,
        structure: findDef('structure')?.color ?? 0xffaa33,
        stress: findDef('stress')?.color ?? 0xcc4488,
        overshield: 0x3366ff,
        burn: findDef('burn')?.color ?? 0xff5522,
        infection: findDef('infection')?.color ?? 0x1a8844,
        reaction: 0x9944cc,
    };

    const cell = (name, value, color, title) => resourceCell({ name, value, color, title });

    // 100px wide, 2 inputs per row.
    const containerStyle = 'display: flex; flex-direction: row; flex-wrap: wrap; justify-content: center; align-items: center; width: 100px; height: fit-content;';

    const isPilot = actor.type === 'pilot';
    const pilotStressOn = isPilot && showsPilotStress(hud?.object?.document ?? null);

    // Top: Overshield, [Infection], Burn. Infection cell hidden when integration is disabled or pilot.
    let infectionOn = false;
    try
    {
        infectionOn = !!game.settings.get(MODULE_ID, 'enableInfectionDamageIntegration');
    }
    catch
    { /* setting not registered */ }
    const topInner =
        cell('system.overshield.value', sys?.overshield?.value ?? 0, COLORS.overshield, 'Overshield') +
        (infectionOn && !isPilot ? cell('system.infection', sys?.infection ?? 0, COLORS.infection, 'Infection') : '') +
        cell('system.burn',              sys?.burn ?? 0,              COLORS.burn,       'Burn');
    const topAttribute = `<div class="attribute la-hud-top" style="${containerStyle} position: absolute; top: 44px; left: 50%; transform: translate(-50%, -100%);">${topInner}</div>`;

    // Bottom: Structure, HP, Stress, Heat (pilots/deployables skip struct/stress; pilots also skip heat).
    const mechStats = hasMechStats(actor);
    const bottomInner =
        (mechStats ? cell('system.structure.value', sys?.structure?.value ?? 0, COLORS.structure, `Structure (max ${sys?.structure?.max ?? 0})`) : '') +
        cell('system.hp.value',        sys?.hp?.value ?? 0,        COLORS.hp,        `HP (max ${sys?.hp?.max ?? 0})`) +
        (mechStats ? cell('system.stress.value',    sys?.stress?.value ?? 0,    COLORS.stress,    `Stress (max ${sys?.stress?.max ?? 0})`) : '') +
        (pilotStressOn ? cell('system.bond_state.stress.value', sys?.bond_state?.stress?.value ?? 0, 0xd9b800, `Stress (max ${sys?.bond_state?.stress?.max ?? 8})`) : '') +
        (isPilot ? '' : cell('system.heat.value',      sys?.heat?.value ?? 0,      COLORS.heat,      `Heat (max ${sys?.heat?.max ?? 0})`));
    const bottomAttribute = `<div class="attribute la-hud-bottom" style="${containerStyle} position: absolute; top: calc(100% - 44px); left: 50%; transform: translateX(-50%);">${bottomInner}</div>`;

    const middleCol = $html.find('.col.middle');
    // Drop vanilla bar1/bar2 fields, we replace them.
    middleCol.find('div.attribute').remove();
    middleCol.append(topAttribute);
    middleCol.append(bottomAttribute);

    // Left: Reaction box. Skipped for deployables.
    if (hasReaction(actor))
    {
        const reactionVal = sys?.action_tracker?.reaction === true ? 1 : 0;
        const reactionInput = resourceCell({
            name: 'system.action_tracker.reaction',
            value: reactionVal,
            color: COLORS.reaction,
            title: 'Reaction (1 = available, 0 = used)',
        });
        const reactionBox = `<div class="attribute la-hud-reaction" style="position: absolute; right: 100%; top: 50%; transform: translateY(-50%); width: 50px; display: flex; justify-content: center;">${reactionInput}</div>`;
        $html.find('.col.left').prepend(reactionBox);
    }

    // Writes to actor.system.* instead of token doc.
    const focusOutHandler = async (ev) =>
    {
        ev.preventDefault();
        const input = ev.currentTarget;
        const name = input.name;
        const raw = input.value.trim();
        let value;
        if (name === 'system.action_tracker.reaction')
            value = Number(raw) > 0;
        else
        {
            const num = Number(raw);
            if (!Number.isFinite(num))
                return;
            // Delta input: "+2" / "-3".
            if (raw.startsWith('+') || raw.startsWith('-'))
            {
                const cur = foundry.utils.getProperty(actor, name) ?? 0;
                value = cur + num;
            }
            else
                value = num;
        }
        await actor.update({ [name]: value });
        hud.clear();
    };

    $html.find('input.la-hud-resource')
        .on('click', (ev) =>
        {
            /** @type {HTMLInputElement} */ (ev.currentTarget).select();
        })
        .on('keydown', (ev) =>
        {
            if (ev.code === 'Enter' || ev.code === 'NumpadEnter')
                ev.currentTarget.blur();
        })
        .on('focusout', focusOutHandler);

    // Extras column, mirrored from the reaction box on the left.
    const tokenDoc = hud.object?.document;
    const extras = tokenDoc?.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
    const visibleExtras = extras.filter(/** @type {any} */ extra => _resolveExtraBarValues(actor, extra).ownerOk);
    if (visibleExtras.length)
    {
        const extraInputs = visibleExtras.map(/** @type {any} */ extra =>
        {
            const { value, max } = _resolveExtraBarValues(actor, extra);
            const primary = extra.color?.stops?.[0] ?? '#888888';
            const readOnly = extra.valueSource?.kind !== 'manual';
            const title = (extra.label || 'Extra') + ` (${value}/${max})` + (readOnly ? ' - read-only (path-bound)' : '');
            return `<input type="text" class="la-hud-extra-input" data-entry-id="${_escAttr(extra.id)}" value="${value}" title="${_escAttr(title)}" ${readOnly ? 'readonly' : ''} style="width:40px;height:30px;font-size:20px;margin:2px;padding-inline:1px;text-align:center;border:1px solid ${_escAttr(primary)};${readOnly ? 'opacity:0.55;' : ''}">`;
        }).join('');
        const extraBlock = `<div class="attribute la-hud-extras" style="position:absolute;left:100%;top:50%;transform:translateY(-50%);width:50px;display:flex;flex-direction:column;justify-content:center;align-items:center;">${extraInputs}</div>`;
        const rightCol = $html.find('.col.right');
        if (rightCol.length)
            rightCol.prepend(extraBlock);
        else
            middleCol.append(extraBlock);

        const extrasFocusOut = async (ev) =>
        {
            ev.preventDefault();
            const input = ev.currentTarget;
            const entryId = input.dataset.entryId;
            const raw = (input.value ?? '').trim();
            const num = Number(raw);
            if (!Number.isFinite(num))
                return;
            const extras = foundry.utils.deepClone(tokenDoc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);
            const entry = extras.find(/** @type {any} */ x => x.id === entryId);
            if (!entry || entry.valueSource?.kind !== 'manual')
                return;
            let next = num;
            if (raw.startsWith('+') || raw.startsWith('-'))
                next = (Number(entry.valueSource.value) || 0) + num;
            entry.valueSource.value = next;
            await tokenDoc.setFlag(MODULE_ID, FLAG_EXTRAS, extras);
            hud.clear();
        };

        $html.find('input.la-hud-extra-input')
            .on('click', (ev) =>
            {
                const el = /** @type {HTMLInputElement} */ (ev.currentTarget);
                if (!el.readOnly)
                    el.select();
            })
            .on('keydown', (ev) =>
            {
                if (ev.code === 'Enter' || ev.code === 'NumpadEnter')
                    ev.currentTarget.blur();
            })
            .on('focusout', extrasFocusOut);
    }
}

// Settings registration

export function registerTokenStatBarSettings()
{
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true,
    });
    game.settings.register(MODULE_ID, SETTING_DEFAULT_HIDDEN, {
        scope: 'world', config: false, type: Boolean, default: false,
    });
    game.settings.register(MODULE_ID, SETTING_DEFAULT_COMBAT_ONLY, {
        scope: 'world', config: false, type: Boolean, default: false,
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
        default: true,
        onChange: () =>
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
        },
    });
    game.settings.register(MODULE_ID, SETTING_VIS_OUT_OF_COMBAT, {
        scope: 'world', config: false, type: String, default: VIS_ALL,
    });
    game.settings.register(MODULE_ID, SETTING_VIS_IN_COMBAT, {
        scope: 'world', config: false, type: String, default: VIS_ALL,
    });
    game.settings.register(MODULE_ID, SETTING_EFFECT_ICON_SCALE, {
        name: 'Effect Icon Scale',
        hint: 'Multiplier on token effect icon size. 1 = default size, below shrinks, above enlarges.',
        scope: 'world',
        config: false,
        type: Number,
        default: 1,
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
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_TALENTS, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () =>
        {
            if (!game.users?.activeGM?.isSelf || !canvas?.ready)
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

// Reset auto-injected bars on every scene token and every actor prototype.
export async function reinjectAutoBarsOnAllTokens()
{
    if (!game.user?.isGM)
    {
        ui.notifications?.warn('Only the GM can reinject auto bars.');
        return;
    }
    let sceneTokens = 0, prototypes = 0, failed = 0;
    for (const scene of game.scenes ?? [])
    {
        for (const tokenDoc of scene.tokens ?? [])
        {
            if (!isLancerCombatant(tokenDoc.actor))
                continue;
            const ok = await _resetAutoInjectedExtras(tokenDoc);
            if (ok)
                sceneTokens++; else
                failed++;
        }
    }
    for (const actor of game.actors ?? [])
    {
        if (!isLancerCombatant(actor))
            continue;
        const proto = /** @type {any} */ (actor.prototypeToken ?? actor.token);
        if (!proto)
            continue;
        const ok = await _resetAutoInjectedExtras(proto);
        if (ok)
            prototypes++; else
            failed++;
    }
    ui.notifications?.info(`Reinjected auto bars on ${sceneTokens} scene token(s) and ${prototypes} prototype(s)${failed ? ` (${failed} failed)` : ''}.`);
}

export async function applyDefaultsToCurrentScene()
{
    if (!canvas?.scene)
    {
        ui.notifications?.warn('No active scene.');
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
        ui.notifications?.info('No Lancer tokens on this scene.');
        return;
    }
    try
    {
        await canvas.scene.updateEmbeddedDocuments('Token', updates);
        ui.notifications?.info(`Applied defaults to ${updates.length} token(s).`);
    }
    catch (e)
    {
        console.warn(`${MODULE_ID} | apply defaults failed`, e);
        ui.notifications?.error('Failed to apply defaults, see the console.');
    }
}

// Init

// Fade a token's bars back out once the flash-linger window elapses, unless it should still show.
function scheduleFlashFade(tok)
{
    _flashingTokens.add(tok.id);
    const fadeTarget = _getFadeTarget(tok);
    if (fadeTarget)
        fadeTarget.alpha = 1;
    setTimeout(() =>
    {
        _flashingTokens.delete(tok.id);
        if (tok?.destroyed)
            return;
        if (!shouldShowBars(tok))
            fadeBars(tok, 0);
    }, FLASH_TOTAL_MS + FLASH_LINGER_MS);
}

// Flash every extra bar whose value changed between snapshots. Returns true if any flashed.
function flashChangedExtras(tok, prev, next)
{
    const prevExtras = prev.extras ?? {};
    const nextExtras = next.extras ?? {};
    let flashed = false;
    for (const extraId of Object.keys(nextExtras))
    {
        const oldVal = prevExtras[extraId];
        if (oldVal !== undefined && oldVal !== nextExtras[extraId])
        {
            spawnFlashExtra(tok, extraId, oldVal, nextExtras[extraId]);
            flashed = true;
        }
    }
    return flashed;
}

export function initTokenStatBar()
{
    // Skip if Bar Brawl is active.
    if (game.modules.get('barbrawl')?.active)
    {
        console.log(`${MODULE_ID} | Bar Brawl detected â€” skipping custom token stat bar registration.`);
        return;
    }

    originalDrawBars = CONFIG.Token.objectClass.prototype.drawBars;

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

    // Value change detection + flash spawning.
    Hooks.on('updateActor', (actor, change) =>
    {
        if (!isEnabled() || !isLancerCombatant(actor))
            return;
        const sysChange = change?.system;
        if (!sysChange)
            return;
        // Don't gate on watched keys: extras may bind anywhere. The per-bar diff filters no-ops.
        for (const tok of actor.getActiveTokens())
        {
            const prev = _lastValues.get(tok.id) ?? { extras: {} };
            const next = snapshotValues(actor, tok.document);

            // Redraw hub with new values.
            try
            {
                tok.drawBars();
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | drawBars on update failed`, e);
            }

            let flashed = false;
            const FLASH_BARS = ['hp', 'heat', 'structure', 'stress', 'pilotStress', 'overshield', 'burn', 'infection'];
            for (const id of FLASH_BARS)
            {
                if (prev[id] !== undefined && prev[id] !== next[id])
                {
                    spawnFlash(tok, id, prev[id], next[id]);
                    flashed = true;
                }
            }
            // Path-bound extras: their value updates when the actor changes.
            if (flashChangedExtras(tok, prev, next))
                flashed = true;
            // Pilot stress delta floats over the token like other damages.
            if (prev.pilotStress !== undefined && prev.pilotStress !== next.pilotStress
                && actor.type === 'pilot' && canvas?.interface?.createScrollingText)
            {
                let showScroll = true;
                try
                {
                    showScroll = !!game.settings.get('lancer', 'floatingNumbers');
                }
                catch
                { /* ignore */ }
                if (showScroll)
                {
                    const delta = next.pilotStress - prev.pilotStress;
                    canvas.interface.createScrollingText(tok.center, `${delta > 0 ? '+' : ''}${delta} Stress`, {
                        anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                        direction: delta > 0 ? CONST.TEXT_ANCHOR_POINTS.BOTTOM : CONST.TEXT_ANCHOR_POINTS.TOP,
                        fontSize: 28,
                        fill: '0xd9b800',
                        stroke: 0,
                        strokeThickness: 4,
                        jitter: 0.25,
                    });
                }
            }
            // Bond XP delta; skipped when the auto-injected XP bar already emits its own feedback.
            if (prev.bondXp !== undefined && prev.bondXp !== next.bondXp
                && actor.type === 'pilot' && canvas?.interface?.createScrollingText)
            {
                let showScroll = true;
                try
                {
                    showScroll = !!game.settings.get('lancer', 'floatingNumbers');
                }
                catch
                { /* ignore */ }
                const extras = tok.document?.getFlag?.(MODULE_ID, FLAG_EXTRAS) ?? [];
                const barCoversIt = extras.some(/** @type {any} */ extra => extra?.autoKey === 'bondXp' && extra.audioTextFeedback);
                if (showScroll && !barCoversIt)
                {
                    const delta = next.bondXp - prev.bondXp;
                    canvas.interface.createScrollingText(tok.center, `${delta > 0 ? '+' : ''}${delta} XP`, {
                        anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                        direction: delta > 0 ? CONST.TEXT_ANCHOR_POINTS.TOP : CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                        fontSize: 28,
                        fill: '0x00b8d4',
                        stroke: 0,
                        strokeThickness: 4,
                        jitter: 0.25,
                    });
                }
            }
            // Reaction: only flash on spent, not turn reset.
            if (prev.reaction === true && next.reaction === false)
            {
                spawnFlash(tok, 'reaction', 1, 0);
                flashed = true;
            }

            _lastValues.set(tok.id, next);

            if (flashed)
                scheduleFlashFade(tok);
        }
    });

    const _laHitContains = (token, x, y) =>
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
    };

    // Refresh visibility + position sync.
    const refreshLancerToken = (token) =>
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

        // Status effect icons (token.effects container).
        const effects = token.effects;
        if (effects && !effects.destroyed)
        {
            if (token._laBaseEffectsX === undefined)
            {
                token._laBaseEffectsX = effects.position.x;
                token._laBaseEffectsY = effects.position.y;
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
                effects.position.set(token._laBaseEffectsX, token._laBaseEffectsY);
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
    };
    Hooks.on('refreshToken', refreshLancerToken);

    // Alt-key peek.
    window.addEventListener('keydown', (ev) =>
    {
        if (ev.key !== 'Alt' || isAltHeld())
            return;
        setAltHeld(true);
        refreshVisibleLancerTokens();
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
        if (!game.users?.activeGM?.isSelf)
            return;
        const talentsOn = game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENTS);
        const flagsOn = altFlags.isActive() && game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_CUSTOM_FLAGS);
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
            if (otherActor.type === 'mech' && otherActor.system?.pilot?.value?.id === parentActor.id)
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

    // Handler for both scene TokenConfig + prototype TokenConfig (v13 fires distinct hooks).
    const renderConfigHandler = (app, html) =>
    {
        if (!isEnabled())
            return;
        const isPrototype = app.isPrototype === true;
        const tokenDoc = app.token ?? app.object;
        const actor = app.actor ?? tokenDoc?.actor ?? tokenDoc?.parent;
        if (!isLancerCombatant(actor) || !tokenDoc)
            return;
        const root = html instanceof HTMLElement ? html : html?.[0];
        const tab = root?.querySelector?.('.tab[data-tab="resources"]');
        if (!tab)
            return;
        const hidden = statBarHidden(tokenDoc);
        const combatOnly = statBarCombatOnly(tokenDoc);
        const rowHeight = statBarRowHeight(tokenDoc);
        const visOut = tokenDoc.getFlag(MODULE_ID, FLAG_VIS_OUT_OF_COMBAT) ?? '';
        const visIn = tokenDoc.getFlag(MODULE_ID, FLAG_VIS_IN_COMBAT) ?? '';
        const isPilotActor = tokenDoc?.actor?.type === 'pilot';
        const pilotStress = showsPilotStress(tokenDoc);
        const visOption = (val, label, current) =>
            `<option value="${val}" ${current === val ? 'selected' : ''}>${label}</option>`;
        const visSelect = (name, current) => `
            <select name="${name}">
                ${visOption('', 'Use world default', current)}
                ${visOption(VIS_ALL, 'All', current)}
                ${visOption(VIS_OWNER, 'Owners only', current)}
                ${visOption(VIS_SCANNED, 'Owners + scanned', current)}
                ${visOption(VIS_NONE, 'None', current)}
            </select>
        `;
        // Hidden bar1/bar2 fields so Foundry's submit handler doesn't crash.
        const bar1Attr = tokenDoc.bar1?.attribute ?? '';
        const bar2Attr = tokenDoc.bar2?.attribute ?? '';
        tab.innerHTML = `
            <input type="hidden" name="bar1.attribute" value="${bar1Attr}"/>
            <input type="hidden" name="bar2.attribute" value="${bar2Attr}"/>
            <div class="la-stat-bar-config">
            <p class="notes la-managed-by">Lancer Automations is managing this token's bars.</p>
            <div class="form-group">
                <label>Hide Stat Bar</label>
                <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_HIDDEN}" ${hidden ? 'checked' : ''}/>
                <p class="notes">Completely hide the stat bar hub for this token.</p>
            </div>
            <div class="form-group">
                <label>Show Only In Combat</label>
                <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_COMBAT_ONLY}" ${combatOnly ? 'checked' : ''}/>
                <p class="notes">Only display the stat bar hub while this token is part of an active combat encounter.</p>
            </div>
            <div class="form-group">
                <label>Row Height (px)</label>
                <input type="number" min="0" step="1" name="flags.${MODULE_ID}.${FLAG_ROW_HEIGHT}" value="${rowHeight || ''}" placeholder="auto"/>
                <p class="notes">Override the height of each bar row, in pixels. Leave blank for the default (scales with grid size).</p>
            </div>
            <div class="form-group">
                <label>Visibility: Out of Combat</label>
                ${visSelect(`flags.${MODULE_ID}.${FLAG_VIS_OUT_OF_COMBAT}`, visOut)}
                <p class="notes">Per-token override of who sees the bars when no combat is active. Leave on "Use world default" to inherit from the module settings.</p>
            </div>
            <div class="form-group">
                <label>Visibility: In Combat</label>
                ${visSelect(`flags.${MODULE_ID}.${FLAG_VIS_IN_COMBAT}`, visIn)}
                <p class="notes">Per-token override of who sees the bars while this token is in an active combat.</p>
            </div>
            ${isPilotActor ? `
            <div class="form-group">
                <label>Display Stress</label>
                <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_PILOT_STRESS}" ${pilotStress ? 'checked' : ''}/>
                <p class="notes">Show the bond stress bar (and input) on this pilot's token.</p>
            </div>
            ` : ''}
            <div class="form-group la-extra-bars-group">
                <label>Extra Bars</label>
                <div class="la-extra-bars-list" data-extras></div>
                <div class="la-extra-bars-actions">
                    <button type="button" class="la-extra-bars-add"><i class="fas fa-plus"></i> Add Bar</button>
                    <button type="button" class="la-extra-bars-reset" title="Re-apply auto-injected counter bars (or remove them when the world setting is off)">
                        <i class="fas fa-rotate"></i> Reset Auto-Injected
                    </button>
                </div>
                <p class="notes">User-defined bars drawn below the standard ones. Layout: 100% width per line; "same line" lays out side-by-side until the line is full.</p>
            </div>
            </div>
        `;
        const storeOverride = isPrototype
            ? _makeActorTemplateStore(actor)
            : _makeSceneTokenStore(actor, tokenDoc);
        _bindExtraBarsUI(root, tokenDoc, app, storeOverride);
        if (typeof app.setPosition === 'function')
            app.setPosition({ height: 'auto' });
    };
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

    // Combat lifecycle â†’ refresh combat-only tokens.
    const refreshAllForCombat = () =>
    {
        if (!isEnabled())
            return;
        for (const tok of canvas.tokens?.placeables ?? [])
        {
            if (!isLancerCombatant(tok.actor))
                continue;
            if (!statBarCombatOnly(tok.document))
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
