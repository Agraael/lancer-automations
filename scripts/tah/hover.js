/*global game, canvas, Hooks, foundry */

import { getMaxWeaponReach_WithBonus, getActorMaxThreat, getMaxItemRanges_WithBonus, getMaxWeaponRanges_WithBonus } from '../misc-tools.js';

// ── LA_range_preview aura ────────────────────────────────────────────────────────

const RANGE_PREVIEW_NAME = 'LA_range_preview';

const RANGE_PREVIEW_TEMPLATE = {
    _v: 1,
    unified: false,
    name: RANGE_PREVIEW_NAME,
    enabled: false,
    onlyEnabledInCombat: false,
    fillAnimation: true,
    fillAnimationSpeed: 0.3,
    keyPressMode: 'DISABLED',
    keyToPress: 'AltLeft',
    lineType: 1,
    lineWidth: 3,
    lineColor: '#ffffff',
    lineOpacity: 0.75,
    lineDashSize: 15,
    lineGapSize: 15,
    fillType: 2,
    fillColor: '#ffffff',
    fillOpacity: 0.05,
    fillTexture: 'modules/terrain-height-tools/textures/hatching.png',
    fillTextureOffset: { x: 0, y: 0 },
    fillTextureScale: { x: 250, y: 250 },
    ownerVisibility: {
        default: true,
        hovered: true,
        controlled: true,
        dragging: true,
        targeted: true,
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
    terrainHeightTools: {
        rulerOnDrag: 'NONE',
        targetTokens: 'ALL',
        onlyWhenAltPressed: false,
    },
};

function hasGAA() {
    return !!game.modules.get('grid-aware-auras')?.active;
}

/**
 * Ensure the token document has a LA_range_preview aura. Creates it (disabled) if missing.
 * @param {any} tokenDoc
 */
async function ensureRangePreviewAura(tokenDoc) {
    if (!hasGAA())
        return;
    const auras = tokenDoc.getFlag('grid-aware-auras', 'auras') ?? [];
    if (auras.some(a => a.name === RANGE_PREVIEW_NAME))
        return;
    const aura = foundry.utils.deepClone(RANGE_PREVIEW_TEMPLATE);
    aura.id = foundry.utils.randomID();
    aura.radius = '1';
    await tokenDoc.setFlag('grid-aware-auras', 'auras', [...auras, aura]);
}

/**
 * Enable LA_range_preview aura in-memory with the given radius. Does NOT write to token flags.
 * @param {any} token  — canvas Token object (not document)
 * @param {number} range
 */
async function activateRangePreview(token, range) {
    if (!hasGAA())
        return;
    const auraLayer = /** @type {any} */ (canvas).gaaAuraLayer;
    if (!auraLayer)
        return;
    let auras = auraLayer._auraManager?.getTokenAuras?.(token);
    let aura = auras?.find(/** @type {any} */ a => a.config?.name === RANGE_PREVIEW_NAME);
    // If the aura doesn't exist yet, create it in flags and re-fetch from canvas
    if (!aura) {
        await ensureRangePreviewAura(token.document);
        auras = auraLayer._auraManager?.getTokenAuras?.(token);
        aura = auras?.find(/** @type {any} */ a => a.config?.name === RANGE_PREVIEW_NAME);
        if (!aura)
            return;
    }
    const cfg = foundry.utils.deepClone(/** @type {any} */ (aura).config);
    cfg.enabled = true;
    cfg.radiusCalculated = Math.max(1, range);
    /** @type {any} */ (aura).update(cfg, { force: true });
}

/**
 * Disable LA_range_preview aura in-memory.
 * @param {any} token  — canvas Token object (not document)
 */
function deactivateRangePreview(token) {
    if (!hasGAA())
        return;
    const auraLayer = /** @type {any} */ (canvas).gaaAuraLayer;
    if (!auraLayer)
        return;
    const auras = auraLayer._auraManager?.getTokenAuras?.(token);
    if (!auras)
        return;
    const aura = auras.find(/** @type {any} */ a => a.config?.name === RANGE_PREVIEW_NAME);
    if (!aura)
        return;
    const cfg = foundry.utils.deepClone(/** @type {any} */ (aura).config);
    cfg.enabled = false;
    cfg.radiusCalculated = 1;
    /** @type {any} */ (aura).update(cfg, { force: true });
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

/**
 * Compute the range to preview for an attack action.
 * Returns null if no preview should be shown.
 * @param {string|undefined} actionName
 * @param {any} actor
 * @param {any|null} item
 * @returns {Promise<number|null>}
 */
async function getAttackRange(actionName, actor, item) {
    const name = (actionName ?? '').toLowerCase().trim();

    // No preview
    if (name === 'basic attack' || name === 'damage')
        return null;

    // Fixed range 1
    if (name === 'ram' || name === 'ramming speed' || name === 'grapple' ||
        name === 'improvised attack' || name === 'pick up weapon' || name === 'pickup weapon')
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
    return Math.max(0, ...ALL_TYPES.map(t => ranges[t] ?? 0));
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
        const max = Math.max(0, ...profile.range.map(r => Number(r.val) || 0));
        return max > 0 ? Math.max(1, max) : null;
    }

    // Item present → use its range if it has one, otherwise fall through to category rules
    if (item) {
        const reach = await getItemMaxReach(item, actor);
        if (reach > 0) return Math.max(1, reach);
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

// ── Persistent range auras (Threat / Sensors / Max Range) ─────────────────────

const AURA_DEFS = {
    LA_max_Threat: {
        settingColor: 'tah.auraColorThreat',
        settingOpacity: 'tah.auraOpacityThreat',
        settingDefault: 'tah.auraDefaultThreat',
        defaultColor: '#9514ff',
        lineDashSize: 15, lineGapSize: 15,
        getRadius: (actor) => getActorMaxThreat(actor),
    },
    LA_Sensor: {
        settingColor: 'tah.auraColorSensor',
        settingOpacity: 'tah.auraOpacitySensor',
        settingDefault: 'tah.auraDefaultSensor',
        defaultColor: '#549eff',
        lineDashSize: 11, lineGapSize: 11,
        getRadius: (actor) => actor?.system?.sensor_range ?? (actor?.type === 'pilot' ? 5 : 10),
    },
    LA_max_range: {
        settingColor: 'tah.auraColorRange',
        settingOpacity: 'tah.auraOpacityRange',
        settingDefault: 'tah.auraDefaultRange',
        defaultColor: '#ff7b00',
        lineDashSize: 13, lineGapSize: 13,
        getRadius: (actor) => {
            const ranges = getMaxWeaponRanges_WithBonus(actor);
            return Math.max(0, ...Object.entries(ranges)
                .filter(([t]) => t !== 'Threat')
                .map(([, v]) => v));
        },
    },
};

function _buildPersistentTemplate(auraName) {
    const def = AURA_DEFS[auraName];
    if (!def) return null;
    let color = def.defaultColor;
    let opacity = 1;
    try {
        color = game.settings.get('lancer-automations', def.settingColor) || def.defaultColor;
        opacity = game.settings.get('lancer-automations', def.settingOpacity) ?? 1;
    } catch { /* use defaults */ }

    return {
        _v: 1,
        unified: true,
        name: auraName,
        enabled: false,
        onlyEnabledInCombat: false,
        animation: true,
        animationType: 'pulse',
        pulseToMax: false,
        animationWhenSelected: true,
        animationSpeed: 0.1,
        keyPressMode: 'DISABLED',
        keyToPress: 'AltLeft',
        lineType: 1,
        lineWidth: 3,
        lineColor: color,
        lineOpacity: opacity,
        lineDashSize: def.lineDashSize,
        lineGapSize: def.lineGapSize,
        fillType: 0,
        fillColor: color,
        fillOpacity: 0.1,
        fillTexture: '',
        fillTextureOffset: { x: 0, y: 0 },
        fillTextureScale: { x: 100, y: 100 },
        ownerVisibility: {
            default: false, hovered: true, controlled: true,
            dragging: true, targeted: false, turn: false,
        },
        nonOwnerVisibility: {
            default: false, hovered: false, controlled: false,
            dragging: false, targeted: false, turn: false,
        },
        effects: [],
        macros: [],
        terrainHeightTools: {
            rulerOnDrag: 'NONE',
            targetTokens: '',
            onlyWhenAltPressed: false,
        },
    };
}

async function ensurePersistentAura(tokenDoc, auraName) {
    if (!hasGAA()) return;
    const auras = tokenDoc.getFlag('grid-aware-auras', 'auras') ?? [];
    if (auras.some(a => a.name === auraName)) return;
    const template = _buildPersistentTemplate(auraName);
    if (!template) return;
    template.id = foundry.utils.randomID();
    template.radius = '1';
    await tokenDoc.setFlag('grid-aware-auras', 'auras', [...auras, template]);
}

function _getAuraFromCanvas(token, auraName) {
    const auraLayer = canvas.gaaAuraLayer;
    if (!auraLayer) return null;
    const auras = auraLayer._auraManager?.getTokenAuras?.(token);
    return auras?.find(a => a.config?.name === auraName) ?? null;
}

export function isPersistentAuraActive(token, auraName) {
    const aura = _getAuraFromCanvas(token, auraName);
    return aura?.config?.enabled === true;
}

export async function togglePersistentAura(token, auraName, radius) {
    if (!hasGAA()) return;
    let aura = _getAuraFromCanvas(token, auraName);
    if (!aura) {
        await ensurePersistentAura(token.document, auraName);
        aura = _getAuraFromCanvas(token, auraName);
        if (!aura) return;
    }
    const cfg = foundry.utils.deepClone(aura.config);
    cfg.enabled = !cfg.enabled;
    if (cfg.enabled) {
        cfg.radiusCalculated = Math.max(1, radius);
    }
    aura.update(cfg, { force: true });
}

export async function setPersistentAura(token, auraName, enabled, radius) {
    if (!hasGAA()) return;
    let aura = _getAuraFromCanvas(token, auraName);
    if (!aura) {
        await ensurePersistentAura(token.document, auraName);
        aura = _getAuraFromCanvas(token, auraName);
        if (!aura) return;
    }
    const cfg = foundry.utils.deepClone(aura.config);
    if (cfg.enabled === enabled && (!enabled || cfg.radiusCalculated === radius)) return;
    cfg.enabled = enabled;
    cfg.radiusCalculated = Math.max(1, radius);
    aura.update(cfg, { force: true });
}

export function updatePersistentAuraRadii(token) {
    if (!hasGAA()) return;
    const actor = token?.actor;
    if (!actor) return;
    for (const [name, def] of Object.entries(AURA_DEFS)) {
        if (!isPersistentAuraActive(token, name)) continue;
        const aura = _getAuraFromCanvas(token, name);
        if (!aura) continue;
        const radius = def.getRadius(actor);
        if (radius > 0 && aura.config.radiusCalculated !== radius) {
            const cfg = foundry.utils.deepClone(aura.config);
            cfg.radiusCalculated = radius;
            aura.update(cfg, { force: true });
        }
    }
}

export function getAuraDefaultMode(auraName) {
    const def = AURA_DEFS[auraName];
    if (!def) return 'none';
    try {
        return game.settings.get('lancer-automations', def.settingDefault) || 'none';
    } catch {
        return 'none';
    }
}

export async function applyDefaultAuras(token) {
    if (!hasGAA()) return;
    const actor = token?.actor;
    if (!actor) return;
    for (const [name, def] of Object.entries(AURA_DEFS)) {
        const mode = getAuraDefaultMode(name);
        if (mode === 'none') continue;
        const inCombat = !!game.combat?.combatants?.find(c => c.token?.id === token.id);
        if (mode === 'combat' && !inCombat) continue;
        const radius = def.getRadius(actor);
        if (radius > 0) {
            await setPersistentAura(token, name, true, radius);
        }
    }
}

export async function disableCombatAuras(token) {
    if (!hasGAA()) return;
    for (const name of Object.keys(AURA_DEFS)) {
        if (getAuraDefaultMode(name) !== 'combat') continue;
        if (isPersistentAuraActive(token, name)) {
            await setPersistentAura(token, name, false, 1);
        }
    }
}

export { AURA_DEFS };

// ── Hook: ensure LA_range_preview aura on token creation ─────────────────────────

Hooks.on('createToken', async (tokenDoc, _options, userId) => {
    if (userId !== game.user.id)
        return;
    if (!hasGAA())
        return;
    const actorType = tokenDoc.actor?.type;
    if (!['mech', 'npc', 'pilot', 'deployable'].includes(actorType))
        return;
    await ensureRangePreviewAura(tokenDoc);
});

// ── HUD row hover ──────────────────────────────────────────────────────────────

/**
 * Called by _openCol for every row that carries hoverData.
 * @param {{ actor: any, item?: any, action?: { name: string, activation?: string }, category?: string, profile?: any, token?: any, isEntering: boolean, isLeaving: boolean }} data
 */
export async function onHudRowHover({ actor, item, action, category, profile, token, isEntering }) {
    if (!token)
        return;
    if (!game.settings.get('lancer-automations', 'tah.rangePreview'))
        return;

    if (isEntering) {
        const range = await computePreviewRange(category, action?.name, actor, item ?? null, profile ?? null);
        if (range != null)
            await activateRangePreview(token, range);
    } else {
        deactivateRangePreview(token);
    }
}
