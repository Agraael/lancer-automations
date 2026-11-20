import { getOccupiedOffsets, neighborKeys } from "./grid-helpers.js";
import { getLAFlag, setLAFlag, unsetLAFlag } from "../tools/flag-utils.js";
import { getMovementBonuses, consumeMovementUse } from "../bonuses/genericBonuses.js";
import { startChoiceCard, getActiveGMId } from "../interactive/network.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { getEnvironmentActor } from "../tools/template-actors.js";
import { groundBandsAtCell, groundTop, solidTokenBandsAtCell, restingSurface } from "../movement/ground.js";
import { laTokenGameplayHeight } from "../tools/token-height.js";

/**
 * Get all grid cells occupied by a token.
 * @param {Token} token
 * @returns {Array<[number, number]>} Array of [row, col] coordinates
 */
export function getTokenCells(token)
{
    const offsets = getOccupiedOffsets(token);
    return offsets.map(offset => [offset.row, offset.col]);
}

const _terrainCache = {
    solidMap: new Map(),
    cellStacks: new Map(),
    timestamp: 0,
    ttl: 2000
};

// THT reloads its shapes after canvasReady, so stacks cached before that reload are empty.
Hooks.on('terrain-height-tools.updateTerrain', () => { _terrainCache.timestamp = 0; });

function _refreshSolidCache(terrainAPI)
{
    const now = Date.now();

    if (now - _terrainCache.timestamp > _terrainCache.ttl)
    {
        const terrainTypes = terrainAPI.getTerrainTypes?.() || [];
        _terrainCache.solidMap.clear();
        _terrainCache.cellStacks.clear();

        for (const terrainType of terrainTypes)
        {
            if (terrainType.usesHeight && terrainType.isSolid)
                _terrainCache.solidMap.set(terrainType.id, terrainType);
        }

        _terrainCache.timestamp = now;
    }
}

// getCell is a THT terrain-stack lookup; cache the raw stack per cell (same 2s TTL as solidMap).
// The solidity check still runs per call, so terrain-type edits apply without a stale result.
function _cellTerrainStack(terrainAPI, col, row)
{
    const key = `${col},${row}`;
    let stack = _terrainCache.cellStacks.get(key);

    if (stack === undefined)
    {
        stack = terrainAPI.getCell(col, row) || [];
        _terrainCache.cellStacks.set(key, stack);
    }

    return stack;
}

/**
 * Max solid terrain elevation at a single hex/cell, in scene grid units. 0 if no terrain or no THT.
 * @param {number} col
 * @param {number} row
 * @param {Object} [terrainAPI]
 * @param {{excludeTokenId?: string|null, solidTokens?: boolean}} [options]
 * @returns {number}
 */
export function getHexGroundElevation(col, row, terrainAPI = globalThis.terrainHeightTools, options = {})
{
    let terrainStack = [];

    if (terrainAPI)
    {
        _refreshSolidCache(terrainAPI);
        terrainStack = _cellTerrainStack(terrainAPI, col, row);
    }

    return groundTop(groundBandsAtCell(terrainStack, _terrainCache.solidMap, col, row, options));
}

/**
 * True if solid terrain at the cell starts above the given elevation, so the cell sits under an overhang.
 * @param {number} col
 * @param {number} row
 * @param {number} elevation Scene grid units
 * @param {Object} [terrainAPI]
 * @returns {boolean}
 */
export function isHexUnderTerrain(col, row, elevation, terrainAPI = globalThis.terrainHeightTools, excludeTokenId = null)
{
    if (solidTokenBandsAtCell(col, row, excludeTokenId).some(band => band.bottom > elevation))
        return true;
    if (!terrainAPI)
        return false;
    _refreshSolidCache(terrainAPI);

    for (const terrain of _cellTerrainStack(terrainAPI, col, row))
    {
        if (!_terrainCache.solidMap.has(terrain.terrainTypeId))
            continue;
        if ((terrain.elevation || 0) > elevation)
            return true;
    }

    return false;
}

/**
 * Get the maximum ground height under a token considering all occupied cells.
 * @param {Token} token
 * @param {Object} terrainAPI - The Terrain Height Tools API
 * @returns {number}
 */
export function getMaxGroundHeightUnderToken(token, terrainAPI)
{
    const cells = getTokenCells(token);
    const excludeTokenId = token?.document?.id ?? token?.id ?? null;
    let maxGroundElevation = 0;

    for (const [row, col] of cells)
    {
        const cellElevation = getHexGroundElevation(col, row, terrainAPI, { excludeTokenId });
        if (cellElevation > maxGroundElevation)
            maxGroundElevation = cellElevation;
    }

    return maxGroundElevation;
}

/**
 * Surface the token would land on, per cell the highest one at or below it with room for its body, highest cell wins.
 * @param {Token} token
 * @param {any} terrainAPI
 * @param {{x: number, y: number, elevation?: number}|null} [position] Top-left to test instead of the token's own.
 * @returns {number}
 */
