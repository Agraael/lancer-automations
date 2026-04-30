import { getOccupiedOffsets } from "./grid-helpers.js";

/**
 * Get all grid cells occupied by a token.
 * @param {Token} token - The token to get cells for
 * @returns {Array<[number, number]>} Array of [row, col] coordinates
 */
export function getTokenCells(token) {
    const offsets = getOccupiedOffsets(token);
    return offsets.map(o => [o.row, o.col]);
}

// Cache for terrain types to avoid redundant API calls and array searches
const _terrainCache = {
    solidMap: new Map(),
    timestamp: 0,
    ttl: 2000 // 2 second TTL is safe for terrain config changes
};

/**
 * Get the maximum ground height under a token considering all occupied cells.
 * @param {Token} token - The token to check ground height for
 * @param {Object} terrainAPI - The Terrain Height Tools API
 * @returns {number} Maximum ground height across all occupied cells
 */
export function getMaxGroundHeightUnderToken(token, terrainAPI) {
    const cells = getTokenCells(token);

    // Refresh terrain type cache if expired
    const now = Date.now();
    if (now - _terrainCache.timestamp > _terrainCache.ttl) {
        const types = terrainAPI.getTerrainTypes?.() || [];
        _terrainCache.solidMap.clear();
        for (const t of types) {
            if (t.usesHeight && t.isSolid) {
                _terrainCache.solidMap.set(t.id, t);
            }
        }
        _terrainCache.timestamp = now;
    }

    let maxGroundHeight = 0;

    for (const [x, y] of cells) {
        // Get existing terrain data at this cell
        const existingTerrain = terrainAPI.getCell(y, x) || [];

        // Find the highest terrain height at this position (only consider solid height-using terrain)
        for (const terrain of existingTerrain) {
            if (_terrainCache.solidMap.has(terrain.terrainTypeId)) {
                const totalHeight = (terrain.elevation || 0) + (terrain.height || 0);
                if (totalHeight > maxGroundHeight) {
                    maxGroundHeight = totalHeight;
                }
            }
        }
    }

    return maxGroundHeight;
}

/**
 * Roll an ENG check; on a result below 10 target the token and roll damage.
 * Dedupes to once per combat round per actor.
 * @param {Token | TokenDocument} token
 * @param {string} [damageType="kinetic"] kinetic, energy, explosive, burn, heat, variable
 * @param {number | string} [damageValue=5]
 * @returns {Promise<void>}
 */
export async function triggerDangerousZoneFlow(token, damageType = "kinetic", damageValue = 5) {
    const actor = token?.actor;
    if (!actor) return;
    const curRound = game.combat?.round || 0;
    const lastRound = actor.getFlag("lancer-automations", "dangerousZoneRound");

    if (lastRound === curRound && game.combat?.started) return;

    if (game.combat?.started) {
        await actor.setFlag("lancer-automations", "dangerousZoneRound", curRound);
    } else if (lastRound !== undefined) {
        await actor.unsetFlag("lancer-automations", "dangerousZoneRound");
    }

    const typeMap = { kinetic: "Kinetic", energy: "Energy", explosive: "Explosive", burn: "Burn", heat: "Heat", variable: "Variable" };

    const StatRollFlow = game.lancer?.flows?.get?.("StatRollFlow");
    if (!StatRollFlow) return;

    const flow = new StatRollFlow(actor, { path: "system.eng", title: "Dangerous Terrain :: ENG" });
    const completed = await flow.begin();

    if (completed && (flow.state.data?.result?.roll?.total ?? 10) < 10) {
        const t = /** @type {any} */ (token).object || token;
        if (t?.setTarget) {
            t.setTarget(true, { releaseOthers: true, groupSelection: false });
        }

        const DamageRollFlow = game.lancer?.flows?.get?.("DamageRollFlow");
        if (!DamageRollFlow) return;
        const dmgFlow = new DamageRollFlow(actor.uuid, {
            title: "Dangerous Terrain",
            damage: [{ val: String(damageValue), type: typeMap[String(damageType).toLowerCase()] || "Kinetic" }],
            tags: [],
            hit_results: [],
            has_normal_hit: true
        });
        await dmgFlow.begin();
    }
}

export const TerrainAPI = {
    getTokenCells,
    getMaxGroundHeightUnderToken,
    triggerDangerousZoneFlow
};
