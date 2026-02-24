
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
            category: "General",
            triggers: ["onMove"],
            triggerDescription: "A hostile character starts any movement inside one of your weapons' THREAT",
            effectDescription: "Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move",
            isReaction: true,
            actionType: "Reaction",
            outOfCombat: true,
            frequency: "Other",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                const api = game.modules.get('lancer-automations').api;
                const mover = triggerData.triggeringToken;
                if (!mover)
                    return false;
                return api.checkOverwatchCondition(reactorToken, mover, triggerData.startPos);
            },
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const api = game.modules.get('lancer-automations').api;
                await api.executeSimpleActivation(reactorToken.actor, {
                    title: "Overwatch",
                    action: {
                        name: "Overwatch",
                        activation: "Reaction",
                    },
                    detail: "Trigger: A hostile character starts any movement (including BOOST and other actions) inside one of your weapons' THREAT.<br>Effect: Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move."
                });
            }
        },
        "Brace": {
            category: "General",
            reactions: [{
                triggers: ["onDamage"],
                triggerDescription: "You are hit by an attack and damage has been rolled.",
                effectDescription: "You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.",
                actionType: "Reaction",
                frequency: "Other",
                isReaction: true,
                consumesReaction: true,
                triggerOther: true,
                triggerSelf: false,
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
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

                    await api.executeSimpleActivation(reactorToken.actor, {
                        title: "Brace",
                        action: {
                            name: "Brace",
                            activation: "Reaction",
                        },
                        detail: "You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions."
                    });
                }
            }, {
                triggers: ["onActivation"],
                triggerDescription: "You are hit by an attack and damage has been rolled.",
                effectDescription: "You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.",
                onlyOnSourceMatch: true,
                autoActivate: true,
                activationType: "code",
                activationMode: "instead",
                actionType: "Reaction",
                frequency: "Other",
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
            }, {
                triggers: ["onStatusApplied", "onStatusRemoved"],
                autoActivate: true,
                activationType: "code",
                activationMode: "instead",
                triggerSelf: true,
                triggerOther: false,
                outOfCombat: true,
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                    return triggerData.statusId === 'brace';
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    const api = game.modules.get('lancer-automations').api;
                    const BRACE_BONUS_ID = 'brace-difficulty-applyToTargetter';

                    if (triggerType === 'onStatusApplied') {
                        await api.addConstantBonus(reactorToken.actor, {
                            id: BRACE_BONUS_ID,
                            name: "Brace",
                            type: "difficulty",
                            val: 1,
                            rollTypes: ["attack"],
                            applyToTargetter: true
                        });
                    } else if (triggerType === 'onStatusRemoved') {
                        await api.removeConstantBonus(reactorToken.actor, BRACE_BONUS_ID);

                        const laggingStatus = CONFIG.statusEffects.find(s => s.id === 'lagging');
                        if (laggingStatus) {
                            await api.applyFlaggedEffectToTokens({
                                tokens: [reactorToken],
                                effectNames: laggingStatus.id,
                                duration: { label: 'start', turns: 1, rounds: 0 },
                                useTokenAsOrigin: true
                            });
                        }
                    }
                }
            }],
        },
        "Flight": {
            category: "General",
            triggers: ["onStatusApplied", "onStructure", "onStress"],
            triggerDescription: "Protects flying characters from incompatible statuses and triggers saves on structure/stress.",
            effectDescription: "Flying grants immunity to Prone. Immobilized or Stunned removes Flying. Structure or Stress requires an AGILITY save or begin falling.",
            isReaction: false,
            consumesReaction: false,
            autoActivate: false,
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
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
            category: "General",
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
            category: "General",
            reactions: [{
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
                    const chosen = await api.chooseToken(reactorToken, {
                        count: 1,
                        range: reactorToken.actor.system.sensor_range,
                        filter: (t) => !api.findFlaggedEffectOnToken(t, "lancer.statusIconsNames.bolster")
                    });
                    if (!chosen || chosen.length === 0)
                        return;
                    const targets = chosen;

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
            }, {
                triggers: ["onInitCheck", "onCheck"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                forceSynchronous: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                    const api = game.modules.get('lancer-automations').api;
                    return !!api.findFlaggedEffectOnToken(reactorToken, "lancer.statusIconsNames.bolster");
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    const api = game.modules.get('lancer-automations').api;
                    if (triggerType === 'onInitCheck') {
                        await api.injectBonusToNextRoll(reactorToken.actor, {
                            name: "Bolster",
                            type: "accuracy",
                            val: 2
                        });
                    } else if (triggerType === 'onCheck') {
                        await api.removeFlaggedEffectToTokens({
                            tokens: [reactorToken],
                            effectNames: ["lancer.statusIconsNames.bolster"]
                        });
                    }
                }
            }]
        },
        "Fragment Signal": {
            category: "General",
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
            category: "General",
            reactions: [{
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
                    const chosen = await api.chooseToken(reactorToken, {
                        count: 1,
                        range: 1,
                        filter: (t) => t.actor.system.size <= reactorToken.actor.system.size
                    });
                    if (!chosen || chosen.length === 0)
                        return;
                    chosen[0].setTarget(true, { releaseOthers: true, groupSelection: false });
                    await api.executeBasicAttack(reactorToken.actor, {
                        title: "Ram",
                        attack_type: "Melee"
                    });
                }
            }, {
                triggers: ["onHit"],
                onlyOnSourceMatch: true,
                activationType: "code",
                activationMode: "instead",
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

                    await api.knockBackToken(targetTokens, 1, { triggeringToken: reactorToken });

                    await api.applyFlaggedEffectToTokens({
                        tokens: targetTokens,
                        effectNames: ["prone"],
                        note: "Ram by " + reactorToken.name,
                        duration: { label: 'end', turns: 1, rounds: 0 },
                        customOriginId: reactorToken.id
                    });
                }
            }]
        },
        "Fall": {
            category: "General",
            reactions: [{
                triggers: ["onTurnEnd"],
                triggerDescription: "At the end of your turn, if you are airborne without Flying or have Flying but haven't moved at least 1 space, you begin falling.",
                effectDescription: "You fall, taking AP kinetic damage based on the distance fallen (3 damage per 3 spaces, max 9).",
                isReaction: false,
                consumesReaction: false,
                autoActivate: false,
                triggerSelf: true,
                triggerOther: false,
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                    const terrainAPI = globalThis.terrainHeightTools;
                    const api = game.modules.get('lancer-automations').api;
                    const elevation = reactorToken.document?.elevation || 0;
                    const maxGroundHeight = terrainAPI ? api.getMaxGroundHeightUnderToken(reactorToken, terrainAPI) : 0;

                    if (elevation <= maxGroundHeight)
                        return false;

                    const isFlying = !!api.findFlaggedEffectOnToken(reactorToken, "lancer.statusIconsNames.flying") || !!api.findFlaggedEffectOnToken(reactorToken, "flying");

                    if (!isFlying)
                        return true;

                    const movedDistance = api.getCumulativeMoveData(reactorToken.document.id);
                    return movedDistance < 1;
                },
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    const api = game.modules.get('lancer-automations').api;
                    if (api.executeFall) {
                        await api.executeFall(reactorToken);
                    }
                }
            }, {
                triggers: ["onDamage"],
                isReaction: false,
                onlyOnSourceMatch: true,
                consumesReaction: false,
                autoActivate: true,
                triggerSelf: true,
                triggerOther: false,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                    reactorToken.setTarget(false, { releaseOthers: true, groupSelection: false });

                    if (typeof Sequencer === 'undefined')
                        return;

                    await Sequencer.Preloader.preloadForClients([
                        "jb2a.impact.boulder.02",
                        "jb2a.impact.ground_crack.white.01",
                        "worlds/Lancer/VTT%20stuff/SFX/IMPACT.mp3"
                    ]);
                    const scale = Math.floor(reactorToken.actor?.system?.size || 1);
                    let sequence = new Sequence()
                        .effect()
                        .file("jb2a.impact.boulder.02")
                        .atLocation(reactorToken)
                        .scale(scale / 2)
                        .effect()
                        .file("jb2a.impact.ground_crack.white.01")
                        .atLocation(reactorToken)
                        .scale(scale / 2)
                        .belowTokens()
                        .sound()
                        .file("worlds/Lancer/VTT%20stuff/SFX/IMPACT.mp3")
                        .volume(game.modules.get("lancer-weapon-fx")?.api?.getEffectVolume(0.7) || 0.7)
                        .waitUntilFinished();

                    await sequence.play();
                }
            }]
        },
        "Engagement": {
            category: "General",
            triggers: ["onUpdate", "onPreMove"],
            triggerDescription: "When a character moves",
            effectDescription: "Targets of equal or greater size stop the character's movement, and engagement status is updated.",
            isReaction: false,
            consumesReaction: false,
            autoActivate: true,
            forceSynchronous: true,
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                if (triggerType === "onUpdate") {
                    const c = triggerData.change || {};
                    if (c.x !== undefined || c.y !== undefined || c.elevation !== undefined) {
                        return true;
                    }
                    return false;
                }

                if (triggerType === "onPreMove") {
                    const moveInfo = triggerData.moveInfo;
                    if (!moveInfo || !moveInfo.pathHexes || moveInfo.pathHexes.length === 0)
                        return false;
                    if (moveInfo.isTeleport || moveInfo.isModified)
                        return false;

                    const api = game.modules.get('lancer-automations')?.api;
                    if (api.findFlaggedEffectOnToken(reactorToken, "lancer.statusIconsNames.hidden") ||
                        api.findFlaggedEffectOnToken(reactorToken, "disengage") ||
                        api.findFlaggedEffectOnToken(reactorToken, "lancer.statusIconsNames.intangible") ||
                        reactorToken.actor?.effects.some(e => e.statuses?.has("hidden") || e.statuses?.has("disengage") || e.statuses?.has("intangible"))) {
                        return false;
                    }

                    const isAlreadyEngaged = api.findFlaggedEffectOnToken(reactorToken, "lancer.statusIconsNames.engaged") ||
                        reactorToken.actor?.effects.some(e => e.statuses?.has("engaged"));
                    if (isAlreadyEngaged)
                        return false;

                    return true;
                }
                return false;
            },
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                if (triggerType === "onUpdate") {
                    const api = game.modules.get('lancer-automations')?.api;
                    api.updateAllEngagements();
                    return;
                }

                if (triggerType === "onPreMove") {
                    const api = game.modules.get('lancer-automations')?.api;
                    const moveInfo = triggerData.moveInfo;
                    const allTokens = canvas.tokens.placeables;
                    const mover = reactorToken;


                    const historyStart = Math.max(1, moveInfo.pathHexes.historyStartIndex);
                    let stoppedBy = null;
                    let interceptIndex = -1;

                    for (let i = historyStart; i < historyStart + triggerData.distanceToMove; i++) {
                        const stepPos = moveInfo.pathHexes[i];

                        for (const other of allTokens) {
                            if (!api.canEngage(mover, other))
                                continue;

                            if (api.getMinGridDistance(mover, other, stepPos) <= 1) {
                                if (other.actor?.system?.size >= mover.actor?.system?.size) {
                                    stoppedBy = other;
                                    interceptIndex = i;
                                    break;
                                }
                            }
                        }
                        if (stoppedBy)
                            break;
                    }

                    if (stoppedBy && interceptIndex < moveInfo.pathHexes.length - 1) {
                        const pt = moveInfo.pathHexes.getPathPositionAt(interceptIndex);
                        const interceptPoint = pt || moveInfo.pathHexes[interceptIndex];
                        await triggerData.changeTriggeredMove(interceptPoint, { stopTokenId: stoppedBy.id }, `Stopped by Engagement (${stoppedBy.name})`, true);
                    }
                }
            }
        },
        "Disengage": {
            category: "General",
            triggers: ["onActivation"],
            effectDescription: "Until the end of your current turn, you ignore engagement and your movement does not provoke reactions.",
            actionType: "Full Action",
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const api = game.modules.get('lancer-automations').api;
                await api.applyFlaggedEffectToTokens({
                    tokens: [reactorToken],
                    effectNames: ["Disengage"],
                    duration: { label: 'end', turns: 1, rounds: 0 },
                    useTokenAsOrigin: true
                });
            }
        }

    };
    return { ...builtInDefaults, ...externalGeneralReactions };
}
