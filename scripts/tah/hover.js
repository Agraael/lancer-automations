/*global game, canvas, Hooks, foundry */

import { getMaxWeaponReach_WithBonus, getActorMaxThreat, getMaxItemRanges_WithBonus } from '../misc-tools.js';

// ── range_preview aura ────────────────────────────────────────────────────────

const RANGE_PREVIEW_NAME = 'range_preview';

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
 * Ensure the token document has a range_preview aura. Creates it (disabled) if missing.
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
 * Enable range_preview aura in-memory with the given radius. Does NOT write to token flags.
 * @param {any} token  — canvas Token object (not document)
 * @param {number} range
 */
function activateRangePreview(token, range) {
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
    cfg.enabled = true;
    cfg.radiusCalculated = Math.max(1, range);
    /** @type {any} */ (aura).update(cfg, { force: true });
}

/**
 * Disable range_preview aura in-memory.
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
 * If item is present, always uses getMaxItemRanges_WithBonus.
 * Category rules apply only when item is null.
 * Returns null if no preview should be shown for this row.
 * @param {string|undefined} category
 * @param {string|undefined} actionName
 * @param {any} actor
 * @param {any|null} item
 * @returns {Promise<number|null>}
 */
async function computePreviewRange(category, actionName, actor, item) {
    // Deployables: placement range from deployRange flag, default 1 (ignore item range tags)
    if (category === 'Deployables') {
        const deployRange = item?.getFlag?.('lancer-automations', 'deployRange') ?? 1;
        return Math.max(1, deployRange);
    }

    // Item present → always show its range (covers Weapons, Systems, weapon children, etc.)
    if (item) {
        const reach = await getItemMaxReach(item, actor);
        return reach > 0 ? Math.max(1, reach) : null;
    }

    // No item — category/action-specific rules
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

// ── Hook: ensure range_preview aura on token creation ─────────────────────────

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
 * @param {{ actor: any, item?: any, action?: { name: string, activation?: string }, category?: string, token?: any, isEntering: boolean, isLeaving: boolean }} data
 */
export async function onHudRowHover({ actor, item, action, category, token, isEntering }) {
    const parts = [];
    if (category)
        parts.push(`[${category}]`);
    if (actor?.name)
        parts.push(`Actor: ${actor.name}`);
    if (item?.name)
        parts.push(`Item: ${item.name}`);
    if (action?.name)
        parts.push(`Action: ${action.name}`);
    if (action?.activation)
        parts.push(`[${action.activation}]`);

    console.log((isEntering ? 'Entering: ' : 'Leaving: ') + parts.join('  |  '));

    if (!token)
        return;

    if (isEntering) {
        const range = await computePreviewRange(category, action?.name, actor, item ?? null);
        if (range != null)
            activateRangePreview(token, range);
    } else {
        deactivateRangePreview(token);
    }
}
