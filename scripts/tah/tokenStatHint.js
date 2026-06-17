/* global PIXI, canvas, game, Hooks, ui, document, window, CONST */
// Hover popup rendered as fixed-position DOM (browser font hinting = sharp text).

import { playUiSound } from './sound.js';
import {
    isLancerActor as isLancerCombatant,
    isTokenInCombat,
    isTokenVisible,
} from '../utils/lancer-token.js';

const MODULE_ID = 'lancer-automations';
const SETTING_ENABLED = 'tokenStatHintEnabled';
const SETTING_DELAY_MS = 'tokenStatHintDelayMs';
const SETTING_SCALE = 'tokenStatHintScale';
const SETTING_SHOW_CONTROLLED = 'tokenStatHintShowForControlled';
const SETTING_COMBAT_ONLY = 'tokenStatHintCombatOnly';
const SETTING_LABEL_MODE = 'tokenStatHintLabelMode';
const SETTING_UNKNOWN_LABEL = 'tokenStatHintUnknownLabel';

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
const SCAN_MEMO_MS = 1000;

const SCANNED_MEMO = new Map();

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

function isEnabled() {
    try {
        return game.settings.get(MODULE_ID, SETTING_ENABLED) === true;
    } catch {
        return false;
    }
}
function getDelayMs() {
    try {
        const v = Number(game.settings.get(MODULE_ID, SETTING_DELAY_MS));
        return Number.isFinite(v) && v >= 0 ? v : 500;
    } catch {
        return 500;
    }
}
function getUserScale() {
    try {
        const v = Number(game.settings.get(MODULE_ID, SETTING_SCALE));
        return Number.isFinite(v) && v > 0 ? v : 1;
    } catch {
        return 1;
    }
}
function showForControlled() {
    try {
        return game.settings.get(MODULE_ID, SETTING_SHOW_CONTROLLED) !== false;
    } catch {
        return true;
    }
}
function isCombatOnly() {
    try {
        return game.settings.get(MODULE_ID, SETTING_COMBAT_ONLY) === true;
    } catch {
        return false;
    }
}
function getLabelMode() {
    try {
        const v = game.settings.get(MODULE_ID, SETTING_LABEL_MODE);
        if (v === LABEL_ACTOR || v === LABEL_SCAN) {
            return v;
        }
    } catch { /* ignore */ }
    return LABEL_SCAN;
}
function getUnknownLabel() {
    try {
        const v = game.settings.get(MODULE_ID, SETTING_UNKNOWN_LABEL);
        if (typeof v === 'string' && v.trim().length > 0) {
            return v;
        }
    } catch { /* ignore */ }
    return 'UNKNOWN';
}
function isBurnEnabled() {
    try {
        return game.settings.get(MODULE_ID, 'enableBurnIntegration') !== false;
    } catch {
        return true;
    }
}
function isInfectionEnabled() {
    try {
        return game.settings.get(MODULE_ID, 'enableInfectionDamageIntegration') === true;
    } catch {
        return false;
    }
}

function isScannedByUser(actor, user) {
    if (!actor || !user)
        return false;
    const key = `${actor.uuid}|${user.id}`;
    const memo = SCANNED_MEMO.get(key);
    const now = Date.now();
    if (memo && now - memo.at < SCAN_MEMO_MS)
        return memo.value;
    let result = false;
    try {
        for (const entry of game.journal ?? []) {
            const scan = entry.getFlag?.(MODULE_ID, 'scan');
            if (scan?.actorUuid !== actor.uuid)
                continue;
            if (entry.testUserPermission?.(user, 'OBSERVER')) {
                result = true;
                break;
            }
        }
    } catch {
        result = false;
    }
    SCANNED_MEMO.set(key, { at: now, value: result });
    return result;
}
function resolveViewMode(actor) {
    if (game.user.isGM)
        return 'gm';
    try {
        if (actor?.testUserPermission?.(game.user, 'OBSERVER'))
            return 'scanned';
    } catch { /* ignore */ }
    if (isScannedByUser(actor, game.user))
        return 'scanned';
    return 'unknown';
}

