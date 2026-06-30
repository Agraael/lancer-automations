/*global game, canvas, Hooks, foundry */

import { getMaxWeaponReach_WithBonus, getActorMaxThreat, getMaxItemRanges_WithBonus, getMaxWeaponRanges_WithBonus, getWeaponProfiles_WithBonus } from '../tools/misc-tools.js';
import { scaleAuraStroke as _scaleAuraStroke } from '../tools/aura.js';
import { createPulsingRangeHighlight } from '../interactive/canvas.js';

// ── Range preview (pulsing highlight) ────────────────────────────────────────────

function hasGAAFork() {
    const mod = game.modules.get('grid-aware-auras');
    if (!mod)
        return false;
    const url = /** @type {any} */ (mod).url ?? '';
    const version = /** @type {any} */ (mod).version ?? '';
    return (typeof url === 'string' && url.includes('Agraael'))
        || (typeof version === 'string' && version.split('.').length >= 4);
}

let _warnedMissingFork = false;
function getTHTConfig() {
    let useAlt = false;
    try {
        useAlt = !!game.settings.get('lancer-automations', 'tah.auraUseAltKey');
    } catch { /* settings not ready */ }
    // Default off (or opt-in without the fork): disable THT rulers entirely to avoid always-drawn on upstream.
    if (!useAlt || !hasGAAFork()) {
        if (useAlt && !_warnedMissingFork) {
            _warnedMissingFork = true;
            ui.notifications.warn("TAH: 'Aura THT Ruler on Alt Press' requires the grid-aware-auras fork — THT rulers disabled.");
        }
        return { rulerOnDrag: "NONE", targetTokens: "", onlyWhenAltPressed: false, onlyWhenTargeted: false };
    }
    return { rulerOnDrag: "E2E", targetTokens: "", onlyWhenAltPressed: true, onlyWhenTargeted: true };
}

function hasGAA() {
    return !!game.modules.get('grid-aware-auras')?.active;
}

const _rangePreviewDestroyByTokenId = new Map();
const _rangePreviewOwnerByTokenId = new Map();

export async function activateRangePreview(token, range, ownerEl = null) {
    if (!token || range == null)
        return;
    deactivateRangePreview(token);
    const radius = Math.max(1, range);
    const destroy = createPulsingRangeHighlight(token, radius, { includeSelf: false });
    _rangePreviewDestroyByTokenId.set(token.id, destroy);
    if (ownerEl)
        _rangePreviewOwnerByTokenId.set(token.id, ownerEl);
}

export function deactivateRangePreview(token) {
    if (!token)
        return;
    _rangePreviewOwnerByTokenId.delete(token.id);
    const destroy = _rangePreviewDestroyByTokenId.get(token.id);
    if (!destroy)
        return;
    try { destroy(); } catch { /* ignore */ }
    _rangePreviewDestroyByTokenId.delete(token.id);
}

// Drop previews whose source row left the DOM (its column closed).
export function cleanupDetachedRangePreviews() {
    for (const [tokenId, ownerEl] of _rangePreviewOwnerByTokenId) {
        if (ownerEl?.isConnected)
            continue;
        const destroy = _rangePreviewDestroyByTokenId.get(tokenId);
        try { destroy?.(); } catch { /* ignore */ }
        _rangePreviewDestroyByTokenId.delete(tokenId);
        _rangePreviewOwnerByTokenId.delete(tokenId);
    }
}

// ── Range computation ──────────────────────────────────────────────────────────

/** Sensor range for an actor (synchronous). */
function getSensorRange(actor) {
    if (!actor)
        return 10;
    if (actor.type === 'pilot')
        return 5;
    return actor.system?.sensor_range ?? 10;
}

// Fixed range-1 melee/utility actions; no card range preview for these.
export const FIXED_MELEE_ACTIONS = new Set(['ram', 'ramming speed', 'grapple', 'improvised attack', 'pick up weapon', 'pickup weapon']);

/**
 * Compute the range to preview for an attack action.
 * Returns null if no preview should be shown.
 * @param {string|undefined} actionName
 * @param {any} actor
 * @param {any|null} item
 * @returns {Promise<number|null>}
 */
