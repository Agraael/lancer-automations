/* global PIXI, canvas, game, Hooks, ui, document, window, CONST */
// Hover popup rendered as fixed-position DOM (browser font hinting = sharp text).

import { playUiSound } from './sound.js';
import {
    isLancerActor as isLancerCombatant,
    isTokenInCombat,
    isTokenVisible,
    corePowerState,
    corePowerDisplay,
    shortOverchargeTerm,
    isDangerZoneHeat,
    rankParts,
    hasReaction,
} from '../utils/lancer-token.js';
import { FLAG_EXTRAS, _resolveExtraBarValues } from './tokenStatBar.js';
import { REF_GRID_SIZE } from './statbar/config.js';
import { getTokenDispositionInfo } from '../tools/misc-tools.js';
import { isActorScannedForUser, isActorAllyOfUser, isScannedByAll, DATALINKED_STATUS } from '../tools/scan-lookup.js';

import { MODULE_ID } from '../tools/constants.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { overchargeColor, REPAIR_COLOR_CSS, haseValueColor, cssHex, hpColorCss, heatColorCss, dangerHeatColorCss, pilotStressColorCss } from '../tools/color-utils.js';
import { EFFECT_TILE_CSS, effectTileEntries, effectTilesHtml } from './effect-tiles.js';
import { HASE_CHIP_CSS, statPipsHtml } from '../tools/hase-chip.js';
import { reactionCounts } from '../combat/action-extras.js';
const SETTING_ENABLED = 'tokenStatHintEnabled';
const SETTING_DELAY_MS = 'tokenStatHintDelayMs';
const SETTING_SCALE = 'tokenStatHintScale';
const SETTING_PLACEMENT = 'tokenStatHintPlacement';
const SETTING_EFFECTS_MODE = 'tokenStatHintEffectsMode';
const SETTING_SHOW_CONTROLLED = 'tokenStatHintShowForControlled';
const SETTING_COMBAT_ONLY = 'tokenStatHintCombatOnly';
const SETTING_LABEL_MODE = 'tokenStatHintLabelMode';
const SETTING_UNKNOWN_LABEL = 'tokenStatHintUnknownLabel';
const SETTING_HIDE_CLASS_UNKNOWN = 'tokenStatHintHideClassWhenUnknown';
const SETTING_HIDE_CURRENT_ON_SCAN = 'tokenStatHintHideCurrentOnScan';
const SETTING_HIDE_CURRENT_FROM_ALLIES = 'tokenStatHintHideCurrentFromAllies';
const SETTING_HIDE_CURRENT_FROM_PLAYERS = 'tokenStatHintHideCurrentFromPlayers';
const SETTING_SHOW_HASE = 'tokenStatHintShowHase';

const LABEL_ACTOR = 'actor';   // always show the token name
const LABEL_SCAN = 'scan';     // tied to scan: name if scanned, "UNKNOWN" otherwise

const SYS = 'systems/lancer/assets/icons/white';
const ICON = {
    armor:    `${SYS}/shield_outline.svg`,
    evasion:  `${SYS}/evasion.svg`,
    edef:     `${SYS}/edef.svg`,
    save:     `${SYS}/save.svg`,
    sensors:  `${SYS}/sensor.svg`,
    techAtk:  `${SYS}/tech_quick.svg`,
    corePwr:  `${SYS}/corepower.svg`,
    reaction: `${SYS}/reaction.svg`,
    repair:   `${SYS}/repair.svg`,
};

const ANCHOR_GAP = 12;
const SLIDE_OFFSET = 28;
const DOCK_MARGIN = 8;
const PLATE_NAME_MIN_PX = 11;
const PLATE_PAN_DELAY_MS = 700;
const PLATE_PAN_HOLD_MS = 1000;
const SCAN_MEMO_MS = 1000;

const SCANNED_MEMO = new Map();
const SCAN_SETTING_KEYS = new Set(['scanRevealMode'].map(key => `${MODULE_ID}.${key}`));

let _popupEl = null;
let _animEl = null;
let _styleInjected = false;
let _state = 'idle';
let _currentTokenId = null;
let _currentToken = null;
let _placeRight = true;
let _delayTimer = null;
let _outTimer = null;
let _hookedPan = false;
let _tahWatch = null;
let _hookedActorUpdate = false;

import { getModuleSetting } from "../tools/settings-utils.js";

function isEnabled()
{
    return getModuleSetting(SETTING_ENABLED);
}
function getDelayMs()
{
    const raw = Number(getModuleSetting(SETTING_DELAY_MS));
    return Number.isFinite(raw) && raw >= 0 ? raw : 500;
}
function isDocked()
{
    return getModuleSetting(SETTING_PLACEMENT, 'docked') === 'docked';
}
function syncDockedClass()
{
    const docked = isEnabled() === true && isDocked();
    document.body.classList.toggle('la-stat-docked', docked);
    if (docked)
        ensureStyleSheet();
}
function getHintScale()
{
    const raw = Number(getModuleSetting(SETTING_SCALE));
    const userScale = Number.isFinite(raw) && raw > 0 ? raw : 1;
    if (getModuleSetting(SETTING_PLACEMENT, 'docked') !== 'zoom')
        return userScale;
    const zoom = canvas?.stage?.scale?.x || 1;
    const gridPx = canvas?.dimensions?.size ?? REF_GRID_SIZE;
    return userScale * zoom * gridPx / REF_GRID_SIZE;
}
function showForControlled()
{
    return getModuleSetting(SETTING_SHOW_CONTROLLED) !== false;
}
function isCombatOnly()
{
    return getModuleSetting(SETTING_COMBAT_ONLY) === true;
}
function getLabelMode()
{
    const raw = getModuleSetting(SETTING_LABEL_MODE);
    if (raw === LABEL_ACTOR || raw === LABEL_SCAN)
        return raw;
    return LABEL_SCAN;
}
// Per-token tri-state override ('on'/'off'), null = use the global setting.
function _hintFlagTriState(tokenDoc, key)
{
    const raw = getLAFlag(tokenDoc,key);
    if (raw === 'on')
        return true;
    if (raw === 'off')
        return false;
    return null;
}
export function getUnknownLabel(tokenDoc)
{
    const perToken = getLAFlag(tokenDoc,'statHintUnknownLabel');
    if (typeof perToken === 'string' && perToken.trim().length > 0)
        return perToken;
    const raw = getModuleSetting(SETTING_UNKNOWN_LABEL);
    if (typeof raw === 'string' && raw.trim().length > 0)
        return raw;
    return 'UNKNOWN';
}
function hideClassWhenUnknown(tokenDoc)
{
    const override = _hintFlagTriState(tokenDoc, 'statHintHideClass');
    if (override !== null)
        return override;
    return getModuleSetting(SETTING_HIDE_CLASS_UNKNOWN) === true;
}
function isBurnEnabled()
{
    return getModuleSetting('enableBurnIntegration') !== false;
}
function isInfectionEnabled()
{
    return getModuleSetting('enableInfectionDamageIntegration') === true;
}

function isScannedByUser(actor, user)
{
    if (!actor || !user)
        return false;
    if (isScannedByAll(actor))
        return true;
    const key = `${actor.uuid}|${user.id}`;
    const memo = SCANNED_MEMO.get(key);
    const now = Date.now();
    if (memo && now - memo.at < SCAN_MEMO_MS)
        return memo.value;
    let result = false;
    try
    {
        result = isActorScannedForUser(actor, user);
    }
    catch
    {
        result = false;
    }
    SCANNED_MEMO.set(key, { at: now, value: result });
    return result;
}
function resolveViewMode(actor)
{
    if (game.user.isGM)
        return 'gm';
    try
    {
        if (actor?.testUserPermission?.(game.user, 'OBSERVER'))
            return 'scanned';
    }
    catch
    { /* ignore */ }
    if (isScannedByUser(actor, game.user))
        return 'scanned';
    return 'unknown';
}

function hasObserverAccess(actor)
{
    try
    {
        return !!actor?.testUserPermission?.(game.user, 'OBSERVER');
    }
    catch
    {
        return false;
    }
}

// Scan-only or unknown with the hide-current option on. Player tokens and allies show like observed ones unless hidden too.
function masksCurrentStats(actor, mode, tokenDoc)
{
    if (mode === 'gm' || actor?.statuses?.has(DATALINKED_STATUS))
        return false;
    if (mode === 'scanned' && hasObserverAccess(actor))
        return false;
    if (mode === 'scanned' && !getModuleSetting(SETTING_HIDE_CURRENT_FROM_PLAYERS) && actor?.hasPlayerOwner)
        return false;
    if (mode === 'scanned' && !getModuleSetting(SETTING_HIDE_CURRENT_FROM_ALLIES) && isActorAllyOfUser(actor, game.user))
        return false;
    const override = _hintFlagTriState(tokenDoc, 'statHintHideCurrent');
    if (override !== null)
        return override;
    return getModuleSetting(SETTING_HIDE_CURRENT_ON_SCAN) === true;
}

// The same reveal gate the stat-hover uses: GM, OBSERVER permission, or scanned (incl. scannedByAll, allies, player tokens).
export function isActorRevealedToUser(actor)
{
    return !!actor && resolveViewMode(actor) !== 'unknown';
}

