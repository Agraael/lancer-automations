// Custom multi-bar hub drawn under Lancer tokens + resource grid in token HUD.
// Replaces vanilla bar1/bar2 for mech/npc/deployable actors. Disabled by default.

import { getIsoProvider } from '../setup/iso-settings.js';
import {
    isLancerActor as isLancerCombatant,
    hasMechStats,
    hasReaction,
    isTokenInCombat,
    isTokenVisible,
} from '../utils/lancer-token.js';
import { setTokenFlag } from '../socket.js';
import { playStatsSound } from './sound.js';

const MODULE_ID = 'lancer-automations';
const SETTING_ENABLED = 'tokenStatBar';
const SETTING_DEFAULT_HIDDEN = 'statBarDefaultHidden';
const SETTING_DEFAULT_COMBAT_ONLY = 'statBarDefaultCombatOnly';
const SETTING_DEFAULT_ROW_HEIGHT = 'statBarDefaultRowHeight';
const SETTING_VIS_OUT_OF_COMBAT = 'statBarVisibilityOutOfCombat';
const SETTING_VIS_IN_COMBAT = 'statBarVisibilityInCombat';
const SETTING_EFFECT_ICON_SCALE = 'statBarEffectIconScale';
const SETTING_MIN_ZOOM_SCALE = 'statBarMinZoomScale';
const SETTING_DEFAULT_PILOT_STRESS = 'statBarDefaultPilotStress';
const SETTING_SHOW_VALUES = 'statBarShowValues';
const SETTING_AUTO_INJECT_TALENTS = 'statBarAutoInjectTalents';
const SETTING_AUTO_INJECT_TALENT_COLOR = 'statBarAutoInjectTalentColor';
const SETTING_AUTO_INJECT_TALENT_WIDTH = 'statBarAutoInjectTalentWidthPct';

const VIS_ALL = 'all';
const VIS_OWNER = 'owner';
const VIS_NONE = 'none';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _altHeld = false;
const _lastValues = new Map();
const _flashingTokens = new Set();
const _fadeState = new Map();
let originalDrawBars = null;

// Overlay on canvas.tokens — hubs render above all tokens.
let _hubOverlay = null;
function getHubOverlay() {
    if (_hubOverlay && !_hubOverlay.destroyed) {
        return _hubOverlay;
    }
    if (!canvas?.tokens) {
        return null;
    }
    _hubOverlay = new PIXI.Container();
    _hubOverlay.name = 'la-stat-bar-overlay';
    _hubOverlay.sortableChildren = true;
    _hubOverlay.zIndex = 99999;
    canvas.tokens.addChild(_hubOverlay);
    return _hubOverlay;
}

const _overlayHubs = new Map();

const FLASH_HOLD_MS = 250;
const FLASH_SHRINK_MS = 1300;
const FLASH_TOTAL_MS = FLASH_HOLD_MS + FLASH_SHRINK_MS;
const FLASH_LINGER_MS = 600;

// Hub width cap — larger tokens get a centered hub.
const MAX_BAR_WIDTH = 500;

const REF_GRID_SIZE = 100;
const REF_ROW_HEIGHT = 7;

// ---------------------------------------------------------------------------
// Bar definitions
// ---------------------------------------------------------------------------

const BAR_DEFS = [
    {
        id: 'hp',
        label: 'HP',
        color: 0x66cc66,
        getValue: a => ({ value: a.system?.hp?.value ?? 0, max: getEffectiveMax(a, 'hp') }),
        editPath: 'system.hp.value',
    },
    {
        id: 'heat',
        label: 'Heat',
        color: 0xcc4422,
        getValue: a => ({ value: a.system?.heat?.value ?? 0, max: getEffectiveMax(a, 'heat') }),
        editPath: 'system.heat.value',
    },
    {
        id: 'structure',
        label: 'STR',
        color: 0xffd633,
        getValue: a => ({ value: a.system?.structure?.value ?? 0, max: a.system?.structure?.max ?? 0 }),
        editPath: 'system.structure.value',
        pips: true,
    },
    {
        id: 'stress',
        label: 'Stress',
        color: 0xff8822,
        getValue: a => ({ value: a.system?.stress?.value ?? 0, max: a.system?.stress?.max ?? 0 }),
        editPath: 'system.stress.value',
        pips: true,
    },
    {
        id: 'overshield',
        label: 'OS',
        color: 0x48dee0,
        getValue: a => ({ value: a.system?.overshield?.value ?? 0, max: a.system?.overshield?.max ?? 0 }),
        editPath: 'system.overshield.value',
        hideWhenZero: true,
    },
    {
        id: 'burn',
        label: 'Burn',
        color: 0xcc1a1a,
        getValue: a => ({ value: a.system?.burn ?? 0, max: 0 }),
        editPath: 'system.burn',
        softMax: 10,
        hideWhenZero: true,
    },
    {
        id: 'infection',
        label: 'Inf',
        color: 0x1a8844,
        getValue: a => ({ value: a.system?.infection ?? 0, max: 0 }),
        editPath: 'system.infection',
        softMax: 10,
        hideWhenZero: true,
    },
    {
        // Pilot-only bond stress; renders as a horizontal bar (no pips) in the heat slot.
        id: 'pilotStress',
        label: 'Stress',
        color: 0xd9b800,
        getValue: a => ({
            value: a.system?.bond_state?.stress?.value ?? 0,
            max: a.system?.bond_state?.stress?.max ?? 8,
        }),
        editPath: 'system.bond_state.stress.value',
    },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEnabled() {
    try {
        return game.settings.get(MODULE_ID, SETTING_ENABLED) === true;
    } catch {
        return false;
    }
}

const ISO_SETTING_STATBAR = 'iso.statBar';
const ISO_SETTING_RETICLE = 'iso.targetReticle';
const ISO_SETTING_HITZONE = 'iso.clickZone';

function _getIsoState(token, settingKey = ISO_SETTING_STATBAR) {
    try {
        if (!game.settings.get(MODULE_ID, settingKey))
            return null;
    } catch {
        return null;
    }
    const provider = getIsoProvider(token?.scene);
    if (!provider)
        return null;
    if (provider.isTokenDisabled(token))
        return null;
    return {
        reverseRotation: provider.reverseRotation,
        reverseSkewX: provider.reverseSkewX,
        reverseSkewY: provider.reverseSkewY,
        counterScale: provider.counterScale,
    };
}

const FLAG_HIDDEN = 'statBarHidden';
const FLAG_COMBAT_ONLY = 'statBarCombatOnly';
const FLAG_ROW_HEIGHT = 'statBarRowHeight';
const FLAG_VIS_OUT_OF_COMBAT = 'statBarVisibilityOutOfCombat';
const FLAG_VIS_IN_COMBAT = 'statBarVisibilityInCombat';
const FLAG_PILOT_STRESS = 'statBarPilotStress';
const FLAG_EXTRAS = 'statBarExtras';
const FLAG_AUTO_KEYS = 'statBarAutoInjectedKeys';
export { FLAG_EXTRAS };

// Accepts Token (placeable), TokenDocument, scene-local token id, or uuid. Returns TokenDocument or null.
async function _resolveTokenDocument(arg) {
    if (!arg)
        return null;
    if (typeof arg === 'string') {
        try {
            if (arg.includes('.')) {
                const doc = /** @type {any} */ (await fromUuid(arg));
                return doc?.documentName === 'Token' ? doc : (doc?.token ?? null);
            }
            for (const scene of game.scenes) {
                const t = scene.tokens.get(arg);
                if (t)
                    return t;
            }
            return canvas?.tokens?.get(arg)?.document ?? null;
        } catch {
            return null;
        }
    }
    return /** @type {any} */ (arg).document ?? arg;
}

function getWorldSetting(key, fallback) {
    try {
        const v = game.settings.get(MODULE_ID, key);
        return v ?? fallback;
    } catch {
        return fallback;
    }
}

// Per-token boolean flag with world-default fallback. Used for any binary toggle
// where the token can override the world setting.
function tokenBoolFlag(tokenDoc, flag, settingKey) {
    const v = tokenDoc?.getFlag?.(MODULE_ID, flag);
    if (v === true || v === false) {
        return v;
    }
    return getWorldSetting(settingKey, false) === true;
}

function statBarHidden(tokenDoc) {
    return tokenBoolFlag(tokenDoc, FLAG_HIDDEN, SETTING_DEFAULT_HIDDEN);
}
function statBarCombatOnly(tokenDoc) {
    return tokenBoolFlag(tokenDoc, FLAG_COMBAT_ONLY, SETTING_DEFAULT_COMBAT_ONLY);
}
function showsPilotStress(tokenDoc) {
    return tokenBoolFlag(tokenDoc, FLAG_PILOT_STRESS, SETTING_DEFAULT_PILOT_STRESS);
}

function statBarRowHeight(tokenDoc) {
    const v = tokenDoc?.getFlag?.(MODULE_ID, FLAG_ROW_HEIGHT);
    if (Number.isFinite(v) && v > 0) {
        return Number(v);
    }
    const fallback = getWorldSetting(SETTING_DEFAULT_ROW_HEIGHT, 0);
    return Number.isFinite(fallback) && fallback > 0 ? Number(fallback) : 0;
}

// Per-combat-state visibility mode: per-token flag wins, else the matching world setting.
function resolveVisibilityMode(tokenDoc, inCombat) {
    const flagKey = inCombat ? FLAG_VIS_IN_COMBAT : FLAG_VIS_OUT_OF_COMBAT;
    const settingKey = inCombat ? SETTING_VIS_IN_COMBAT : SETTING_VIS_OUT_OF_COMBAT;
    const m = tokenDoc?.getFlag?.(MODULE_ID, flagKey);
    if (m === VIS_ALL || m === VIS_OWNER || m === VIS_NONE) {
        return m;
    }
    return getWorldSetting(settingKey, VIS_ALL);
}

function shouldShowBars(token) {
    if (!token) {
        return false;
    }
    if (statBarHidden(token.document)) {
        return false;
    }
    const inCombat = isTokenInCombat(token);
    if (statBarCombatOnly(token.document) && !inCombat) {
        return false;
    }
    // Flash override beats every mode.
    if (_flashingTokens.has(token.id)) {
        return true;
    }
    const mode = resolveVisibilityMode(token.document, inCombat);
    if (mode === VIS_NONE) {
        return !!token.controlled;
    }
    if (mode === VIS_OWNER && !token.actor?.isOwner) {
        return false;
    }
    if (token.controlled || token.hover) {
        return true;
    }
    if (token.targeted?.has(game.user)) {
        return true;
    }
    if (_altHeld && isTokenVisible(token)) {
        return true;
    }
    return false;
}

function getVisibleBars(actor, tokenDoc = null) {
    if (!actor) {
        return [];
    }
    const mechStats = hasMechStats(actor);
    const isPilot = actor.type === 'pilot';
    return BAR_DEFS.filter(def => {
        // Pilots & deployables don't get structure/stress at all.
        if (!mechStats && (def.id === 'structure' || def.id === 'stress')) {
            return false;
        }
        // Pilots can't take heat or infection mechanically.
        if (isPilot && (def.id === 'heat' || def.id === 'infection')) {
            return false;
        }
        // pilotStress is pilot-only and gated on per-token / world setting.
        if (def.id === 'pilotStress' && (!isPilot || !showsPilotStress(tokenDoc))) {
            return false;
        }
        const v = def.getValue(actor);
        const value = v.value ?? 0;
        const max = v.max ?? 0;
        if (def.pips && max <= 0) {
            return false;
        }
        // Heat: if the actor has no native heat track, only render the bar
        // when there is actual heat or infection to show.
        if (def.id === 'heat' && (actor.system?.heat?.max ?? 0) <= 0) {
            const infection = actor.system?.infection ?? 0;
            if (value <= 0 && infection <= 0) {
                return false;
            }
        }
        if (def.hideWhenZero && value <= 0) {
            return false;
        }
        if (def.hideWhenFull && max > 0 && value >= max) {
            return false;
        }
        return true;
    });
}

// Effective max — bar grows if value or overshield exceeds nominal max.
function getEffectiveMax(actor, hostId) {
    const sys = actor?.system;
    if (!sys) {
        return 0;
    }
    if (hostId === 'hp') {
        const max = sys.hp?.max ?? 0;
        const value = Math.max(0, sys.hp?.value ?? 0);
        const os = Math.max(0, sys.overshield?.value ?? 0);
        // Largest of max, HP, or overshield. OS doesn't stack on HP for sizing.
        return Math.max(max, value, os);
    }
    if (hostId === 'heat') {
        const ownMax = sys.heat?.max ?? 0;
        const value = Math.max(0, sys.heat?.value ?? 0);
        const fallbackMax = ownMax > 0 ? ownMax : (sys.hp?.max ?? 0);
        return Math.max(fallbackMax, value);
    }
    return 0;
}

// Parse "#rrggbb" into a 0xrrggbb integer (PIXI fill format). Falls back to gray.
function _parseHex(hex) {
    if (typeof hex !== 'string')
        return 0x888888;
    const s = hex.trim().replace(/^#/, '');
    const n = parseInt(s, 16);
    return Number.isFinite(n) ? (n & 0xffffff) : 0x888888;
}

// Path resolver: supports normal actor-rooted paths plus two special prefixes
// used by auto-injected counter bars:
//   "items.{id}.{rest}"        → walks actor.items.get(id) (e.g. frame on a mech)
//   "pilotItems.{id}.{rest}"   → walks actor.system.pilot.value.items.get(id) when
//                                 the actor is a mech, otherwise falls back to actor.items
//                                 (talents live on the pilot for mechs, on the pilot actor itself otherwise)
function _readActorPath(actor, path) {
    if (!actor || !path)
        return undefined;
    let m = /^items\.([^.]+)\.(.+)$/.exec(path);
    if (m) {
        const item = actor.items?.get?.(m[1]);
        if (!item)
            return undefined;
        return foundry.utils.getProperty(item, m[2]);
    }
    m = /^pilotItems\.([^.]+)\.(.+)$/.exec(path);
    if (m) {
        const pilot = actor.system?.pilot?.value ?? actor;
        const item = pilot?.items?.get?.(m[1]);
        if (!item)
            return undefined;
        return foundry.utils.getProperty(item, m[2]);
    }
    return foundry.utils.getProperty(actor, path);
}

// True if `user` has an OBSERVER-or-better scan journal entry for this actor.
function _isActorScannedByUser(actor, user) {
    if (!actor || !user)
        return false;
    try {
        for (const entry of /** @type {any} */ (game.journal ?? [])) {
            const scan = /** @type {any} */ (entry.getFlag?.(MODULE_ID, 'scan'));
            if (scan?.actorUuid !== actor.uuid)
                continue;
            if (entry.testUserPermission?.(user, 'OBSERVER'))
                return true;
        }
    } catch { /* ignore */ }
    return false;
}

// Resolve visibility from the 3-mode field. Falls back to legacy ownerOnly, then 'scanned'.
function _resolveExtraBarVisibility(actor, entry) {
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

export function _resolveExtraBarValues(actor, entry) {
    const read = (src) => {
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

// Enumerate every talent rank counter and frame core counter on an actor.
// Returns [{ autoKey, label, valuePath, maxPath }] using actor-rooted "items.{id}.{rest}"
// paths that the extended resolver understands.
function _enumerateAutoCounters(actor) {
    const out = [];
    if (!actor)
        return out;
    const pilot = actor.system?.pilot?.value ?? actor;
    const talentItems = pilot?.items
        ? [...pilot.items.values()].filter(/** @type {any} */ i => i.type === 'talent')
        : [];
    for (const talent of talentItems) {
        const lid = /** @type {any} */ (talent).system?.lid ?? talent.id;
        const ranks = /** @type {any} */ (talent).system?.ranks ?? [];
        const currRank = /** @type {any} */ (talent).system?.curr_rank ?? ranks.length;
        const lastIdx = Math.min(currRank, ranks.length);
        // Counters keyed by lid/name supersede across ranks: keep only the highest rank.
        const byKey = new Map();
        for (let r = 0; r < lastIdx; r++) {
            const counters = ranks[r]?.counters ?? [];
            for (let c = 0; c < counters.length; c++) {
                const counter = counters[c];
                const k = counter?.lid || counter?.name || `r${r}c${c}`;
                byKey.set(k, { r, c, counter });
            }
        }
        for (const { r, c, counter } of byKey.values()) {
            out.push({
                autoKey: `talent:${lid}:r${r}:c${c}`,
                label: counter?.name ?? 'Counter',
                valuePath: `pilotItems.${talent.id}.system.ranks.${r}.counters.${c}.value`,
                maxPath: `pilotItems.${talent.id}.system.ranks.${r}.counters.${c}.max`,
            });
        }
    }
    const frame = actor.system?.loadout?.frame?.value;
    const csCounters = frame?.system?.core_system?.counters ?? [];
    for (let c = 0; c < csCounters.length; c++) {
        const counter = csCounters[c];
        const lid = frame.system?.lid ?? frame.id;
        out.push({
            autoKey: `frame:${lid}:c${c}`,
            label: counter?.name ?? 'Core Counter',
            valuePath: `items.${frame.id}.system.core_system.counters.${c}.value`,
            maxPath: `items.${frame.id}.system.core_system.counters.${c}.max`,
        });
    }
    return out;
}

// Idempotent auto-injection of talent/frame counters as extra bars on a token.
// Only runs on the active GM client. Skips counters whose autoKey already
// exists in the live array OR has ever been injected before (tombstone sidecar
// flag FLAG_AUTO_KEYS), so user-deleted bars stay deleted.
async function _autoInjectCounters(tokenDoc) {
    try {
        if (!game.users?.activeGM?.isSelf)
            return;
        if (!game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENTS))
            return;
        const td = /** @type {any} */ (tokenDoc)?.document ?? tokenDoc;
        if (!td)
            return;
        const actor = td.actor;
        if (!actor || !['mech', 'pilot', 'npc'].includes(actor.type))
            return;

        const color = game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_COLOR) || '#196161';
        const widthPct = Math.max(1, Math.min(100, Number(game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_WIDTH)) || 100));

        const existing = td.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
        const seen = td.getFlag(MODULE_ID, FLAG_AUTO_KEYS) ?? {};
        const liveKeys = new Set(existing.filter(/** @type {any} */ e => e?.autoKey).map(/** @type {any} */ e => e.autoKey));

        const counters = _enumerateAutoCounters(actor);
        const toAdd = counters.filter(c => !liveKeys.has(c.autoKey) && !seen[c.autoKey]);
        if (!toAdd.length)
            return;

        const next = existing.slice();
        const seenNext = { ...seen };
        for (const counter of toAdd) {
            next.push(_buildAutoInjectedEntry(counter, color, widthPct));
            seenNext[counter.autoKey] = true;
        }
        await setTokenFlag(td, MODULE_ID, FLAG_EXTRAS, next);
        await setTokenFlag(td, MODULE_ID, FLAG_AUTO_KEYS, seenNext);
    } catch (err) {
        console.warn(`${MODULE_ID} | _autoInjectCounters failed`, err);
    }
}

// Build an auto-injected entry from an enumerated counter + style settings.
function _buildAutoInjectedEntry(c, color, widthPct) {
    const base = _defaultExtraBar();
    return {
        ...base,
        id: foundry.utils.randomID(),
        autoKey: c.autoKey,
        label: c.label,
        layoutMode: 'newLine',
        widthPct,
        color: { kind: 'solid', stops: [color] },
        icon: DEFAULT_EXTRA_BAR_ICON,
        valueSource: { kind: 'path', path: c.valuePath, value: 0 },
        maxSource: { kind: 'path', path: c.maxPath, value: 1 },
        segmented: true,
        showLabelInHint: true,
        visibility: 'scanned',
        audioTextFeedback: true,
    };
}

// Reset auto-injected entries on a single token. If the world auto-inject setting
// is ON, removes everything tagged with an autoKey, clears the tombstone sidecar,
// and synchronously builds fresh entries for every current counter. If the setting
// is OFF, just strips the auto entries and clears the sidecar (clean wipe).
// Writes the result in a single setFlag call so it works regardless of GM status
// (no reliance on the global GM-gated injector) and avoids any read-after-write race.
async function _resetAutoInjectedExtras(tokenDoc) {
    try {
        const td = /** @type {any} */ (tokenDoc)?.document ?? tokenDoc;
        if (!td)
            return false;
        const existing = td.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
        const kept = existing.filter(/** @type {any} */ e => !e?.autoKey);
        let nextArr = kept;
        const nextSeen = {};
        if (game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENTS)) {
            const actor = td.actor;
            if (actor && ['mech', 'pilot', 'npc'].includes(actor.type)) {
                const color = game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_COLOR) || '#196161';
                const widthPct = Math.max(1, Math.min(100, Number(game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENT_WIDTH)) || 100));
                const counters = _enumerateAutoCounters(actor);
                const fresh = counters.map(counter => _buildAutoInjectedEntry(counter, color, widthPct));
                nextArr = [...kept, ...fresh];
                for (const counter of counters)
                    nextSeen[counter.autoKey] = true;
            }
        }
        await setTokenFlag(td, MODULE_ID, FLAG_EXTRAS, nextArr);
        await setTokenFlag(td, MODULE_ID, FLAG_AUTO_KEYS, nextSeen);
        return true;
    } catch (err) {
        console.warn(`${MODULE_ID} | _resetAutoInjectedExtras failed`, err);
        return false;
    }
}