// Mirrors TAH's logic in hud.js:268-299.
function getDispositionInfo(token) {
    if (!token?.document)
        return null;
    try {
        const tfActive = game.modules.get('token-factions')?.active;
        const tfAdvanced = tfActive
            && game.settings.get('token-factions', 'color-from') === 'advanced-factions';
        if (tfAdvanced) {
            const teamId = token.document.getFlag?.('token-factions', 'team')
                || token.actor?.prototypeToken?.flags?.['token-factions']?.team;
            if (teamId) {
                const teams = game.settings.get('token-factions', 'team-setup') || [];
                const team = teams.find(t => t.id === teamId);
                if (team)
                    return { color: team.color, label: team.name };
            }
        }
    } catch { /* ignore */ }
    const disp = token.document.disposition;
    const map = {
        [CONST.TOKEN_DISPOSITIONS.HOSTILE]:  { color: '#e53935', label: 'Hostile' },
        [CONST.TOKEN_DISPOSITIONS.NEUTRAL]:  { color: '#f9a825', label: 'Neutral' },
        [CONST.TOKEN_DISPOSITIONS.FRIENDLY]: { color: '#43a047', label: 'Friendly' },
        [CONST.TOKEN_DISPOSITIONS.SECRET]:   { color: '#7e57c2', label: 'Secret' },
    };
    return map[disp] ?? { color: '#888', label: 'Unknown' };
}

function effectiveHpMax(actor) {
    const sys = actor?.system;
    if (!sys)
        return 0;
    const max = sys.hp?.max ?? 0;
    const val = Math.max(0, sys.hp?.value ?? 0);
    const os = Math.max(0, sys.overshield?.value ?? 0);
    return Math.max(max, val, os);
}
function getStatsForActor(actor) {
    const sys = actor?.system ?? {};
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
        reaction: sys.action_tracker?.reaction === true,
        overcharge: sys.overcharge ?? 0,
        ocSequence: sys.overcharge_sequence ?? null,
        coreEnergy: sys.core_energy,
        coreActive: sys.core_active === true,
        hasRepairs: sys.repairs != null,
        repairs: sys.repairs?.value ?? 0,
        repairsMax: sys.repairs?.max ?? 0,
        pilotStressVal: sys.bond_state?.stress?.value ?? 0,
        pilotStressMax: sys.bond_state?.stress?.max ?? 0,
        tier: sys.tier,
    };
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}
function rgbToHex(r, g, b) {
    const h = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}
function hpColorCss(val, max) {
    if (max <= 0)
        return '#cccccc';
    const t = Math.max(0, Math.min(1, val / max));
    if (t < 0.5) {
        const k = t * 2;
        return rgbToHex(lerp(244, 255, k), lerp(67, 215, k), lerp(54, 0, k));
    }
    const k = (t - 0.5) * 2;
    return rgbToHex(lerp(255, 76, k), lerp(215, 175, k), lerp(0, 80, k));
}
function heatColorCss(val, max) {
    if (max <= 0)
        return '#888888';
    const t = Math.max(0, Math.min(1, val / max));
    if (t < 1 / 3) {
        const k = t * 3;
        return rgbToHex(lerp(136, 255, k), lerp(136, 215, k), lerp(136, 0, k));
    }
    if (t < 2 / 3) {
        const k = (t - 1 / 3) * 3;
        return rgbToHex(255, lerp(215, 140, k), 0);
    }
    const k = (t - 2 / 3) * 3;
    return rgbToHex(lerp(255, 244, k), lerp(140, 67, k), lerp(0, 54, k));
}
function ocColorCss(value, max) {
    if (max <= 0)
        return '#cccccc';
    const t = Math.min(1, value / max);
    return rgbToHex(lerp(204, 244, t), lerp(170, 67, t), lerp(50, 54, t));
}
function corePowerColor(energy, active) {
    if (energy > 0)
        return active ? '#a855f7' : '#3a9e6e';
    return '#555';
}
function signed(n) {
    return n >= 0 ? `+${n}` : `${n}`;
}
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function svgIcon(url, color = '#fff') {
    return `<img class="la-stat-hint-icon" src="${url}" style="filter: brightness(0) saturate(100%) invert(1);" data-color="${esc(color)}">`;
}
function cciIcon(name, color) {
    return `<i class="cci ${name}" style="color:${esc(color)};font-size:18px;line-height:1;"></i>`;
}
function glyph(ch, color, size = 16) {
    return `<span class="la-stat-hint-glyph" style="color:${esc(color)};font-size:${size}px;line-height:1;">${esc(ch)}</span>`;
}
function mdi(name, color) {
    return `<i class="mdi ${name}" style="color:${esc(color)};font-size:18px;line-height:1;"></i>`;
}
function cell(iconHtml, value, color = '#ddd') {
    return `<span class="la-stat-hint-cell">${iconHtml}<span class="la-stat-hint-val" style="color:${esc(color)};">${esc(value)}</span></span>`;
}