// Bond XP color follows the auto-injected XP bar's color when one exists.
function _bondXpColor(actor)
{
    const tokenDoc = actor?.getActiveTokens?.()?.[0]?.document;
    const extras = getLAFlag(tokenDoc,FLAG_EXTRAS) ?? [];
    const entry = extras.find((/** @type {any} */ extra) => extra?.autoKey === 'bondXp');
    return entry?.color?.stops?.[0] || '#00b8d4';
}

function effectiveHpMax(actor)
{
    const sys = actor?.system;
    if (!sys)
        return 0;
    const max = sys.hp?.max ?? 0;
    const val = Math.max(0, sys.hp?.value ?? 0);
    const overshieldVal = Math.max(0, sys.overshield?.value ?? 0);
    return Math.max(max, val, overshieldVal);
}
export function getStatsForActor(actor)
{
    const sys = actor?.system ?? {};
    const reactions = reactionCounts(actor);
    return {
        type: actor.type,
        hpVal: sys.hp?.value ?? 0,
        hpMax: effectiveHpMax(actor),
        hpNominalMax: sys.hp?.max ?? 0,
        structVal: sys.structure?.value ?? 0,
        structMax: sys.structure?.max ?? 0,
        stressVal: sys.stress?.value ?? 0,
        stressMax: sys.stress?.max ?? 0,
        heatVal: sys.heat?.value ?? 0,
        heatMax: sys.heat?.max ?? 0,
        burn: sys.burn ?? 0,
        infection: sys.infection ?? 0,
        overshield: sys.overshield?.value ?? 0,
        armor: sys.armor ?? 0,
        evasion: sys.evasion ?? 0,
        edef: sys.edef ?? 0,
        techAtk: sys.tech_attack ?? 0,
        save: sys.save ?? 0,
        sensors: sys.sensor_range ?? 0,
        speed: sys.speed ?? 0,
        reaction: reactions.left,
        reactionText: reactions.text,
        overcharge: sys.overcharge ?? 0,
        ocSequence: sys.overcharge_sequence ?? null,
        core: corePowerState(actor),
        hasRepairs: sys.repairs != null,
        repairs: sys.repairs?.value ?? 0,
        repairsMax: sys.repairs?.max ?? 0,
        pilotStressVal: sys.bond_state?.stress?.value ?? 0,
        pilotStressMax: sys.bond_state?.stress?.max ?? 0,
        pilotXpVal: sys.bond_state?.xp?.value ?? 0,
        pilotXpMax: sys.bond_state?.xp?.max ?? 0,
        hasBond: !!actor?.items?.find?.((/** @type {any} */ ownedItem) => ownedItem.type === 'bond'),
        tier: sys.tier,
    };
}

function ocColorCss(value, max)
{
    if (max <= 0)
        return '#cccccc';
    return cssHex(overchargeColor(value, max));
}
import { escapeHtml as esc, signedNumber as signed } from "../tools/string-utils.js";

function svgIcon(url, color = '#fff')
{
    return `<img class="la-stat-hint-icon" src="${url}" style="filter: brightness(0) saturate(100%) invert(1);" data-color="${esc(color)}">`;
}
function cciIcon(name, color)
{
    return `<i class="cci ${name}" style="color:${esc(color)};font-size:18px;line-height:1;"></i>`;
}
function glyph(ch, color, size = 16)
{
    return `<span class="la-stat-hint-glyph" style="color:${esc(color)};font-size:${size}px;line-height:1;">${esc(ch)}</span>`;
}
function mdi(name, color)
{
    return `<i class="mdi ${name}" style="color:${esc(color)};font-size:18px;line-height:1;"></i>`;
}
function cell(iconHtml, value, color = '#ddd')
{
    return `<span class="la-stat-hint-cell">${iconHtml}<span class="la-stat-hint-val" style="color:${esc(color)};">${esc(value)}</span></span>`;
}
function haseChipCell(letter, value, chipClass = '')
{
    return cell(`<i class="la-hase-chip${chipClass}">${letter}</i>`, signed(value), haseValueColor(value));
}

function getActorSubtitleText(actor)
{
    if (!actor)
        return '';
    if (actor.type === 'npc')
    {
        try
        {
            const cls = actor.items?.find?.(item => item.is_npc_class?.());
            const templates = actor.items?.filter?.(item => item.is_npc_template?.()) ?? [];
            const parts = [];
            if (cls?.name)
                parts.push(cls.name);
            if (templates.length > 0)
                parts.push(templates.map(tmpl => tmpl.name).join(', '));
            return parts.join(' · ');
        }
        catch
        { /* ignore */ }
        return '';
    }
    if (actor.type === 'mech')
        return actor.system?.loadout?.frame?.value?.name ?? '';
    return '';
}

function displayName(tokenDoc, actor = tokenDoc?.actor)
{
    return tokenDoc?.name || actor?.name || 'UNKNOWN';
}

// SCAN-tied mode reveals nothing about NPC/deployable until scanned.
function unknownName(tokenDoc, actor = tokenDoc?.actor)
{
    const ownSide = actor?.type === 'pilot' || actor?.type === 'mech';
    if (!ownSide && getLabelMode() === LABEL_SCAN)
        return getUnknownLabel(tokenDoc);
    return displayName(tokenDoc, actor);
}

export function getTokenNameView(tokenDoc, actor = tokenDoc?.actor)
{
    if (isActorRevealedToUser(actor))
        return { text: displayName(tokenDoc, actor), unknown: false };
    return { text: unknownName(tokenDoc, actor), unknown: true };
}

function buildHeaderHtml(token, mode, titleSuffixHtml = '')
{
    const actor = token.actor;
    const tokenDoc = token?.document ?? token;
    const isNpc = actor?.type === 'npc';
    const isUnknown = (mode === 'unknown-stable' || mode === 'unknown-damaged');

    let label = displayName(token.document, actor);
    const rank = rankParts(actor);
    const tierBadge = rank ? `<span class="la-stat-hint-tier">${rank.kind}${rank.value}</span>` : '';

    if (isUnknown)
    {
        label = unknownName(tokenDoc);
        const unknownTier = hideClassWhenUnknown(tokenDoc) ? '' : tierBadge;
        let unknownSub = '';
        let unknownInline = '';
        const subText = getActorSubtitleText(actor);
        if (subText && !hideClassWhenUnknown(tokenDoc))
        {
            if (actor?.type === 'mech')
                unknownInline = `<span class="la-stat-hint-frame">${esc(subText)}</span>`;
            else
                unknownSub = `<div class="la-stat-hint-subtitle">${esc(subText)}</div>`;
        }
        return `<div class="la-stat-hint-header la-unknown"><div class="la-stat-hint-title">${unknownTier}<s class="horus--subtle" style="opacity:0.85;color:#e50000;text-decoration:none;">${esc(String(label).toUpperCase())}</s>${unknownInline}</div>${unknownSub}</div>`;
    }

    let subtitle = '';
    if (isNpc)
    {
        const subText = getActorSubtitleText(actor);
        if (subText)
            subtitle = `<div class="la-stat-hint-subtitle">${esc(subText)}</div>`;
    }
    let titleExtra = '';
    if (actor?.type === 'mech')
    {
        const frameName = getActorSubtitleText(actor);
        if (frameName)
            titleExtra = `<span class="la-stat-hint-frame">${esc(frameName)}</span>`;
    }
    return `<div class="la-stat-hint-header"><div class="la-stat-hint-title">${tierBadge}<span class="la-stat-hint-name">${esc(String(label).toUpperCase())}</span>${titleExtra}${titleSuffixHtml}</div>${subtitle}</div>`;
}

