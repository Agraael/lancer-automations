
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
    const hasExecuteFall = qol?.active && qol.exposed?.executeFall;

    const builtInDefaults = {
        "Overwatch": {
            triggers: ["onMove"],
            triggerDescription: "A hostile character starts any movement inside one of your weapons' THREAT",
            effectDescription: "Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move",
            isReaction: true,
            evaluate: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const api = game.modules.get('lancer-automations').api;
                const mover = triggerData.triggeringToken;
                if (!mover)
                    return false;
                return api.checkOverwatchCondition(reactorToken, mover, triggerData.startPos);
            },
            activationType: hasExecuteOverwatch ? "code" : "flow",
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
                if (reactorToken.actor?.type !== 'mech')
                    return false;
                if (triggerData.target?.id !== reactorToken.id)
                    return false;

                const currentHP = reactorToken.actor?.system?.hp?.value ?? 0;
                const halfHP = currentHP / 2;
                const totalDamage = (triggerData.damages || []).reduce((sum, d) => sum + (d || 0), 0);
                const wouldKill = (currentHP - totalDamage) <= 0;
                const isHalfHP = totalDamage >= halfHP;

                return wouldKill || isHalfHP;
            },
            activationType: hasExecuteBrace ? "code" : "flow",
            activationMode: hasExecuteBrace ? "instead" : "after",
            activationMacro: "",
            activationCode: hasExecuteBrace ? async function (triggerType, triggerData, reactorToken, item, activationName) {
                const qol = game.modules.get('csm-lancer-qol');
                await qol.exposed.executeBrace(reactorToken.actor);
            } : ""
        },
        "Flight": {
            triggers: ["onStatusApplied", "onStructure", "onStress"],
            triggerDescription: "Protects flying characters from incompatible statuses and triggers saves on structure/stress.",
            effectDescription: "Flying grants immunity to Prone. Immobilized or Stunned removes Flying. Structure or Stress requires an AGILITY save or begin falling.",
            isReaction: false,
            consumesReaction: false,
            autoActivate: false,
            triggerSelf: true,
            triggerOther: false,
            evaluate: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const isFlying = reactorToken.actor?.effects.some(e =>
                    e.statuses?.has('flying') && !e.disabled
                );
                if (!isFlying)
                    return false;

                if (triggerType === 'onStatusApplied') {
                    return ['prone', 'immobilized', 'stunned'].includes(triggerData.statusId);
                }
                if (triggerType === 'onStructure' || triggerType === 'onStress') {
                    return true;
                }
                return false;
            },
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const api = game.modules.get('lancer-automations').api;

                if (triggerType === 'onStatusApplied') {
                    if (triggerData.statusId === 'prone') {
                        await api.removeFlaggedEffectToTokens({ tokens: [reactorToken], effectNames: ["Prone"] });
                        ui.notifications.info(`${reactorToken.name} is flying and immune to Prone!`);
                    } else {
                        await api.removeFlaggedEffectToTokens({ tokens: [reactorToken], effectNames: ["Flying"] });
                        ui.notifications.warn(`${reactorToken.name} became ${triggerData.statusId} and is no longer flying!`);
                    }
                }

                if (triggerType === 'onStructure' || triggerType === 'onStress') {
                    const label = triggerType === 'onStructure' ? 'Structure damage' : 'Stress';
                    const result = await api.performStatRoll(reactorToken.actor, "AGI", `AGILITY Save (${label} while Flying)`);
                    if (result.completed && !result.passed) {
                        await api.removeFlaggedEffectToTokens({ tokens: [reactorToken], effectNames: ["Flying"] });
                        ui.notifications.warn(`${reactorToken.name} failed the AGILITY save and is no longer flying!`);
                    }
                }
            }
        },
        "Fall": {
            triggers: ["onTurnEnd"],
            triggerDescription: "At the end of your turn, if you are airborne without Flying or have Flying but haven't moved at least 1 space, you begin falling.",
            effectDescription: "You fall, taking AP kinetic damage based on the distance fallen (3 damage per 3 spaces, max 9).",
            isReaction: false,
            consumesReaction: false,
            autoActivate: false,
            triggerSelf: true,
            triggerOther: false,
            evaluate: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const terrainAPI = globalThis.terrainHeightTools;
                if (!terrainAPI)
                    return false;

                const api = game.modules.get('lancer-automations').api;
                const elevation = reactorToken.document?.elevation || 0;
                const maxGroundHeight = api.getMaxGroundHeightUnderToken(reactorToken, terrainAPI);

                if (elevation <= maxGroundHeight)
                    return false;

                const isFlying = reactorToken.actor?.effects.some(e =>
                    e.statuses?.has('flying') && !e.disabled
                );

                if (!isFlying)
                    return true;

                const movedDistance = api.getCumulativeMoveData(reactorToken.document.id);
                return movedDistance < 1;
            },
            activationType: hasExecuteFall ? "code" : "flow",
            activationMode: hasExecuteFall ? "instead" : "after",
            activationMacro: "",
            activationCode: hasExecuteFall ? async function (triggerType, triggerData, reactorToken, item, activationName) {
                const qol = game.modules.get('csm-lancer-qol');
                await qol.exposed.executeFall(reactorToken);
            } : ""
        }
    };
    return { ...builtInDefaults, ...externalGeneralReactions };
}