export async function getAttackRange(actionName, actor, item) {
    const name = (actionName ?? '').toLowerCase().trim();

    // No preview
    if (name === 'basic attack' || name === 'damage')
        return null;

    // Fixed range 1
    if (FIXED_MELEE_ACTIONS.has(name))
        return 1;

    // Skirmish / Barrage / Thrown — max weapon reach (includes throw tag) with bonuses
    if (name === 'skirmish' || name === 'barrage' || name === 'thrown' || name === 'throw') {
        const input = item ?? actor;
        if (!input)
            return 1;
        return Math.max(1, await getMaxWeaponReach_WithBonus(input));
    }

    // Generic: if weapon item provided, use its max reach
    if (item) {
        const reach = await getMaxWeaponReach_WithBonus(item);
        if (reach > 0)
            return Math.max(1, reach);
    }

    return null;
}

/** Max across all range types from a getMaxItemRanges_WithBonus result, min 0. */
async function getItemMaxReach(item, actor) {
    const ranges = await getMaxItemRanges_WithBonus(item, actor);
    const ALL_TYPES = ['Range', 'Line', 'Cone', 'Blast', 'Burst', 'Threat', 'Thrown', 'Deploy'];
    return Math.max(0, ...ALL_TYPES.map(rangeType => ranges[rangeType] ?? 0));
}

/**
 * Dispatch preview range based on category and hoverData fields.
 * If profile is present, uses profile.range directly.
 * If item is present (no profile), uses getMaxItemRanges_WithBonus.
 * Category rules apply only when item is null.
 * Returns null if no preview should be shown for this row.
 * @param {string|undefined} category
 * @param {string|undefined} actionName
 * @param {any} actor
 * @param {any|null} item
 * @param {any|null} [profile]
 * @returns {Promise<number|null>}
 */
async function computePreviewRange(category, actionName, actor, item, profile) {
    // Deployables: placement range from deployRange flag, default 1 (ignore item range tags)
    if (category === 'Deployables') {
        const deployRange = item?.getFlag?.('lancer-automations', 'deployRange') ?? 1;
        return Math.max(1, deployRange);
    }

    // Specific profile → use profile's own range array
    if (profile?.range?.length) {
        const max = Math.max(0, ...profile.range.map(rangeEntry => Number(rangeEntry.val) || 0));
        return max > 0 ? Math.max(1, max) : null;
    }

    // Item present → use its range if it has one, otherwise fall through to category rules
    if (item) {
        const reach = await getItemMaxReach(item, actor);
        if (reach > 0)
            return Math.max(1, reach);
    }

    // No item range (or no item) — category/action-specific rules
    if (category === 'Tech')
        return getSensorRange(actor);

    if (category === 'Actions') {
        const name = (actionName ?? '').toLowerCase().trim();
        if (name === 'overwatch')
            return Math.max(1, await getActorMaxThreat(actor));
        return null;
    }

    if (category === 'Attacks')
        return getAttackRange(actionName, actor, null);

    return null;
}

// ── Persistent range auras (Threat / Sensors / Weapon Range / Custom Measure) ─

const AURA_DEFS = {
    LA_max_Threat: {
        settingColor: 'tah.auraColorThreat',
        settingOpacity: 'tah.auraOpacityThreat',
        settingDefault: 'tah.auraDefaultThreat',
        defaultColor: '#9514ff',
        lineDashSize: 15,
        lineGapSize: 15,
        getRadius: (actor) => getActorMaxThreat(actor),
    },
    LA_Sensor: {
        settingColor: 'tah.auraColorSensor',
        settingOpacity: 'tah.auraOpacitySensor',
        settingDefault: 'tah.auraDefaultSensor',
        defaultColor: '#549eff',
        lineDashSize: 11,
        lineGapSize: 11,
        getRadius: (actor) => actor?.system?.sensor_range ?? (actor?.type === 'pilot' ? 5 : 10),
    },
    LA_max_range: {
        settingColor: 'tah.auraColorRange',
        settingOpacity: 'tah.auraOpacityRange',
        settingDefault: 'tah.auraDefaultRange',
        defaultColor: '#ff0000',
        lineDashSize: 13,
        lineGapSize: 13,
        getRadius: (actor, token) => {
            const overrideId = token?.document?.getFlag?.('lancer-automations', 'weaponRangeItemId');
            if (overrideId) {
                const item = actor?.items?.get(overrideId);
                if (item) {
                    const profiles = getWeaponProfiles_WithBonus(item, actor);
                    return Math.max(0, ...profiles.flatMap(/** @type {any} */ profile => (profile.range ?? []).map(/** @type {any} */ rangeEntry => Number(rangeEntry.val) || 0)));
                }
            }
            const ranges = getMaxWeaponRanges_WithBonus(actor);
            return Math.max(0, ...Object.entries(ranges)
                .filter(([rangeType]) => rangeType !== 'Threat')
                .map(([, rangeValue]) => rangeValue));
        },
    },
    LA_custom_measure: {
        settingColor: 'tah.auraColorCustom',
        settingOpacity: 'tah.auraOpacityCustom',
        settingDefault: null,
        defaultColor: '#ff8800',
        lineDashSize: 8,
        lineGapSize: 8,
        getRadius: (_actor, token) => {
            const val = token?.document?.getFlag?.('lancer-automations', 'customMeasureSize');
            return val ?? 10;
        },
    },
};