export function buildRevealRowsHtml(actor, stats, { maskCurrent = false, omitCombatState = false } = {})
{
    const burnOn = isBurnEnabled();
    const infOn = isInfectionEnabled();
    const rows = [];

    const dimColor = '#555';
    const isMechOrNpc = stats.type === 'mech' || stats.type === 'npc';

    {
        const parts = [];
        if (stats.structMax > 0)
        {
            parts.push(cell(cciIcon('cci-structure', '#e8d060'),
                `${stats.structVal}/${stats.structMax}`, '#e8d060'));
        }
        const hpFull = stats.hpNominalMax || stats.hpMax;
        const hpColor = maskCurrent ? hpColorCss(hpFull, hpFull) : hpColorCss(stats.hpVal, hpFull);
        parts.push(cell(glyph('♥', hpColor, 16), maskCurrent ? `?/${stats.hpNominalMax}` : `${stats.hpVal}/${stats.hpNominalMax}`, hpColor));
        if (burnOn && !omitCombatState)
        {
            const burnCol = stats.burn > 0 ? '#d74242' : dimColor;
            parts.push(cell(cciIcon('cci-burn', burnCol), String(stats.burn), burnCol));
        }
        if (isMechOrNpc)
            parts.push(cell(svgIcon(ICON.armor), String(stats.armor)));
        if (!omitCombatState)
        {
            const overshieldColor = stats.overshield > 0 ? '#60a5fa' : dimColor;
            parts.push(cell(mdi('mdi-hexagon-multiple-outline', overshieldColor), String(stats.overshield), overshieldColor));
        }
        rows.push(parts.join(''));
    }

    {
        const parts = [];
        if (stats.stressMax > 0 && stats.heatMax > 0)
        {
            parts.push(cell(cciIcon('cci-reactor', '#e07830'),
                `${stats.stressVal}/${stats.stressMax}`, '#e07830'));
        }
        if (stats.heatMax > 0)
        {
            const heatColor = maskCurrent ? heatColorCss(0, stats.heatMax) : heatColorCss(stats.heatVal, stats.heatMax);
            parts.push(cell(glyph('🌡', heatColor, 16), maskCurrent ? `?/${stats.heatMax}` : `${stats.heatVal}/${stats.heatMax}`, heatColor));
        }
        else if (stats.type === 'pilot' && stats.pilotStressMax > 0)
        {
            parts.push(cell(mdi('mdi-brain', '#d9b800'),
                `${stats.pilotStressVal}/${stats.pilotStressMax}`, '#d9b800'));
        }
        if (stats.type === 'pilot' && stats.hasBond && stats.pilotXpMax > 0)
        {
            const xpColor = (maskCurrent || stats.pilotXpVal > 0) ? _bondXpColor(actor) : dimColor;
            parts.push(cell(mdi('mdi-head-cog-outline', xpColor),
                maskCurrent ? `?/${stats.pilotXpMax}` : `${stats.pilotXpVal}/${stats.pilotXpMax}`, xpColor));
        }
        if (infOn && !omitCombatState)
        {
            const infectionColor = stats.infection > 0 ? '#1a8a3a' : dimColor;
            parts.push(cell(glyph('☣', infectionColor, 16), String(stats.infection), infectionColor));
        }
        if (stats.type !== 'deployable' && !omitCombatState)
        {
            const reactionColor = maskCurrent ? '#a855f7' : (stats.reaction ? '#a855f7' : dimColor);
            const reactionOpacity = maskCurrent ? 1 : (stats.reaction ? 1 : 0.4);
            parts.push(cell(`<img class="la-stat-hint-icon" src="${ICON.reaction}" style="filter:brightness(0) saturate(100%) invert(1);opacity:${reactionOpacity};">`,
                maskCurrent ? '?' : stats.reactionText, reactionColor));
        }
        if (parts.length)
            rows.push(parts.join(''));
    }

    if (isMechOrNpc)
    {
        // NPCs absorb Save here so they don't get a lone row 4.
        const parts = [
            cell(mdi('mdi-arrow-right-bold-hexagon-outline', '#fff'), String(stats.speed)),
            cell(svgIcon(ICON.evasion), String(stats.evasion)),
            cell(svgIcon(ICON.edef),    String(stats.edef)),
            cell(svgIcon(ICON.sensors), String(stats.sensors)),
        ];
        if (stats.type === 'npc')
            parts.push(cell(svgIcon(ICON.save), signed(stats.save)));
        rows.push(parts.join(''));
    }

    if (stats.type === 'mech')
    {
        const parts = [cell(svgIcon(ICON.save), signed(stats.save))];
        const ocSeq = typeof stats.ocSequence === 'string'
            ? stats.ocSequence.split(',').map(step => step.trim())
            : [];
        if (ocSeq.length > 0)
        {
            const ocLabel = maskCurrent ? '?' : shortOverchargeTerm(ocSeq[Math.min(stats.overcharge, ocSeq.length - 1)] ?? '—');
            const ocCol = maskCurrent ? ocColorCss(0, Math.max(1, ocSeq.length - 1)) : ocColorCss(stats.overcharge, Math.max(1, ocSeq.length - 1));
            parts.push(cell(cciIcon('cci-overcharge', ocCol), String(ocLabel), ocCol));
        }
        if (stats.hasRepairs)
        {
            const repairsColor = maskCurrent ? REPAIR_COLOR_CSS : (stats.repairs > 0 ? REPAIR_COLOR_CSS : '#555');
            const repairsLabel = maskCurrent
                ? (stats.repairsMax > 0 ? `?/${stats.repairsMax}` : '?')
                : (stats.repairsMax > 0 ? `${stats.repairs}/${stats.repairsMax}` : String(stats.repairs));
            parts.push(cell(svgIcon(ICON.repair), repairsLabel, repairsColor));
        }
        if (stats.core.hasCore)
        {
            const coreShown = corePowerDisplay(maskCurrent ? { charged: true, active: false } : stats.core);
            parts.push(cell(svgIcon(ICON.corePwr), maskCurrent ? '?' : coreShown.label, coreShown.color));
        }
        rows.push(parts.join(''));
    }

    return rows.map((rowHtml, i) =>
    {
        const sep = (i === 2 && rows.length > 2) ? '<div class="la-stat-hint-sep"></div>' : '';
        return sep + `<div class="la-stat-hint-row">${rowHtml}</div>`;
    }).join('');
}

/**
 * Two-zone statline for revealed mechs and NPCs: vitals left, sheet right, HASE(+grit) under the sheet.
 * @param {any} actor
 * @param {any} stats getStatsForActor result
 * @param {object} [options]
 * @param {boolean} [options.maskCurrent] show current values as "?"
 * @param {boolean} [options.omitCombatState] drop burn/overshield/infection/reaction (battle log)
 * @param {boolean} [options.showHase] include the HASE row
 * @returns {string}
 */
export function buildTwoZoneStatsHtml(actor, stats, { maskCurrent = false, omitCombatState = false, showHase = true } = {})
{
    const sys = actor?.system ?? {};
    const dimColor = '#555';

    const vitals = [];
    if (stats.structMax > 0)
        vitals.push(cell(cciIcon('cci-structure', '#e8d060'), `${stats.structVal}/${stats.structMax}`, '#e8d060'));
    const hpFull = stats.hpNominalMax || stats.hpMax;
    const hpColor = maskCurrent ? hpColorCss(hpFull, hpFull) : hpColorCss(stats.hpVal, hpFull);
    vitals.push(cell(glyph('♥', hpColor, 16), maskCurrent ? `?/${stats.hpNominalMax}` : `${stats.hpVal}/${stats.hpNominalMax}`, hpColor));
    if (stats.stressMax > 0 && stats.heatMax > 0)
        vitals.push(cell(cciIcon('cci-reactor', '#e07830'), `${stats.stressVal}/${stats.stressMax}`, '#e07830'));
    if (stats.heatMax > 0)
    {
        const heatColor = maskCurrent ? heatColorCss(0, stats.heatMax) : heatColorCss(stats.heatVal, stats.heatMax);
        vitals.push(cell(glyph('🌡', heatColor, 16), maskCurrent ? `?/${stats.heatMax}` : `${stats.heatVal}/${stats.heatMax}`, heatColor));
    }
    if (!omitCombatState)
    {
        if (isBurnEnabled())
        {
            const burnCol = stats.burn > 0 ? '#d74242' : dimColor;
            vitals.push(cell(cciIcon('cci-burn', burnCol), String(stats.burn), burnCol));
        }
        const overshieldColor = stats.overshield > 0 ? '#60a5fa' : dimColor;
        vitals.push(cell(mdi('mdi-hexagon-multiple-outline', overshieldColor), String(stats.overshield), overshieldColor));
        if (isInfectionEnabled())
        {
            const infectionColor = stats.infection > 0 ? '#1a8a3a' : dimColor;
            vitals.push(cell(glyph('☣', infectionColor, 16), String(stats.infection), infectionColor));
        }
        const reactionColor = maskCurrent ? '#a855f7' : (stats.reaction ? '#a855f7' : dimColor);
        const reactionOpacity = maskCurrent ? 1 : (stats.reaction ? 1 : 0.4);
        vitals.push(cell(`<img class="la-stat-hint-icon" src="${ICON.reaction}" style="filter:brightness(0) saturate(100%) invert(1);opacity:${reactionOpacity};">`,
            maskCurrent ? '?' : stats.reactionText, reactionColor));
    }

    const sheet = [
        cell(mdi('mdi-arrow-right-bold-hexagon-outline', '#fff'), String(stats.speed)),
        cell(svgIcon(ICON.armor), String(stats.armor)),
        cell(svgIcon(ICON.evasion), String(stats.evasion)),
        cell(svgIcon(ICON.edef), String(stats.edef)),
        cell(svgIcon(ICON.sensors), String(stats.sensors)),
        cell(svgIcon(ICON.save), signed(stats.save)),
    ];
    if (stats.type === 'mech')
    {
        const ocSeq = typeof stats.ocSequence === 'string'
            ? stats.ocSequence.split(',').map(step => step.trim())
            : [];
        if (ocSeq.length > 0)
        {
            const ocLabel = maskCurrent ? '?' : shortOverchargeTerm(ocSeq[Math.min(stats.overcharge, ocSeq.length - 1)] ?? '—');
            const ocCol = maskCurrent ? ocColorCss(0, Math.max(1, ocSeq.length - 1)) : ocColorCss(stats.overcharge, Math.max(1, ocSeq.length - 1));
            sheet.push(cell(cciIcon('cci-overcharge', ocCol), String(ocLabel), ocCol));
        }
        if (stats.hasRepairs)
        {
            const repairsColor = maskCurrent ? REPAIR_COLOR_CSS : (stats.repairs > 0 ? REPAIR_COLOR_CSS : '#555');
            const repairsLabel = maskCurrent
                ? (stats.repairsMax > 0 ? `?/${stats.repairsMax}` : '?')
                : (stats.repairsMax > 0 ? `${stats.repairs}/${stats.repairsMax}` : String(stats.repairs));
            sheet.push(cell(svgIcon(ICON.repair), repairsLabel, repairsColor));
        }
    }

    let haseHtml = '';
    if (showHase)
    {
        const parts = [
            haseChipCell('H', sys.hull ?? 0),
            haseChipCell('A', sys.agi ?? 0),
            haseChipCell('S', sys.sys ?? 0),
            haseChipCell('E', sys.eng ?? 0),
        ];
        // The battle log has no fourth line, so grit rides inline there.
        if (stats.type === 'mech' && omitCombatState)
            parts.push(haseChipCell('G', sys.grit ?? 0, ' la-grit'));
        haseHtml = `<div class="la-stat-hint-hase${omitCombatState ? ' la-inline' : ''}">${parts.join('')}</div>`;
    }

    let extraLineHtml = '';
    if (stats.type === 'mech' && !omitCombatState)
    {
        const parts = [];
        if (showHase)
            parts.push(haseChipCell('G', sys.grit ?? 0, ' la-grit'));
        if (stats.core.hasCore)
        {
            const coreShown = corePowerDisplay(maskCurrent ? { charged: true, active: false } : stats.core);
            parts.push(cell(svgIcon(ICON.corePwr), maskCurrent ? '?' : coreShown.label, coreShown.color));
        }
        if (parts.length)
            extraLineHtml = `<div class="la-stat-hint-extraline">${parts.join('')}</div>`;
    }

    return `<div class="la-stat-hint-zones">`
        + `<div class="la-stat-hint-vitals">${vitals.join('')}</div>`
        + `<div class="la-stat-hint-zrule"></div>`
        + `<div class="la-stat-hint-sheet">${sheet.join('')}${haseHtml}${extraLineHtml}</div>`
        + `</div>`;
}