function buildHeaderHtml(token, mode) {
    const actor = token.actor;
    const isNpc = actor?.type === 'npc';
    const isOwnSide = actor?.type === 'pilot' || actor?.type === 'mech';
    const labelMode = getLabelMode();
    const isUnknown = (mode === 'unknown-stable' || mode === 'unknown-damaged');

    let label = token.document?.name || actor?.name || 'UNKNOWN';
    let tierBadge = '';

    if (isUnknown) {
        // SCAN-tied mode reveals nothing about NPC/deployable until scanned.
        if (!isOwnSide && labelMode === LABEL_SCAN) {
            label = getUnknownLabel();
        }
        return `<div class="la-stat-hint-header la-unknown"><s class="horus--subtle" style="opacity:0.85;color:#e50000;text-decoration:none;">${esc(String(label).toUpperCase())}</s></div>`;
    }

    if (isNpc) {
        const t = Number(actor.system?.tier) || 1;
        tierBadge = `<span class="la-stat-hint-tier">T${t}</span>`;
    } else if (actor?.type === 'pilot') {
        const ll = Number(actor.system?.level) || 0;
        tierBadge = `<span class="la-stat-hint-tier">LL${ll}</span>`;
    } else if (actor?.type === 'mech') {
        const pilot = actor.system?.pilot?.value;
        const ll = pilot ? (Number(pilot.system?.level) || 0) : null;
        if (ll !== null) {
            tierBadge = `<span class="la-stat-hint-tier">LL${ll}</span>`;
        }
    }
    return `<div class="la-stat-hint-header">${tierBadge}<span class="la-stat-hint-name">${esc(String(label).toUpperCase())}</span></div>`;
}

