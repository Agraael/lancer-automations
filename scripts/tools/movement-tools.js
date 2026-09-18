import { removeEffectsByNameFromTokens, applyEffectsToTokens, findEffectOnToken } from "../bonuses/flagged-effects.js";
import { MODULE_ID } from "./constants.js";
import { getLAFlag, setLAFlag, unsetLAFlag } from "./flag-utils.js";
import { getMaxGroundHeightUnderToken } from "../combat/terrain-utils.js";
import { playStandingUpFX, playTeleportFX } from "../fx/actionFX.js";
import { executeDamageRoll, executeSimpleActivation } from "./misc-tools.js";
import { localize, localizeFormat } from "./string-utils.js";

/** Add a virtual LA movement entry for actions that cost movement without physically moving the token. */
async function addVirtualMovement(token, cost)
{
    const tokenDoc = token.document;
    const laHistory = getLAFlag(tokenDoc,'moveHistory') ?? { moves: [] };
    const moves = laHistory.moves || [];
    moves.push({
        distanceMoved: cost,
        movementCost: cost,
        isDrag: true,
        isFreeMovement: false,
        startPos: { x: tokenDoc.x, y: tokenDoc.y },
    });
    await tokenDoc.update({ 'flags.lancer-automations.moveHistory': { ...laHistory, moves } });
}

export async function applyStandingUp(token)
{
    if (!token?.actor)
        return;
    await removeEffectsByNameFromTokens({ tokens: [token], effectNames: ['prone'] });
    playStandingUpFX(token);
    Hooks.callAll('lancer-automations.battelog.action', { token, name: 'STAND UP', actionType: 'Move' });
    await addVirtualMovement(token, token.actor.system?.speed ?? 0);
}

/**
 * Stands up from prone; costs standard move, charges movement cap.
 * @returns {Promise<void>}
 */
export async function executeStandingUp(token)
{
    if (!token?.actor)
        return;
    const hasProne = !!findEffectOnToken(token, effect => effect.statuses?.has('prone'));
    if (!hasProne)
    {
        ui.notifications.info(localizeFormat('LA.notify.notProne', { name: token.name }));
        return;
    }
    const speed = token.actor.system?.speed ?? 0;
    await executeSimpleActivation(token.actor, {
        title: 'Standing Up',
        action: { name: 'Standing Up', activation: 'Movement' },
        detail: localizeFormat('LA.movement.standingUpDetail', { speed })
    });
}

/**
 * Activates the general Boost action, then opens a ruler move of the token's speed
 * using its current movement action.
 * @param {Token} token
 * @param {Object} [options] Passed to moveTokenRuler (title, description, urgent, ...)
 * @returns {Promise<TokenDocument|null>} The moved doc, or null if the move was cancelled
 */
export async function boostMove(token, options = {})
{
    if (!token?.actor)
        return null;
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api)
        return null;
    const activation = await api.activateGeneralAction(token, "Boost");
    if (!activation?.completed)
        return null;
    return api.moveTokenRuler(token, {
        range: token.actor.system.speed,
        title: localize('LA.dialogTitle.boostCaps'),
        description: localize('LA.movement.moveUpToYourSpeed'),
        ...options
    });
}

/** @returns {Promise<void>} */
export async function executeTeleport(token, cost)
{
    if (!token?.actor)
        return;
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api)
        return;
    const speed = token.actor.system?.speed ?? 0;
    const moveCost = cost ?? speed;
    const result = await api.moveToken(token, {
        teleport: true,
        range: speed,
        cost: moveCost,
        title: localize('LA.dialogTitle.teleportCaps'),
        description: localizeFormat('LA.movement.teleportPrompt', { range: speed, cost: moveCost })
    });
    if (result)
    {
        playTeleportFX(token);
        Hooks.callAll('lancer-automations.battelog.action', { token, name: 'TELEPORT', actionType: 'Quick' });
    }
}

/**
 * Reduces elevation by ≤10/tick; on landing deals 3 AP kinetic per 3 spaces fallen (capped at 9).
 * @returns {Promise<void>}
 */
export async function executeFall(targetToken)
{
    if (!targetToken)
    {
        ui.notifications.error('lancer-automations | executeFall requires a target token.');
        return;
    }

    const tokenDoc = targetToken.document;
    const terrainAPI = globalThis.terrainHeightTools;

    // falling implies not flying
    const hasFlyingStatus = !!findEffectOnToken(targetToken, "flying");
    if (hasFlyingStatus)
    {
        await removeEffectsByNameFromTokens({
            tokens: [targetToken],
            effectNames: ["Flying"]
        });
    }

    const tokenElevation = tokenDoc.elevation || 0;
    const maxGroundHeight = terrainAPI ? getMaxGroundHeightUnderToken(targetToken, terrainAPI) : 0;

    const hasFallingEffect = !!findEffectOnToken(targetToken, "falling");

    if (tokenElevation <= maxGroundHeight)
    {
        if (hasFallingEffect)
        {
            ui.notifications.warn(localize('LA.notify.tokenIsAlreadyOnTheGround'));
            await removeEffectsByNameFromTokens({
                tokens: [targetToken],
                effectNames: ["Falling"]
            });
        }
        return;
    }

    let fallStartElevation = Math.max(tokenElevation, getLAFlag(tokenDoc,'fallStartElevation') || 0);
    const fallDistance = tokenElevation - maxGroundHeight;
    const fallAmount = Math.min(10, fallDistance);
    const newElevation = tokenElevation - fallAmount;
    const totalFallAmount = fallStartElevation - newElevation;

    await tokenDoc.update({ elevation: newElevation });
    ui.notifications.info(localizeFormat('LA.notify.tokenHasFallen', { amount: fallAmount, total: fallAmount !== totalFallAmount ? ` (for a total of ${totalFallAmount})` : '' }));

    if (newElevation <= maxGroundHeight)
    {
        await removeEffectsByNameFromTokens({
            tokens: [targetToken],
            effectNames: ["Falling"]
        });

        const totalFallDistance = fallStartElevation - maxGroundHeight;
        const damageGroups = Math.min(3, Math.floor(totalFallDistance / 3));

        if (damageGroups > 0)
        {
            const totalDamage = damageGroups * 3;
            await executeDamageRoll(targetToken, [targetToken], totalDamage, "Kinetic", "Fall", { ap: true, action: { name: "Fall" } });
        }

        if (newElevation < maxGroundHeight)
            await tokenDoc.update({ elevation: maxGroundHeight });

        await unsetLAFlag(tokenDoc,'fallStartElevation');

    }
    else if (!hasFallingEffect)
    {
        await applyEffectsToTokens({
            tokens: [targetToken],
            effectNames: ["Falling"],
            duration: { label: "indefinite" }
        });
        await setLAFlag(tokenDoc,'fallStartElevation', fallStartElevation);
    }
    else
        await setLAFlag(tokenDoc,'fallStartElevation', fallStartElevation);
}