// Unknown view: vitals only; HP/Heat shown as deltas so the maxes don't leak.
function buildDamagedRowsHtml(actor, stats, { maskCurrent = false } = {})
{
    const burnOn = isBurnEnabled();
    const infOn = isInfectionEnabled();
    const dimColor = '#555';
    const rows = [];

    {
        const parts = [];
        if (stats.structMax > 0)
        {
            parts.push(cell(cciIcon('cci-structure', '#e8d060'),
                `${stats.structVal}/${stats.structMax}`, '#e8d060'));
        }
        if (!maskCurrent && stats.hpNominalMax > 0 && stats.hpVal < stats.hpNominalMax)
        {
            parts.push(cell(glyph('♥', '#d74242', 16),
                `-${stats.hpNominalMax - stats.hpVal}`, '#d74242'));
        }
        if (burnOn)
        {
            const burnCol = stats.burn > 0 ? '#d74242' : dimColor;
            parts.push(cell(cciIcon('cci-burn', burnCol), String(stats.burn), burnCol));
        }
        const osCol = stats.overshield > 0 ? '#60a5fa' : dimColor;
        parts.push(cell(mdi('mdi-hexagon-multiple-outline', osCol), String(stats.overshield), osCol));
        rows.push(parts.join(''));
    }
    {
        const parts = [];
        if (stats.stressMax > 0 && stats.heatMax > 0)
        {
            parts.push(cell(cciIcon('cci-reactor', '#e07830'),
                `${stats.stressVal}/${stats.stressMax}`, '#e07830'));
        }
        if (!maskCurrent && stats.heatMax > 0 && stats.heatVal > 0)
        {
            parts.push(cell(glyph('🌡', '#ff8a00', 16),
                `+${stats.heatVal}`, '#ff8a00'));
        }
        if (infOn)
        {
            const infCol = stats.infection > 0 ? '#1a8a3a' : dimColor;
            parts.push(cell(glyph('☣', infCol, 16), String(stats.infection), infCol));
        }
        if (parts.length)
            rows.push(parts.join(''));
    }
    return rows.map(rowHtml => `<div class="la-stat-hint-row">${rowHtml}</div>`).join('');
}

export function ensureStyleSheet()
{
    if (_styleInjected)
        return;
    _styleInjected = true;
    const css = `
.la-stat-hint-popup {
    position: fixed;
    pointer-events: none;
    z-index: 99;
    font-family: var(--font-primary, "Signika", Arial, sans-serif);
    user-select: none;
}
.la-stat-hint-anim {
    zoom: var(--la-hint-scale, 1);
    box-sizing: border-box;
    background: #666;
    padding: 1px;
    opacity: 0;
    transform: translateX(var(--la-hint-slide-from, 28px));
    transition: opacity 200ms ease-out, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
    overflow: hidden;
    min-width: 150px;
    max-width: 420px;
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
}
.la-stat-hint-inner {
    display: flex;
    align-items: stretch;
    width: 100%;
    background: rgba(13, 13, 13, 0.92);
    overflow: hidden;
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
}
.la-stat-hint-stripe {
    flex: 0 0 4px;
    align-self: stretch;
}
.la-stat-hint-body {
    flex: 1 1 auto;
    min-width: 0;
}
.la-stat-hint-anim.la-show {
    opacity: 1;
    transform: translateX(0);
}
.la-stat-hint-header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 5px 9px;
    background: #1a1a1a;
    border-bottom: 1px solid #444;
    color: #eee;
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 0.02em;
}
.la-stat-hint-header.la-unknown {
    background: #1a1a1a;
    border-bottom: 1px solid #444;
}
.la-stat-hint-title {
    display: flex;
    align-items: center;
    gap: 6px;
}
.la-stat-hint-subtitle {
    color: #888;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0;
    opacity: 0.85;
}
.la-stat-hint-tier { color: #ffaa55; font-weight: 600; }
.la-stat-hint-name { color: #eeeeee; }
.la-stat-hint-frame {
    color: #888;
    font-size: 11px;
    font-weight: 400;
    letter-spacing: 0;
    opacity: 0.85;
    margin-left: 4px;
}
.la-stat-hint-zones {
    display: flex;
    align-items: stretch;
    gap: 10px;
    padding: 6px 9px;
    font-size: 13px;
    line-height: 1;
    color: #ddd;
    font-weight: 400;
    white-space: nowrap;
}
.la-stat-hint-vitals {
    display: grid;
    grid-template-columns: repeat(2, max-content);
    column-gap: 9px;
    row-gap: 2px;
    align-content: center;
}
.la-stat-hint-zrule {
    flex: 0 0 1px;
    align-self: stretch;
    width: 1px;
    background: rgba(255, 255, 255, 0.3);
}
.la-stat-hint-sheet {
    display: grid;
    grid-template-columns: repeat(4, max-content);
    column-gap: 9px;
    row-gap: 2px;
    align-content: start;
    justify-items: center;
}
.la-stat-hint-hase {
    grid-column: 1 / -1;
    justify-self: stretch;
    border-top: 1px dashed rgba(255, 255, 255, 0.3);
    padding-top: 3px;
    margin-top: 1px;
    display: grid;
    grid-template-columns: subgrid;
    justify-items: center;
    align-items: center;
}
.la-stat-hint-hase.la-inline {
    display: flex;
    align-items: center;
    gap: 9px;
}
.la-stat-hint-extraline {
    grid-column: 1 / -1;
    justify-self: stretch;
    display: grid;
    grid-template-columns: subgrid;
    justify-items: center;
    align-items: center;
    margin-top: 2px;
}
.la-stat-hint-rows {
    display: grid;
    grid-template-columns: repeat(5, max-content);
    column-gap: 9px;
    row-gap: 2px;
    padding: 6px 9px;
    font-size: 13px;
    line-height: 1;
    color: #ddd;
    font-weight: 400;
    white-space: nowrap;
}
.la-stat-hint-row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: center;
}
.la-stat-hint-sep {
    grid-column: 1 / -1;
    border-top: 1px dashed rgba(255, 255, 255, 0.22);
    margin: 2px 0 0;
    height: 0;
}
.la-stat-hint-cell {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.la-stat-hint-cell .la-stat-hint-icon {
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    vertical-align: middle;
    flex-shrink: 0;
}
.la-stat-hint-cell .cci,
.la-stat-hint-cell .mdi {
    font-size: 16px;
    line-height: 1;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
}
.la-stat-hint-cell .la-stat-hint-val { font-weight: 400; }
.la-stat-hint-extras {
    padding: 2px 9px 5px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.la-stat-hint-extras .la-stat-hint-sep {
    border-top: 1px dashed rgba(255, 255, 255, 0.22);
    height: 0;
    margin: 0 0 4px;
}
.la-stat-hint-extra-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    line-height: 1.1;
    white-space: nowrap;
}
.la-stat-hint-extra-icon {
    width: 16px;
    height: 16px;
    object-fit: contain;
    flex-shrink: 0;
    filter: brightness(0) saturate(100%) invert(1);
}
.la-stat-hint-extra-val {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}
.la-stat-hint-extra-label {
    color: #888;
    opacity: 0.85;
    font-size: 10px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.la-stat-plate {
    --la-chip-w: 34px;
    --la-chip-cut: calc(var(--la-chip-w) * 0.32);
}
.la-stat-plate .la-hud-token-name {
    flex: 1 1 auto;
    min-width: 150px;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
}
.la-stat-plate-namefit {
    display: block;
    width: max-content;
    max-width: 260px;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    white-space: nowrap;
}
.la-stat-plate-namebox {
    contain: inline-size;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 1px 8px;
}
.la-stat-plate-nm {
    min-width: 0;
    max-width: 100%;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.la-stat-plate-nm.la-panning {
    text-overflow: clip;
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent);
}
.la-stat-plate-nm.la-panning > span {
    display: inline-block;
    padding-right: 14px;
}
.la-stat-plate-sub {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    color: #8a8a8a;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.la-stat-plate-unknown {
    color: #e50000;
    opacity: 0.85;
}
.la-stat-plate-stats {
    background: #111;
    padding: 2px 6px 2px 5px;
    font-size: 0.97em;
    color: #888;
    display: flex;
    align-items: stretch;
}
.la-stat-plate-pair {
    gap: 6px;
}
.la-stat-plate-def {
    background: #111;
    border-top: 1px solid #262626;
    padding: 3px 8px 4px 6px;
    display: flex;
    gap: 10px;
    align-items: center;
    color: #aaa;
    font-size: 0.92em;
    white-space: nowrap;
}
.la-stat-plate-def span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}
.la-stat-plate-def img {
    width: 1.3em;
    height: 1.3em;
    border: none;
    background: none;
}
.la-stat-plate-hase {
    gap: 9px;
}
${HASE_CHIP_CSS}
.la-stat-plate-fx {
    background: #111;
    border-top: 1px solid #262626;
    padding: 5px 6px;
}
${EFFECT_TILE_CSS}
.la-stat-plate-extras {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 12px;
}
.la-stat-plate-extra {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12.5px;
    white-space: nowrap;
}
body.la-stat-docked #tht_terrainStackViewer {
    --header-height: 22px;
    background: #666;
    padding: 1px;
    border: none;
    border-radius: 0;
    box-shadow: none;
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
    transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
body.la-stat-docked #tht_terrainStackViewer > .window-header {
    gap: 7px;
    padding: 0 12px 0 8px;
    background: #1a1a1a;
    border: none;
    border-left: 4px solid #4a4a4a;
    color: #cfcfcf;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
}
body.la-stat-docked #tht_terrainStackViewer > .window-header .window-title {
    color: #cfcfcf;
}
body.la-stat-docked #tht_terrainStackViewer > .window-header .window-icon {
    color: #8f8f8f;
}
body.la-stat-docked #tht_terrainStackViewer > .window-content {
    background: #111;
    border-left: 4px solid #4a4a4a;
    clip-path: polygon(0 0, 100% 0, 100% 100%, 10px 100%, 0 calc(100% - 10px));
}
body.la-stat-dock-open #tht_terrainStackViewer {
    transform: translateY(calc(-1 * var(--la-stat-dock-lift, 0px)));
}
`;
    const el = document.createElement('style');
    el.id = 'la-stat-hint-styles';
    el.textContent = css;
    document.head.appendChild(el);
}

