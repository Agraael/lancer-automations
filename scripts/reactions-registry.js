
const externalItemReactions = {};
const externalGeneralReactions = {};

export function registerExternalItemReactions(reactions) {
    Object.assign(externalItemReactions, reactions);
}

export function registerExternalGeneralReactions(reactions) {
    Object.assign(externalGeneralReactions, reactions);
}

export function getDefaultItemReactionRegistry() {
    const builtInDefaults = {};
    return { ...builtInDefaults, ...externalItemReactions };
}

export function getDefaultGeneralReactionRegistry() {
    const qol = game.modules.get('csm-lancer-qol');
    const hasExecuteOverwatch = qol?.active && qol.exposed?.executeOverwatch;
    const hasExecuteBrace = qol?.active && qol.exposed?.executeBrace;

    const builtInDefaults = {
        "Overwatch": {
            triggers: ["onMove"],
            triggerDescription: "A hostile character starts any movement inside one of your weapons' THREAT",
            effectDescription: "Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move",
            isReaction: true,
            evaluate: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const api = game.modules.get('lancer-reactionChecker').api;
                const mover = triggerData.triggeringToken;
                if (!mover) return false;
                return api.checkOverwatchCondition(reactorToken, mover, triggerData.startPos);
            },
            activationType: hasExecuteOverwatch ? "code" : "none",
            activationMode: hasExecuteOverwatch ? "instead" : "after",
            activationMacro: "",
            activationCode: hasExecuteOverwatch ? async function (triggerType, triggerData, reactorToken, item, activationName) {
                const qol = game.modules.get('csm-lancer-qol');
                await qol.exposed.executeOverwatch(reactorToken.actor);
            } : ""
        },
        "Brace": {
            triggers: ["onDamage"],
            triggerDescription: "You are hit by an attack and damage has been rolled.",
            effectDescription: "You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.",
            isReaction: true,
            triggerOther: true,
            triggerSelf: false,
            evaluate: async function (triggerType, triggerData, reactorToken, item, activationName) {
                if (reactorToken.actor?.type !== 'mech') return false;
                if (triggerData.target?.id !== reactorToken.id) return false;

                const currentHP = reactorToken.actor?.system?.hp?.value ?? 0;
                const halfHP = currentHP / 2;
                const totalDamage = (triggerData.damages || []).reduce((sum, d) => sum + (d || 0), 0);
                const wouldKill = (currentHP - totalDamage) <= 0;
                const isHalfHP = totalDamage >= halfHP;

                return wouldKill || isHalfHP;
            },
            activationType: hasExecuteBrace ? "code" : "none",
            activationMode: hasExecuteBrace ? "instead" : "after",
            activationMacro: "",
            activationCode: hasExecuteBrace ? async function (triggerType, triggerData, reactorToken, item, activationName) {
                const qol = game.modules.get('csm-lancer-qol');
                await qol.exposed.executeBrace(reactorToken.actor);
            } : ""
        }
    };
    return { ...builtInDefaults, ...externalGeneralReactions };
}