function buildRevealRowsHtml(actor, s) {
    const burnOn = isBurnEnabled();
    const infOn = isInfectionEnabled();
    const rows = [];

    const dimColor = '#555';
    const isMechOrNpc = s.type === 'mech' || s.type === 'npc';

    {
        const parts = [];
        if (s.structMax > 0) {
            parts.push(cell(cciIcon('cci-structure', '#e8d060'),
                `${s.structVal}/${s.structMax}`, '#e8d060'));
        }
        const hpC = hpColorCss(s.hpVal, s.hpNominalMax || s.hpMax);
        parts.push(cell(glyph('♥', hpC, 16), `${s.hpVal}/${s.hpNominalMax}`, hpC));
        if (burnOn) {
            const burnCol = s.burn > 0 ? '#d74242' : dimColor;
            parts.push(cell(cciIcon('cci-burn', burnCol), String(s.burn), burnCol));
        }
        const osCol = s.overshield > 0 ? '#60a5fa' : dimColor;
        parts.push(cell(glyph('🛡', osCol, 16), String(s.overshield), osCol));
        if (isMechOrNpc) {
            parts.push(cell(svgIcon(ICON.armor), String(s.armor)));
        }
        rows.push(parts.join(''));
    }

    {
        const parts = [];
        if (s.stressMax > 0) {
            parts.push(cell(cciIcon('cci-reactor', '#e07830'),
                `${s.stressVal}/${s.stressMax}`, '#e07830'));
        }
        if (s.heatMax > 0) {
            const hC = heatColorCss(s.heatVal, s.heatMax);
            parts.push(cell(glyph('🌡', hC, 16), `${s.heatVal}/${s.heatMax}`, hC));
        } else if (s.type === 'pilot' && s.pilotStressMax > 0) {
            parts.push(cell(mdi('mdi-brain', '#d9b800'),
                `${s.pilotStressVal}/${s.pilotStressMax}`, '#d9b800'));
        }
        if (infOn) {
            const infCol = s.infection > 0 ? '#1a8a3a' : dimColor;
            parts.push(cell(glyph('☣', infCol, 16), String(s.infection), infCol));
        }
        if (s.type !== 'deployable') {
            const rc = s.reaction ? '#a855f7' : dimColor;
            parts.push(cell(`<img class="la-stat-hint-icon" src="${ICON.reaction}" style="filter:brightness(0) saturate(100%) invert(1);opacity:${s.reaction ? 1 : 0.4};">`,
                s.reaction ? '1' : '0', rc));
        }
        if (parts.length)
            rows.push(parts.join(''));
    }

    if (isMechOrNpc) {
        // NPCs absorb Save here so they don't get a lone row 4.
        const parts = [
            cell(mdi('mdi-arrow-right-bold-hexagon-outline', '#fff'), String(s.speed)),
            cell(svgIcon(ICON.evasion), String(s.evasion)),
            cell(svgIcon(ICON.edef),    String(s.edef)),
            cell(svgIcon(ICON.sensors), String(s.sensors)),
        ];
        if (s.type === 'npc') {
            parts.push(cell(svgIcon(ICON.save), signed(s.save)));
        }
        rows.push(parts.join(''));
    }

    if (s.type === 'mech') {
        const parts = [cell(svgIcon(ICON.save), signed(s.save))];
        const ocSeq = typeof s.ocSequence === 'string'
            ? s.ocSequence.split(',').map(x => x.trim())
            : [];
        if (ocSeq.length > 0) {
            const ocLabel = ocSeq[Math.min(s.overcharge, ocSeq.length - 1)] ?? '—';
            const ocCol = ocColorCss(s.overcharge, Math.max(1, ocSeq.length - 1));
            parts.push(cell(cciIcon('cci-overcharge', ocCol), String(ocLabel), ocCol));
        }
        if (s.hasRepairs) {
            const rCol = s.repairs > 0 ? '#66cc66' : '#555';
            const rLabel = s.repairsMax > 0
                ? `${s.repairs}/${s.repairsMax}`
                : String(s.repairs);
            parts.push(cell(svgIcon(ICON.repair), rLabel, rCol));
        }
        if (s.coreEnergy != null) {
            const cc = corePowerColor(s.coreEnergy, s.coreActive);
            const label = s.coreEnergy > 0 ? (s.coreActive ? 'ON' : '✓') : '✗';
            parts.push(cell(svgIcon(ICON.corePwr), label, cc));
        }
        rows.push(parts.join(''));
    }

    return rows.map(r => `<div class="la-stat-hint-row">${r}</div>`).join('');
}