// User-defined extra bars; empty string when none are visible.
function buildExtrasHintHtml(token, actor, maskCurrent = false, compact = false)
{
    const tokenDoc = token?.document;
    if (!tokenDoc || !actor)
        return '';
    const extras = getLAFlag(tokenDoc,FLAG_EXTRAS) ?? [];
    if (!extras.length)
        return '';
    const visible = extras.filter(extra => !extra.hideInHint && _resolveExtraBarValues(actor, extra).ownerOk);
    if (!visible.length)
        return '';
    const rows = visible.map(extra =>
    {
        const { value, max } = _resolveExtraBarValues(actor, extra);
        // Bars set to 'all' are public even unscanned; only scan-gated bars mask.
        const entryVisibility = extra.visibility ?? (extra.ownerOnly === true ? 'owner' : extra.ownerOnly === false ? 'all' : 'scanned');
        const masked = maskCurrent && entryVisibility === 'scanned';
        const color = extra.color?.stops?.[0] ?? '#cccccc';
        const iconSrc = extra.icon || 'modules/lancer-automations/icons/perspective-dice-two.svg';
        const iconHtml = /\.(svg|png|webp|jpe?g|gif)$/i.test(iconSrc)
            ? `<img class="la-stat-hint-extra-icon" src="${esc(iconSrc)}" alt="">`
            : `<i class="la-stat-hint-extra-icon ${esc(iconSrc)}"></i>`;
        const labelHtml = extra.showLabelInHint && extra.label
            ? `<span class="la-stat-hint-extra-label">${esc(extra.label)}</span>`
            : '';
        const valueHtml = `<span class="la-stat-hint-extra-val" style="color:${esc(color)};">${masked ? `?/${max}` : `${value}/${max}`}</span>`;
        if (compact)
            return `<span class="la-stat-plate-extra">${iconHtml}${valueHtml}${labelHtml}</span>`;
        return `<div class="la-stat-hint-extra-row">
            ${iconHtml}
            ${valueHtml}
            ${labelHtml}
        </div>`;
    }).join('');
    if (compact)
        return `<div class="la-stat-plate-fx"><div class="la-stat-plate-extras">${rows}</div></div>`;
    return `<div class="la-stat-hint-extras"><div class="la-stat-hint-sep"></div>${rows}</div>`;
}

function plateEffectsHtml(actor)
{
    const entries = effectTileEntries(actor);
    if (!entries.length)
        return '';
    const names = getModuleSetting(SETTING_EFFECTS_MODE) === 'names';
    return `<div class="la-stat-plate-fx">${effectTilesHtml(entries, { names })}</div>`;
}

function plateCell(color, iconClass, value, extraClass = '')
{
    return `<span class="la-stats-cell${extraClass ? ` ${extraClass}` : ''}" style="color:${esc(color)};"><span class="la-stats-glyph"><i class="${iconClass}"></i></span><span class="la-stats-val">${esc(String(value))}</span></span>`;
}

function plateHeatColor(val, max)
{
    if (val >= max)
        return '#ff5a4e';
    if (!isDangerZoneHeat(val, max))
        return heatColorCss(val, max);
    return dangerHeatColorCss(val, max);
}

function plateBandHtml(token, unknown)
{
    const actor = token.actor;
    const tokenDoc = token.document;
    const hideClass = unknown && hideClassWhenUnknown(tokenDoc);
    const rank = hideClass ? null : rankParts(actor);
    const chip = rank ? `<span class="la-hud-token-rank"><span class="la-hud-rank-kind">${rank.kind}</span><span class="la-hud-rank-num">${rank.value}</span></span>` : '';
    const ownSide = actor?.type === 'pilot' || actor?.type === 'mech';
    const label = unknown ? unknownName(tokenDoc, actor) : displayName(tokenDoc, actor);
    const nameClass = unknown && !ownSide && getLabelMode() === LABEL_SCAN ? ' class="la-stat-plate-nm la-stat-plate-unknown"' : ' class="la-stat-plate-nm"';
    const subText = hideClass ? '' : getActorSubtitleText(actor);
    const sub = subText ? `<span class="la-stat-plate-sub">${esc(subText)}</span>` : '';
    const nameText = esc(String(label).toUpperCase());
    return `<div class="la-hud-token-title">${chip}<span class="la-hud-token-name"><span class="la-stat-plate-namefit" aria-hidden="true">${nameText}</span><span class="la-stat-plate-namebox"><span${nameClass}><span>${nameText}</span></span>${sub}</span></span></div>`;
}