export function getRestingElevationUnderToken(token, terrainAPI, position = null)
{
    const doc = /** @type {TokenDocument} */ (token?.document ?? token);
    const excludeTokenId = doc?.id ?? null;
    const height = position?.elevation ?? doc?.elevation ?? 0;
    const zHeight = laTokenGameplayHeight(doc);
    let resting = 0;

    if (terrainAPI)
        _refreshSolidCache(terrainAPI);

    for (const offset of getOccupiedOffsets(token, position))
    {
        const stack = terrainAPI ? _cellTerrainStack(terrainAPI, offset.col, offset.row) : [];
        const bands = groundBandsAtCell(stack, _terrainCache.solidMap, offset.col, offset.row, { excludeTokenId });
        const surface = restingSurface(bands, zHeight, height, 'ground');
        resting = Math.max(resting, Number.isFinite(surface) ? surface : groundTop(bands));
    }

    return resting;
}

/**
 * True if any cell adjacent to the token has a solid terrain top strictly higher than the token's elevation.
 * @param {Token} token
 * @param {Object} [terrainAPI]
 * @returns {boolean}
 */
export function hasTallerSolidAdjacent(token, terrainAPI = globalThis.terrainHeightTools)
{
    const tokenElevation = token?.document?.elevation || 0;
    const excludeTokenId = token?.document?.id ?? token?.id ?? null;
    const ownCells = getTokenCells(token);
    const ownCellKeys = new Set(ownCells.map(([row, col]) => row + "," + col));

    for (const [row, col] of ownCells)
    {
        for (const neighborKey of neighborKeys(col + "," + row))
        {
            const [neighborCol, neighborRow] = neighborKey.split(',').map(Number);

            if (ownCellKeys.has(neighborRow + "," + neighborCol))
                continue;
            if (getHexGroundElevation(neighborCol, neighborRow, terrainAPI, { excludeTokenId }) > tokenElevation)
                return true;
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
async function _runDangerousZone(token, damageType, damageValue)
{
    const actor = token?.actor;
    if (!actor)
        return;

    const currentRound = game.combat?.round || 0;
    const lastTriggeredRound = getLAFlag(actor,"dangerousZoneRound");

    if (lastTriggeredRound === currentRound && game.combat?.started)
        return;

    if (game.combat?.started)
        await setLAFlag(actor,"dangerousZoneRound", currentRound);
    else if (lastTriggeredRound !== undefined)
        await unsetLAFlag(actor,"dangerousZoneRound");

    const damageTypeLabels = { kinetic: "Kinetic", energy: "Energy", explosive: "Explosive", burn: "Burn", heat: "Heat", variable: "Variable" };

    const StatRollFlow = game.lancer?.flows?.get?.("StatRollFlow");
    if (!StatRollFlow)
        return;

    const flow = new StatRollFlow(actor, { path: "system.eng", title: "Dangerous Terrain :: ENG" });
    const completed = await flow.begin();

    if (completed && (flow.state.data?.result?.roll?.total ?? 10) < 10)
    {
        const targetToken = /** @type {any} */ (token).object || token;
        if (targetToken?.setTarget)
            targetToken.setTarget(true, { releaseOthers: true, groupSelection: false });

        const DamageRollFlow = game.lancer?.flows?.get?.("DamageRollFlow");
        if (!DamageRollFlow)
            return;

        const source = await getEnvironmentActor() ?? actor;

        const damageFlow = new DamageRollFlow(source.uuid, {
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
 * If the actor is terrain-immune (status or `terrain_immunity` movement bonus) shows a
 * choice card to ignore the trigger or apply it anyway.
 * Dedupes to once per combat round per actor.
 * @param {Token | TokenDocument} token
 * @param {string} [damageType="kinetic"] kinetic, energy, explosive, burn, heat, variable
 * @param {number | string} [damageValue=5]
 * @returns {Promise<void>}
 */
export async function triggerDangerousZoneFlow(token, damageType = "kinetic", damageValue = 5)
{
    const actor = token?.actor;
    if (!actor)
        return;

    const immunityBonuses = getMovementBonuses(actor, "terrain_immunity");
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
        title: localize('LA.dialogTitle.terrainImmunity'),
        description: localizeFormat('LA.terrain.immunityPrompt', { name: actorName, sources: immunitySourceNames.join(', ') }),
        icon: "mdi mdi-boot",
        mode: "or",
        relatedToken: tokenPlaceable,
        userIdControl: getActiveGMId(),
        choices: [
            {
                text: localize('LA.terrain.activateIgnoreTerrain'),
                icon: "fas fa-shield-alt",
                callback: async () =>
                {
                    ui.notifications.info(localizeFormat('LA.notify.ignoredDangerousTerrain', { name: actorName }));
                    if (immunityBonuses.length > 0)
                        await consumeMovementUse(actor, 'terrain_immunity');
                }
            },
            {
                text: localize('LA.terrain.noApplyEffect'),
                icon: "fas fa-times",
                callback: async () =>
                {
                    await _runDangerousZone(token, damageType, damageValue);
                }
            }
        ]
    });
}

export const TerrainAPI = {
    getTokenCells,
    getHexGroundElevation,
    isHexUnderTerrain,
    getMaxGroundHeightUnderToken,
    getRestingElevationUnderToken,
    hasTallerSolidAdjacent,
    triggerDangerousZoneFlow
};