// Unknown view: vitals only. Struct/Stress as val/max, HP/Heat as deltas
// so the maxes don't leak.
function buildDamagedRowsHtml(actor, s) {
    const burnOn = isBurnEnabled();
    const infOn = isInfectionEnabled();
    const dimColor = '#555';
    const rows = [];

    {
        const parts = [];
        if (s.structMax > 0) {
            parts.push(cell(cciIcon('cci-structure', '#e8d060'),
                `${s.structVal}/${s.structMax}`, '#e8d060'));
        }
        if (s.hpNominalMax > 0 && s.hpVal < s.hpNominalMax) {
            parts.push(cell(glyph('♥', '#d74242', 16),
                `-${s.hpNominalMax - s.hpVal}`, '#d74242'));
        }
        if (burnOn) {
            const burnCol = s.burn > 0 ? '#d74242' : dimColor;
            parts.push(cell(cciIcon('cci-burn', burnCol), String(s.burn), burnCol));
        }
        const osCol = s.overshield > 0 ? '#60a5fa' : dimColor;
        parts.push(cell(glyph('🛡', osCol, 16), String(s.overshield), osCol));
        rows.push(parts.join(''));
    }
    {
        const parts = [];
        if (s.stressMax > 0) {
            parts.push(cell(cciIcon('cci-reactor', '#e07830'),
                `${s.stressVal}/${s.stressMax}`, '#e07830'));
        }
        if (s.heatMax > 0 && s.heatVal > 0) {
            parts.push(cell(glyph('🌡', '#ff8a00', 16),
                `+${s.heatVal}`, '#ff8a00'));
        }
        if (infOn) {
            const infCol = s.infection > 0 ? '#1a8a3a' : dimColor;
            parts.push(cell(glyph('☣', infCol, 16), String(s.infection), infCol));
        }
        if (parts.length) {
            rows.push(parts.join(''));
        }
    }
    return rows.map(r => `<div class="la-stat-hint-row">${r}</div>`).join('');
}