function plateStatsHtml(actor, stats, unknown, mask)
{
    const SEP = '<span class="la-stats-sep">│</span>';
    const EMPTY = '<span></span>';
    const showStress = stats.stressMax > 0 && stats.heatMax > 0;
    const cols = [];
    if (stats.structMax > 0 || showStress)
    {
        cols.push({
            top: stats.structMax > 0 ? statPipsHtml('cci-structure', stats.structVal, stats.structMax, '#e8d060') : '',
            bottom: showStress ? statPipsHtml('cci-reactor', stats.stressVal, stats.stressMax, '#e07830') : '',
        });
    }
    const overshield = stats.overshield > 0 ? plateCell('#60a5fa', 'mdi mdi-hexagon-multiple-outline', stats.overshield) : '';
    const withShield = (hpHtml) => [hpHtml, overshield].filter(Boolean).join(SEP);
    if (unknown)
    {
        const hpLost = !mask && stats.hpNominalMax > 0 && stats.hpVal < stats.hpNominalMax;
        const heatUp = !mask && stats.heatMax > 0 && stats.heatVal > 0;
        const top = withShield(hpLost ? plateCell('#d74242', 'mdi mdi-heart', `-${stats.hpNominalMax - stats.hpVal}`) : '');
        cols.push({
            top: top ? `<span class="la-stats-group">${top}</span>` : '',
            bottom: heatUp ? plateCell('#ff8a00', 'cci cci-heat', `+${stats.heatVal}`) : '',
            anchor: heatUp,
        });
    }
    else
    {
        const hpFull = stats.hpNominalMax || stats.hpMax;
        const hpColor = mask ? hpColorCss(hpFull, hpFull) : hpColorCss(stats.hpVal, hpFull);
        const hpCritical = !mask && hpFull > 0 && stats.hpVal * 10 <= hpFull;
        const hp = plateCell(hpColor, 'mdi mdi-heart', mask ? `?/${stats.hpNominalMax}` : `${stats.hpVal}/${stats.hpNominalMax}`, hpCritical ? 'la-stats-critical' : '');
        let bottom = '';
        if (stats.heatMax > 0)
        {
            const danger = !mask && isDangerZoneHeat(stats.heatVal, stats.heatMax);
            const atMax = !mask && stats.heatVal >= stats.heatMax;
            const heatClass = atMax ? 'la-stats-critical' : (danger ? 'la-stats-heat--danger' : '');
            const heatColor = mask ? heatColorCss(0, stats.heatMax) : plateHeatColor(stats.heatVal, stats.heatMax);
            bottom = plateCell(heatColor, danger ? 'cci cci-status-danger-zone' : 'cci cci-heat', mask ? `?/${stats.heatMax}` : `${stats.heatVal}/${stats.heatMax}`, heatClass);
        }
        else if (stats.type === 'pilot' && stats.pilotStressMax > 0)
            bottom = plateCell(pilotStressColorCss(stats.pilotStressVal, stats.pilotStressMax), 'mdi mdi-brain', `${stats.pilotStressVal}/${stats.pilotStressMax}`);
        cols.push({ top: `<span class="la-stats-group">${withShield(hp)}</span>`, bottom, anchor: !!bottom });
        if (stats.type === 'mech' && typeof stats.ocSequence === 'string')
        {
            const ocSeq = stats.ocSequence.split(',').map(step => step.trim());
            const ocMax = Math.max(1, ocSeq.length - 1);
            const ocLabel = mask ? '?' : shortOverchargeTerm(ocSeq[Math.min(stats.overcharge, ocSeq.length - 1)] ?? '—');
            const ocColor = mask ? ocColorCss(0, ocMax) : ocColorCss(stats.overcharge, ocMax);
            const repairsNow = mask ? '?' : stats.repairs;
            const repairsLabel = stats.repairsMax > 0 ? `${repairsNow}/${stats.repairsMax}` : repairsNow;
            cols.push({
                top: stats.hasRepairs ? plateCell(mask || stats.repairs > 0 ? REPAIR_COLOR_CSS : '#aaa', 'cci cci-repair', repairsLabel) : '',
                bottom: plateCell(ocColor, 'cci cci-overcharge', ocLabel),
                anchor: true,
            });
        }
        if (stats.type === 'pilot' && stats.hasBond && stats.pilotXpMax > 0)
        {
            const xpColor = mask || stats.pilotXpVal > 0 ? _bondXpColor(actor) : '#888';
            cols.push({ top: '', bottom: plateCell(xpColor, 'mdi mdi-head-cog-outline', mask ? `?/${stats.pilotXpMax}` : `${stats.pilotXpVal}/${stats.pilotXpMax}`), anchor: true });
        }
        const speed = stats.type !== 'deployable' ? plateCell('#aaa', 'mdi mdi-arrow-right-bold-hexagon-outline', stats.speed, 'la-stats-move') : '';
        const reaction = hasReaction(actor) ? plateCell(mask || stats.reaction ? '#a855f7' : '#aaa', 'cci cci-reaction', mask ? '?' : stats.reactionText, 'la-stats-reaction') : '';
        if (speed || reaction)
            cols.push({ top: speed, bottom: reaction });
    }
    const burn = isBurnEnabled() && stats.burn > 0 ? plateCell('#d74242', 'cci cci-burn', stats.burn) : '';
    const infection = isInfectionEnabled() && stats.infection > 0 ? plateCell('#1a8a3a', 'mdi mdi-biohazard', stats.infection) : '';
    if (burn || infection)
        cols.push({ top: burn, bottom: infection });
    const live = cols.filter(col => col.top || col.bottom);
    if (!live.length)
        return '';
    const folded = !live.some(col => col.anchor);
    const topRow = [];
    const bottomRow = [];
    live.forEach((col, index) =>
    {
        if (folded)
        {
            if (index > 0)
                topRow.push(SEP);
            const parts = [col.top, col.bottom].filter(Boolean);
            topRow.push(parts.length > 1 ? `<span class="la-stats-group la-stat-plate-pair">${parts.join('')}</span>` : parts[0]);
            return;
        }
        if (index > 0)
        {
            topRow.push(col.top ? SEP : EMPTY);
            bottomRow.push(col.bottom ? SEP : EMPTY);
        }
        topRow.push(col.top || EMPTY);
        bottomRow.push(col.bottom || EMPTY);
    });
    const cells = folded ? topRow : [...topRow, ...bottomRow];
    return `<div class="la-stat-plate-stats"><div class="la-stats-grid" style="grid-template-columns:repeat(${topRow.length},auto);">${cells.join('')}</div></div>`;
}

function plateDefenseHtml(stats, mask)
{
    const type = stats.type;
    const stat = (url, value) => `<span><img src="${url}" alt="">${esc(String(value))}</span>`;
    const parts = [stat(ICON.armor, stats.armor), stat(ICON.evasion, stats.evasion), stat(ICON.edef, stats.edef)];
    if (type === 'mech')
        parts.push(stat(ICON.techAtk, signed(stats.techAtk)));
    if (type !== 'pilot')
        parts.push(stat(ICON.save, stats.save));
    if (type === 'mech' || type === 'npc')
        parts.push(stat(ICON.sensors, stats.sensors));
    if (type === 'mech' && stats.core.hasCore)
    {
        const shown = corePowerDisplay(mask ? { charged: true, active: false } : stats.core);
        parts.push(`<span style="color:${shown.color};"><img src="${ICON.corePwr}" alt="">${mask ? '?' : shown.label}</span>`);
    }
    return `<div class="la-stat-plate-def">${parts.join('')}</div>`;
}

function plateHaseHtml(actor, stats)
{
    if (getModuleSetting(SETTING_SHOW_HASE) !== true || (stats.type !== 'mech' && stats.type !== 'npc'))
        return '';
    const sys = actor?.system ?? {};
    const parts = [haseChipCell('H', sys.hull ?? 0), haseChipCell('A', sys.agi ?? 0), haseChipCell('S', sys.sys ?? 0), haseChipCell('E', sys.eng ?? 0)];
    if (stats.type === 'mech')
        parts.push(haseChipCell('G', sys.grit ?? 0, ' la-grit'));
    return `<div class="la-stat-plate-def la-stat-plate-hase">${parts.join('')}</div>`;
}

function buildPopupDom(token)
{
    const actor = token.actor;
    if (!actor)
        return null;
    const mode = resolveViewMode(actor);
    const stats = getStatsForActor(actor);
    const maskCurrent = masksCurrentStats(actor, mode, token?.document ?? token);

    let viewMode = mode;
    let headerHtml;
    let rowsHtml = '';
    if (mode === 'gm' || mode === 'scanned')
    {
        const isMechOrNpc = stats.type === 'mech' || stats.type === 'npc';
        headerHtml = buildHeaderHtml(token, 'reveal');
        const showHase = getModuleSetting(SETTING_SHOW_HASE) === true;
        rowsHtml = isMechOrNpc
            ? buildTwoZoneStatsHtml(actor, stats, { maskCurrent, showHase })
            : `<div class="la-stat-hint-rows">${buildRevealRowsHtml(actor, stats, { maskCurrent })}</div>`;
    }
    else
    {
        viewMode = 'unknown';
        headerHtml = buildHeaderHtml(token, 'unknown-damaged');
        rowsHtml = `<div class="la-stat-hint-rows">${buildDamagedRowsHtml(actor, stats, { maskCurrent })}</div>`;
    }
    let bodyClass = 'la-stat-hint-body';
    if (isDocked())
    {
        const unknown = viewMode === 'unknown';
        headerHtml = plateBandHtml(token, unknown);
        rowsHtml = plateStatsHtml(actor, stats, unknown, maskCurrent) + (unknown ? '' : plateDefenseHtml(stats, maskCurrent) + plateHaseHtml(actor, stats)) + plateEffectsHtml(actor);
        bodyClass += ' la-stat-plate';
    }
    const extrasHtml = buildExtrasHintHtml(token, actor, maskCurrent, isDocked());

    const popup = document.createElement('div');
    popup.className = 'la-stat-hint-popup';
    const anim = document.createElement('div');
    anim.className = 'la-stat-hint-anim';
    const disp = getTokenDispositionInfo(token);
    const stripeHtml = disp
        ? `<div class="la-stat-hint-stripe" style="background:${esc(disp.color)};" title="${esc(disp.label)}"></div>`
        : '';
    anim.innerHTML = `<div class="la-stat-hint-inner">${stripeHtml}<div class="${bodyClass}">${headerHtml}${rowsHtml}${extrasHtml}</div></div>`;
    popup.appendChild(anim);
    popup.dataset.viewMode = viewMode;
    popup.dataset.tokenId = token.id;
    return { popup, anim };
}

function usableScreenBounds()
{
    const viewW = window.innerWidth;
    let leftEdge = 0;
    let rightEdge = viewW;
    try
    {
        const controls = document.getElementById('controls')
            || document.querySelector('#ui-left')
            || document.querySelector('#scene-controls');
        if (controls)
        {
            const controlsRect = controls.getBoundingClientRect();
            if (controlsRect.width > 0 && controlsRect.right > leftEdge && controlsRect.left < viewW * 0.4)
                leftEdge = controlsRect.right;
        }
    }
    catch
    { /* ignore */ }
    try
    {
        const sidebar = document.getElementById('sidebar')
            || ui?.sidebar?.element
            || document.getElementById('ui-right');
        if (sidebar)
        {
            const sidebarRect = sidebar.getBoundingClientRect();
            if (sidebarRect.width > 0 && sidebarRect.left > viewW * 0.5 && sidebarRect.left < rightEdge)
                rightEdge = sidebarRect.left;
        }
    }
    catch
    { /* ignore */ }
    return { left: leftEdge, right: rightEdge, width: Math.max(0, rightEdge - leftEdge) };
}