// Group extras into lines respecting layoutMode + 100% width cap. Overflow wraps.
function _groupExtrasIntoLines(extras) {
    const lines = [];
    let currentLine = null;
    for (const extra of extras ?? []) {
        const widthPct = Math.max(1, Math.min(100, Number(extra?.widthPct) || 100));
        const breaks = !currentLine || extra?.layoutMode === 'newLine' || (currentLine.used + widthPct) > 100;
        if (breaks) {
            currentLine = { entries: [], used: 0 };
            lines.push(currentLine);
        }
        currentLine.entries.push({ entry: extra, width: widthPct });
        currentLine.used += widthPct;
    }
    return lines;
}

const DEFAULT_EXTRA_BAR_ICON = 'modules/lancer-automations/icons/perspective-dice-two.svg';

export function _defaultExtraBar() {
    return {
        id: foundry.utils.randomID(),
        label: '',
        layoutMode: 'newLine',
        widthPct: 100,
        valueSource: { kind: 'path', path: 'system.hp.value', value: 0 },
        maxSource: { kind: 'path', path: 'system.hp.max', value: 1 },
        segmented: false,
        segments: 4,
        color: { kind: 'solid', stops: ['#66cc66'] },
        visibility: 'scanned',
        icon: DEFAULT_EXTRA_BAR_ICON,
        showLabelInHint: false,
        linkedItemUuid: '',
        audioTextFeedback: false,
    };
}

/**
 * Update the value of a manual extra-bar entry.
 * Accepts a number, a numeric string, or a delta string ("+2" / "-3").
 * Rejects path-bound entries (read-only) and unknown ids.
 * @returns {Promise<number|null>} the new value, or null on failure.
 */
export async function updateExtraBarValue(token, entryId, value) {
    const td = await _resolveTokenDocument(token);
    if (!td || !entryId) {
        console.warn(`${MODULE_ID} | updateExtraBarValue: invalid token or entryId`);
        return null;
    }
    const arr = foundry.utils.deepClone(/** @type {any} */ (td).getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);
    const entry = arr.find(/** @type {any} */ x => x.id === entryId);
    if (!entry) {
        console.warn(`${MODULE_ID} | updateExtraBarValue: entry ${entryId} not found`);
        return null;
    }
    if (entry.valueSource?.kind !== 'manual') {
        console.warn(`${MODULE_ID} | updateExtraBarValue: entry ${entryId} is not manual (path-bound bars are read-only)`);
        return null;
    }
    let next;
    if (typeof value === 'string') {
        const raw = value.trim();
        const num = Number(raw);
        if (!Number.isFinite(num)) {
            console.warn(`${MODULE_ID} | updateExtraBarValue: NaN value "${value}"`);
            return null;
        }
        next = (raw.startsWith('+') || raw.startsWith('-'))
            ? (Number(entry.valueSource.value) || 0) + num
            : num;
    } else {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            console.warn(`${MODULE_ID} | updateExtraBarValue: NaN value`);
            return null;
        }
        next = num;
    }
    entry.valueSource.value = next;
    try {
        await /** @type {any} */ (td).setFlag(MODULE_ID, FLAG_EXTRAS, arr);
    } catch (err) {
        console.warn(`${MODULE_ID} | updateExtraBarValue: setFlag failed`, err);
        return null;
    }
    return next;
}

/**
 * Create a new extra bar by overlaying `partial` on the default shape.
 * Auto-generates a fresh id if missing or colliding with an existing entry.
 * @returns {Promise<string|null>} the new entry id, or null on failure.
 */
export async function addExtraBar(token, partial = {}) {
    const td = await _resolveTokenDocument(token);
    if (!td) {
        console.warn(`${MODULE_ID} | addExtraBar: invalid token`);
        return null;
    }
    if (partial && typeof partial !== 'object') {
        console.warn(`${MODULE_ID} | addExtraBar: partial must be an object`);
        return null;
    }
    const arr = foundry.utils.deepClone(/** @type {any} */ (td).getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);
    // API entries default to scanned; partial wins.
    const base = { ..._defaultExtraBar(), visibility: 'scanned', audioTextFeedback: true };
    const entry = foundry.utils.mergeObject(base, partial ?? {}, { inplace: false });
    if (!entry.id || arr.some(/** @type {any} */ x => x.id === entry.id)) {
        entry.id = foundry.utils.randomID();
    }
    arr.push(entry);
    try {
        await /** @type {any} */ (td).setFlag(MODULE_ID, FLAG_EXTRAS, arr);
    } catch (err) {
        console.warn(`${MODULE_ID} | addExtraBar: setFlag failed`, err);
        return null;
    }
    return entry.id;
}

/**
 * Remove an extra bar by id.
 * @returns {Promise<boolean>} true if removed, false if not found or on failure.
 */
export async function removeExtraBar(token, entryId) {
    const td = await _resolveTokenDocument(token);
    if (!td || !entryId) {
        console.warn(`${MODULE_ID} | removeExtraBar: invalid token or entryId`);
        return false;
    }
    const arr = foundry.utils.deepClone(/** @type {any} */ (td).getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);
    const next = arr.filter(/** @type {any} */ x => x.id !== entryId);
    if (next.length === arr.length)
        return false;
    try {
        await /** @type {any} */ (td).setFlag(MODULE_ID, FLAG_EXTRAS, next);
    } catch (err) {
        console.warn(`${MODULE_ID} | removeExtraBar: setFlag failed`, err);
        return false;
    }
    return true;
}

export const ExtraBarsAPI = { updateExtraBarValue, addExtraBar, removeExtraBar };