function ensureStyleSheet() {
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
    transform-origin: var(--la-hint-origin, 0% 50%);
    transform: scale(var(--la-hint-scale, 1));
}
.la-stat-hint-anim {
    background: rgba(13, 13, 13, 0.92);
    border: 1px solid #666;
    border-radius: 4px;
    opacity: 0;
    transform: translateX(var(--la-hint-slide-from, 28px));
    transition: opacity 200ms ease-out, transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
    overflow: hidden;
    min-width: 150px;
    max-width: 420px;
    display: flex;
    align-items: stretch;
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
    align-items: center;
    gap: 6px;
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
    justify-content: center;
}
.la-stat-hint-tier { color: #ffaa55; font-weight: 600; }
.la-stat-hint-name { color: #eeeeee; }
.la-stat-hint-rows {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 9px;
}
.la-stat-hint-row {
    display: flex;
    align-items: center;
    gap: 11px;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1;
    color: #ddd;
    font-weight: 400;
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
`;
    const el = document.createElement('style');
    el.id = 'la-stat-hint-styles';
    el.textContent = css;
    document.head.appendChild(el);
}

function buildPopupDom(token) {
    const actor = token.actor;
    if (!actor)
        return null;
    const mode = resolveViewMode(actor);
    const s = getStatsForActor(actor);

    let viewMode = mode;
    let headerHtml;
    let rowsHtml = '';
    if (mode === 'gm' || mode === 'scanned') {
        headerHtml = buildHeaderHtml(token, 'reveal');
        rowsHtml = `<div class="la-stat-hint-rows">${buildRevealRowsHtml(actor, s)}</div>`;
    } else {
        viewMode = 'unknown';
        headerHtml = buildHeaderHtml(token, 'unknown-damaged');
        rowsHtml = `<div class="la-stat-hint-rows">${buildDamagedRowsHtml(actor, s)}</div>`;
    }

    const popup = document.createElement('div');
    popup.className = 'la-stat-hint-popup';
    const anim = document.createElement('div');
    anim.className = 'la-stat-hint-anim';
    const disp = getDispositionInfo(token);
    const stripeHtml = disp
        ? `<div class="la-stat-hint-stripe" style="background:${esc(disp.color)};" title="${esc(disp.label)}"></div>`
        : '';
    anim.innerHTML = `${stripeHtml}<div class="la-stat-hint-body">${headerHtml}${rowsHtml}</div>`;
    popup.appendChild(anim);
    popup.dataset.viewMode = viewMode;
    popup.dataset.tokenId = token.id;
    return { popup, anim };
}

function usableScreenBounds() {
    const viewW = window.innerWidth;
    let leftEdge = 0;
    let rightEdge = viewW;
    try {
        const controls = document.getElementById('controls')
            || document.querySelector('#ui-left')
            || document.querySelector('#scene-controls');
        if (controls) {
            const r = controls.getBoundingClientRect();
            if (r.width > 0 && r.right > leftEdge && r.left < viewW * 0.4) {
                leftEdge = r.right;
            }
        }
    } catch { /* ignore */ }
    try {
        const sidebar = document.getElementById('sidebar')
            || ui?.sidebar?.element
            || document.getElementById('ui-right');
        if (sidebar) {
            const r = sidebar.getBoundingClientRect();
            if (r.width > 0 && r.left > viewW * 0.5 && r.left < rightEdge) {
                rightEdge = r.left;
            }
        }
    } catch { /* ignore */ }
    return { left: leftEdge, right: rightEdge, width: Math.max(0, rightEdge - leftEdge) };
}

function tokenScreenRect(token) {
    if (!canvas?.stage || !canvas.app?.view || !token) {
        return { left: 0, top: 0, right: 0, bottom: 0, w: 0, h: 0, cy: 0 };
    }
    // toGlobal handles pivot/skew that plain stage.position+scale would miss.
    const tx = token.x ?? 0;
    const ty = token.y ?? 0;
    const tw = token.w ?? 0;
    const th = token.h ?? 0;
    const topLeft = canvas.stage.toGlobal(new PIXI.Point(tx, ty));
    const bottomRight = canvas.stage.toGlobal(new PIXI.Point(tx + tw, ty + th));
    const view = canvas.app.view;
    const r = view.getBoundingClientRect?.() ?? { left: 0, top: 0, width: view.width, height: view.height };
    // widthRatio = 1/dpr when autoDensity=false. Yields CSS pixels in both modes.
    const widthRatio = view.width > 0 ? (r.width / view.width) : 1;
    const cssScale = widthRatio > 0 ? widthRatio : 1;
    const left = r.left + topLeft.x * cssScale;
    const top = r.top + topLeft.y * cssScale;
    const right = r.left + bottomRight.x * cssScale;
    const bottom = r.top + bottomRight.y * cssScale;
    return { left, top, right, bottom, w: right - left, h: bottom - top, cy: (top + bottom) / 2 };
}

// Right-by-default. Flips only when the right side cannot show even half.
function computePlaceRight(token, popupScreenW) {
    if (!canvas?.stage || !token)
        return true;
    const rect = tokenScreenRect(token);
    const bounds = usableScreenBounds();
    const gap = ANCHOR_GAP * getUserScale();
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

function applyPosition(token) {
    if (!_popupEl || !token || token.destroyed)
        return;
    const rect = tokenScreenRect(token);
    const anchorX = _placeRight ? rect.right : rect.left;
    const anchorY = rect.cy;
    const us = getUserScale();
    const popW = _popupEl.offsetWidth || 0;
    const popH = _popupEl.offsetHeight || 0;
    if (_placeRight) {
        _popupEl.style.left = `${anchorX + ANCHOR_GAP * us}px`;
        _popupEl.style.top = `${anchorY - (popH * us) / 2}px`;
        _popupEl.style.setProperty('--la-hint-origin', '0% 50%');
        _popupEl.style.setProperty('--la-hint-slide-from', `${SLIDE_OFFSET}px`);
    } else {
        _popupEl.style.left = `${anchorX - ANCHOR_GAP * us - popW * us}px`;
        _popupEl.style.top = `${anchorY - (popH * us) / 2}px`;
        _popupEl.style.setProperty('--la-hint-origin', '100% 50%');
        _popupEl.style.setProperty('--la-hint-slide-from', `${-SLIDE_OFFSET}px`);
    }
    _popupEl.style.setProperty('--la-hint-scale', String(us));
}

function clearDelay() {
    if (_delayTimer) {
        clearTimeout(_delayTimer); _delayTimer = null;
    }
}
function clearOutTimer() {
    if (_outTimer) {
        clearTimeout(_outTimer); _outTimer = null;
    }
}
function shouldShowHintFor(token) {
    if (!isEnabled()) {
        return false;
    }
    if (!token?.actor) {
        return false;
    }
    if (!isLancerCombatant(token.actor)) {
        return false;
    }
    if (token.controlled && !showForControlled()) {
        return false;
    }
    if (isCombatOnly() && !isTokenInCombat(token)) {
        return false;
    }
    if (!isTokenVisible(token)) {
        return false;
    }
    return true;
}

function destroyPopup() {
    clearOutTimer();
    _stopTahWatch();
    if (_popupEl && _popupEl.parentNode) {
        _popupEl.parentNode.removeChild(_popupEl);
    }
    _popupEl = null;
    _animEl = null;
}

function forceHide() {
    clearDelay();
    destroyPopup();
    _state = 'idle';
    _currentTokenId = null;
    _currentToken = null;
}

// hoverToken only fires over the canvas, so cursor sliding onto #la-hud leaks the popup.
function _startTahWatch() {
    if (_tahWatch) {
        return;
    }
    _tahWatch = (ev) => {
        if (ev.target?.closest?.('#la-hud')) {
            _hideOnTahEnter();
        }
    };
    document.addEventListener('mouseover', _tahWatch, true);
}

function _stopTahWatch() {
    if (!_tahWatch) {
        return;
    }
    document.removeEventListener('mouseover', _tahWatch, true);
    _tahWatch = null;
}

function _hideOnTahEnter() {
    if (_state === 'idle' || _state === 'out') {
        return;
    }
    if (_state === 'delay') {
        clearDelay();
        _state = 'idle';
        _currentTokenId = null;
        _stopTahWatch();
        return;
    }
    _state = 'out';
    animateOut(() => {
        if (_state === 'out') {
            _state = 'idle';
            _currentTokenId = null;
            _currentToken = null;
        }
        _stopTahWatch();
    });
}

function showFor(token) {
    ensureStyleSheet();
    destroyPopup();
    const built = buildPopupDom(token);
    if (!built)
        return;
    _popupEl = built.popup;
    _animEl = built.anim;
    document.body.appendChild(_popupEl);
    _currentToken = token;

    const popW = _popupEl.offsetWidth || 200;
    _placeRight = computePlaceRight(token, popW * getUserScale());
    applyPosition(token);

    _state = 'in';
    playUiSound('details');
    _startTahWatch();
    void _animEl.offsetWidth;
    _animEl.classList.add('la-show');
    setTimeout(() => {
        if (_state === 'in') {
            _state = 'visible';
        }
    }, 240);
}

function startHover(token) {
    if (!shouldShowHintFor(token))
        return;
    clearDelay();
    if (_state === 'visible' && _currentTokenId && _currentTokenId !== token.id) {
        animateOut(() => {
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

function scheduleShow(token) {
    clearDelay();
    const delay = getDelayMs();
    _state = 'delay';
    _delayTimer = setTimeout(() => {
        _delayTimer = null;
        if (_currentTokenId !== token.id)
            return;
        if (!shouldShowHintFor(token)) {
            _state = 'idle';
            _currentTokenId = null;
            return;
        }
        showFor(token);
    }, delay);
}

function animateOut(done) {
    clearOutTimer();
    if (!_animEl || !_popupEl) {
        done?.(); return;
    }
    _animEl.classList.remove('la-show');
    _outTimer = setTimeout(() => {
        _outTimer = null;
        destroyPopup();
        done?.();
    }, 220);
}

function endHover(token) {
    if (_currentTokenId !== token?.id)
        return;
    clearDelay();
    if (_state === 'delay') {
        _state = 'idle';
        _currentTokenId = null;
        return;
    }
    if (!_popupEl) {
        _state = 'idle';
        _currentTokenId = null;
        return;
    }
    _state = 'out';
    playUiSound('details');
    animateOut(() => {
        if (_state === 'out') {
            _state = 'idle';
            _currentTokenId = null;
            _currentToken = null;
        }
    });
}

function rebuildIfVisible(actor) {
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
    if (wasShown) {
        void _animEl.offsetWidth;
        _animEl.classList.add('la-show');
    }
    const popW = _popupEl.offsetWidth || 200;
    _placeRight = computePlaceRight(token, popW * getUserScale());
    applyPosition(token);
}

export function registerTokenStatHintSettings() {
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        name: 'Enable Token Stat Hint',
        hint: 'Hover popup showing stats for hovered tokens.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, SETTING_DELAY_MS, {
        name: 'Hover Delay (ms)',
        hint: 'Delay before the popup appears on hover.',
        scope: 'world',
        config: false,
        type: Number,
        default: 500,
        range: { min: 0, max: 2000, step: 50 },
    });
    game.settings.register(MODULE_ID, SETTING_SCALE, {
        name: 'Popup Scale',
        hint: 'Visual scale of the popup. 1 is default, lower shrinks, higher grows.',
        scope: 'world',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0.5, max: 2, step: 0.05 },
        onChange: () => {
            if (_currentToken)
                applyPosition(_currentToken);
        },
    });
    game.settings.register(MODULE_ID, SETTING_SHOW_CONTROLLED, {
        name: 'Show for Controlled Token',
        hint: 'When off, the popup is suppressed for the token you currently control.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID, SETTING_COMBAT_ONLY, {
        name: 'Show Only In Combat',
        hint: 'Suppress the popup outside of an active combat.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID, SETTING_LABEL_MODE, {
        name: 'Header Label (NPC)',
        hint: 'How to display the NPC token name in the popup header.',
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
        name: 'Unknown Label',
        hint: 'Text shown in the header when label mode is Tied to scan and the token is not scanned.',
        scope: 'world',
        config: false,
        type: String,
        default: 'UNKNOWN',
    });
}

export function initTokenStatHint() {
    Hooks.on('hoverToken', (token, hovered) => {
        if (!token?.actor)
            return;
        if (hovered)
            startHover(token);
        else
            endHover(token);
    });

    Hooks.on('controlToken', (token, controlled) => {
        if (controlled && _currentTokenId === token?.id && !showForControlled())
            forceHide();
    });

    Hooks.on('deleteToken', (tokenDoc) => {
        if (_currentTokenId === tokenDoc?.id)
            forceHide();
    });

    Hooks.on('canvasTearDown', () => {
        forceHide();
        SCANNED_MEMO.clear();
    });

    Hooks.on('updateToken', (tokenDoc) => {
        if (_currentTokenId !== tokenDoc?.id)
            return;
        const tok = canvas?.tokens?.get(tokenDoc.id);
        if (!tok)
            return;
        _currentToken = tok;
        applyPosition(tok);
    });

    if (!_hookedPan) {
        _hookedPan = true;
        Hooks.on('canvasPan', () => {
            if (!_popupEl || !_currentToken)
                return;
            const popW = _popupEl.offsetWidth || 0;
            _placeRight = computePlaceRight(_currentToken, popW * getUserScale());
            applyPosition(_currentToken);
        });
        Hooks.on('collapseSidebar', () => {
            if (!_popupEl || !_currentToken)
                return;
            const popW = _popupEl.offsetWidth || 0;
            _placeRight = computePlaceRight(_currentToken, popW * getUserScale());
            applyPosition(_currentToken);
        });
        Hooks.on('renderSidebar', () => {
            if (!_popupEl || !_currentToken)
                return;
            const popW = _popupEl.offsetWidth || 0;
            _placeRight = computePlaceRight(_currentToken, popW * getUserScale());
            applyPosition(_currentToken);
        });
    }

    if (!_hookedActorUpdate) {
        _hookedActorUpdate = true;
        Hooks.on('updateActor', (actor) => {
            if (!isEnabled())
                return;
            rebuildIfVisible(actor);
        });
        Hooks.on('updateJournalEntry', () => {
            SCANNED_MEMO.clear();
        });
    }
}
