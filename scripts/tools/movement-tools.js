import { removeEffectsByNameFromTokens, applyEffectsToTokens, findEffectOnToken } from "../bonuses/flagged-effects.js";
import { getMaxGroundHeightUnderToken } from "../combat/terrain-utils.js";
import { playStandingUpFX, playTeleportFX } from "../fx/actionFX.js";
import { executeDamageRoll } from "./misc-tools.js";

/** Add a virtual LA movement entry for actions that cost movement without physically moving the token. */
async function addVirtualMovement(token, cost) {
    const tokenDoc = token.document;
    const laHistory = tokenDoc.getFlag('lancer-automations', 'moveHistory') ?? { moves: [] };
    const moves = laHistory.moves || [];
    moves.push({
        distanceMoved: cost,
        movementCost: cost,
        isDrag: true,
        isFreeMovement: false,
        boostSet: [],
        startPos: { x: tokenDoc.x, y: tokenDoc.y },
    });
    await tokenDoc.update({ 'flags.lancer-automations.moveHistory': { ...laHistory, moves } });
}

/**
 * Stand up from prone: removes the Prone status and adds +speed to the movement cap.
 * Costs the standard move (not a quick/full action).
 */
export async function executeStandingUp(token) {
    if (!token?.actor)
        return;
    const hasProne = !!findEffectOnToken(token, e => e.statuses?.has('prone'));
    if (!hasProne) {
        ui.notifications.info(`${token.name} is not Prone.`);
        return;
    }
    await removeEffectsByNameFromTokens({ tokens: [token], effectNames: ['prone'] });
    playStandingUpFX(token);
    const speed = token.actor.system?.speed ?? 0;
    await addVirtualMovement(token, speed);
    ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token: token.document }),
        content: `<b>${token.name}</b> stands up, using their standard move (+${speed} speed).`,
    });
}

export async function executeTeleport(token, cost) {
    if (!token?.actor)
        return;
    const api = game.modules.get('lancer-automations')?.api;
    if (!api)
        return;
    const speed = token.actor.system?.speed ?? 0;
    const moveCost = cost ?? speed;
    const result = await api.moveToken(token, {
        teleport: true,
        range: speed,
        cost: moveCost,
        title: "TELEPORT",
        description: `Select destination within Range ${speed}. Costs ${moveCost} movement.`
    });
    if (result)
        playTeleportFX(token);
}

/**
 * Tick a fall: if the token is above ground, reduce elevation by up to 10 spaces.
 * Once it lands, deal 3 AP kinetic per 3 spaces fallen (capped at 9).
 */
export async function executeFall(paramToken) {
    if (!paramToken) {
        ui.notifications.error('lancer-automations | executeFall requires a target token.');
        return;
    }

    const targetToken = paramToken;
    const tokenDoc = targetToken.document;
    const terrainAPI = globalThis.terrainHeightTools;

    // falling implies not flying
    const hasFlyingStatus = !!findEffectOnToken(targetToken, "flying");
    if (hasFlyingStatus) {
        await removeEffectsByNameFromTokens({
            tokens: [targetToken],
            effectNames: ["Flying"]
        });
    }

    const tokenElevation = tokenDoc.elevation || 0;
    const maxGroundHeight = terrainAPI ? getMaxGroundHeightUnderToken(targetToken, terrainAPI) : 0;

    const hasFallingEffect = !!findEffectOnToken(targetToken, "falling");

    if (tokenElevation <= maxGroundHeight) {
        if (hasFallingEffect) {
            ui.notifications.warn('Token is already on the ground');
            await removeEffectsByNameFromTokens({
                tokens: [targetToken],
                effectNames: ["Falling"]
            });
        }
        return;
    }

    let fallStartElevation = Math.max(tokenElevation, tokenDoc.getFlag('lancer-automations', 'fallStartElevation') || 0);
    const fallDistance = tokenElevation - maxGroundHeight;
    const fallAmount = Math.min(10, fallDistance);
    const newElevation = tokenElevation - fallAmount;
    const totalFallAmount = fallStartElevation - newElevation;

    await tokenDoc.update({ elevation: newElevation });
    ui.notifications.info(`Token has fallen ${fallAmount} space${fallAmount !== totalFallAmount ? ` (for a total of ${totalFallAmount})` : ''}`);

    if (newElevation <= maxGroundHeight) {
        await removeEffectsByNameFromTokens({
            tokens: [targetToken],
            effectNames: ["Falling"]
        });

        const totalFallDistance = fallStartElevation - maxGroundHeight;
        const damageGroups = Math.min(3, Math.floor(totalFallDistance / 3));

        if (damageGroups > 0) {
            const totalDamage = damageGroups * 3;
            await executeDamageRoll(targetToken, [targetToken], totalDamage, "Kinetic", "Fall", { ap: true, action: { name: "Fall" } });
        }

        if (newElevation < maxGroundHeight) {
            await tokenDoc.update({ elevation: maxGroundHeight });
        }

        await tokenDoc.unsetFlag('lancer-automations', 'fallStartElevation');

    } else if (!hasFallingEffect) {
        await applyEffectsToTokens({
            tokens: [targetToken],
            effectNames: ["Falling"],
            duration: { label: "unlimited" }
        });
        await tokenDoc.setFlag('lancer-automations', 'fallStartElevation', fallStartElevation);
    } else {
        await tokenDoc.setFlag('lancer-automations', 'fallStartElevation', fallStartElevation);
    }
}