function _teamKey(token) {
    if (game.modules.get('token-factions')?.active) {
        const teamId = token?.document?.getFlag?.('token-factions', 'team')
            ?? token?.actor?.prototypeToken?.flags?.['token-factions']?.team
            ?? token?.actor?.getFlag?.('token-factions', 'team');
        if (teamId)
            return `tf_${teamId}`;
    }
    return `d${token?.document?.disposition ?? 0}`;
}

function _teamSuffixedName(baseName, token) {
    return `${baseName}__t${_teamKey(token)}`;
}

async function _renameStaleTeamAuras(tokenDoc) {
    if (!hasGAA() || !tokenDoc)
        return;
    const token = tokenDoc.object ?? canvas.tokens?.get?.(tokenDoc.id);
    if (!token)
        return;
    const auras = tokenDoc.getFlag('grid-aware-auras', 'auras') ?? [];
    if (!auras.length)
        return;
    let changed = false;
    const next = auras.map(auraCfg => {
        for (const baseName of Object.keys(AURA_DEFS)) {
            const prefix = `${baseName}__t`;
            const isMatch = auraCfg.name === baseName || (typeof auraCfg.name === 'string' && auraCfg.name.startsWith(prefix));
            if (!isMatch)
                continue;
            const expected = _teamSuffixedName(baseName, token);
            if (auraCfg.name !== expected) {
                changed = true;
                return { ...auraCfg, name: expected };
            }
            break;
        }
        return auraCfg;
    });
    if (changed)
        await tokenDoc.setFlag('grid-aware-auras', 'auras', next);
}

function _hexToInt(hex) {
    if (typeof hex !== 'string')
        return 0xffffff;
    const m = /#?([0-9a-f]{6})/i.exec(hex);
    return m ? Number.parseInt(m[1], 16) : 0xffffff;
}

function _buildPersistentTemplate(auraName, token) {
    const def = AURA_DEFS[auraName];
    if (!def)
        return null;
    let color = def.defaultColor;
    let opacity = 1;
    try {
        color = game.settings.get('lancer-automations', def.settingColor) || def.defaultColor;
        opacity = game.settings.get('lancer-automations', def.settingOpacity) ?? 1;
    } catch { /* use defaults */ }

    // Pulse the line alpha while keeping the aura colour stable.
    const colorInt = _hexToInt(color);
    const lineColorAnimation = {
        duration: 2500,
        easingFunc: 'linear',
        keyframes: [
            { color: colorInt, alpha: 1, position: 0 },
            { color: colorInt, alpha: 0.22, position: 0.5 },
            { color: colorInt, alpha: 1, position: 1 }
        ]
    };

    const tpl = {
        unified: true,
        name: token ? _teamSuffixedName(auraName, token) : auraName,
        enabled: false,
        onlyEnabledInCombat: false,
        keyPressMode: 'DISABLED',
        keyToPress: 'AltLeft',
        innerRadius: '',
        position: 'CENTER',
        lineType: 2,
        lineWidth: 3,
        lineColor: color,
        lineColorAnimation,
        lineOpacity: opacity,
        lineDashSize: def.lineDashSize,
        lineGapSize: def.lineGapSize,
        lineDashOffsetAnimation: 15,
        radiusOffset: 0,
        fillType: 0,
        fillColor: color,
        fillColorAnimation: null,
        fillOpacity: 0.1,
        fillTexture: '',
        fillTextureOffset: { x: 0, y: 0 },
        fillTextureOffsetAnimation: null,
        fillTextureScale: { x: 100, y: 100 },
        ownerVisibility: {
            default: false,
            hovered: true,
            controlled: true,
            dragging: true,
            targeted: false,
            turn: false,
        },
        nonOwnerVisibility: {
            default: false,
            hovered: false,
            controlled: false,
            dragging: false,
            targeted: false,
            turn: false,
        },
        effects: [],
        macros: [],
        sequencerEffects: [],
        terrainHeightTools: getTHTConfig(),
        elevationAware: auraName !== 'LA_custom_measure',
        movementPenalty: 0
    };
    _scaleAuraStroke(tpl);
    return tpl;
}