function _escAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _renderExtraBarRowHtml(entry, idx, overflow, collapsed) {
    const e = entry;
    const v = e.valueSource ?? {};
    const m = e.maxSource ?? {};
    const stops = e.color?.stops ?? ['#888888'];
    const summary = e.label || (v.kind === 'path' ? (v.path || 'unset') : `${v.value ?? 0}`);
    return `
        <div class="la-extra-bar-row${collapsed ? ' collapsed' : ''}" data-idx="${idx}" data-id="${e.id}">
            <div class="la-extra-bar-header">
                <span class="la-extra-bar-drag" draggable="true" title="Drag to reorder">≡</span>
                <button type="button" class="la-extra-bar-toggle" title="${collapsed ? 'Expand' : 'Collapse'}">
                    <i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i>
                </button>
                <input type="text" class="la-extra-bar-label" data-field="label" value="${_escAttr(e.label ?? '')}" placeholder="Label" maxlength="14">
                <span class="la-extra-bar-summary" title="${_escAttr(summary)}">${_escAttr(summary)}</span>
                <input type="number" data-field="widthPct" value="${e.widthPct}" min="1" max="100" step="1" title="Width %" class="la-extra-bar-width" style="${overflow ? 'border-color:#c33;color:#c33;' : ''}">
                <span class="la-extra-bar-pct">%</span>
                ${(() => {
                    const vis = e.visibility ?? (e.ownerOnly === true ? 'owner' : e.ownerOnly === false ? 'all' : 'scanned');
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
                        <option value="newLine" ${e.layoutMode === 'newLine' ? 'selected' : ''}>New line</option>
                        <option value="sameLine" ${e.layoutMode === 'sameLine' ? 'selected' : ''}>Same line</option>
                    </select>
                </div>
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Value</span>
                    <select data-field="valueSource.kind">
                        <option value="path" ${v.kind === 'path' ? 'selected' : ''}>Path</option>
                        <option value="manual" ${v.kind === 'manual' ? 'selected' : ''}>Manual</option>
                    </select>
                    <input type="text" data-field="valueSource.path" value="${_escAttr(v.path ?? '')}" placeholder="system.hp.value" class="la-extra-bar-grow" style="${v.kind !== 'path' ? 'display:none;' : ''}">
                    <input type="number" data-field="valueSource.value" value="${v.value ?? 0}" step="1" style="${v.kind !== 'manual' ? 'display:none;' : ''}">
                </div>
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Max</span>
                    <select data-field="maxSource.kind">
                        <option value="path" ${m.kind === 'path' ? 'selected' : ''}>Path</option>
                        <option value="manual" ${m.kind === 'manual' ? 'selected' : ''}>Manual</option>
                    </select>
                    <input type="text" data-field="maxSource.path" value="${_escAttr(m.path ?? '')}" placeholder="system.hp.max" class="la-extra-bar-grow" style="${m.kind !== 'path' ? 'display:none;' : ''}">
                    <input type="number" data-field="maxSource.value" value="${m.value ?? 1}" step="1" style="${m.kind !== 'manual' ? 'display:none;' : ''}">
                </div>
                <div class="la-extra-bar-line">
                    <label class="la-extra-bar-cb" title="Display as discrete pips using the max value as the segment count."><input type="checkbox" data-field="segmented" ${e.segmented ? 'checked' : ''}><span>Segmented</span></label>
                    <span class="la-extra-bar-tag" style="margin-left:auto;">Color</span>
                    <input type="color" data-field="color.stops.0" value="${stops[0] ?? '#888888'}">
                </div>
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Icon</span>
                    <img class="la-extra-bar-icon-preview" src="${_escAttr(e.icon ?? DEFAULT_EXTRA_BAR_ICON)}" alt="" onerror="this.style.opacity='0.3';">
                    <input type="text" data-field="icon" value="${_escAttr(e.icon ?? DEFAULT_EXTRA_BAR_ICON)}" placeholder="${DEFAULT_EXTRA_BAR_ICON}" class="la-extra-bar-grow">
                    <button type="button" class="la-extra-bar-icon-pick" title="Browse files"><i class="fas fa-file-import"></i></button>
                    <label class="la-extra-bar-cb" title="Show label next to the icon in the hover stat hint"><input type="checkbox" data-field="showLabelInHint" ${e.showLabelInHint ? 'checked' : ''}><span>Show label in hint</span></label>
                    <label class="la-extra-bar-cb" title="Float a +/- text over the token and play the generic_stat sound on value change"><input type="checkbox" data-field="audioTextFeedback" ${e.audioTextFeedback ? 'checked' : ''}><span>Audio/Text Feedback</span></label>
                </div>
                ${e.autoKey ? '' : `
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag" title="Right-click in TAH Resources opens this item's sheet.">Linked Item</span>
                    <input type="text" data-field="linkedItemUuid" value="${_escAttr(e.linkedItemUuid ?? '')}" placeholder="Actor.X.Item.Y (UUID)" class="la-extra-bar-grow" readonly>
                    <button type="button" class="la-extra-bar-item-pick" title="Pick an item from the actor"><i class="fas fa-link"></i></button>
                    <button type="button" class="la-extra-bar-item-clear" title="Clear linked item"><i class="fas fa-times"></i></button>
                </div>`}
            </div>
        </div>
    `;
}