function tokenScreenRect(token)
{
    if (!canvas?.stage || !canvas.app?.view || !token)
        return { left: 0, top: 0, right: 0, bottom: 0, w: 0, h: 0, cy: 0 };
    // toGlobal handles pivot/skew that plain stage.position+scale would miss.
    const tokenLocalX = token.x ?? 0;
    const tokenLocalY = token.y ?? 0;
    const tokenLocalW = token.w ?? 0;
    const tokenLocalH = token.h ?? 0;
    // Anchor on the sprite (mesh) when iso has shifted it off the cell; otherwise use the orthogonal cell.
    const meshPos = token.mesh?.position;
    const meshShifted = meshPos && (meshPos.x !== token.position?.x || meshPos.y !== token.position?.y);
    const rectCenterX = meshShifted ? meshPos.x : (tokenLocalX + tokenLocalW / 2);
    const rectCenterY = meshShifted ? meshPos.y : (tokenLocalY + tokenLocalH / 2);
    const halfW = tokenLocalW / 2;
    const halfH = tokenLocalH / 2;
    const topLeft = canvas.stage.toGlobal(new PIXI.Point(rectCenterX - halfW, rectCenterY - halfH));
    const bottomRight = canvas.stage.toGlobal(new PIXI.Point(rectCenterX + halfW, rectCenterY + halfH));
    const view = canvas.app.view;
    const viewRect = view.getBoundingClientRect?.() ?? { left: 0, top: 0, width: view.width, height: view.height };
    // toGlobal yields logical px; renderer.screen is that space (view.width is backing px, off by dpr)
    const screenW = canvas.app.renderer?.screen?.width || viewRect.width;
    const cssScale = screenW > 0 ? (viewRect.width / screenW) : 1;
    const left = viewRect.left + topLeft.x * cssScale;
    const top = viewRect.top + topLeft.y * cssScale;
    const right = viewRect.left + bottomRight.x * cssScale;
    const bottom = viewRect.top + bottomRight.y * cssScale;
    return { left, top, right, bottom, w: right - left, h: bottom - top, cy: (top + bottom) / 2 };
}

// Right-by-default. Flips only when the right side cannot show even half.
function computePlaceRight(token, popupScreenW)
{
    if (!canvas?.stage || !token)
        return true;
    const rect = tokenScreenRect(token);
    const bounds = usableScreenBounds();
    const gap = ANCHOR_GAP * getHintScale();
    const rightSpace = bounds.right - rect.right;
    const leftSpace = rect.left - bounds.left;
    const rightAcceptable = rightSpace >= (popupScreenW / 2 + gap);
    const leftFits = leftSpace >= (popupScreenW + gap);
    if (rightAcceptable)
        return true;
    if (leftFits)
        return false;
    return true;
}

function liftTerrainViewer()
{
    const body = document.body;
    const viewer = document.getElementById('tht_terrainStackViewer');
    if (!_popupEl || !viewer || !isDocked())
    {
        body.classList.remove('la-stat-dock-open');
        return;
    }
    const viewerRect = viewer.getBoundingClientRect();
    const transform = getComputedStyle(viewer).transform;
    const shift = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
    const naturalBottom = viewerRect.height > 0 ? viewerRect.bottom - shift : (document.getElementById('players')?.getBoundingClientRect().top ?? 0);
    const lift = Math.max(0, Math.ceil(naturalBottom - _popupEl.getBoundingClientRect().top + 6));
    body.style.setProperty('--la-stat-dock-lift', `${lift}px`);
    body.classList.toggle('la-stat-dock-open', lift > 0);
}

function placeDocked()
{
    const playersRect = document.getElementById('players')?.getBoundingClientRect();
    const left = playersRect?.width ? playersRect.left : DOCK_MARGIN;
    let bottom = playersRect?.height ? playersRect.bottom : window.innerHeight - DOCK_MARGIN;
    const measureBar = document.getElementById('la-measure-toolbar');
    if (measureBar?.classList.contains('la-show'))
    {
        const barRect = measureBar.getBoundingClientRect();
        const dockRight = left + (_popupEl.offsetWidth || 0);
        if (left < barRect.right && dockRight > barRect.left)
            bottom = Math.min(bottom, barRect.top - DOCK_MARGIN);
    }
    const pixelRatio = window.devicePixelRatio || 1;
    const snap = (value) => Math.round(value * pixelRatio) / pixelRatio;
    _popupEl.style.left = `${snap(left)}px`;
    _popupEl.style.top = `${snap(bottom - (_popupEl.offsetHeight || 0))}px`;
    _popupEl.style.setProperty('--la-hint-slide-from', `${-SLIDE_OFFSET}px`);
    liftTerrainViewer();
}

function scaledPopupWidth(fallback)
{
    _popupEl.style.setProperty('--la-hint-scale', String(getHintScale()));
    return _popupEl.offsetWidth || fallback;
}

function applyPosition(token)
{
    if (!_popupEl || !token || token.destroyed)
        return;
    const hintScale = getHintScale();
    _popupEl.style.setProperty('--la-hint-scale', String(hintScale));
    if (isDocked())
    {
        placeDocked();
        return;
    }
    const rect = tokenScreenRect(token);
    const anchorX = _placeRight ? rect.right : rect.left;
    const anchorY = rect.cy;
    const popupW = _popupEl.offsetWidth || 0;
    const popupH = _popupEl.offsetHeight || 0;
    if (_placeRight)
    {
        _popupEl.style.left = `${anchorX + ANCHOR_GAP * hintScale}px`;
        _popupEl.style.top = `${anchorY - popupH / 2}px`;
        _popupEl.style.setProperty('--la-hint-slide-from', `${SLIDE_OFFSET}px`);
    }
    else
    {
        _popupEl.style.left = `${anchorX - ANCHOR_GAP * hintScale - popupW}px`;
        _popupEl.style.top = `${anchorY - popupH / 2}px`;
        _popupEl.style.setProperty('--la-hint-slide-from', `${-SLIDE_OFFSET}px`);
    }
}

function clearDelay()
{
    if (_delayTimer)
    {
        clearTimeout(_delayTimer); _delayTimer = null;
    }
}
function clearOutTimer()
{
    if (_outTimer)
    {
        clearTimeout(_outTimer); _outTimer = null;
    }
}
function shouldShowHintFor(token)
{
    if (!isEnabled())
        return false;
    if (!token?.actor)
        return false;
    if (!isLancerCombatant(token.actor))
        return false;
    if (token.controlled && !showForControlled())
        return false;
    if (isCombatOnly() && !isTokenInCombat(token))
        return false;
    if (!isTokenVisible(token))
        return false;
    return true;
}

function destroyPopup()
{
    clearOutTimer();
    _stopTahWatch();
    document.body.classList.remove('la-stat-dock-open');
    if (_popupEl && _popupEl.parentNode)
        _popupEl.parentNode.removeChild(_popupEl);
    _popupEl = null;
    _animEl = null;
}

export function forceHideStatHint()
{
    forceHide();
}

function forceHide()
{
    clearDelay();
    destroyPopup();
    _state = 'idle';
    _currentTokenId = null;
    _currentToken = null;
}

// hoverToken only fires over the canvas, so cursor sliding onto #la-hud leaks the popup.
function _startTahWatch()
{
    if (_tahWatch)
        return;
    _tahWatch = (ev) =>
    {
        if (ev.target?.closest?.('#la-hud'))
            _hideOnTahEnter();
    };
    document.addEventListener('mouseover', _tahWatch, true);
}

function _stopTahWatch()
{
    if (!_tahWatch)
        return;
    document.removeEventListener('mouseover', _tahWatch, true);
    _tahWatch = null;
}

function _hideOnTahEnter()
{
    if (_state === 'idle' || _state === 'out')
        return;
    if (_state === 'delay')
    {
        clearDelay();
        _state = 'idle';
        _currentTokenId = null;
        _stopTahWatch();
        return;
    }
    _state = 'out';
    animateOut(() =>
    {
        if (_state === 'out')
        {
            _state = 'idle';
            _currentTokenId = null;
            _currentToken = null;
        }
        _stopTahWatch();
    });
}

function showFor(token)
{
    ensureStyleSheet();
    destroyPopup();
    const built = buildPopupDom(token);
    if (!built)
        return;
    _popupEl = built.popup;
    _animEl = built.anim;
    document.body.appendChild(_popupEl);
    _currentToken = token;
    fitPlateName();

    _placeRight = computePlaceRight(token, scaledPopupWidth(200));
    applyPosition(token);
    _animEl.style.transition = 'none';
    void _animEl.offsetWidth;
    _animEl.style.transition = '';

    _state = 'in';
    playUiSound('details');
    _startTahWatch();
    void _animEl.offsetWidth;
    _animEl.classList.add('la-show');
    panPlateName();
    setTimeout(() =>
    {
        if (_state === 'in')
            _state = 'visible';
    }, 240);
}

