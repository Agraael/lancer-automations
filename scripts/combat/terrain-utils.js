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
        const terrainTypes = terrainAPI.getTerrainTypes?.() || [];
        _terrainCache.solidMap.clear();
        for (const terrainType of terrainTypes) {
            if (terrainType.usesHeight && terrainType.isSolid)
                _terrainCache.solidMap.set(terrainType.id, terrainType);
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
    let maxTopElevation = 0;
    const terrainStack = terrainAPI.getCell(col, row) || [];
    for (const terrain of terrainStack) {
        if (_terrainCache.solidMap.has(terrain.terrainTypeId)) {
            const topElevation = (terrain.elevation || 0) + (terrain.height || 0);
            if (topElevation > maxTopElevation)
                maxTopElevation = topElevation;
        }
    }
    return maxTopElevation;
}

/**
 * Get the maximum ground height under a token considering all occupied cells.
 * @param {Token} token - The token to check ground height for
 * @param {Object} terrainAPI - The Terrain Height Tools API
 * @returns {number} Maximum ground height across all occupied cells
 */
export function getMaxGroundHeightUnderToken(token, terrainAPI) {
    const cells = getTokenCells(token);
    let maxGroundElevation = 0;
    for (const [row, col] of cells) {
        const cellElevation = getHexGroundElevation(col, row, terrainAPI);
        if (cellElevation > maxGroundElevation)
            maxGroundElevation = cellElevation;
    }
    return maxGroundElevation;
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
    const tokenElevation = token?.document?.elevation || 0;
    const ownCells = getTokenCells(token);
    const ownCellKeys = new Set(ownCells.map(([row, col]) => row + "," + col));
    for (const [row, col] of ownCells) {
        for (let rowDelta = -1; rowDelta <= 1; rowDelta++) {
            for (let colDelta = -1; colDelta <= 1; colDelta++) {
                if (rowDelta === 0 && colDelta === 0)
                    continue;
                const neighborRow = row + rowDelta;
                const neighborCol = col + colDelta;
                if (ownCellKeys.has(neighborRow + "," + neighborCol))
                    continue;
                if (getHexGroundElevation(neighborCol, neighborRow, terrainAPI) > tokenElevation)
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
    const currentRound = game.combat?.round || 0;
    const lastTriggeredRound = actor.getFlag("lancer-automations", "dangerousZoneRound");

    if (lastTriggeredRound === currentRound && game.combat?.started)
        return;

    if (game.combat?.started) {
        await actor.setFlag("lancer-automations", "dangerousZoneRound", currentRound);
    } else if (lastTriggeredRound !== undefined) {
        await actor.unsetFlag("lancer-automations", "dangerousZoneRound");
    }

    const damageTypeLabels = { kinetic: "Kinetic", energy: "Energy", explosive: "Explosive", burn: "Burn", heat: "Heat", variable: "Variable" };

    const StatRollFlow = game.lancer?.flows?.get?.("StatRollFlow");
    if (!StatRollFlow)
        return;

    const flow = new StatRollFlow(actor, { path: "system.eng", title: "Dangerous Terrain :: ENG" });
    const completed = await flow.begin();

    if (completed && (flow.state.data?.result?.roll?.total ?? 10) < 10) {
        const targetToken = /** @type {any} */ (token).object || token;
        if (targetToken?.setTarget) {
            targetToken.setTarget(true, { releaseOthers: true, groupSelection: false });
        }

        const DamageRollFlow = game.lancer?.flows?.get?.("DamageRollFlow");
        if (!DamageRollFlow)
            return;
        const damageFlow = new DamageRollFlow(actor.uuid, {
            title: "Dangerous Terrain",
            damage: [{ val: String(damageValue), type: damageTypeLabels[String(damageType).toLowerCase()] || "Kinetic" }],
            tags: [],
            hit_results: [],
            has_normal_hit: true
        });
        await damageFlow.begin();
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

    const immunitySourceNames = [
        ...immunityBonuses.map(bonus => bonus.name || bonus.id),
        ...(hasStatusImmunity ? ["Terrain Immunity"] : [])
    ];
    const tokenPlaceable = /** @type {any} */ (token).object ?? token;
    const actorName = actor.name ?? "Token";
    await startChoiceCard({
        title: "TERRAIN IMMUNITY",
        description: `<b>${actorName}</b> entered dangerous terrain.<hr>Immunity from: <i>${immunitySourceNames.join(", ")}</i>`,
        icon: "mdi mdi-boot",
        mode: "or",
        relatedToken: tokenPlaceable,
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
