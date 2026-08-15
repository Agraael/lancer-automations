/*global game, Hooks, console, foundry */
const ZDA_ACTOR_TYPES = new Set(['mech', 'npc', 'pilot']);

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
        default: true,
        hovered: true,
        controlled: true,
        dragging: true,
        targeted: true,
        turn: true,
    },
    nonOwnerVisibility: {
        default: true,
        hovered: true,
        controlled: false,
        dragging: false,
        targeted: true,
        turn: true,
    },
    effects: [],
    macros: [],
    terrainHeightTools: {
        rulerOnDrag: "NONE",
        targetTokens: "",
        onlyWhenAltPressed: false,
    },
};

// Adds the ZDA aura (disabled, radius = 75% of sensors) if the token doesn't already have one.
async function ensureZDAAura(tokenDoc)
{
    if (!game.modules.get('grid-aware-auras')?.active)
        return;
    const auras = tokenDoc.getFlag('grid-aware-auras', 'auras') ?? [];
    if (auras.some(existing => existing.name === 'ZDA'))
        return;
    const actor = tokenDoc.actor;
    if (!actor)
        return;
    const sensors = actor.system?.sensor_range ?? 10;
    const aura = foundry.utils.deepClone(ZDA_TEMPLATE);
    aura.id = foundry.utils.randomID();
    aura.radius = Math.floor(sensors * 0.75).toString();
    await tokenDoc.setFlag('grid-aware-auras', 'auras', [...auras, aura]);
}

api.registerDefaultGeneralReactions({
    "ZDA Aura": {
        category: "General (LaSossis)",
        comments: "Zone of Deadly Approach aura, created disabled on every mech/npc/pilot token",
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            if (!ZDA_ACTOR_TYPES.has(token.actor?.type))
                return;
            await ensureZDAAura(token.document);
        }
    }
});

// Macro entry point: toggle the ZDA aura on the selected tokens.
window.toggleLancerZDA = async function ()
{
    const controlled = canvas.tokens.controlled;
    if (!controlled.length)
    {
        ui.notifications.warn("No tokens selected");
        return;
    }
    for (const token of controlled)
    {
        if (!ZDA_ACTOR_TYPES.has(token.actor?.type))
            continue;
        await ensureZDAAura(token.document);
        const auras = token.document.getFlag('grid-aware-auras', 'auras') ?? [];
        const zdaAura = auras.find(existing => existing.name === 'ZDA');
        if (!zdaAura)
            continue;
        zdaAura.enabled = !zdaAura.enabled;
        await token.document.setFlag('grid-aware-auras', 'auras', auras);
    }
};
