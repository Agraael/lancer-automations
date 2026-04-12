/*global game, Hooks, console, foundry */

// Token height is now handled by main.js autoTokenHeight setting.

// ── ZDA (Zone of Deadly Approach) aura ──────────────────────────────────────

const ZDA_TEMPLATE = {
    _v: 1,
    unified: true,
    name: "ZDA",
    enabled: false,
    onlyEnabledInCombat: false,
    keyPressMode: "DISABLED",
    keyToPress: "AltLeft",
    lineType: 1,
    lineWidth: 3,
    lineColor: "#ff0000",
    lineOpacity: 1,
    lineDashSize: 10,
    lineGapSize: 10,
    fillType: 2,
    fillColor: "#b1ab06",
    fillOpacity: 0.5,
    fillTexture: "modules/terrain-height-tools/textures/hatching.png",
    fillTextureOffset: { x: 0, y: 0 },
    fillTextureScale: { x: 100, y: 100 },
    ownerVisibility: {
        default: true, hovered: true, controlled: true,
        dragging: true, targeted: true, turn: true,
    },
    nonOwnerVisibility: {
        default: true, hovered: true, controlled: false,
        dragging: false, targeted: true, turn: true,
    },
    effects: [],
    macros: [],
    terrainHeightTools: {
        rulerOnDrag: "NONE",
        targetTokens: "",
        onlyWhenAltPressed: false,
    },
};

async function ensureZDAAura(tokenDoc) {
    if (!game.modules.get('grid-aware-auras')?.active) return;
    const auras = tokenDoc.getFlag('grid-aware-auras', 'auras') ?? [];
    if (auras.some(a => a.name === 'ZDA')) return;
    const actor = tokenDoc.actor;
    if (!actor) return;
    const sensors = actor.system?.sensor_range ?? 10;
    const aura = foundry.utils.deepClone(ZDA_TEMPLATE);
    aura.id = foundry.utils.randomID();
    aura.radius = Math.floor(sensors * 0.75).toString();
    await tokenDoc.setFlag('grid-aware-auras', 'auras', [...auras, aura]);
}

// Create ZDA on token creation.
Hooks.on('createToken', async (tokenDoc, _options, userId) => {
    if (userId !== game.user.id) return;
    if (!game.modules.get('grid-aware-auras')?.active) return;
    const actorType = tokenDoc.actor?.type;
    if (!['mech', 'npc', 'pilot'].includes(actorType)) return;
    await ensureZDAAura(tokenDoc);
});

// Global toggle function — call from macro or console.
window.toggleLancerZDA = async function () {
    const controlled = canvas.tokens.controlled;
    if (controlled.length === 0) {
        ui.notifications.warn("No tokens selected");
        return;
    }
    for (const token of controlled) {
        const actorType = token.actor?.type;
        if (!['mech', 'npc', 'pilot'].includes(actorType)) continue;
        const existingAuras = token.document.getFlag('grid-aware-auras', 'auras') || [];
        const zdaAura = existingAuras.find(a => a.name === 'ZDA');
        if (zdaAura) {
            zdaAura.enabled = !zdaAura.enabled;
            await token.document.setFlag('grid-aware-auras', 'auras', existingAuras);
        } else {
            await ensureZDAAura(token.document);
            // Enable it after creation.
            const refreshed = token.document.getFlag('grid-aware-auras', 'auras') || [];
            const created = refreshed.find(a => a.name === 'ZDA');
            if (created) {
                created.enabled = true;
                await token.document.setFlag('grid-aware-auras', 'auras', refreshed);
            }
        }
    }
};

console.log('lancer-automations | Personal token setup startup loaded');