// Inject CSS once for the extra-bars editor.
function _ensureExtraBarsStyles() {
    if (document.getElementById('la-extra-bars-styles'))
        return;
    const s = document.createElement('style');
    s.id = 'la-extra-bars-styles';
    s.textContent = `
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
    document.head.appendChild(s);
}

function _bindExtraBarsUI(root, tokenDoc, app) {
    _ensureExtraBarsStyles();
    const listEl = root.querySelector?.('[data-extras]');
    const addBtn = root.querySelector?.('.la-extra-bars-add');
    const formEl = root.querySelector?.('form') ?? root.closest?.('form') ?? root;
    if (!listEl || !addBtn || !formEl)
        return;

    // Working copy. Persisted on form submit.
    let arr = foundry.utils.deepClone(tokenDoc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);

    // Per-id collapsed state. Existing rows start collapsed so the list is scannable.
    const collapsedIds = new Set(arr.map(/** @type {any} */ e => e?.id).filter(Boolean));

    const computeOverflow = () => {
        const lines = _groupExtrasIntoLines(arr);
        // Mark every entry whose requested width pushed it onto a new line.
        const overflowing = new Set();
        let currentLine = null;
        for (const extra of arr) {
            const widthPct = Math.max(1, Math.min(100, Number(extra?.widthPct) || 100));
            const breaks = !currentLine || extra?.layoutMode === 'newLine' || (currentLine.used + widthPct) > 100;
            if (breaks) {
                if (currentLine && extra?.layoutMode === 'sameLine' && (currentLine.used + widthPct) > 100) {
                    overflowing.add(extra.id);
                }
                currentLine = { used: 0 };
            }
            currentLine.used += widthPct;
        }
        void lines;
        return overflowing;
    };

    const rerender = () => {
        const overflowing = computeOverflow();
        listEl.innerHTML = arr.map((e, i) => _renderExtraBarRowHtml(e, i, overflowing.has(e.id), collapsedIds.has(e.id))).join('');
        bindRow();
        if (typeof app.setPosition === 'function')
            app.setPosition({ height: 'auto' });
    };

    const setField = (entry, field, value) => {
        if (field.includes('.')) {
            foundry.utils.setProperty(entry, field, value);
        } else {
            entry[field] = value;
        }
    };

    const bindRow = () => {
        listEl.querySelectorAll('.la-extra-bar-row').forEach(/** @type {any} */(rowEl) => {
            const idx = Number(rowEl.dataset.idx);
            const entry = arr[idx];
            if (!entry)
                return;

            rowEl.querySelectorAll('[data-field]').forEach(/** @type {any} */(input) => {
                input.addEventListener('change', () => {
                    const field = input.dataset.field;
                    let value;
                    if (input.type === 'checkbox') {
                        value = input.checked;
                    } else if (input.type === 'number') {
                        value = Number(input.value) || 0;
                    } else {
                        value = input.value;
                    }
                    setField(entry, field, value);
                    // Re-render on changes that affect visibility of dependent fields.
                    if (field === 'valueSource.kind' || field === 'maxSource.kind'
                        || field === 'segmented'
                        || field === 'layoutMode' || field === 'widthPct') {
                        rerender();
                    }
                });
                input.addEventListener('input', () => {
                    // Live-update on color pickers so the saved value reflects the last pick.
                    if (input.type === 'color') {
                        setField(entry, input.dataset.field, input.value);
                    }
                });
            });

            rowEl.querySelector('.la-extra-bar-del')?.addEventListener('click', () => {
                collapsedIds.delete(entry.id);
                arr.splice(idx, 1);
                rerender();
            });

            // Icon path → live-update the preview img on input.
            const iconInput = /** @type {any} */ (rowEl.querySelector('input[data-field="icon"]'));
            const iconPreview = /** @type {any} */ (rowEl.querySelector('.la-extra-bar-icon-preview'));
            iconInput?.addEventListener('input', () => {
                if (iconPreview) {
                    iconPreview.src = iconInput.value || DEFAULT_EXTRA_BAR_ICON;
                    iconPreview.style.opacity = '';
                }
            });

            // Icon picker button → open Foundry's FilePicker rooted in modules/lancer-automations/icons.
            rowEl.querySelector('.la-extra-bar-icon-pick')?.addEventListener('click', () => {
                const current = (entry.icon || DEFAULT_EXTRA_BAR_ICON);
                const fp = new FilePicker({
                    type: 'imagevideo',
                    current,
                    callback: (path) => {
                        entry.icon = path;
                        if (iconInput) iconInput.value = path;
                        if (iconPreview) {
                            iconPreview.src = path;
                            iconPreview.style.opacity = '';
                        }
                    },
                });
                fp.browse();
            });

            // Item picker → choose an Item from the actor (or any actor) to link.
            rowEl.querySelector('.la-extra-bar-item-pick')?.addEventListener('click', async () => {
                const actor = tokenDoc?.actor ?? tokenDoc?.parent?.actor;
                const pilot = actor?.system?.pilot?.value;
                const sources = [];
                if (actor) sources.push({ label: actor.name ?? 'Actor', items: [...(actor.items?.values?.() ?? [])] });
                if (pilot && pilot !== actor) sources.push({ label: `${pilot.name ?? 'Pilot'} (Pilot)`, items: [...(pilot.items?.values?.() ?? [])] });
                const optionGroups = sources.filter(s => s.items.length).map(s =>
                    `<optgroup label="${_escAttr(s.label)}">${s.items.map(i =>
                        `<option value="${_escAttr(i.uuid)}" ${entry.linkedItemUuid === i.uuid ? 'selected' : ''}>${_escAttr(i.name)} [${_escAttr(i.type)}]</option>`
                    ).join('')}</optgroup>`
                ).join('');
                const content = `<form><div class="form-group"><label>Linked Item</label><select name="uuid" style="width:100%;">${optionGroups || '<option value="">(no items found)</option>'}</select></div></form>`;
                const picked = await Dialog.prompt({
                    title: 'Link Item to Extra Bar',
                    content,
                    label: 'Link',
                    callback: (/** @type {any} */ html) => {
                        const sel = (html?.find?.('select[name="uuid"]')?.[0]) ?? html?.querySelector?.('select[name="uuid"]');
                        return sel?.value ?? '';
                    },
                    rejectClose: false,
                });
                if (typeof picked === 'string') {
                    entry.linkedItemUuid = picked;
                    rerender();
                }
            });
            rowEl.querySelector('.la-extra-bar-item-clear')?.addEventListener('click', () => {
                entry.linkedItemUuid = '';
                rerender();
            });

            rowEl.querySelector('.la-extra-bar-toggle')?.addEventListener('click', () => {
                if (collapsedIds.has(entry.id))
                    collapsedIds.delete(entry.id);
                else
                    collapsedIds.add(entry.id);
                rerender();
            });

            // HTML5 drag/drop reorder — dragstart fires from the handle only.
            const dragHandle = rowEl.querySelector('.la-extra-bar-drag');
            if (dragHandle) {
                dragHandle.addEventListener('dragstart', (/** @type {any} */ ev) => {
                    rowEl.classList.add('dragging');
                    ev.dataTransfer.effectAllowed = 'move';
                    ev.dataTransfer.setData('text/plain', String(idx));
                });
                dragHandle.addEventListener('dragend', () => rowEl.classList.remove('dragging'));
            }
            rowEl.addEventListener('dragover', (/** @type {any} */ ev) => {
                ev.preventDefault();
                rowEl.classList.add('drag-over');
            });
            rowEl.addEventListener('dragleave', () => rowEl.classList.remove('drag-over'));
            rowEl.addEventListener('drop', (/** @type {any} */ ev) => {
                ev.preventDefault();
                rowEl.classList.remove('drag-over');
                const from = Number(ev.dataTransfer.getData('text/plain'));
                const to = idx;
                if (Number.isFinite(from) && from !== to) {
                    const moved = arr.splice(from, 1)[0];
                    arr.splice(to, 0, moved);
                    rerender();
                }
            });
        });
    };

    addBtn.addEventListener('click', () => {
        const entry = _defaultExtraBar();
        arr.push(entry);
        collapsedIds.add(entry.id);
        rerender();
    });

    // Reset auto-injected bars: re-syncs from talent / frame core counters when
    // the world setting is on, or wipes auto entries + tombstones when it's off.
    const resetBtn = root.querySelector?.('.la-extra-bars-reset');
    resetBtn?.addEventListener('click', async () => {
        const settingOn = !!game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENTS);
        // Persist the in-memory edits first so user changes aren't blown away by setFlag races.
        try {
            await tokenDoc.setFlag(MODULE_ID, FLAG_EXTRAS, arr);
        } catch (err) {
            console.warn(`${MODULE_ID} | reset auto: failed to persist current state`, err);
        }
        const ok = await _resetAutoInjectedExtras(tokenDoc);
        if (!ok) {
            ui.notifications.warn('Reset failed — check the console.');
            return;
        }
        // Pull the fresh array back into the editor and re-render.
        arr = foundry.utils.deepClone(tokenDoc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);
        for (const e of arr) {
            if (e?.id && e.autoKey)
                collapsedIds.add(e.id);
        }
        rerender();
        ui.notifications.info(settingOn
            ? 'Talent counter bars re-synced.'
            : 'Auto-injected bars removed.');
    });

    // Persist on form submit. Foundry's submit fires before close.
    formEl.addEventListener('submit', () => {
        // Defer so this runs after Foundry's own form-data extraction.
        Promise.resolve().then(() => {
            try {
                tokenDoc.setFlag(MODULE_ID, FLAG_EXTRAS, arr);
            } catch (err) {
                console.warn(`${MODULE_ID} | failed to persist extra bars`, err);
            }
        });
    }, true);

    rerender();
}

function snapshotValues(actor, tokenDoc = null) {
    const extras = tokenDoc?.getFlag?.(MODULE_ID, FLAG_EXTRAS) ?? [];
    const extrasSnap = {};
    for (const extra of extras) {
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
        overshield: actor.system?.overshield?.value ?? 0,
        burn: actor.system?.burn ?? 0,
        infection: actor.system?.infection ?? 0,
        reaction: actor.system?.action_tracker?.reaction === true,
        extras: extrasSnap,
    };
}

function refreshVisibleLancerTokens() {
    if (!isEnabled()) {
        return;
    }
    if (!canvas?.tokens) {
        return;
    }
    for (const tok of canvas.tokens.placeables) {
        if (!isLancerCombatant(tok.actor)) {
            continue;
        }
        if (!_overlayHubs.has(tok.id)) {
            continue;
        }
        fadeBars(tok, shouldShowBars(tok) ? 1 : 0);
    }
}

// ---------------------------------------------------------------------------
// Fade + flash animations
// ---------------------------------------------------------------------------

function _getFadeTarget(token) {
    const entry = _overlayHubs.get(token.id);
    return entry?.wrapper ?? token.bars;
}

function fadeBars(token, targetAlpha) {
    const target = _getFadeTarget(token);
    if (!target) {
        return;
    }
    const id = token.id;
    const cur = _fadeState.get(id);
    if (cur && cur.target === targetAlpha) {
        return;
    }
    if (cur) {
        canvas.app.ticker.remove(cur.tick);
    }
    const startAlpha = target.alpha ?? 1;
    const duration = 150;
    const startTime = performance.now();

    const tick = () => {
        const t2 = _getFadeTarget(token);
        if (!t2 || token.destroyed) {
            canvas.app.ticker.remove(tick);
            _fadeState.delete(id);
            return;
        }
        const t = Math.min(1, (performance.now() - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        t2.alpha = startAlpha + (targetAlpha - startAlpha) * eased;
        if (t >= 1) {
            canvas.app.ticker.remove(tick);
            _fadeState.delete(id);
        }
    };

    _fadeState.set(id, { target: targetAlpha, tick });
    canvas.app.ticker.add(tick);
}

function runFlashAnimation(token, name, drawAt) {
    const flashGfx = new PIXI.Graphics();
    flashGfx.name = name;
    // Flash goes into the overlay hub if available.
    const entry = _overlayHubs.get(token.id);
    const parent = entry?.hub ?? token;
    parent.addChild(flashGfx);

    const flashStart = performance.now();
    const tick = () => {
        if (!flashGfx || flashGfx.destroyed) {
            canvas.app.ticker.remove(tick);
            return;
        }
        const elapsed = performance.now() - flashStart;
        flashGfx.clear();
        if (elapsed < FLASH_HOLD_MS) {
            drawAt(flashGfx, 0);
            return;
        }
        const t = Math.min(1, (elapsed - FLASH_HOLD_MS) / FLASH_SHRINK_MS);
        if (t >= 1) {
            flashGfx.destroy();
            canvas.app.ticker.remove(tick);
            return;
        }
        const eased = 1 - Math.pow(1 - t, 3);
        drawAt(flashGfx, eased);
    };
    canvas.app.ticker.add(tick);
}

function spawnFlash(token, barId, oldVal, newVal) {
    const geom = token._laBarsGeom;
    if (!geom || oldVal === newVal) {
        return;
    }

    const { layoutOffsetX, pipColW, rowHeight, rowGap, startY, indicatorW, reactionExtension, rightColX, rightColW } = geom;
    const visibleIds = geom.visibleIds;

    if (barId === 'hp' || barId === 'heat' || barId === 'pilotStress') {
        if (!visibleIds.has(barId)) {
            return;
        }
        const rowIdx = barId === 'hp' ? 0 : 1;
        const hostMax = barId === 'pilotStress'
            ? Math.max(token.actor?.system?.bond_state?.stress?.max ?? 8, oldVal, newVal)
            : Math.max(getEffectiveMax(token.actor, barId), oldVal, newVal);
        if (hostMax <= 0) {
            return;
        }
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const rowY = startY + rowIdx * (rowHeight + rowGap) + 1;
        const rowH = rowHeight - 2;

        const minVal = Math.min(oldVal, newVal);
        const maxVal = Math.max(oldVal, newVal);
        const isDamage = newVal < oldVal;
        const initialFlashX = barX + (minVal / hostMax) * barW;
        const initialFlashW = ((maxVal - minVal) / hostMax) * barW;
        if (initialFlashW <= 0) {
            return;
        }
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) => {
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

    if (barId === 'structure' || barId === 'stress') {
        if (!visibleIds.has(barId)) {
            return;
        }
        const rowIdx = barId === 'structure' ? 0 : 1;
        const pipMax = barId === 'structure'
            ? (token.actor?.system?.structure?.max ?? 0)
            : (token.actor?.system?.stress?.max ?? 0);
        if (pipMax <= 0) {
            return;
        }
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
        if (endIdx <= startIdx) {
            return;
        }
        const isDamage = newVal < oldVal;
        const flashStartX = colX + 1 + startIdx * (pipSegW + pipGapPx);
        const flashEndX = colX + 1 + endIdx * (pipSegW + pipGapPx) - pipGapPx;
        const initialFlashW = flashEndX - flashStartX;
        if (initialFlashW <= 0) {
            return;
        }
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) => {
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

    if (barId === 'overshield') {
        if (!visibleIds.has('hp')) {
            return;
        }
        const hpMax = Math.max(getEffectiveMax(token.actor, 'hp'), oldVal, newVal);
        if (hpMax <= 0) {
            return;
        }
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const rowY = startY + 1;
        const rowH = rowHeight - 2;

        const minVal = Math.min(oldVal, newVal);
        const maxVal = Math.max(oldVal, newVal);
        const isDamage = newVal < oldVal;
        const initialFlashX = barX + (minVal / hpMax) * barW;
        const initialFlashW = ((maxVal - minVal) / hpMax) * barW;
        if (initialFlashW <= 0) {
            return;
        }
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) => {
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

    if (barId === 'burn' || barId === 'infection') {
        const hostId = barId === 'burn' ? 'hp' : 'heat';
        if (!visibleIds.has(hostId)) {
            return;
        }
        const hostMax = Math.max(getEffectiveMax(token.actor, hostId), oldVal, newVal);
        if (hostMax <= 0) {
            return;
        }
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
        if (barId === 'burn') {
            const oldEdge = barX + Math.max(0, fillPx - (oldVal / hostMax) * barW);
            const newEdge = barX + Math.max(0, fillPx - (newVal / hostMax) * barW);
            flashStartX = Math.min(oldEdge, newEdge);
            flashW = Math.abs(newEdge - oldEdge);
        } else {
            const oldEdge = barX + Math.min(barW, fillPx + (oldVal / hostMax) * barW);
            const newEdge = barX + Math.min(barW, fillPx + (newVal / hostMax) * barW);
            flashStartX = Math.min(oldEdge, newEdge);
            flashW = Math.abs(newEdge - oldEdge);
        }
        if (flashW <= 0) {
            return;
        }

        const initialFlashX = flashStartX;
        const initialFlashW = flashW;
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) => {
            const remainingW = initialFlashW * (1 - eased);
            // Reversed vs host bar.
            let drawX;
            if (barId === 'burn') {
                drawX = isReduction
                    ? initialFlashX + (initialFlashW - remainingW)
                    : initialFlashX;
            } else {
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

    if (barId === 'reaction') {
        // Reaction hangs off the left edge.
        const x = -reactionExtension;
        const y = startY + 1;
        const w = indicatorW - 2;
        const h = rowHeight - 2;
        if (w <= 0 || h <= 0) {
            return;
        }
        runFlashAnimation(token, 'la-flash-reaction', (gfx, eased) => {
            const remainingH = h * (1 - eased);
            const drawY = y + (h - remainingH);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(x + 1, drawY, w, remainingH);
            gfx.endFill();
        });
    }
}

// Audio + scrolling text. Fires even without a rendered hub.
function fireExtraFeedback(token, entryId, oldVal, newVal) {
    if (oldVal === newVal)
        return;
    try {
        const extras = /** @type {any} */ (token).document?.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
        const entry = extras.find(/** @type {any} */ e => e?.id === entryId);
        if (!entry?.audioTextFeedback)
            return;
        const canSee = _resolveExtraBarVisibility(/** @type {any} */ (token).actor, entry);
        const delta = newVal - oldVal;
        const label = entry.label || 'Stat';
        const text = canSee ? `${delta > 0 ? '+' : ''}${delta} ${label}` : '???';
        if (canvas?.interface?.createScrollingText) {
            let showScroll = true;
            try { showScroll = !!game.settings.get('lancer', 'floatingNumbers'); } catch { /* ignore */ }
            if (showScroll) {
                const primary = canSee ? (entry.color?.stops?.[0] ?? '#ffffff') : '#888888';
                canvas.interface.createScrollingText(token.center, text, {
                    anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                    direction: delta > 0 ? CONST.TEXT_ANCHOR_POINTS.BOTTOM : CONST.TEXT_ANCHOR_POINTS.TOP,
                    fontSize: 28,
                    fill: primary,
                    stroke: 0,
                    strokeThickness: 4,
                    jitter: 0.25,
                });
            }
        }
        playStatsSound('generic_stat');
    } catch { /* ignore */ }
}

function spawnFlashExtra(token, entryId, oldVal, newVal) {
    fireExtraFeedback(token, entryId, oldVal, newVal);
    const geom = token._laBarsGeom;
    if (!geom || !Array.isArray(geom.extras) || oldVal === newVal)
        return;
    let target = null;
    let lineY = 0;
    for (const line of geom.extras) {
        const found = line.entries.find(/** @type {any} */ entryGeom => entryGeom.entryId === entryId);
        if (found) {
            target = found;
            lineY = line.y;
            break;
        }
    }
    if (!target)
        return;

    const { rowHeight } = geom;
    const isDamage = newVal < oldVal;

    if (target.segmented) {
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
        runFlashAnimation(token, `la-flash-extra-${entryId}`, (gfx, eased) => {
            const remainingW = initialFlashW * (1 - eased);
            // Damage: pips drain from the right → flash shrinks from the left.
            const drawX = isDamage
                ? flashStartX
                : flashStartX + (initialFlashW - remainingW);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, rowY, remainingW, rowH);
            gfx.endFill();
        });
        return;
    }

    // Solid / gradient bar — rectangular flash on the changed slice.
    const hostMax = Math.max(1, oldVal, newVal);
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
    runFlashAnimation(token, `la-flash-extra-${entryId}`, (gfx, eased) => {
        const remainingW = initialFlashW * (1 - eased);
        const drawX = isDamage
            ? initialFlashX
            : initialFlashX + (initialFlashW - remainingW);
        gfx.beginFill(0xffffff, 1);
        gfx.drawRect(drawX, rowY, remainingW, rowH);
        gfx.endFill();
    });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const BAKE_RESOLUTION = 4;

// Replaces gfx in container with a baked sprite at the same Z-position and
// tracks the texture for cleanup. Returns true if the swap happened.
function bakeAndSwap(container, gfx, tokenId, { addAt } = {}) {
    const sprite = bakeGraphicsToTexture(gfx);
    if (!sprite) {
        return false;
    }
    container.removeChild(gfx);
    if (Number.isFinite(addAt)) {
        container.addChildAt(sprite, addAt);
    } else {
        container.addChild(sprite);
    }
    gfx.destroy();
    const entry = _overlayHubs.get(tokenId);
    if (entry) {
        entry.bakedTextures = entry.bakedTextures || [];
        entry.bakedTextures.push(sprite._laBakedTexture);
    }
    return true;
}

// Bakes a Graphics into a high-res RenderTexture and returns a Sprite that
// renders crisp at any zoom. Caller is responsible for destroying the original
// Graphics; the texture lives on sprite._laBakedTexture for later cleanup.
function bakeGraphicsToTexture(gfx, resolution = BAKE_RESOLUTION) {
    if (!canvas?.app?.renderer || !gfx) {
        return null;
    }
    try {
        const bounds = gfx.getLocalBounds();
        if (bounds.width <= 0 || bounds.height <= 0) {
            return null;
        }
        const region = new PIXI.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);
        const tex = canvas.app.renderer.generateTexture(gfx, {
            resolution,
            region,
            multisample: PIXI.MSAA_QUALITY?.HIGH ?? 4,
        });
        // Mipmaps so the GPU uses pre-filtered downsampled copies instead of
        // 1-of-N nearest sampling (which is what causes the visible moiré).
        if (tex.baseTexture) {
            tex.baseTexture.mipmap = PIXI.MIPMAP_MODES?.ON ?? 1;
            tex.baseTexture.anisotropicLevel = 16;
            tex.baseTexture.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? 1;
            tex.baseTexture.update();
        }
        const sprite = new PIXI.Sprite(tex);
        sprite.position.set(bounds.x, bounds.y);
        sprite._laBakedTexture = tex;
        return sprite;
    } catch (e) {
        console.warn(`${MODULE_ID} | bakeGraphicsToTexture failed`, e);
        return null;
    }
}

function drawSegment(gfx, x, y, w, h, def, v, cs = 1) {
    const max = (v.max && v.max > 0) ? v.max : (def.softMax ?? 1);
    const value = Math.max(0, v.value ?? 0);
    const pct = Math.max(0, Math.min(1, value / max));

    gfx.lineStyle(0);
    gfx.beginFill(0x111111, 0.9);
    gfx.drawRect(x, y, w, h);
    gfx.endFill();
    gfx.beginFill(0x222222, 0.9);
    gfx.drawRect(x + cs, y + cs, w - 2 * cs, h - 2 * cs);
    gfx.endFill();

    if (def.pips) {
        // Default: drains left-first (Structure/Stress convention). When def.pipsLTR
        // is set, fills left-first (progress-bar convention) — used by extras.
        const gap = cs;
        const inner = w - 2 * cs;
        const segW = (inner - gap * (max - 1)) / max;
        const filledCount = Math.max(0, Math.min(max, value));
        for (let s = 0; s < max; s++) {
            const filled = def.pipsLTR ? (s < filledCount) : (s >= max - filledCount);
            gfx.beginFill(filled ? def.color : 0x333333, filled ? 1 : 0.6);
            gfx.drawRect(x + cs + s * (segW + gap), y + cs, segW, h - 2 * cs);
            gfx.endFill();
        }
    } else {
        const fillW = Math.max(0, (w - 2 * cs) * pct);
        if (fillW > 0) {
            gfx.beginFill(def.color, 1);
            gfx.drawRect(x + cs, y + cs, fillW, h - 2 * cs);
            gfx.endFill();
        }
    }
}

function _removeOverlayHub(tokenId) {
    _removeSyncTicker(tokenId);
    const entry = _overlayHubs.get(tokenId);
    if (!entry) {
        return;
    }
    if (!entry.wrapper.destroyed) {
        entry.wrapper.destroy({ children: true });
    }
    if (entry.bakedTextures) {
        for (const tex of entry.bakedTextures) {
            try {
                tex.destroy(true);
            } catch { /* ignore */ }
        }
    }
    _overlayHubs.delete(tokenId);
}

// Per-frame position sync so the hub follows token drag.
const _syncTickers = new Map();

function _ensureSyncTicker(token) {
    if (_syncTickers.has(token.id)) {
        return;
    }
    const tick = () => {
        const entry = _overlayHubs.get(token.id);
        if (!entry || token.destroyed) {
            canvas.app.ticker.remove(tick);
            _syncTickers.delete(token.id);
            return;
        }
        const active = _activeForId(token.id) ?? token;
        const iso = _getIsoState(active);
        if (iso && active.mesh) {
            entry.wrapper.position.set(active.mesh.position.x, active.mesh.position.y);
        } else {
            entry.wrapper.position.set(active.position.x, active.position.y);
        }
        const minZoom = getWorldSetting(SETTING_MIN_ZOOM_SCALE, 0);
        if (minZoom > 0 && !iso) {
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
            for (const child of entry.hub.children) {
                if (child?.name === 'la-bar-label') {
                    child.scale.set((ky / kx) / 8, 1 / 8);
                }
            }
        }
    };
    _syncTickers.set(token.id, tick);
    canvas.app.ticker.add(tick);
}

function _removeSyncTicker(tokenId) {
    const tick = _syncTickers.get(tokenId);
    if (tick) {
        canvas.app.ticker.remove(tick);
        _syncTickers.delete(tokenId);
    }
}

// Returns the active Token instance for an id: the drag preview if one exists in
// canvas.tokens.preview, otherwise the source token. Both share the same id in v13.
function _activeForId(tokenId) {
    const previews = canvas.tokens?.preview?.children ?? [];
    for (const p of previews) {
        if (p?.document?.id === tokenId && p.mesh)
            return p;
    }
    return canvas.tokens?.get?.(tokenId) ?? null;
}

function _syncHubPosition(token) {
    const entry = _overlayHubs.get(token.id);
    if (!entry) {
        return;
    }
    const active = _activeForId(token.id) ?? token;
    const iso = _getIsoState(active);
    if (iso && active.mesh) {
        entry.wrapper.position.set(active.mesh.position.x, active.mesh.position.y);
    } else {
        entry.wrapper.position.set(active.position.x, active.position.y);
    }
    _ensureSyncTicker(token);
}

function drawStatHub() {
    const token = this;
    const actor = token?.actor;

    if (!token?.bars)
        return;

    token.bars.removeChildren();

    // Preserve flash children before destroying the old hub.
    const oldEntry = _overlayHubs.get(token.id);
    const savedFlashes = [];
    if (oldEntry?.hub) {
        for (const child of [...oldEntry.hub.children]) {
            if (child.name?.startsWith('la-flash-')) {
                oldEntry.hub.removeChild(child);
                savedFlashes.push(child);
            }
        }
    }
    _removeOverlayHub(token.id);

    if (!isEnabled() || !isLancerCombatant(actor)) {
        if (originalDrawBars) {
            return originalDrawBars.call(token);
        }
        return;
    }

    token.displayBars = CONST.TOKEN_DISPLAY_MODES.ALWAYS;

    const overlay = getHubOverlay();
    if (!overlay) {
        return;
    }

    const visibleIds = new Set(getVisibleBars(actor, token.document).map(d => d.id));
    const find = id => BAR_DEFS.find(d => d.id === id);
    const mechStats = hasMechStats(actor);
    const reactionEnabled = hasReaction(actor);

    const rows = [];
    if (mechStats) {
        if (visibleIds.has('structure') || visibleIds.has('hp')) {
            rows.push([find('structure'), find('hp')]);
        }
        // Stress is paired with heat — if heat is hidden, drop stress too so
        // we don't render an orphan row.
        if (visibleIds.has('heat')) {
            rows.push([find('stress'), find('heat')]);
        }
    } else {
        // Pilots / deployables: full-width HP row, plus a heat row if heat
        // somehow ended up on them (e.g. infection ticking on a deployable).
        if (visibleIds.has('hp')) {
            rows.push([null, find('hp')]);
        }
        if (visibleIds.has('pilotStress')) {
            rows.push([null, find('pilotStress')]);
        } else if (visibleIds.has('heat')) {
            rows.push([null, find('heat')]);
        }
    }

    if (rows.length === 0) {
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
    if (mechStats) {
        const baseColW = Math.floor(usableW * 0.32);
        const innerGap = chromeScale;
        const pipSlotW = (baseColW - 2 * chromeScale - innerGap * 3) / 4;
        const structMax = actor.system?.structure?.max ?? 0;
        const stressMax = actor.system?.stress?.max ?? 0;
        const pipCount = Math.min(4, Math.max(structMax, stressMax, 1));
        pipColW = Math.ceil(pipCount * pipSlotW + innerGap * (pipCount - 1) + 2 * chromeScale);
    }

    // Armor ticks — right of HP bar, GM/owners only.
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
    if (iso && token.mesh) {
        wrapper.position.set(token.mesh.position.x, token.mesh.position.y);
        wrapper.rotation = iso.reverseRotation;
        wrapper.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        // K = 1/sqrt(sqrt(3)) ≈ 0.76 cancels the True Iso aspect change.
        const k = 0.76;
        wrapper.scale.set(k, 1 / k);
        container.position.set(-width / 2, (token.h / 2) + 3 - rowHeight);
    } else {
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
    // Reaction — hangs off the left edge. Skipped for deployables.
    if (reactionEnabled) {
        const reactionAvailable = actor.system?.action_tracker?.reaction === true;
        const reactionX = -reactionExtension;
        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(reactionX, 0, indicatorW, rowHeight);
        gfx.endFill();
        gfx.beginFill(reactionAvailable ? 0x9944cc : 0x333333, reactionAvailable ? 1 : 0.6);
        gfx.drawRect(reactionX + chromeScale, chromeScale, indicatorW - 2 * chromeScale, rowHeight - 2 * chromeScale);
        gfx.endFill();
    }

    rows.forEach((row, rowIdx) => {
        const y = rowIdx * (rowHeight + rowGap);
        const [leftDef, rightDef] = row;
        if (leftDef && visibleIds.has(leftDef.id)) {
            drawSegment(gfx, layoutOffsetX, y, pipColW, rowHeight, leftDef, leftDef.getValue(actor), chromeScale);
        }
        if (rightDef && visibleIds.has(rightDef.id)) {
            drawSegment(gfx, rightColX, y, rightColW, rowHeight, rightDef, rightDef.getValue(actor), chromeScale);
        }
    });

    // Armor ticks (HP row, right extension).
    if (armorVal > 0 && visibleIds.has('hp')) {
        const armorX = rightColX + rightColW + armorGap;
        const innerH = rowHeight - 2 * chromeScale;
        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(armorX, 0, armorW, rowHeight);
        gfx.endFill();
        for (let i = 0; i < armorVal; i++) {
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
    if (osVal > 0 && hpMax > 0 && visibleIds.has('hp')) {
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

        const tick = () => {
            if (osGfx.destroyed || !osGfx.parent) {
                canvas.app.ticker.remove(tick);
                return;
            }
            osGfx.clear();
            const phase = (performance.now() % periodMs) / periodMs;
            for (let i = 0; i < osW; i++) {
                const base = osW > 1 ? i / (osW - 1) : 0;
                let t = (base + phase) % 1;
                if (t > 0.5) {
                    t = 1 - t;
                }
                t *= 2;
                const r = Math.round(rA + (rB - rA) * t);
                const g = Math.round(gA + (gB - gA) * t);
                const b = Math.round(bA + (bB - bA) * t);
                osGfx.beginFill((r << 16) | (g << 8) | b, 0.75);
                osGfx.drawRect(osX + i, osY, 1, osH);
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
    const drawCounterStripe = (rowIdx, def, hostId, direction) => {
        if (!visibleIds.has(hostId)) {
            return;
        }
        const counterV = def.getValue(actor);
        if ((counterV.value ?? 0) <= 0) {
            return;
        }
        const hostV = find(hostId).getValue(actor);
        const hostMax = hostV.max ?? 0;
        if (hostMax <= 0) {
            return;
        }
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const stripeY = rowIdx * (rowHeight + rowGap) + 1;
        const stripeH = rowHeight - 2;

        const fillPx = (Math.max(0, hostV.value ?? 0) / hostMax) * barW;
        const counterPx = Math.min(barW, (counterV.value / hostMax) * barW);

        let stripeX;
        let stripeW;
        if (direction === 'left') {
            stripeX = barX + Math.max(0, fillPx - counterPx);
            stripeW = Math.min(counterPx, fillPx);
        } else {
            stripeX = barX + fillPx;
            stripeW = Math.min(counterPx, barW - fillPx);
        }
        if (stripeW <= 0) {
            return;
        }

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
        const pulse = () => {
            if (!stripeGfx || stripeGfx.destroyed) {
                canvas.app.ticker.remove(pulse);
                return;
            }
            const t = (performance.now() % periodMs) / periodMs;
            stripeGfx.alpha = 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
        };
        canvas.app.ticker.add(pulse);
    };
    drawCounterStripe(0, find('burn'), 'hp', 'left');
    drawCounterStripe(1, find('infection'), 'heat', 'right');

    // Heat fill terminator + danger zone. Only for actors with a real heat max.
    if (visibleIds.has('heat') && (actor.system?.heat?.max ?? 0) > 0) {
        const heatBarX = rightColX + 1;
        const heatBarW = rightColW - 2;
        const heatRowY = rowHeight + rowGap;
        const heatV = find('heat').getValue(actor);
        const heatMax = heatV.max ?? 0;
        if (heatMax > 0) {
            const heatGfx = new PIXI.Graphics();
            heatGfx.name = 'la-heat-decorations';
            container.addChild(heatGfx);

            const heatPct = Math.max(0, Math.min(1, (heatV.value ?? 0) / heatMax));
            const fillW = heatBarW * heatPct;
            if (fillW > 0) {
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

    // Extra bars (user-defined via Resources tab). Drawn live (post-bake) so a
    // value redraw doesn't have to invalidate the baked chrome.
    const extras = /** @type {any} */ (token).document?.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
    const visibleExtras = extras.filter(/** @type {any} */ e => _resolveExtraBarValues(actor, e).ownerOk);
    const extraLines = _groupExtrasIntoLines(visibleExtras);
    const extrasGeom = [];
    const extrasSeparator = extraLines.length > 0 && rows.length > 0
        ? Math.max(1, Math.round(chromeScale))
        : 0;
    if (extraLines.length > 0) {
        const extraGfx = new PIXI.Graphics();
        extraGfx.name = 'la-extras';
        container.addChild(extraGfx);
        const extrasStartY = rows.length * (rowHeight + rowGap) + extrasSeparator;
        const lineGap = Math.floor(chromeScale);
        const interGap = chromeScale;
        for (let li = 0; li < extraLines.length; li++) {
            const line = extraLines[li];
            const lineY = extrasStartY + li * (rowHeight + lineGap);
            let runningX = 0;
            const entryGeoms = [];
            for (let ei = 0; ei < line.entries.length; ei++) {
                const { entry, width } = line.entries[ei];
                const slot = Math.floor(usableW * (width / 100));
                const w = Math.max(2, slot - (ei < line.entries.length - 1 ? interGap : 0));
                const { value, max } = _resolveExtraBarValues(actor, entry);
                const stops = entry?.color?.stops?.length ? entry.color.stops : ['#888888'];
                const segCount = Math.max(1, Math.round(max));
                if (entry?.segmented) {
                    drawSegment(
                        extraGfx, runningX, lineY, w, rowHeight,
                        { color: _parseHex(stops[0]), pips: true, pipsLTR: true },
                        { value, max: segCount },
                        chromeScale
                    );
                } else {
                    drawSegment(
                        extraGfx, runningX, lineY, w, rowHeight,
                        { color: _parseHex(stops[0]), softMax: 1 },
                        { value, max },
                        chromeScale
                    );
                }
                entryGeoms.push({
                    entryId: entry.id,
                    x: runningX,
                    w,
                    segmented: !!entry.segmented,
                    segments: segCount,
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
    if (!_lastValues.has(token.id)) {
        _lastValues.set(token.id, snapshotValues(actor, /** @type {any} */ (token).document));
    }

    const extraLinesHeight = extraLines.length > 0
        ? extraLines.length * rowHeight + (extraLines.length - 1) * Math.floor(chromeScale) + Math.floor(chromeScale)
        : 0;
    const totalHeight = rows.length * (rowHeight + rowGap) - rowGap + extrasSeparator + extraLinesHeight;
    token.bars.visible = true;
    token.bars.height = totalHeight;
    // Zero alpha only on first draw so redraws don't flicker.
    if (wrapper.alpha === undefined || token._laFirstDraw !== false) {
        wrapper.alpha = 0;
        token._laFirstDraw = false;
    }

    // HP / Heat value labels.
    const hpLabelX = (armorVal > 0 && visibleIds.has('hp'))
        ? rightColX + rightColW + armorGap + armorW + 2
        : rightColX + rightColW + 2;
    _drawBarValueLabels(actor, rows, visibleIds, container, hpLabelX, hpLabelX, rowHeight, rowGap);

    // Re-attach saved flashes on top of everything.
    for (const flash of savedFlashes) {
        if (!flash.destroyed) {
            container.addChild(flash);
        }
    }

    // Elevation badge — replaces the vanilla "+N" tooltip text.
    drawElevationBadge(token);

    // Undo fvtt-perf-optim bitmap caching.
    const tok = token;
    setTimeout(() => {
        if (tok.destroyed || !tok.bars) {
            return;
        }
        const undoCache = (node) => {
            if (node instanceof PIXI.Graphics && node.cacheAsBitmap) {
                node.cacheAsBitmap = false;
            }
            if (node.children) {
                node.children.forEach(undoCache);
            }
        };
        undoCache(tok.bars);
    }, 0);
}

// ---------------------------------------------------------------------------
// HP / Heat value labels
// ---------------------------------------------------------------------------

function _drawBarValueLabels(actor, rows, visibleIds, container, hpLabelX, heatLabelX, rowHeight, rowGap) {
    if (!game.user?.isGM && !actor.isOwner) {
        return;
    }
    if (getWorldSetting(SETTING_SHOW_VALUES, true) === false) {
        return;
    }
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

    rows.forEach((row, rowIdx) => {
        const rightDef = row[1];
        if (!rightDef || !visibleIds.has(rightDef.id)) {
            return;
        }
        if (rightDef.id !== 'hp' && rightDef.id !== 'heat' && rightDef.id !== 'pilotStress') {
            return;
        }

        // Segments: value + optional colored OS/burn/infection suffixes.
        const segments = [];
        const v = rightDef.getValue(actor);
        segments.push({ text: `${v.value ?? 0}`, style: whiteStyle });

        if (rightDef.id === 'hp') {
            const os = actor.system?.overshield?.value ?? 0;
            const burn = actor.system?.burn ?? 0;
            if (os > 0) {
                segments.push({ text: ` ${os}`, style: makeStyle(0x4488ff) });
            }
            if (burn > 0) {
                segments.push({ text: ` ${burn}`, style: makeStyle(0xff4444) });
            }
        } else if (rightDef.id === 'heat') {
            const infection = actor.system?.infection ?? 0;
            if (infection > 0) {
                segments.push({ text: ` ${infection}`, style: makeStyle(0x1a8844) });
            }
        }

        const labelX = rightDef.id === 'hp' ? hpLabelX : heatLabelX;
        // pilotStress shares the heat slot — same label position as heat.
        const labelContainer = new PIXI.Container();
        labelContainer.name = 'la-bar-label';
        labelContainer.scale.set(1 / renderScale);
        labelContainer.position.set(
            labelX,
            rowIdx * (rowHeight + rowGap) + rowHeight / 2
        );
        labelContainer.eventMode = 'none';

        let cursorX = 0;
        for (const seg of segments) {
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

// ---------------------------------------------------------------------------
// Elevation badge — directional indicator, top-right of token
// ---------------------------------------------------------------------------

function drawElevationBadge(token) {
    const prev = token.children?.find(c => c.name === 'la-elevation-badge');
    if (prev) {
        token.removeChild(prev);
        prev.destroy({ children: true });
    }

    // Hide the core elevation tooltip.
    if (token.tooltip) {
        token.tooltip.visible = false;
    }

    const srcRaw = token.document?._source?.elevation;
    const derRaw = token.document?.elevation;
    const raw = Number.isFinite(srcRaw) && srcRaw !== derRaw ? srcRaw : derRaw;
    const elevation = Number.isFinite(raw) ? Math.round(raw) : raw;
    if (!Number.isFinite(elevation) || elevation === 0) {
        return;
    }

    const isPositive = elevation > 0;
    const label = Math.abs(elevation).toString();

    // Sized to match effect icons (_shrinkEffectIcons).
    const gridPx = canvas.dimensions?.size ?? 100;
    const iconSize = Math.max(8, Math.round(gridPx * 0.1));
    const cellH = iconSize;
    const cellW = iconSize;
    let arrowH = Math.max(3, Math.round(cellH * 0.5));
    if (arrowH % 2 !== 0) {
        arrowH += 1;
    }
    const halfW = Math.round(cellW / 2);

    const badge = new PIXI.Container();
    badge.name = 'la-elevation-badge';
    badge.eventMode = 'none';

    const gfx = new PIXI.Graphics();
    badge.addChild(gfx);
    gfx.lineStyle(0);

    const arrowColor = isPositive ? 0x55aacc : 0xcc7744;

    if (isPositive) {
        // ▲ arrow then dark cell
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
    } else {
        // Dark cell then ▼ arrow
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

    // Align the cell body with the status icon row (y=0).
    const badgeY = isPositive ? -arrowH : 0;
    const iso = _getIsoState(token);
    if (iso && token.mesh) {
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
    } else {
        badge.position.set(token.w - cellW, badgeY);
        token.addChild(badge);
    }
}

// ---------------------------------------------------------------------------
// Token HUD injection
// ---------------------------------------------------------------------------

function hex(c) {
    return '#' + c.toString(16).padStart(6, '0');
}

function resourceCell({ name, value, color, title }) {
    const border = hex(color);
    return `<input type="text" name="${name}" value="${value}" title="${title}" class="la-hud-resource" style="width: 40%; height: 30px; font-size: 20px; margin: 2px; min-width: 40px; padding-inline: 1px; text-align: center; border: 1px solid ${border};" />`;
}

function injectLancerHud(hud, html, actor) {
    const sys = actor.system;
    const $html = $(html);

    const findDef = id => BAR_DEFS.find(d => d.id === id);
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
    try {
        infectionOn = !!game.settings.get(MODULE_ID, 'enableInfectionDamageIntegration');
    } catch { /* setting not registered */ }
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
    if (hasReaction(actor)) {
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
    const focusOutHandler = async (ev) => {
        ev.preventDefault();
        const input = ev.currentTarget;
        const name = input.name;
        const raw = input.value.trim();
        let value;
        if (name === 'system.action_tracker.reaction') {
            value = Number(raw) > 0;
        } else {
            const num = Number(raw);
            if (!Number.isFinite(num)) {
                return;
            }
            // Delta input: "+2" / "-3".
            if (raw.startsWith('+') || raw.startsWith('-')) {
                const cur = foundry.utils.getProperty(actor, name) ?? 0;
                value = cur + num;
            } else {
                value = num;
            }
        }
        await actor.update({ [name]: value });
        hud.clear();
    };

    $html.find('input.la-hud-resource')
        .on('click', (ev) => {
            /** @type {HTMLInputElement} */ (ev.currentTarget).select();
        })
        .on('keydown', (ev) => {
            if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
                ev.currentTarget.blur();
            }
        })
        .on('focusout', focusOutHandler);

    // Extras column, mirrored from the reaction box on the left.
    const tokenDoc = hud.object?.document;
    const extras = tokenDoc?.getFlag(MODULE_ID, FLAG_EXTRAS) ?? [];
    const visibleExtras = extras.filter(/** @type {any} */ e => _resolveExtraBarValues(actor, e).ownerOk);
    if (visibleExtras.length) {
        const extraInputs = visibleExtras.map(/** @type {any} */ e => {
            const { value, max } = _resolveExtraBarValues(actor, e);
            const primary = e.color?.stops?.[0] ?? '#888888';
            const ro = e.valueSource?.kind !== 'manual';
            const title = (e.label || 'Extra') + ` (${value}/${max})` + (ro ? ' — read-only (path-bound)' : '');
            return `<input type="text" class="la-hud-extra-input" data-entry-id="${_escAttr(e.id)}" value="${value}" title="${_escAttr(title)}" ${ro ? 'readonly' : ''} style="width:40px;height:30px;font-size:20px;margin:2px;padding-inline:1px;text-align:center;border:1px solid ${_escAttr(primary)};${ro ? 'opacity:0.55;' : ''}">`;
        }).join('');
        const extraBlock = `<div class="attribute la-hud-extras" style="position:absolute;left:100%;top:50%;transform:translateY(-50%);width:50px;display:flex;flex-direction:column;justify-content:center;align-items:center;">${extraInputs}</div>`;
        const rightCol = $html.find('.col.right');
        if (rightCol.length) {
            rightCol.prepend(extraBlock);
        } else {
            middleCol.append(extraBlock);
        }

        const extrasFocusOut = async (ev) => {
            ev.preventDefault();
            const input = ev.currentTarget;
            const entryId = input.dataset.entryId;
            const raw = (input.value ?? '').trim();
            const num = Number(raw);
            if (!Number.isFinite(num))
                return;
            const arr = foundry.utils.deepClone(tokenDoc.getFlag(MODULE_ID, FLAG_EXTRAS) ?? []);
            const entry = arr.find(/** @type {any} */ x => x.id === entryId);
            if (!entry || entry.valueSource?.kind !== 'manual')
                return;
            let next = num;
            if (raw.startsWith('+') || raw.startsWith('-')) {
                next = (Number(entry.valueSource.value) || 0) + num;
            }
            entry.valueSource.value = next;
            await tokenDoc.setFlag(MODULE_ID, FLAG_EXTRAS, arr);
            hud.clear();
        };

        $html.find('input.la-hud-extra-input')
            .on('click', (ev) => {
                const el = /** @type {HTMLInputElement} */ (ev.currentTarget);
                if (!el.readOnly)
                    el.select();
            })
            .on('keydown', (ev) => {
                if (ev.code === 'Enter' || ev.code === 'NumpadEnter')
                    ev.currentTarget.blur();
            })
            .on('focusout', extrasFocusOut);
    }
}

// ---------------------------------------------------------------------------
// Settings registration
// ---------------------------------------------------------------------------

export function registerTokenStatBarSettings() {
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        name: 'Custom Token Stat Bars',
        hint: 'Replaces default token bars with my custom token bar, very similar to Bar Brawl but with my own personal tweaks. Disabled when Bar Brawl is active.',
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
    game.settings.register(MODULE_ID, SETTING_SHOW_VALUES, {
        name: 'Show Numeric Values on Bars',
        hint: 'When off, HP/Heat/Stress numbers are hidden — only the bars themselves are drawn.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => {
            if (!isEnabled() || !canvas?.tokens) {
                return;
            }
            for (const tok of canvas.tokens.placeables) {
                if (!isLancerCombatant(tok.actor)) {
                    continue;
                }
                try {
                    tok.drawBars();
                } catch { /* ignore */ }
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
        name: 'Effect Icon Scale (with Stat Bar)',
        hint: 'Multiplier on token effect icon size when the custom stat bar is active. 1 = no shrink (Foundry default), lower values progressively shrink. Only used when stat bar is enabled.',
        scope: 'world',
        config: false,
        type: Number,
        default: 0.7,
        range: { min: 0.3, max: 1, step: 0.05 },
        requiresReload: true,
    });

    game.settings.register(MODULE_ID, SETTING_MIN_ZOOM_SCALE, {
        name: 'Minimum Bar Zoom Scale',
        hint: 'Below this zoom level, the bar keeps a constant screen size instead of shrinking with the canvas. 0 = disabled (scales naturally). 1 = lock at 1x zoom equivalent.',
        scope: 'world',
        config: false,
        type: Number,
        default: 0,
        range: { min: 0, max: 4, step: 0.1 },
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_TALENTS, {
        name: 'Auto-add Talent Counter Bars',
        hint: 'Inject an extra stat bar for every talent counter and frame core counter on Lancer tokens. User-deleted bars are not re-added.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => {
            if (!game.users?.activeGM?.isSelf || !canvas?.ready)
                return;
            for (const t of canvas.tokens?.placeables ?? []) {
                if (isLancerCombatant(t.actor))
                    _autoInjectCounters(t.document);
            }
        },
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_TALENT_COLOR, {
        name: 'Talent Counter Bar Color',
        hint: 'Color used for auto-injected talent counter bars. Existing bars keep their original color when this changes.',
        scope: 'world',
        config: false,
        type: String,
        default: '#196161',
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_INJECT_TALENT_WIDTH, {
        name: 'Talent Counter Width (%)',
        hint: 'Width % used for auto-injected talent counter bars. Existing bars keep their original width when this changes.',
        scope: 'world',
        config: false,
        type: Number,
        default: 32,
        range: { min: 1, max: 100, step: 1 },
    });

}

export { TokenStatBarConfig };

// ---------------------------------------------------------------------------
// Settings menu form
// ---------------------------------------------------------------------------

class TokenStatBarConfig extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'la-token-stat-bar-config',
            title: 'Lancer Automations — Token Stat Bars',
            template: `modules/${MODULE_ID}/templates/token-stat-bar-config.html`,
            width: 560,
            closeOnSubmit: true,
        });
    }

    getData() {
        const visChoices = [
            { value: VIS_ALL, label: 'All (default behaviour)' },
            { value: VIS_OWNER, label: 'Owners only' },
            { value: VIS_NONE, label: 'None (hidden)' },
        ];
        return {
            enabled: getWorldSetting(SETTING_ENABLED, false),
            defaultHidden: getWorldSetting(SETTING_DEFAULT_HIDDEN, false),
            defaultCombatOnly: getWorldSetting(SETTING_DEFAULT_COMBAT_ONLY, false),
            defaultRowHeight: getWorldSetting(SETTING_DEFAULT_ROW_HEIGHT, 0) || '',
            defaultPilotStress: getWorldSetting(SETTING_DEFAULT_PILOT_STRESS, false),
            visOutOfCombat: getWorldSetting(SETTING_VIS_OUT_OF_COMBAT, VIS_ALL),
            visInCombat: getWorldSetting(SETTING_VIS_IN_COMBAT, VIS_ALL),
            visChoicesOut: visChoices.map(c => ({ ...c, selected: c.value === getWorldSetting(SETTING_VIS_OUT_OF_COMBAT, VIS_ALL) })),
            visChoicesIn: visChoices.map(c => ({ ...c, selected: c.value === getWorldSetting(SETTING_VIS_IN_COMBAT, VIS_ALL) })),
        };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find('button.la-apply-defaults').on('click', async (ev) => {
            ev.preventDefault();
            await applyDefaultsToCurrentScene();
        });
    }

    async _updateObject(_event, formData) {
        const previousEnabled = getWorldSetting(SETTING_ENABLED, false);
        const newEnabled = !!formData.enabled;

        await game.settings.set(MODULE_ID, SETTING_ENABLED, newEnabled);
        await game.settings.set(MODULE_ID, SETTING_DEFAULT_HIDDEN, !!formData.defaultHidden);
        await game.settings.set(MODULE_ID, SETTING_DEFAULT_COMBAT_ONLY, !!formData.defaultCombatOnly);
        const rowH = Number(formData.defaultRowHeight);
        await game.settings.set(MODULE_ID, SETTING_DEFAULT_ROW_HEIGHT, Number.isFinite(rowH) && rowH > 0 ? rowH : 0);
        await game.settings.set(MODULE_ID, SETTING_DEFAULT_PILOT_STRESS, !!formData.defaultPilotStress);
        await game.settings.set(MODULE_ID, SETTING_VIS_OUT_OF_COMBAT, formData.visOutOfCombat || VIS_ALL);
        await game.settings.set(MODULE_ID, SETTING_VIS_IN_COMBAT, formData.visInCombat || VIS_ALL);

        // Refresh visibility immediately so the new modes apply without a reload
        // (unless the master toggle changed, in which case we need a reload).
        refreshVisibleLancerTokens();

        if (previousEnabled !== newEnabled) {
            const DialogV2 = foundry.applications?.api?.DialogV2;
            if (DialogV2) {
                await DialogV2.confirm({
                    window: { title: 'Reload Required' },
                    content: '<p>The Custom Token Stat Bars master toggle was changed. Reload Foundry now?</p>',
                    yes: { callback: () => foundry.utils.debouncedReload() },
                });
            } else {
                foundry.utils.debouncedReload?.();
            }
        }
    }
}

// Reset auto-injected bars on every scene token and every actor prototype.
export async function reinjectAutoBarsOnAllTokens() {
    if (!game.user?.isGM) {
        ui.notifications?.warn('Only the GM can reinject auto bars.');
        return;
    }
    let sceneTokens = 0, prototypes = 0, failed = 0;
    for (const scene of game.scenes ?? []) {
        for (const td of scene.tokens ?? []) {
            if (!isLancerCombatant(td.actor))
                continue;
            const ok = await _resetAutoInjectedExtras(td);
            if (ok) sceneTokens++; else failed++;
        }
    }
    for (const actor of game.actors ?? []) {
        if (!isLancerCombatant(actor))
            continue;
        const proto = /** @type {any} */ (actor.prototypeToken ?? actor.token);
        if (!proto)
            continue;
        const ok = await _resetAutoInjectedExtras(proto);
        if (ok) prototypes++; else failed++;
    }
    ui.notifications?.info(`Reinjected auto bars on ${sceneTokens} scene token(s) and ${prototypes} prototype(s)${failed ? ` (${failed} failed)` : ''}.`);
}

export async function applyDefaultsToCurrentScene() {
    if (!canvas?.scene) {
        ui.notifications?.warn('No active scene.');
        return;
    }
    const defaultHidden = getWorldSetting(SETTING_DEFAULT_HIDDEN, false);
    const defaultCombatOnly = getWorldSetting(SETTING_DEFAULT_COMBAT_ONLY, false);
    const defaultRowHeight = getWorldSetting(SETTING_DEFAULT_ROW_HEIGHT, 0);
    const updates = [];
    for (const tok of canvas.tokens?.placeables ?? []) {
        if (!isLancerCombatant(tok.actor)) {
            continue;
        }
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
    if (updates.length === 0) {
        ui.notifications?.info('No Lancer tokens on this scene.');
        return;
    }
    try {
        await canvas.scene.updateEmbeddedDocuments('Token', updates);
        ui.notifications?.info(`Applied defaults to ${updates.length} token(s).`);
    } catch (e) {
        console.warn(`${MODULE_ID} | apply defaults failed`, e);
        ui.notifications?.error('Failed to apply defaults — see console.');
    }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initTokenStatBar() {
    // Skip if Bar Brawl is active.
    if (game.modules.get('barbrawl')?.active) {
        console.log(`${MODULE_ID} | Bar Brawl detected — skipping custom token stat bar registration.`);
        return;
    }

    originalDrawBars = CONFIG.Token.objectClass.prototype.drawBars;

    if (game.modules.get('lib-wrapper')?.active) {
        // MIXED: short-circuit on Lancer actors, chain otherwise.
        libWrapper.register(MODULE_ID, 'CONFIG.Token.objectClass.prototype.drawBars',
            function (wrapped, ...args) {
                if (isEnabled() && isLancerCombatant(this.actor)) {
                    return drawStatHub.call(this);
                }
                return wrapped(...args);
            }, 'MIXED');

        // Neutralise vanilla bar attribute lookups.
        libWrapper.register(MODULE_ID, 'CONFIG.Token.documentClass.prototype.getBarAttribute',
            function (wrapped, ...args) {
                if (isEnabled() && isLancerCombatant(this.actor)) {
                    return null;
                }
                return wrapped(...args);
            }, 'MIXED');
    } else {
        const origDrawBars = CONFIG.Token.objectClass.prototype.drawBars;
        CONFIG.Token.objectClass.prototype.drawBars = function (...args) {
            if (isEnabled() && isLancerCombatant(this.actor)) {
                return drawStatHub.call(this);
            }
            return origDrawBars.call(this, ...args);
        };
        const origGetBarAttribute = CONFIG.Token.documentClass.prototype.getBarAttribute;
        CONFIG.Token.documentClass.prototype.getBarAttribute = function (...args) {
            if (isEnabled() && isLancerCombatant(this.actor)) {
                return null;
            }
            return origGetBarAttribute.call(this, ...args);
        };
    }

    // Value change detection + flash spawning.
    Hooks.on('updateActor', (actor, change) => {
        if (!isEnabled() || !isLancerCombatant(actor)) {
            return;
        }
        const sysChange = change?.system;
        if (!sysChange) {
            return;
        }
        // Don't gate on watched keys: extras may bind anywhere. The per-bar diff filters no-ops.
        for (const tok of actor.getActiveTokens()) {
            const prev = _lastValues.get(tok.id) ?? { extras: {} };
            const next = snapshotValues(actor, tok.document);

            // Redraw hub with new values.
            try {
                tok.drawBars();
            } catch (e) {
                console.warn(`${MODULE_ID} | drawBars on update failed`, e);
            }

            let flashed = false;
            const FLASH_BARS = ['hp', 'heat', 'structure', 'stress', 'pilotStress', 'overshield', 'burn', 'infection'];
            for (const id of FLASH_BARS) {
                if (prev[id] !== undefined && prev[id] !== next[id]) {
                    spawnFlash(tok, id, prev[id], next[id]);
                    flashed = true;
                }
            }
            // Path-bound extras: their value updates when the actor changes.
            const prevExtras = prev.extras ?? {};
            const nextExtras = next.extras ?? {};
            for (const extraId of Object.keys(nextExtras)) {
                const oldVal = prevExtras[extraId];
                if (oldVal !== undefined && oldVal !== nextExtras[extraId]) {
                    spawnFlashExtra(tok, extraId, oldVal, nextExtras[extraId]);
                    flashed = true;
                }
            }
            // Pilot stress delta floats over the token like other damages.
            if (prev.pilotStress !== undefined && prev.pilotStress !== next.pilotStress
                && actor.type === 'pilot' && canvas?.interface?.createScrollingText) {
                let showScroll = true;
                try {
                    showScroll = !!game.settings.get('lancer', 'floatingNumbers');
                } catch { /* ignore */ }
                if (showScroll) {
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
            // Reaction: only flash on spent, not turn reset.
            if (prev.reaction === true && next.reaction === false) {
                spawnFlash(tok, 'reaction', 1, 0);
                flashed = true;
            }

            _lastValues.set(tok.id, next);

            if (flashed) {
                _flashingTokens.add(tok.id);
                const ft = _getFadeTarget(tok);
                if (ft) {
                    ft.alpha = 1;
                }
                setTimeout(() => {
                    _flashingTokens.delete(tok.id);
                    if (tok?.destroyed) {
                        return;
                    }
                    if (!shouldShowBars(tok)) {
                        fadeBars(tok, 0);
                    }
                }, FLASH_TOTAL_MS + FLASH_LINGER_MS);
            }
        }
    });

    // Refresh visibility + position sync.
    const refreshLancerToken = (token) => {
        if (!isEnabled() || !isLancerCombatant(token?.actor)) {
            return;
        }

        // Create hub if missing.
        if (!_overlayHubs.has(token.id)) {
            try {
                token.drawBars();
            } catch (e) {
                console.warn(`${MODULE_ID} | drawBars on refresh failed`, e);
            }
        }
        if (!_overlayHubs.has(token.id)) {
            return;
        }
        // Position sync (updates wrapper.position to active mesh.position).
        _syncHubPosition(token);

        // Must run after _syncHubPosition so the badge reads the fresh wrapper.position.
        drawElevationBadge(token);

        const show = shouldShowBars(token);
        fadeBars(token, show ? 1 : 0);

        const entry = _overlayHubs.get(token.id);
        const nameplate = token.nameplate;
        if (nameplate) {
            const iso = _getIsoState(token);
            // Only cache base when iso is off; otherwise we'd trap an iso-shifted position.
            if (!iso) {
                if (token._laBaseNameplateY === undefined) {
                    token._laBaseNameplateY = nameplate.position.y;
                }
                if (token._laBaseNameplateX === undefined) {
                    token._laBaseNameplateX = nameplate.position.x;
                }
                if (nameplate.anchor && token._laBaseNameplateAnchorX === undefined) {
                    token._laBaseNameplateAnchorX = nameplate.anchor.x;
                    token._laBaseNameplateAnchorY = nameplate.anchor.y;
                }
            }
            if (iso && token.mesh && entry?.wrapper && entry?.hub) {
                nameplate.anchor?.set(0.5, 0.5);
                nameplate.rotation = iso.reverseRotation;
                nameplate.skew.set(iso.reverseSkewX, iso.reverseSkewY);
                const k = 0.76;
                nameplate.scale.set(k, 1 / k);
                entry.wrapper.transform.updateLocalTransform();
                const localBelow = show
                    ? new PIXI.Point(0, entry.hub.position.y + (entry.hub.height || 0) + 8)
                    : new PIXI.Point(0, (token.h ?? 0) / 2 + 8);
                const wp = entry.wrapper.localTransform.apply(localBelow);
                nameplate.position.set(wp.x - token.position.x, wp.y - token.position.y);
            } else {
                if (nameplate.anchor && token._laBaseNameplateAnchorX !== undefined) {
                    nameplate.anchor.set(token._laBaseNameplateAnchorX, token._laBaseNameplateAnchorY);
                }
                nameplate.rotation = 0;
                nameplate.skew.set(0, 0);
                nameplate.scale.set(1, 1);
                if (nameplate.visible && entry) {
                    // Foundry's canonical nameplate default is (w/2, h + 2); push down for the bars.
                    const baseX = token.w / 2;
                    const baseY = token.h + 2;
                    nameplate.position.x = baseX;
                    nameplate.position.y = show
                        ? baseY + (token.bars?.height ?? 0) + 8
                        : baseY;
                }
            }
        }

        // Status effect icons (token.effects container).
        const effects = token.effects;
        if (effects && !effects.destroyed) {
            if (token._laBaseEffectsX === undefined) {
                token._laBaseEffectsX = effects.position.x;
                token._laBaseEffectsY = effects.position.y;
            }
            const isoFx = _getIsoState(token);
            if (isoFx && token.mesh) {
                effects.pivot.set(0, 0);
                effects.rotation = isoFx.reverseRotation;
                effects.skew.set(isoFx.reverseSkewX, isoFx.reverseSkewY);
                const k = 0.76;
                effects.scale.set(k, 1 / k);
                const cosR = Math.cos(isoFx.reverseRotation);
                const sinR = Math.sin(isoFx.reverseRotation);
                const lx = -(token.w ?? 0) / 2;
                const ly = -(token.h ?? 0) / 2;
                const offX = (cosR * k * lx) + (-sinR * (1 / k) * ly);
                const offY = (sinR * k * lx) + (cosR * (1 / k) * ly);
                const wx = token.mesh.position.x + offX;
                const wy = token.mesh.position.y + offY;
                effects.position.set(wx - token.position.x, wy - token.position.y);
            } else {
                effects.rotation = 0;
                effects.skew.set(0, 0);
                effects.scale.set(1, 1);
                effects.position.set(token._laBaseEffectsX, token._laBaseEffectsY);
            }
        }

        // Reticle would draw under our overlay bars, so move it into the overlay. In iso, also re-center it.
        const isoTgt = _getIsoState(token, ISO_SETTING_RETICLE);
        const tgtOverlay = getHubOverlay();
        for (const g of [token.targetArrows, token.targetPips]) {
            if (!g || g.destroyed)
                continue;
            if (tgtOverlay) {
                if (g.parent !== tgtOverlay)
                    tgtOverlay.addChild(g);
                g.zIndex = 1;
            }
            if (isoTgt && token.mesh) {
                g.rotation = isoTgt.reverseRotation;
                g.skew.set(isoTgt.reverseSkewX, isoTgt.reverseSkewY);
                const k = 0.76;
                g.scale.set(k, 1 / k);
                const cosR = Math.cos(isoTgt.reverseRotation);
                const sinR = Math.sin(isoTgt.reverseRotation);
                const cx = (cosR * k * ((token.w ?? 0) / 2)) - (sinR * (1 / k) * ((token.h ?? 0) / 2));
                const cy = (sinR * k * ((token.w ?? 0) / 2)) + (cosR * (1 / k) * ((token.h ?? 0) / 2));
                g.position.set(token.mesh.position.x - cx, token.mesh.position.y - cy);
            } else {
                g.rotation = 0;
                g.skew.set(0, 0);
                g.scale.set(1, 1);
                // overlay is in canvas.tokens space, so token.position lands at the native cell
                g.position.set(token.position.x, token.position.y);
            }
        }

        // Extend hitArea onto the sprite. Foundry resets it to the cell each refresh, so this re-applies.
        const isoHit = _getIsoState(token, ISO_SETTING_HITZONE);
        if (isoHit && token.mesh) {
            token.hitArea = {
                contains: (x, y) => {
                    if (token.shape?.contains?.(x, y))
                        return true;
                    if (!token.mesh)
                        return false;
                    const lx = token.mesh.position.x - token.position.x;
                    const ly = token.mesh.position.y - token.position.y;
                    const hw = (token.w ?? 0) / 2;
                    const hh = (token.h ?? 0) / 2;
                    return x >= lx - hw && x <= lx + hw && y >= ly - hh && y <= ly + hh;
                },
            };
        } else if (token.shape && token.hitArea !== token.shape) {
            token.hitArea = token.shape;
        }
    };
    Hooks.on('refreshToken', refreshLancerToken);

    // Alt-key peek.
    window.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Alt' || _altHeld) {
            return;
        }
        _altHeld = true;
        refreshVisibleLancerTokens();
    });
    window.addEventListener('keyup', (ev) => {
        if (ev.key !== 'Alt' || !_altHeld) {
            return;
        }
        _altHeld = false;
        refreshVisibleLancerTokens();
    });
    window.addEventListener('blur', () => {
        if (!_altHeld) {
            return;
        }
        _altHeld = false;
        refreshVisibleLancerTokens();
    });

    // Sweep — canvasReady may have fired before our ready hook.
    const sweepLancerTokens = () => {
        // Clear stale overlay hubs from previous canvas.
        for (const [, entry] of _overlayHubs) {
            if (!entry.wrapper.destroyed) {
                entry.wrapper.destroy({ children: true });
            }
        }
        _overlayHubs.clear();
        _hubOverlay = null;
        if (!isEnabled()) {
            return;
        }
        for (const tok of canvas.tokens?.placeables ?? []) {
            if (!isLancerCombatant(tok.actor)) {
                continue;
            }
            try {
                tok.drawBars();
                refreshLancerToken(tok);
            } catch (e) {
                console.warn(`${MODULE_ID} | drawBars sweep failed`, e);
            }
        }
    };
    if (canvas?.ready) {
        sweepLancerTokens();
    }
    Hooks.on('canvasReady', sweepLancerTokens);

    // Rebuild bars when an iso flag toggles so they pick up the new transform.
    Hooks.on('updateScene', (scene, changes) => {
        if (scene.id !== canvas.scene?.id)
            return;
        const touchesIso = foundry.utils.hasProperty(changes, 'flags.isometric-perspective')
            || foundry.utils.hasProperty(changes, 'flags.grape_juice-isometrics');
        if (!touchesIso)
            return;
        requestAnimationFrame(() => {
            for (const tok of canvas.tokens?.placeables ?? []) {
                if (!isLancerCombatant(tok.actor))
                    continue;
                try {
                    tok.drawBars();
                    refreshLancerToken(tok);
                } catch (e) {
                    console.warn(`${MODULE_ID} | iso refresh`, e);
                }
            }
        });
    });

    // Cleanup on token removal.
    Hooks.on('destroyToken', (token) => {
        _removeOverlayHub(token.id);
        // reticle lives in the overlay now, so the token's own destroy won't reach it
        for (const g of [token.targetArrows, token.targetPips]) {
            if (g && !g.destroyed && g.parent && g.parent !== token) {
                g.parent.removeChild(g);
                g.destroy();
            }
        }
    });

    Hooks.on('drawToken', (token) => {
        if (!isEnabled() || !isLancerCombatant(token?.actor)) {
            return;
        }
        try {
            token.drawBars();
        } catch (e) {
            console.warn(`${MODULE_ID} | drawBars on drawToken failed`, e);
        }
    });

    // Force displayBars=NONE on new Lancer tokens.
    Hooks.on('preCreateToken', (tokenDoc, data) => {
        if (!isEnabled()) {
            return;
        }
        const actor = tokenDoc.actor ?? game.actors?.get(data?.actorId);
        if (!isLancerCombatant(actor)) {
            return;
        }
        tokenDoc.updateSource({ displayBars: CONST.TOKEN_DISPLAY_MODES.NONE });
    });

    // Fix existing tokens that predate the setting.
    const sweepDisplayBars = async () => {
        if (!isEnabled() || !canvas?.scene || !game.user?.isGM) {
            return;
        }
        const updates = [];
        for (const tok of canvas.tokens?.placeables ?? []) {
            if (!isLancerCombatant(tok.actor)) {
                continue;
            }
            if (tok.document.displayBars !== CONST.TOKEN_DISPLAY_MODES.NONE) {
                updates.push({
                    _id: tok.document.id,
                    displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
                });
            }
        }
        if (updates.length > 0) {
            try {
                await canvas.scene.updateEmbeddedDocuments('Token', updates);
            } catch (e) {
                console.warn(`${MODULE_ID} | sweep displayBars failed`, e);
            }
        }
    };
    if (canvas?.ready) {
        sweepDisplayBars();
    }
    Hooks.on('canvasReady', sweepDisplayBars);

    // ── Auto-inject talent / frame core counters as extras (GM-only) ──────────
    const _sweepAutoInjectCounters = () => {
        if (!isEnabled() || !canvas?.scene)
            return;
        if (!game.users?.activeGM?.isSelf)
            return;
        if (!game.settings.get(MODULE_ID, SETTING_AUTO_INJECT_TALENTS))
            return;
        for (const t of canvas.tokens?.placeables ?? []) {
            if (isLancerCombatant(t.actor))
                _autoInjectCounters(t.document);
        }
    };
    if (canvas?.ready) {
        _sweepAutoInjectCounters();
    }
    Hooks.on('canvasReady', _sweepAutoInjectCounters);

    Hooks.on('createToken', (tokenDoc) => {
        if (!isEnabled())
            return;
        if (!isLancerCombatant(tokenDoc?.actor))
            return;
        _autoInjectCounters(tokenDoc);
    });

    Hooks.on('updateActor', (actor, changes) => {
        if (!isEnabled() || !isLancerCombatant(actor))
            return;
        const touched = !!(changes?.system?.loadout
            || changes?.items
            || foundry.utils.hasProperty(changes ?? {}, 'system.pilot'));
        if (!touched)
            return;
        for (const tok of actor.getActiveTokens())
            _autoInjectCounters(tok.document);
    });

    // updateItem doesn't bubble to updateActor; relay it here.
    Hooks.on('updateItem', (item) => {
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
        for (const a of game.actors ?? []) {
            if (a.type === 'mech' && a.system?.pilot?.value?.id === parentActor.id)
                actors.push(a);
        }
        for (const a of actors) {
            for (const tok of a.getActiveTokens()) {
                const prev = _lastValues.get(tok.id) ?? { extras: {} };
                _autoInjectCounters(tok.document);
                try { tok.drawBars(); } catch (e) { console.warn(`${MODULE_ID} | updateItem drawBars`, e); }
                const next = snapshotValues(a, tok.document);
                let flashed = false;
                const prevExtras = prev.extras ?? {};
                const nextExtras = next.extras ?? {};
                for (const extraId of Object.keys(nextExtras)) {
                    const oldVal = prevExtras[extraId];
                    if (oldVal !== undefined && oldVal !== nextExtras[extraId]) {
                        spawnFlashExtra(tok, extraId, oldVal, nextExtras[extraId]);
                        flashed = true;
                    }
                }
                _lastValues.set(tok.id, next);
                if (flashed) {
                    _flashingTokens.add(tok.id);
                    const ft = _getFadeTarget(tok);
                    if (ft) ft.alpha = 1;
                    setTimeout(() => {
                        _flashingTokens.delete(tok.id);
                        if (tok?.destroyed) return;
                        if (!shouldShowBars(tok)) fadeBars(tok, 0);
                    }, FLASH_TOTAL_MS + FLASH_LINGER_MS);
                }
            }
        }
    });

    // Token Config Resources tab override.
    Hooks.on('renderTokenConfig', (app, html) => {
        if (!isEnabled()) {
            return;
        }
        const tokenDoc = app.token ?? app.object;
        if (!isLancerCombatant(tokenDoc?.actor)) {
            return;
        }
        const root = html instanceof HTMLElement ? html : html?.[0];
        const tab = root?.querySelector?.('.tab[data-tab="resources"]');
        if (!tab) {
            return;
        }
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
                <label>Visibility — Out of Combat</label>
                ${visSelect(`flags.${MODULE_ID}.${FLAG_VIS_OUT_OF_COMBAT}`, visOut)}
                <p class="notes">Per-token override of who sees the bars when no combat is active. Leave on "Use world default" to inherit from the module settings.</p>
            </div>
            <div class="form-group">
                <label>Visibility — In Combat</label>
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
        _bindExtraBarsUI(root, tokenDoc, app);
        if (typeof app.setPosition === 'function') {
            app.setPosition({ height: 'auto' });
        }
    });

    // Re-evaluate when per-token flags change.
    Hooks.on('updateToken', (tokenDoc, change) => {
        if (!isEnabled()) {
            return;
        }
        if (!isLancerCombatant(tokenDoc?.actor)) {
            return;
        }
        const touchesFlags = foundry.utils.hasProperty(change, `flags.${MODULE_ID}`);
        const touchesElevation = change.elevation !== undefined;
        if (!touchesFlags && !touchesElevation) {
            return;
        }
        const tok = tokenDoc.object;
        if (!tok) {
            return;
        }
        if (touchesElevation) {
            try { drawElevationBadge(tok); } catch { /* ignore */ }
        }
        // Manual-value edits to extras: diff vs the seeded snapshot, then redraw.
        const extrasTouched = foundry.utils.hasProperty(change, `flags.${MODULE_ID}.${FLAG_EXTRAS}`);
        const prev = _lastValues.get(tok.id) ?? { extras: {} };
        if (!touchesFlags) return;
        try {
            tok.drawBars();
        } catch (e) {
            console.warn(`${MODULE_ID} | drawBars on flag update failed`, e);
        }
        if (extrasTouched) {
            const next = snapshotValues(tokenDoc.actor, tokenDoc);
            let flashed = false;
            const prevExtras = prev.extras ?? {};
            const nextExtras = next.extras ?? {};
            for (const extraId of Object.keys(nextExtras)) {
                const oldVal = prevExtras[extraId];
                if (oldVal !== undefined && oldVal !== nextExtras[extraId]) {
                    spawnFlashExtra(tok, extraId, oldVal, nextExtras[extraId]);
                    flashed = true;
                }
            }
            _lastValues.set(tok.id, next);
            if (flashed) {
                _flashingTokens.add(tok.id);
                const ft = _getFadeTarget(tok);
                if (ft) {
                    ft.alpha = 1;
                }
                setTimeout(() => {
                    _flashingTokens.delete(tok.id);
                    if (tok?.destroyed) {
                        return;
                    }
                    if (!shouldShowBars(tok)) {
                        fadeBars(tok, 0);
                    }
                }, FLASH_TOTAL_MS + FLASH_LINGER_MS);
            }
        }
        fadeBars(tok, shouldShowBars(tok) ? 1 : 0);
    });

    // Combat lifecycle → refresh combat-only tokens.
    const refreshAllForCombat = () => {
        if (!isEnabled()) {
            return;
        }
        for (const tok of canvas.tokens?.placeables ?? []) {
            if (!isLancerCombatant(tok.actor)) {
                continue;
            }
            if (!statBarCombatOnly(tok.document)) {
                continue;
            }
            fadeBars(tok, shouldShowBars(tok) ? 1 : 0);
        }
    };
    Hooks.on('combatStart', refreshAllForCombat);
    Hooks.on('deleteCombat', refreshAllForCombat);
    Hooks.on('createCombatant', refreshAllForCombat);
    Hooks.on('deleteCombatant', refreshAllForCombat);

    Hooks.on('renderTokenHUD', (hud, html, _data) => {
        if (!isEnabled()) {
            return;
        }
        const actor = hud.object?.actor;
        if (!isLancerCombatant(actor)) {
            return;
        }
        injectLancerHud(hud, html, actor);
    });
}