async function ensurePersistentAura(tokenDoc, auraName) {
    if (!hasGAA())
        return;
    const token = tokenDoc.object ?? canvas.tokens?.get?.(tokenDoc.id);
    const suffixed = token ? _teamSuffixedName(auraName, token) : auraName;
    const prefix = `${auraName}__t`;
    const auras = tokenDoc.getFlag('grid-aware-auras', 'auras') ?? [];

    if (auras.some(auraCfg => auraCfg.name === suffixed))
        return;

    const stale = auras.find(auraCfg => auraCfg.name === auraName || (typeof auraCfg.name === 'string' && auraCfg.name.startsWith(prefix)));
    if (stale) {
        const renamed = auras.map(auraCfg => auraCfg === stale ? { ...auraCfg, name: suffixed } : auraCfg);
        await tokenDoc.setFlag('grid-aware-auras', 'auras', renamed);
        return;
    }

    const template = _buildPersistentTemplate(auraName, token);
    if (!template)
        return;
    template.id = foundry.utils.randomID();
    template.radius = '1';
    await tokenDoc.setFlag('grid-aware-auras', 'auras', [...auras, template]);
}

function _getAuraFromCanvas(token, auraName) {
    const auraLayer = canvas.gaaAuraLayer;
    if (!auraLayer)
        return null;
    const auras = auraLayer._auraManager?.getTokenAuras?.(token);
    if (!auras?.length)
        return null;
    const suffixed = _teamSuffixedName(auraName, token);
    const prefix = `${auraName}__t`;
    return auras.find(aura => aura.config?.name === suffixed)
        ?? auras.find(aura => aura.config?.name === auraName || (typeof aura.config?.name === 'string' && aura.config.name.startsWith(prefix)))
        ?? null;
}

export function isPersistentAuraActive(token, auraName) {
    const aura = _getAuraFromCanvas(token, auraName);
    return aura?.config?.enabled === true;
}

async function _persistAuraState(tokenDoc, auraName, enabled, radius) {
    const token = tokenDoc.object ?? canvas.tokens?.get?.(tokenDoc.id);
    const suffixed = token ? _teamSuffixedName(auraName, token) : auraName;
    const prefix = `${auraName}__t`;
    const elevationAware = auraName !== 'LA_custom_measure';
    const auras = (tokenDoc.getFlag('grid-aware-auras', 'auras') ?? []).map(auraCfg => {
        if (auraCfg.name !== suffixed && auraCfg.name !== auraName && !(typeof auraCfg.name === 'string' && auraCfg.name.startsWith(prefix)))
            return auraCfg;
        return { ...auraCfg, name: suffixed, enabled, radius: String(Math.max(1, radius)), elevationAware };
    });
    await tokenDoc.setFlag('grid-aware-auras', 'auras', auras);
}

export async function togglePersistentAura(token, auraName, radius) {
    if (!hasGAA())
        return;
    let aura = _getAuraFromCanvas(token, auraName);
    if (!aura) {
        await ensurePersistentAura(token.document, auraName);
        aura = _getAuraFromCanvas(token, auraName);
        if (!aura)
            return;
    }
    const cfg = foundry.utils.deepClone(aura.config);
    cfg.enabled = !cfg.enabled;
    cfg.elevationAware = auraName !== 'LA_custom_measure';
    if (cfg.enabled) {
        cfg.radiusCalculated = Math.max(1, radius);
    }
    aura.update(cfg, { force: true });
    await _persistAuraState(token.document, auraName, cfg.enabled, radius);
}

