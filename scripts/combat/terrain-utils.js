import { getOccupiedOffsets } from "./grid-helpers.js";
import { getImmunityBonuses } from "../bonuses/genericBonuses.js";
import { startChoiceCard, getActiveGMId } from "../interactive/network.js";

/**
 * Get all grid cells occupied by a token.
 * @param {Token} token - The token to get cells for
 * @returns {Array<[number, number]>} Array of [row, col] coordinates
 */
export function getTokenCells(token) {
    const offsets = getOccupiedOffsets(token);
    return offsets.map(o => [o.row, o.col]);
}

const _terrainCache = {
    solidMap: new Map(),
    timestamp: 0,
    ttl: 2000
};

function _refreshSolidCache(terrainAPI) {
    const now = Date.now();
    if (now - _terrainCache.timestamp > _terrainCache.ttl) {
        const types = terrainAPI.getTerrainTypes?.() || [];
        _terrainCache.solidMap.clear();
        for (const t of types) {
            if (t.usesHeight && t.isSolid)
                _terrainCache.solidMap.set(t.id, t);
        }
        _terrainCache.timestamp = now;
    }
}

/**
 * Max solid terrain elevation at a single hex/cell, in scene grid units. 0 if no terrain or no THT.
 * @param {number} col
 * @param {number} row
 * @param {Object} [terrainAPI]
 * @returns {number}
 */
export function getHexGroundElevation(col, row, terrainAPI = globalThis.terrainHeightTools) {
    if (!terrainAPI)
        return 0;
    _refreshSolidCache(terrainAPI);
    let maxHeight = 0;
    const cell = terrainAPI.getCell(col, row) || [];
    for (const terrain of cell) {
        if (_terrainCache.solidMap.has(terrain.terrainTypeId)) {
            const h = (terrain.elevation || 0) + (terrain.height || 0);
            if (h > maxHeight)
                maxHeight = h;
        }
    }
    return maxHeight;
}

/**
 * Get the maximum ground height under a token considering all occupied cells.
 * @param {Token} token - The token to check ground height for
 * @param {Object} terrainAPI - The Terrain Height Tools API
 * @returns {number} Maximum ground height across all occupied cells
 */
export function getMaxGroundHeightUnderToken(token, terrainAPI) {
    const cells = getTokenCells(token);
    let maxGroundHeight = 0;
    for (const [x, y] of cells) {
        const h = getHexGroundElevation(y, x, terrainAPI);
        if (h > maxGroundHeight)
            maxGroundHeight = h;
    }
    return maxGroundHeight;
}

/**
 * True if any cell adjacent to the token has a solid terrain top strictly higher than the token's elevation.
 * @param {Token} token
 * @param {Object} [terrainAPI]
 * @returns {boolean}
 */
export function hasTallerSolidAdjacent(token, terrainAPI = globalThis.terrainHeightTools) {
    if (!terrainAPI)
        return false;
    const elevation = token?.document?.elevation || 0;
    const ownCells = getTokenCells(token);
    const ownSet = new Set(ownCells.map(([r, c]) => r + "," + c));
    for (const [r, c] of ownCells) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0)
                    continue;
                const nr = r + dr;
                const nc = c + dc;
                if (ownSet.has(nr + "," + nc))
                    continue;
                if (getHexGroundElevation(nc, nr, terrainAPI) > elevation)
                    return true;
            }
        }
    }
    return false;
}

/**
 * Roll an ENG check; on a result below 10 target the token and roll damage.
 * Dedupes to once per combat round per actor.
 * @param {Token | TokenDocument} token
 * @param {string} [damageType="kinetic"] kinetic, energy, explosive, burn, heat, variable
 * @param {number | string} [damageValue=5]
 * @returns {Promise<void>}
 */
async function _runDangerousZone(token, damageType, damageValue) {
    const actor = token?.actor;
    if (!actor)
        return;
    const curRound = game.combat?.round || 0;
    const lastRound = actor.getFlag("lancer-automations", "dangerousZoneRound");

    if (lastRound === curRound && game.combat?.started)
        return;

    if (game.combat?.started) {
        await actor.setFlag("lancer-automations", "dangerousZoneRound", curRound);
    } else if (lastRound !== undefined) {
        await actor.unsetFlag("lancer-automations", "dangerousZoneRound");
    }

    const typeMap = { kinetic: "Kinetic", energy: "Energy", explosive: "Explosive", burn: "Burn", heat: "Heat", variable: "Variable" };

    const StatRollFlow = game.lancer?.flows?.get?.("StatRollFlow");
    if (!StatRollFlow)
        return;

    const flow = new StatRollFlow(actor, { path: "system.eng", title: "Dangerous Terrain :: ENG" });
    const completed = await flow.begin();

    if (completed && (flow.state.data?.result?.roll?.total ?? 10) < 10) {
        const t = /** @type {any} */ (token).object || token;
        if (t?.setTarget) {
            t.setTarget(true, { releaseOthers: true, groupSelection: false });
        }

        const DamageRollFlow = game.lancer?.flows?.get?.("DamageRollFlow");
        if (!DamageRollFlow)
            return;
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

/**
 * Roll an ENG check; on a result below 10 target the token and roll damage.
 * If the actor is terrain-immune (status or `terrain` immunity bonus) shows a
 * choice card to ignore the trigger or apply it anyway.
 * Dedupes to once per combat round per actor.
 * @param {Token | TokenDocument} token
 * @param {string} [damageType="kinetic"] kinetic, energy, explosive, burn, heat, variable
 * @param {number | string} [damageValue=5]
 * @returns {Promise<void>}
 */
export async function triggerDangerousZoneFlow(token, damageType = "kinetic", damageValue = 5) {
    const actor = token?.actor;
    if (!actor)
        return;

    const immunityBonuses = getImmunityBonuses(actor, "terrain");
    const hasStatusImmunity = !!actor.statuses?.has?.("terrain_immunity");
    if (!hasStatusImmunity && immunityBonuses.length === 0)
        return _runDangerousZone(token, damageType, damageValue);

    const sources = [
        ...immunityBonuses.map(b => b.name || b.id),
        ...(hasStatusImmunity ? ["Terrain Immunity"] : [])
    ];
    const tokenObj = /** @type {any} */ (token).object ?? token;
    const actorName = actor.name ?? "Token";
    await startChoiceCard({
        title: "TERRAIN IMMUNITY",
        description: `<b>${actorName}</b> entered dangerous terrain.<hr>Immunity from: <i>${sources.join(", ")}</i>`,
        icon: "mdi mdi-boot",
        mode: "or",
        relatedToken: tokenObj,
        userIdControl: getActiveGMId(),
        choices: [
            {
                text: "Activate (Ignore Terrain)",
                icon: "fas fa-shield-alt",
                callback: async () => {
                    ui.notifications.info(`${actorName} ignored dangerous terrain.`);
                }
            },
            {
                text: "No (Apply Effect)",
                icon: "fas fa-times",
                callback: async () => {
                    await _runDangerousZone(token, damageType, damageValue);
                }
            }
        ]
    });
}

export const TerrainAPI = {
    getTokenCells,
    getHexGroundElevation,
    getMaxGroundHeightUnderToken,
    hasTallerSolidAdjacent,
    triggerDangerousZoneFlow
};