function startHover(token)
{
    if (!shouldShowHintFor(token))
        return;
    clearDelay();
    if (_state === 'visible' && _currentTokenId && _currentTokenId !== token.id)
    {
        animateOut(() =>
        {
            _state = 'idle';
            _currentTokenId = token.id;
            scheduleShow(token);
        });
        return;
    }
    if ((_state === 'in' || _state === 'visible') && _currentTokenId === token.id)
        return;
    _currentTokenId = token.id;
    scheduleShow(token);
}

function scheduleShow(token)
{
    clearDelay();
    const delay = getDelayMs();
    _state = 'delay';
    _delayTimer = setTimeout(() =>
    {
        _delayTimer = null;
        if (_currentTokenId !== token.id)
            return;
        if (!shouldShowHintFor(token))
        {
            _state = 'idle';
            _currentTokenId = null;
            return;
        }
        showFor(token);
    }, delay);
}

function animateOut(done)
{
    clearOutTimer();
    if (!_animEl || !_popupEl)
    {
        done?.(); return;
    }
    _animEl.classList.remove('la-show');
    document.body.classList.remove('la-stat-dock-open');
    _outTimer = setTimeout(() =>
    {
        _outTimer = null;
        destroyPopup();
        done?.();
    }, 220);
}

function endHover(token)
{
    if (_currentTokenId !== token?.id)
        return;
    clearDelay();
    if (_state === 'delay')
    {
        _state = 'idle';
        _currentTokenId = null;
        return;
    }
    if (!_popupEl)
    {
        _state = 'idle';
        _currentTokenId = null;
        return;
    }
    _state = 'out';
    playUiSound('details');
    animateOut(() =>
    {
        if (_state === 'out')
        {
            _state = 'idle';
            _currentTokenId = null;
            _currentToken = null;
        }
    });
}

function fitPlateName()
{
    const name = _popupEl?.querySelector('.la-stat-plate-nm');
    if (!(name instanceof HTMLElement))
        return;
    let size = parseFloat(getComputedStyle(name).fontSize);
    while (name.scrollWidth > name.clientWidth && size > PLATE_NAME_MIN_PX)
    {
        size = Math.max(PLATE_NAME_MIN_PX, size - 0.5);
        name.style.fontSize = `${size}px`;
    }
}

function panPlateName()
{
    const name = _popupEl?.querySelector('.la-stat-plate-nm');
    const text = name?.firstElementChild;
    if (!(name instanceof HTMLElement) || !(text instanceof HTMLElement) || name.scrollWidth <= name.clientWidth)
        return;
    name.classList.add('la-panning');
    const overflow = text.offsetWidth - name.clientWidth;
    if (overflow <= 0)
    {
        name.classList.remove('la-panning');
        return;
    }
    const travel = Math.min(2000, Math.max(500, overflow * 20));
    const total = PLATE_PAN_DELAY_MS + travel + PLATE_PAN_HOLD_MS;
    const pan = text.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: PLATE_PAN_DELAY_MS / total },
        { transform: `translateX(${-overflow}px)`, offset: (PLATE_PAN_DELAY_MS + travel) / total },
        { transform: `translateX(${-overflow}px)`, offset: 1 },
    ], { duration: total, iterations: 1, easing: 'linear' });
    pan.finished
        .catch(() => null)
        .then(() => name.classList.remove('la-panning'));
}

function rebuildIfVisible(actor)
{
    if (!actor || _state !== 'visible' || !_popupEl || !_currentTokenId)
        return;
    const token = canvas?.tokens?.get(_currentTokenId);
    if (!token || token.actor?.id !== actor.id)
        return;
    const built = buildPopupDom(token);
    if (!built)
        return;
    // Preserve la-show so the swap doesn't replay the slide-in animation.
    const wasShown = _animEl.classList.contains('la-show');
    _popupEl.innerHTML = '';
    _popupEl.appendChild(built.anim);
    _animEl = built.anim;
    fitPlateName();
    if (wasShown)
    {
        void _animEl.offsetWidth;
        _animEl.classList.add('la-show');
    }
    _placeRight = computePlaceRight(token, scaledPopupWidth(200));
    applyPosition(token);
}

export function registerTokenStatHintSettings()
{
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => syncDockedClass(),
    });
    game.settings.register(MODULE_ID, SETTING_DELAY_MS, {
        scope: 'world',
        config: false,
        type: Number,
        default: 500,
        range: { min: 0, max: 2000, step: 50 },
    });
    game.settings.register(MODULE_ID, SETTING_SCALE, {
        scope: 'world',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0.5, max: 2, step: 0.05 },
        onChange: () =>
        {
            if (_currentToken)
                applyPosition(_currentToken);
        },
    });
    game.settings.register(MODULE_ID, SETTING_PLACEMENT, {
        name: 'LA.settings.tokenStatHintPlacement.name',
        hint: 'LA.settings.tokenStatHintPlacement.hint',
        scope: 'client',
        config: false,
        type: String,
        choices: {
            token: 'LA.settings.tokenStatHintPlacement.choices.token',
            zoom: 'LA.settings.tokenStatHintPlacement.choices.zoom',
            docked: 'LA.settings.tokenStatHintPlacement.choices.docked',
        },
        default: 'docked',
        onChange: () =>
        {
            forceHide();
            syncDockedClass();
        },
    });
    game.settings.register(MODULE_ID, SETTING_EFFECTS_MODE, {
        scope: 'client',
        config: false,
        type: String,
        default: 'names',
        choices: { icons: 'Icons', names: 'Names' },
        onChange: () => forceHide(),
    });
    game.settings.register(MODULE_ID, SETTING_SHOW_CONTROLLED, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, SETTING_COMBAT_ONLY, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, SETTING_LABEL_MODE, {
        scope: 'world',
        config: false,
        type: String,
        default: LABEL_SCAN,
        choices: {
            [LABEL_ACTOR]: 'Always show name',
            [LABEL_SCAN]: 'Tied to scan (shows UNKNOWN until scanned)',
        },
    });
    game.settings.register(MODULE_ID, SETTING_UNKNOWN_LABEL, {
        scope: 'world',
        config: false,
        type: String,
        default: 'UNKNOWN',
    });
    game.settings.register(MODULE_ID, SETTING_HIDE_CLASS_UNKNOWN, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, SETTING_HIDE_CURRENT_ON_SCAN, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, SETTING_HIDE_CURRENT_FROM_ALLIES, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, SETTING_HIDE_CURRENT_FROM_PLAYERS, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, SETTING_SHOW_HASE, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
}

export function initTokenStatHint()
{
    syncDockedClass();
    Hooks.on('hoverToken', (token, hovered) =>
    {
        if (!token?.actor)
            return;
        if (hovered)
            startHover(token);
        else
            endHover(token);
    });

    Hooks.on('controlToken', (token, controlled) =>
    {
        if (controlled && _currentTokenId === token?.id && !showForControlled())
            forceHide();
    });

    Hooks.on('deleteToken', (tokenDoc) =>
    {
        if (_currentTokenId === tokenDoc?.id)
            forceHide();
    });

    Hooks.on('canvasTearDown', () =>
    {
        forceHide();
        SCANNED_MEMO.clear();
    });


    Hooks.on('updateToken', (tokenDoc) =>
    {
        if (_currentTokenId !== tokenDoc?.id)
            return;
        const token = canvas?.tokens?.get(tokenDoc.id);
        if (!token)
            return;
        _currentToken = token;
        applyPosition(token);
    });

    if (!_hookedPan)
    {
        _hookedPan = true;
        Hooks.on('canvasPan', () =>
        {
            if (!_popupEl || !_currentToken)
                return;
            _placeRight = computePlaceRight(_currentToken, scaledPopupWidth(0));
            applyPosition(_currentToken);
        });
        Hooks.on('collapseSidebar', () =>
        {
            if (!_popupEl || !_currentToken)
                return;
            _placeRight = computePlaceRight(_currentToken, scaledPopupWidth(0));
            applyPosition(_currentToken);
        });
        Hooks.on('renderSidebar', () =>
        {
            if (!_popupEl || !_currentToken)
                return;
            _placeRight = computePlaceRight(_currentToken, scaledPopupWidth(0));
            applyPosition(_currentToken);
        });
    }

    if (!_hookedActorUpdate)
    {
        _hookedActorUpdate = true;
        Hooks.on('updateActor', (actor) =>
        {
            if (!isEnabled())
                return;
            rebuildIfVisible(actor);
        });
        for (const hook of /** @type {const} */ (['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']))
        {
            Hooks.on(hook, (effect) =>
            {
                if (isEnabled() && (isDocked() || effect?.statuses?.has(DATALINKED_STATUS)))
                    rebuildIfVisible(effect?.parent);
            });
        }
        for (const hook of /** @type {const} */ (['createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry']))
            Hooks.on(hook, () => SCANNED_MEMO.clear());
        for (const hook of /** @type {const} */ (['createSetting', 'updateSetting', 'deleteSetting']))
        {
            Hooks.on(hook, setting =>
            {
                if (SCAN_SETTING_KEYS.has(setting.key))
                    SCANNED_MEMO.clear();
            });
        }
    }
}