export async function setPersistentAura(token, auraName, enabled, radius) {
    if (!hasGAA())
        return;
    let aura = _getAuraFromCanvas(token, auraName);
    if (!aura) {
        await ensurePersistentAura(token.document, auraName);
        aura = _getAuraFromCanvas(token, auraName);
        if (!aura)
            return;
    }
    const cfg = foundry.utils.deepClone(aura.config);
    const wantElevAware = auraName !== 'LA_custom_measure';
    if (cfg.enabled === enabled && cfg.elevationAware === wantElevAware && (!enabled || cfg.radiusCalculated === radius))
        return;
    cfg.enabled = enabled;
    cfg.elevationAware = wantElevAware;
    cfg.radiusCalculated = Math.max(1, radius);
    aura.update(cfg, { force: true });
    await _persistAuraState(token.document, auraName, enabled, radius);
}

export function updatePersistentAuraRadii(token) {
    if (!hasGAA())
        return;
    const actor = token?.actor;
    if (!actor)
        return;
    for (const [name, def] of Object.entries(AURA_DEFS)) {
        if (!isPersistentAuraActive(token, name))
            continue;
        const aura = _getAuraFromCanvas(token, name);
        if (!aura)
            continue;
        const radius = def.getRadius(actor, token);
        if (radius > 0 && aura.config.radiusCalculated !== radius) {
            const cfg = foundry.utils.deepClone(aura.config);
            cfg.radiusCalculated = radius;
            aura.update(cfg, { force: true });
        }
    }
}

export function getAuraDefaultMode(auraName) {
    const def = AURA_DEFS[auraName];
    if (!def)
        return 'none';
    try {
        return game.settings.get('lancer-automations', def.settingDefault) || 'none';
    } catch {
        return 'none';
    }
}

export async function applyDefaultAuras(token) {
    if (!hasGAA())
        return;
    const actor = token?.actor;
    if (!actor)
        return;
    for (const [name, def] of Object.entries(AURA_DEFS)) {
        const mode = getAuraDefaultMode(name);
        if (mode === 'none')
            continue;
        const inCombat = !!game.combat?.combatants?.find(combatant => combatant.token?.id === token.id);
        if (mode === 'combat' && !inCombat)
            continue;
        const radius = def.getRadius(actor, token);
        if (radius > 0) {
            await setPersistentAura(token, name, true, radius);
        }
    }
}

export async function disableCombatAuras(token) {
    if (!hasGAA())
        return;
    for (const name of Object.keys(AURA_DEFS)) {
        if (getAuraDefaultMode(name) !== 'combat')
            continue;
        if (isPersistentAuraActive(token, name)) {
            await setPersistentAura(token, name, false, 1);
        }
    }
}

export { AURA_DEFS };

Hooks.on('updateToken', async (tokenDoc, change, _options, userId) => {
    if (userId !== game.user.id)
        return;
    if (!('disposition' in (change ?? {})))
        return;
    await _renameStaleTeamAuras(tokenDoc);
    for (const t of canvas.tokens?.placeables ?? []) {
        if (t.id === tokenDoc.id)
            continue;
        await _renameStaleTeamAuras(t.document);
    }
});

Hooks.on('updateActor', async (actor, change) => {
    if (!actor || !change?.flags?.['token-factions'])
        return;
    if (!game.user.isGM)
        return;
    for (const t of canvas.tokens?.placeables ?? []) {
        if (t.actor?.id === actor.id)
            await _renameStaleTeamAuras(t.document);
    }
});

Hooks.on('updateSetting', async (setting) => {
    if (setting?.key !== 'token-factions.team-setup' && setting?.key !== 'token-factions.disposition-matrix')
        return;
    if (!game.user.isGM)
        return;
    for (const t of canvas.tokens?.placeables ?? [])
        await _renameStaleTeamAuras(t.document);
});

// ── HUD row hover ──────────────────────────────────────────────────────────────

/**
 * Called by _openCol for every row that carries hoverData.
 * @param {{ actor: any, item?: any, action?: { name: string, activation?: string }, category?: string, profile?: any, token?: any, isEntering: boolean, isLeaving: boolean, el?: any }} data
 */
export async function onHudRowHover({ actor, item, action, category, profile, token, isEntering, el }) {
    if (!token)
        return;
    if (!game.settings.get('lancer-automations', 'tah.rangePreview'))
        return;

    if (isEntering) {
        const range = await computePreviewRange(category, action?.name, actor, item ?? null, profile ?? null);
        if (range != null)
            await activateRangePreview(token, range, el);
    } else {
        deactivateRangePreview(token);
    }
}
