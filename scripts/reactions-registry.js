
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
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const SimpleActivationFlow = game.lancer?.flows?.get("SimpleActivationFlow");
                const flow = new SimpleActivationFlow(reactorToken.actor, {
                    title: "Overwatch",
                    action: {
                        name: "Overwatch",
                        activation: "Reaction",
                    },
                    detail: "Trigger: A hostile character starts any movement (including BOOST and other actions) inside one of your weapons' THREAT.<br>Effect: Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move."
                });
                await flow.begin();
            }
        },
        "Brace": {
            reactions: [{
                triggers: ["onDamage"],
                triggerDescription: "You are hit by an attack and damage has been rolled.",
                effectDescription: "You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.",
                actionType: "Reaction",
                frequency: "1/Round",
                isReaction: true,
                consumesReaction: true,
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
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    const api = game.modules.get('lancer-automations').api;

                    const SimpleActivationFlow = game.lancer?.flows?.get("SimpleActivationFlow");
                    const flow = new SimpleActivationFlow(reactorToken.actor, {
                        title: "Brace",
                        action: {
                            name: "Brace",
                            activation: "Reaction",
                        },
                        detail: "You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions."
                    });
                    await flow.begin();
                }
            }, {
                triggers: ["onInitAttack"],
                triggerDescription: "When an attack is initiated against a braced target, +1 difficulty is applied.",
                effectDescription: "All attacks against a braced character are made at +1 difficulty until the end of their next turn.",
                isReaction: false,
                consumesReaction: false,
                autoActivate: true,
                triggerSelf: false,
                triggerOther: true,
                evaluate: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    const api = game.modules.get('lancer-automations').api;
                    const braceEffect = api.findFlaggedEffectOnToken(reactorToken, "Brace");
                    if (!braceEffect)
                        return false;

                    const targets = triggerData.targets || [];
                    return targets.some(t => t?.id === reactorToken.id);
                },
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    const attacker = triggerData.triggeringToken?.actor;
                    if (!attacker)
                        return;

                    const ephemeralBonuses = attacker.getFlag("lancer-automations", "ephemeral_bonuses") || [];
                    ephemeralBonuses.push({
                        name: "Brace",
                        type: "damage",
                        targetTypes: ["all"],
                        applyTo: [reactorToken.id],
                        damage: [{ type: "Kinetic", val: "1d6" }]
                    });
                    await attacker.setFlag("lancer-automations", "ephemeral_bonuses", ephemeralBonuses);
                }
            }, {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                autoActivate: true,
                activationType: "code",
                activationMode: "instead",
                actionType: "Reaction",
                frequency: "1/Round",
                isReaction: true,
                consumesReaction: true,
                triggerSelf: true,
                triggerOther: false,
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    const api = game.modules.get('lancer-automations').api;
                    const validTokens = await api.applyFlaggedEffectToTokens({
                        tokens: [reactorToken],
                        effectNames: "brace",
                        note: "brace",
                        duration: { label: 'end', turns: 1, rounds: 0 },
                        useTokenAsOrigin: true
                    });

                    if (!validTokens || validTokens.length === 0)
                        return;

                    const weaponFx = game.modules.get("lancer-weapon-fx");
                    if (!weaponFx?.active || typeof Sequencer === 'undefined')
                        return;

                    await Sequencer.Preloader.preloadForClients(["modules/lancer-weapon-fx/soundfx/PPC_Charge.ogg", "jb2a.shield.01.intro.blue"]);
                    validTokens.forEach(token => {
                        let sequence = new Sequence()
                            .sound()
                            .file("modules/lancer-weapon-fx/soundfx/PPC_Charge.ogg")
                            .volume(weaponFx.api.getEffectVolume(0.7))
                            .effect()
                            .file("jb2a.shield.01.intro.blue")
                            .scaleToObject(2)
                            .filter("Glow", { color: 0x4169E1 })
                            .playbackRate(1.3)
                            .atLocation(token)
                            .waitUntilFinished(-400);
                        sequence.play();
                    });
                }
            }],
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
                        await api.triggerFlaggedEffectImmunity(reactorToken, ["Prone"], "Flying");
                    } else {
                        await api.removeFlaggedEffectToTokens({ tokens: [reactorToken], effectNames: ["Flying"], notify: true });
                    }
                }

                if (triggerType === 'onStructure' || triggerType === 'onStress') {
                    const label = triggerType === 'onStructure' ? 'Structure damage' : 'Stress';
                    const result = await api.executeStatRoll(reactorToken.actor, "AGI", `AGILITY Save (${label} while Flying)`);
                    if (result.completed && !result.passed) {
                        await api.removeFlaggedEffectToTokens({ tokens: [reactorToken], effectNames: ["Flying"], notify: true });
                    }
                }
            }
        },
        "Lock On": {
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            activationType: "code",
            activationMode: "instead",
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const api = game.modules.get('lancer-automations').api;
                const targets = Array.from(game.user.targets);

                if (targets.length === 0) {
                    return ui.notifications.warn('No targets selected!');
                }

                await api.applyFlaggedEffectToTokens({
                    tokens: targets,
                    effectNames: ["lockon"],
                    note: "Lock On",
                    useTokenAsOrigin: true
                });

                const targetsWithLockOn = targets.filter(target =>
                    api.findFlaggedEffectOnToken(target, "lockon")
                );

                if (targetsWithLockOn.length === 0)
                    return;

                const weaponFx = game.modules.get("lancer-weapon-fx");
                if (!weaponFx?.active || typeof Sequencer === 'undefined')
                    return;

                await Sequencer.Preloader.preloadForClients([
                    "modules/lancer-weapon-fx/soundfx/LockOn.ogg",
                    "jb2a.zoning.inward.square.once.redyellow.01.01",
                ]);

                let sequence = new Sequence();
                for (const target of targetsWithLockOn) {
                    sequence
                        .sound()
                        .file("modules/lancer-weapon-fx/soundfx/LockOn.ogg")
                        .volume(weaponFx.api.getEffectVolume(0.8));
                    sequence.effect().file("jb2a.zoning.inward.square.once.redyellow.01.01").atLocation(target).scaleToObject(1.6);
                }
                sequence.play();
            }
        },
        "Bolster": {
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            activationType: "code",
            activationMode: "instead",
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const targets = Array.from(game.user.targets);
                if (targets.length === 0) {
                    return ui.notifications.warn('No targets selected!');
                }

                const api = game.modules.get('lancer-automations').api;
                const validTargets = await api.applyFlaggedEffectToTokens({
                    tokens: targets,
                    effectNames: "lancer.statusIconsNames.bolster",
                    note: "Bolster",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                    useTokenAsOrigin: true
                });

                if (!validTargets || validTargets.length === 0)
                    return;

                const weaponFx = game.modules.get("lancer-weapon-fx");
                if (!weaponFx?.active || typeof Sequencer === 'undefined')
                    return;

                await Sequencer.Preloader.preloadForClients([
                    "modules/lancer-weapon-fx/soundfx/TechPrepare.ogg",
                    "jb2a.zoning.inward.circle.once.bluegreen.01.01",
                ]);

                validTargets.forEach(target => {
                    let sequence = new Sequence()
                        .sound()
                        .file("modules/lancer-weapon-fx/soundfx/TechPrepare.ogg")
                        .volume(weaponFx.api.getEffectVolume(0.7))
                        .effect()
                        .file("jb2a.zoning.inward.circle.once.bluegreen.01.01")
                        .scaleToObject(1.5)
                        .filter("Glow", { color: 0x36c11a })
                        .playbackRate(1.3)
                        .atLocation(target)
                        .waitUntilFinished(-400);

                    sequence.play();
                });
            }
        },
        "Fragment Signal": {
            triggers: ["onTechHit"],
            onlyOnSourceMatch: true,
            activationType: "code",
            activationMode: "instead",
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const targets = triggerData.targets;
                if (!targets || targets.length === 0)
                    return;
                const targetTokens = targets.map(t => t.target);

                const actor = reactorToken.actor;
                const effects = actor.type === 'npc'
                    ? ["lancer.statusIconsNames.impaired"]
                    : ["lancer.statusIconsNames.slow", "lancer.statusIconsNames.impaired"];

                const api = game.modules.get('lancer-automations').api;
                await api.applyFlaggedEffectToTokens({
                    tokens: targetTokens,
                    effectNames: effects,
                    duration: { label: 'end', turns: 1, rounds: 0 },
                    useTokenAsOrigin: true
                });
            }
        },
        "Ram": {
            triggers: ["onHit"],
            onlyOnSourceMatch: true,
            activationType: "code",
            activationMode: "instead",
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const api = game.modules.get('lancer-automations').api;
                const targets = triggerData.targets;
                if (!targets || targets.length === 0)
                    return;
                const targetTokens = targets.map(t => t.target);

                await api.applyFlaggedEffectToTokens({
                    tokens: targetTokens,
                    effectNames: ["prone"],
                    note: "Ram by " + reactorToken.name,
                    duration: { label: 'end', turns: 1, rounds: 0 },
                    customOriginId: reactorToken.id
                });
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
