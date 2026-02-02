
export function getDefaultItemReactionRegistry() {
    return {
        "npc-rebake_npcf_trait_hunker_down": {
            itemType: "npc_feature",
            reactions: [
                {
                    reactionPath: "system.trigger",
                    triggers: ["onHit"],
                    evaluate: "return data.target?.id === reactorToken.id;"
                }
            ]
        }
    };
}

export function getDefaultGeneralReactionRegistry() {
    // Check if csm-lancer-qol's executeOverwatch is available
    const qol = game.modules.get('csm-lancer-qol');
    const hasExecuteOverwatch = qol?.active && qol.exposed?.executeOverwatch;

    return {
        "Overwatch": {
            triggers: ["onMove"],
            triggerDescription: "A hostile character starts any movement inside one of your weapons' THREAT",
            effectDescription: "Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move",
            isReaction: true,
            evaluate: `const api = game.modules.get('lancer-reactionChecker').api;
const mover = data.triggeringToken;
if (!mover) return false;
return api.checkOverwatchCondition(reactorToken, mover, data.startPos);`,
            activationType: hasExecuteOverwatch ? "code" : "none",
            activationMode: hasExecuteOverwatch ? "instead" : "after",
            activationMacro: "",
            activationCode: hasExecuteOverwatch ? `const qol = game.modules.get('csm-lancer-qol');
await qol.exposed.executeOverwatch(actor);` : ""
        }
    };
}
