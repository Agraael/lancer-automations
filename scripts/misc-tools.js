import { removeFlaggedEffectToTokens, applyFlaggedEffectToTokens, findFlaggedEffectOnToken } from "./flagged-effects.js";
import { getMaxGroundHeightUnderToken } from "./terrain-utils.js";

/**
 * Checks the token height and applies fall damage if necessary
 * If the token is above the ground, adds the "falling" tag and reduces height by 10 per tick
 * For every 3 spaces fallen, applies 3 AP kinetic damage
 * @param {Token} paramToken - Token to check
 */
export async function executeFall(paramToken) {
    if (!paramToken) {
        ui.notifications.error('lancer-automations | executeFall requires a target token.');
        return;
    }

    const targetToken = paramToken;

    const terrainAPI = globalThis.terrainHeightTools;

    // Remove Flying status if present - falling means no longer flying
    const hasFlyingStatus = !!findFlaggedEffectOnToken(targetToken, "lancer.statusIconsNames.flying") || !!findFlaggedEffectOnToken(targetToken, "flying");
    if (hasFlyingStatus) {
        await removeFlaggedEffectToTokens({
            tokens: [targetToken],
            effectNames: ["Flying"]
        });
    }

    const tokenElevation = targetToken.document.elevation || 0;
    const maxGroundHeight = terrainAPI ? getMaxGroundHeightUnderToken(targetToken, terrainAPI) : 0;

    const hasFallingEffect = !!findFlaggedEffectOnToken(targetToken, "falling");

    // Check if token is on the ground
    if (tokenElevation <= maxGroundHeight) {
        if (hasFallingEffect) {
            ui.notifications.warn('Token is already on the ground');
            await removeFlaggedEffectToTokens({
                tokens: [targetToken],
                effectNames: ["Falling"]
            });
        }
        return;
    }

    // Calculate fall distance
    let fallStartElevation = Math.max(tokenElevation, targetToken.document.getFlag('lancer-automations', 'fallStartElevation') || 0);
    const fallDistance = tokenElevation - maxGroundHeight;
    const fallAmount = Math.min(10, fallDistance); // Maximum 10 per tick
    const newElevation = tokenElevation - fallAmount;
    const totalFallAmount = fallStartElevation - newElevation;

    // Update token elevation
    await targetToken.document.update({ elevation: newElevation });
    ui.notifications.info(`Token has fallen ${fallAmount} space${fallAmount !== totalFallAmount ? ` (for a total of ${totalFallAmount})` : ''}`);

    // If the token reaches the ground, calculate damage
    if (newElevation <= maxGroundHeight) {
        await removeFlaggedEffectToTokens({
            tokens: [targetToken],
            effectNames: ["Falling"]
        });

        const totalFallDistance = fallStartElevation - maxGroundHeight;

        // Calculate damage: 3 damage for every 3 spaces
        const damageGroups = Math.min(3, Math.floor(totalFallDistance / 3));

        if (damageGroups > 0) {
            const totalDamage = damageGroups * 3;

            targetToken.setTarget(true, { releaseOthers: true, groupSelection: false });

            const DamageRollFlow = game?.lancer?.flows?.get("DamageRollFlow");
            if (DamageRollFlow) {
                const flowData = {
                    title: "Fall",
                    action: { name: "Fall" },
                    damage: [{ val: totalDamage.toString(), type: "Kinetic" }],
                    overkill: false,
                    ap: true
                };
                const flow = new DamageRollFlow(targetToken.actor.uuid, flowData);
                await flow.begin();
            }
        }

        // Adjust final elevation to be exactly at ground level
        if (newElevation < maxGroundHeight) {
            await targetToken.document.update({ elevation: maxGroundHeight });
        }

        // Clean up the flag
        await targetToken.document.unsetFlag('lancer-automations', 'fallStartElevation');

    } else if (!hasFallingEffect) {
        await applyFlaggedEffectToTokens({
            tokens: [targetToken],
            effectNames: ["Falling"],
            duration: { label: "unlimited" }
        });
        await targetToken.document.setFlag('lancer-automations', 'fallStartElevation', fallStartElevation);
    } else {
        await targetToken.document.setFlag('lancer-automations', 'fallStartElevation', fallStartElevation);
    }
}
