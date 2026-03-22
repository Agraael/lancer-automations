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
    const builtInDefaults = {
        "Overwatch": {
            category: "General",
            reactions: [{
                comments: "Reaction Skirmish",
                triggers: ["onMove"],
                triggerDescription: "A hostile character starts any movement inside one of your weapons' THREAT",
                effectDescription: "Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move",
                isReaction: true,
                actionType: "Reaction",
                outOfCombat: true,
                frequency: "Other",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const mover = triggerData.triggeringToken;
                    if (!mover)
                        return false;
                    return api.checkOverwatchCondition(reactorToken, mover, triggerData.startPos);
                },
                activationType: "code",
                activationMode: "instead",
                activationCode: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    api.executeSimpleActivation(reactorToken.actor, {
                        title: "Overwatch",
                        action: {
                            name: "Overwatch",
                            activation: "Reaction",
                        },
                        detail: "Trigger: A hostile character starts any movement (including BOOST and other actions) inside one of your weapons' THREAT.<br>Effect: Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move."
                    });
                }
            }, {
                comments: "Overwatch v2",
                triggers: ["onPreMove"],
                triggerSelf: false,
                triggerOther: true,
                outOfCombat: false,
                enabled: false,
                actionType: "Reaction",
                frequency: "Other",
                isReaction: true,
                checkReaction: true,
                autoActivate: true,
                forceSynchronous: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const mover = triggerData.triggeringToken;
                    if (!mover)
                        return false;
                    if (triggerData.moveInfo?.isInvoluntary)
                        return false;
                    if (api.isFriendly(reactorToken, mover))
                        return false;
                    const ranges = api.getMaxWeaponRanges_WithBonus(reactorToken);
                    const maxThreat = ranges.Threat || 1;
                    const distance = api.getTokenDistance(reactorToken, mover);
                    return maxThreat > 1 && distance > 1 && maxThreat >= distance;
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const mover = triggerData.triggeringToken;
                    if (!mover)
                        return;
                    let preConfirmResponderIds = [];
                    const preConfirm = async () => {
                        const result = await api.startChoiceCard({
                            title: "OVERWATCH",
                            icon: api.getActivationIcon("reaction"),
                            description: `<b>${mover.name}</b> is moving through <b>${reactorToken.name}</b>'s threat range. Fire?`,
                            originToken: reactorToken,
                            relatedToken: mover,
                            userIdControl: api.getTokenOwnerUserId(reactorToken),
                            choices: [
                                { text: "Fire", icon: "fas fa-crosshairs", callback: async () => {} },
                                { text: "Let pass", icon: "fas fa-times", callback: async () => {} }
                            ]
                        });
                        preConfirmResponderIds = result?.responderIds ?? [];
                        if (result?.choiceIdx === 0) {
                            await triggerData.startRelatedFlowToReactor(preConfirmResponderIds[0], { moverTokenId: mover.id });
                            await api.startChoiceCard({
                                title: `WAITING — ${reactorToken.name.toUpperCase()} OVERWATCH`,
                                description: `Waiting for <b>${reactorToken.name}</b> to resolve Overwatch against <b>${mover.name}</b>.`,
                                originToken: reactorToken,
                                icon: api.getActivationIcon("reaction"),
                                relatedToken: mover,
                                userIdControl: null,
                                choices: [
                                    { text: "Confirm", icon: "fas fa-check", callback: async () => {} }
                                ]
                            });
                        }
                        return false;
                    };
                    const postChoice = async () => {};
                    triggerData.cancelTriggeredMove?.(
                        `<b>${reactorToken.name}</b> triggers Overwatch against <b>${mover.name}</b>.`,
                        true,
                        api.getTokenOwnerUserId(mover),
                        preConfirm,
                        postChoice,
                        { originToken: reactorToken, relatedToken: mover }
                    );
                }
            }, {
                comments: "Overwatch v2",
                triggers: ["onActivation"],
                triggerSelf: true,
                triggerOther: false,
                outOfCombat: false,
                enabled: false,
                actionType: "Reaction",
                frequency: "Other",
                autoActivate: true,
                onlyOnSourceMatch: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const moverId = triggerData.extraData?.moverTokenId ?? null;
                    const mover = moverId ? canvas.tokens.get(moverId) ?? null : null;
                    const distance = mover ? api.getTokenDistance(reactorToken, mover) : 0;
                    const weaponFilter = distance > 0
                        ? (w) => {
                            const ranges = api.getMaxWeaponRanges_WithBonus(w);
                            return (ranges.Threat || 1) >= distance;
                        }
                        : null;
                    await api.executeSkirmish(reactorToken.actor, null, mover, weaponFilter);
                }
            }]
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
                checkReaction: true,
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
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
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
                comments: "Apply Brace Status",
                triggerDescription: "You are hit by an attack and damage has been rolled.",
                effectDescription: "You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.",
                onlyOnSourceMatch: true,
                autoActivate: true,
                activationType: "code",
                activationMode: "instead",
                actionType: "Reaction",
                frequency: "Other",
                isReaction: true,
                checkReaction: true,
                triggerSelf: true,
                triggerOther: false,
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const validTokens = await api.applyEffectsToTokens({
                        tokens: [reactorToken],
                        effectNames: "brace",
                        note: "brace",
                        duration: { label: 'end', turns: 1, rounds: 0 }
                    });

                    if (!validTokens || validTokens.length === 0)
                        return;

                    const weaponFx = game.modules.get("lancer-weapon-fx");
                    if (!weaponFx?.active || typeof Sequencer === 'undefined')
                        return;

                    await Sequencer.Preloader.preloadForClients(["modules/lancer-weapon-fx/soundfx/PPC_Charge.ogg", "jb2a.shield.01.intro.blue", "modules/lancer-automations/SFX/Brace.svg"]);
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
                            .waitUntilFinished(-400)
                            .effect()
                            .file("modules/lancer-automations/SFX/Brace.svg")
                            .attachTo(token, { align: "bottom-left", edge: "inner", offset: { x: -0.07, y: -0.07 }, gridUnits: true })
                            .scaleIn(0.01, 500)
                            .scale(0.09)
                            .scaleOut(0.01, 900)
                            .filter("Glow", { distance: 2, color: 0x000000 })
                            .aboveInterface()
                            .duration(3000)
                            .fadeIn(400)
                            .fadeOut(800);
                        sequence.play();
                    });
                }
            }, {
                triggers: ["onStatusApplied", "onStatusRemoved"],
                comments: "Add bonuses while Braced",
                autoActivate: true,
                activationType: "code",
                activationMode: "instead",
                triggerSelf: true,
                triggerOther: false,
                outOfCombat: true,
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                    return triggerData.statusId === 'brace';
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
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
                            await api.applyEffectsToTokens({
                                tokens: [reactorToken],
                                effectNames: laggingStatus.id,
                                duration: { label: 'start', turns: 1, rounds: 0 }
                            });
                        }
                    }
                }
            }],
        },
        "Flight": {
            category: "General",
            comments: "Prone Immunity / Falling Check",
            triggers: ["onStatusApplied", "onStructure", "onStress"],
            triggerDescription: "Protects flying characters from incompatible statuses and triggers saves on structure/stress.",
            effectDescription: "Flying grants immunity to Prone. Immobilized or Stunned removes Flying. Structure or Stress requires an AGILITY save or begin falling.",
            isReaction: false,
            checkReaction: false,
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
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (triggerType === 'onStatusApplied') {
                    if (triggerData.statusId === 'prone') {
                        await api.triggerEffectImmunity(reactorToken, ["Prone"], "Flying");
                    } else {
                        await api.removeEffectsByNameFromTokens({ tokens: [reactorToken], effectNames: ["Flying"], notify: true });
                    }
                }

                if (triggerType === 'onStructure' || triggerType === 'onStress') {
                    const label = triggerType === 'onStructure' ? 'Structure damage' : 'Stress';
                    const result = await api.executeStatRoll(reactorToken.actor, "AGI", `AGILITY Save (${label} while Flying)`);
                    if (result.completed && !result.passed) {
                        await api.removeEffectsByNameFromTokens({ tokens: [reactorToken], effectNames: ["Flying"], notify: true });
                    }
                }
            }
        },
        "Lock On": {
            category: "General",
            comments: "Apply Lock On Status",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            activationType: "code",
            activationMode: "instead",
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const targets = Array.from(game.user.targets);

                if (targets.length === 0) {
                    return ui.notifications.warn('No targets selected!');
                }

                await api.applyEffectsToTokens({
                    tokens: targets,
                    effectNames: ["lockon"],
                    note: "Lock On"
                });

                const targetsWithLockOn = targets.filter(target =>
                    api.findEffectOnToken(target, "lockon")
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


                for (const target of targetsWithLockOn) {
                    let sequence = new Sequence()
                        .sound()
                        .file("modules/lancer-weapon-fx/soundfx/LockOn.ogg")
                        .volume(weaponFx.api.getEffectVolume(0.8))
                        .effect()
                        .file("modules/lancer-automations/SFX/Lockon.svg")
                        .attachTo(target, { align: "bottom-left", edge: "inner", offset: { x: -0.07, y: -0.07 }, gridUnits: true })
                        .scaleIn(0.01, 500)
                        .scale(0.09)
                        .scaleOut(0.01, 900)
                        .filter("Glow", { distance: 2, color: 0x000000 })
                        .aboveInterface()
                        .duration(3000)
                        .fadeIn(400)
                        .fadeOut(800)
                        .effect()
                        .file("jb2a.zoning.inward.square.once.redyellow.01.01")
                        .atLocation(target)
                        .scaleToObject(1.6);
                    sequence.play();
                }

            }
        },
        "Bolster": {
            category: "General",
            reactions: [{
                triggers: ["onActivation"],
                comments: "Grant Bolster to Ally",
                onlyOnSourceMatch: true,
                activationType: "code",
                activationMode: "instead",
                actionType: "Quick Action",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const chosen = await api.chooseToken(reactorToken, {
                        count: 1,
                        range: reactorToken.actor.system.sensor_range,
                        filter: (t) => !api.findEffectOnToken(t, "bolster")
                    });
                    if (!chosen || chosen.length === 0)
                        return;
                    const targets = chosen;

                    const validTargets = await api.applyEffectsToTokens({
                        tokens: targets,
                        effectNames: "bolster",
                        note: "Bolster",
                        duration: { label: 'end', turns: 1, rounds: 0 }
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
                            .file("modules/lancer-automations/SFX/Bolster.svg")
                            .attachTo(target, { align: "bottom-left", edge: "inner", offset: { x: -0.07, y: -0.07 }, gridUnits: true })
                            .scaleIn(0.01, 500)
                            .scale(0.09)
                            .scaleOut(0.01, 900)
                            .filter("Glow", { distance: 2, color: 0x000000 })
                            .aboveInterface()
                            .duration(3000)
                            .fadeIn(400)
                            .fadeOut(800)
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
                comments: "Consume Bolster for Accuracy",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                forceSynchronous: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    return !!api.findEffectOnToken(reactorToken, "lancer.statusIconsNames.bolster");
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    if (triggerType === 'onInitCheck') {
                        triggerData.flowState.injectBonus({
                            name: "Bolster",
                            type: "accuracy",
                            val: 2
                        });

                    } else if (triggerType === 'onCheck') {
                        await api.removeEffectsByNameFromTokens({
                            tokens: [reactorToken],
                            effectNames: ["lancer.statusIconsNames.bolster"]
                        });
                    }
                }
            }]
        },
        "Aid": {
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
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const chosen = await api.chooseToken(reactorToken, {
                        count: 1,
                        range: 1,
                        filter: (t) => !api.findEffectOnToken(t, "Aided")
                    });
                    if (!chosen || chosen.length === 0)
                        return;

                    const validTargets = await api.applyEffectsToTokens({
                        tokens: chosen,
                        effectNames: ["Aided"],
                        note: "Aid",
                        duration: { label: 'end', turns: 1, rounds: 0 }
                    });

                    if (!validTargets || validTargets.length === 0)
                        return;

                    const weaponFx = game.modules.get("lancer-weapon-fx");
                    if (!weaponFx?.active || typeof Sequencer === 'undefined')
                        return;

                    await Sequencer.Preloader.preloadForClients([
                        "modules/lancer-automations/SFX/activation-sound-effect.wav",
                        "jb2a.healing_generic.400px.blue",
                    ]);

                    validTargets.forEach(target => {
                        let sequence = new Sequence()
                            .sound()
                            .file("modules/lancer-automations/SFX/activation-sound-effect.wav")
                            .volume(weaponFx.api.getEffectVolume(0.7))
                            .effect()
                            .file("modules/lancer-automations/SFX/Aid.svg")
                            .attachTo(target, { align: "bottom-left", edge: "inner", offset: { x: -0.07, y: -0.07 }, gridUnits: true })
                            .scaleIn(0.01, 500)
                            .scale(0.09)
                            .scaleOut(0.01, 900)
                            .filter("Glow", { distance: 2, color: 0x000000 })
                            .aboveInterface()
                            .duration(3000)
                            .fadeIn(400)
                            .fadeOut(800)
                            .effect()
                            .file("jb2a.healing_generic.400px.blue")
                            .scaleToObject(1.5)
                            .playbackRate(1.3)
                            .atLocation(target)
                            .waitUntilFinished(-400);
                        sequence.play();
                    });
                }
            }]
        },
        "Stabilize": {
            category: "General",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            activationType: "code",
            activationMode: "instead",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                return !!api.findEffectOnToken(reactorToken, "Aided");
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                await api.removeEffectsByNameFromTokens({
                    tokens: [reactorToken],
                    effectNames: ["Aided"]
                });
                ui.notifications.info(`${reactorToken.name} stabilizes as a Quick Action (Aided).`);
            }
        },
        "Fragment Signal": {
            category: "General",
            comments: "Impair/Slow on Tech Hit",
            triggers: ["onTechHit"],
            onlyOnSourceMatch: true,
            activationType: "code",
            activationMode: "instead",
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const targets = triggerData.targets;
                if (!targets || targets.length === 0)
                    return;
                const targetTokens = targets.map(t => t.target);

                const actor = reactorToken.actor;
                const effects = actor.type === 'npc'
                    ? ["impaired"]
                    : ["slow", "impaired"];

                await api.applyEffectsToTokens({
                    tokens: targetTokens,
                    effectNames: effects,
                    duration: { label: 'end', turns: 1, rounds: 0 }
                });
            }
        },
        "Ram": {
            category: "General",
            reactions: [{
                triggers: ["onActivation"],
                comments: "Execute Ram Attack",
                onlyOnSourceMatch: true,
                activationType: "code",
                activationMode: "instead",
                actionType: "Quick Action",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
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
                comments: "Apply Knockback and Prone",
                onlyOnSourceMatch: true,
                activationType: "code",
                activationMode: "instead",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const targets = triggerData.targets;
                    if (!targets || targets.length === 0)
                        return;
                    const targetTokens = targets.map(t => t.target);

                    await api.knockBackToken(targetTokens, 1, { triggeringToken: reactorToken });

                    await api.applyEffectsToTokens({
                        tokens: targetTokens,
                        effectNames: ["prone"],
                        note: "Ram by " + reactorToken.name,
                        duration: { label: 'end', turns: 1, rounds: 0, overrideTurnOriginId: reactorToken.id },
                    });
                }
            }]
        },
        "Fall": {
            category: "General",
            reactions: [{
                triggers: ["onTurnEnd"],
                comments: "Check for Airborne Falling",
                triggerDescription: "At the end of your turn, if you are airborne without Flying or have Flying but haven't moved at least 1 space, you begin falling.",
                effectDescription: "You fall, taking AP kinetic damage based on the distance fallen (3 damage per 3 spaces, max 9).",
                isReaction: false,
                checkReaction: false,
                autoActivate: true,
                triggerSelf: true,
                triggerOther: false,
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const terrainAPI = globalThis.terrainHeightTools;
                    const elevation = reactorToken.document?.elevation || 0;
                    const maxGroundHeight = terrainAPI ? api.getMaxGroundHeightUnderToken(reactorToken, terrainAPI) : 0;

                    if (elevation <= maxGroundHeight)
                        return false;

                    const isFlying = !!api.findEffectOnToken(reactorToken, "lancer.statusIconsNames.flying") || !!api.findEffectOnToken(reactorToken, "flying");

                    if (!isFlying)
                        return true;

                    const movedDistance = api.getCumulativeMoveData(reactorToken.document.id);
                    return movedDistance < 1;
                },
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const gmUserId = game.users.find(u => u.isGM && u.active)?.id;
                    await api.startChoiceCard({
                        title: "FALLING?",
                        description: `<b>${reactorToken.name}</b> is hanging in the air. Does it fall?`,
                        item,
                        originToken: reactorToken,
                        userIdControl: gmUserId,
                        choices: [
                            {
                                text: "Yes, it falls",
                                icon: "fas fa-arrow-down",
                                callback: async () => {
                                    await api.executeFall(reactorToken);

                                    const weaponFx = game.modules.get("lancer-weapon-fx");
                                    if (!weaponFx?.active || typeof Sequencer === 'undefined')
                                        return;

                                    await Sequencer.Preloader.preloadForClients([
                                        "modules/lancer-automations/SFX/fall.mp3",
                                        "modules/lancer-automations/SFX/falling.svg"
                                    ]);
                                    new Sequence()
                                        .sound()
                                        .file("modules/lancer-automations/SFX/fall.mp3")
                                        .volume(weaponFx.api.getEffectVolume(0.7))
                                        .atLocation(reactorToken)
                                        .effect()
                                        .file("modules/lancer-automations/SFX/falling.svg")
                                        .attachTo(reactorToken, { align: "bottom-left", edge: "inner", offset: { x: -0.07, y: -0.07 }, gridUnits: true })
                                        .scaleIn(0.01, 500)
                                        .scale(0.09)
                                        .scaleOut(0.01, 900)
                                        .filter("Glow", { distance: 2, color: 0x000000 })
                                        .aboveInterface()
                                        .duration(3000)
                                        .fadeIn(400)
                                        .fadeOut(800)
                                        .play();
                                }
                            },
                            { text: "No", icon: "fas fa-times" }
                        ]
                    });
                }
            }, {
                triggers: ["onDamage"],
                comments: "Ground Impact",
                isReaction: false,
                onlyOnSourceMatch: true,
                checkReaction: false,
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
                        "modules/lancer-automations/SFX/IMPACT.mp3"
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
                        .file("modules/lancer-automations/SFX/IMPACT.mp3")
                        .volume(game.modules.get("lancer-weapon-fx")?.api?.getEffectVolume(0.7) || 0.7)
                        .waitUntilFinished();

                    await sequence.play();
                }
            }]
        },
        "Engagement": {
            category: "General",
            comments: "Stop Movement & Engagement",
            triggers: ["onUpdate", "onPreMove"],
            triggerDescription: "When a character moves",
            effectDescription: "Targets of equal or greater size stop the character's movement, and engagement status is updated.",
            isReaction: false,
            checkReaction: false,
            autoActivate: true,
            forceSynchronous: true,
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: false,
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (triggerType === "onUpdate") {
                    const c = triggerData.change || {};
                    if (c.x !== undefined || c.y !== undefined || c.elevation !== undefined) {
                        return true;
                    }
                    return false;
                }

                if (triggerType === "onPreMove") {
                    const moveInfo = triggerData.moveInfo;
                    if (!moveInfo?.pathHexes || moveInfo.pathHexes.length === 0)
                        return false;
                    if (moveInfo.isTeleport || moveInfo.isModified)
                        return false;

                    if (api.findEffectOnToken(reactorToken, "lancer.statusIconsNames.hidden") ||
                        api.findEffectOnToken(reactorToken, "disengage") ||
                        api.findEffectOnToken(reactorToken, "lancer.statusIconsNames.intangible") ||
                        reactorToken.actor?.effects.some(e => e.statuses?.has("hidden") || e.statuses?.has("disengage") || e.statuses?.has("intangible"))) {
                        return false;
                    }

                    const isAlreadyEngaged = api.findEffectOnToken(reactorToken, "lancer.statusIconsNames.engaged") ||
                        reactorToken.actor?.effects.some(e => e.statuses?.has("engaged"));
                    if (isAlreadyEngaged)
                        return false;

                    return true;
                }
                return false;
            },
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (triggerType === "onUpdate") {
                    api.updateAllEngagements();
                    return;
                }

                if (triggerType === "onPreMove") {
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
            comments: "Apply Disengage Status",
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
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                await api.applyEffectsToTokens({
                    tokens: [reactorToken],
                    effectNames: ["Disengage"],
                    duration: { label: 'end', turns: 1, rounds: 0 }
                });
            }
        },
        "Reactor Meltdown": {
            category: "General",
            reactions: [{
                triggers: ["onActivation"],
                comments: "Meltdown status",
                onlyOnSourceMatch: true,
                activationType: "code",
                activationMode: "instead",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                evaluate: function (triggerType, triggerData) {
                    if (!triggerData.actionData?.flowState?.la_extraData?.selectedTurns) {
                        ui.notifications.warn('Reactor Meltdown: no turn count provided.');
                        return false;
                    }
                    return true;
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const selectedTurns = triggerData.actionData.flowState.selectedTurns;
                    const validTokens = await api.applyEffectsToTokens({
                        tokens: [reactorToken],
                        effectNames: "reactor_meltdown",
                        duration: { label: 'end', turns: selectedTurns, rounds: 0 }
                    });
                    if (validTokens.length > 0)
                        ui.notifications.warn(`⚠️ Reactor Meltdown initiated! Explosion in ${selectedTurns} turn${selectedTurns > 1 ? 's' : ''}!`);
                }
            }, {
                triggers: ["onStatusRemoved"],
                comments: "Trigger explosion",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                evaluate: function (triggerType, triggerData) {
                    return triggerData.statusId === 'reactor_meltdown';
                },
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    await api.startChoiceCard({
                        mode: "or",
                        title: "Reactor Explosion",
                        icon: "cci cci-boom",
                        description: "Trigger the explosion?",
                        choices: [{
                            text: "Trigger Reactor Explosion",
                            icon: "cci cci-boom",
                            callback: async () => {
                                await api.executeReactorExplosion(reactorToken);
                            }
                        }]
                    });
                }
            }]
        },
        "Eject": {
            category: "General",
            comments: "Eject pilot from mech",
            triggers: ["onActivation"],
            triggerDescription: "A pilot ejects from their mech as a quick action.",
            effectDescription: "The pilot is placed within range of the mech. The mech becomes IMPAIRED.",
            actionType: "Quick Action",
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                const mechActor = reactorToken.actor;
                if (mechActor?.type !== 'mech') {
                    ui.notifications.warn('Eject: this action must be used by a mech token.');
                    return false;
                }

                const pilotRef = mechActor.system.pilot;
                const idStr = pilotRef ? (typeof pilotRef === 'object' ? pilotRef.id : pilotRef) : null;
                const pilotActor = idStr
                    ? (idStr.startsWith('Actor.') ? fromUuidSync(idStr) : game.actors.get(idStr))
                    : null;

                if (!pilotActor) {
                    ui.notifications.warn(`Eject: no linked pilot found on ${mechActor.name}.`);
                    return false;
                }

                return true;
            },
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const mechActor = reactorToken.actor;

                const pilotRef = mechActor.system.pilot;
                const idStr = typeof pilotRef === 'object' ? pilotRef.id : pilotRef;
                const pilotActor = idStr.startsWith('Actor.') ? fromUuidSync(idStr) : game.actors.get(idStr);

                const placed = await api.placeToken({
                    actor: pilotActor,
                    range: 6,
                    origin: reactorToken,
                    count: 1,
                    title: "Eject — Place Pilot",
                    description: `Place ${pilotActor.name} within 6 spaces of ${mechActor.name}.`
                });

                if (!placed || placed.length === 0)
                    return;

                await api.applyEffectsToTokens({
                    tokens: [reactorToken],
                    effectNames: ['impaired'],
                    note: 'Eject'
                });

                ui.notifications.info(`${pilotActor.name} has ejected from ${mechActor.name}!`);
            }
        },
        "Shut Down": {
            category: "General",
            comments: "Apply Shutdown Effects",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                await api.applyEffectsToTokens({
                    tokens: [reactorToken],
                    effectNames: ["shutdown", "stunned"],
                    duration: { label: "unlimited" }
                });

                const weaponFx = game.modules.get("lancer-weapon-fx");
                if (!weaponFx?.active || typeof Sequencer === 'undefined')
                    return;

                await Sequencer.Preloader.preloadForClients([
                    "modules/lancer-automations/SFX/shutdown.wav",
                    "modules/lancer-automations/SFX/Shutdown.svg",
                    "jb2a.extras.tmfx.inpulse.circle.02.normal",
                    "jb2a.smoke.plumes.01.grey"
                ]);
                new Sequence()
                    .sound()
                    .file("modules/lancer-automations/SFX/shutdown.wav")
                    .volume(weaponFx.api.getEffectVolume(0.7))
                    .atLocation(reactorToken)
                    .effect()
                    .file("jb2a.extras.tmfx.inpulse.circle.02.normal")
                    .atLocation(reactorToken)
                    .scaleToObject(2)
                    .effect()
                    .file("jb2a.smoke.plumes.01.grey")
                    .atLocation(reactorToken, { offset: { x: 0, y: -0.5 }, gridUnits: true })
                    .scaleToObject(2)
                    .opacity(0.5)
                    .fadeIn(500)
                    .fadeOut(1500)
                    .effect()
                    .file("modules/lancer-automations/SFX/Shutdown.svg")
                    .attachTo(reactorToken, { align: "bottom-left", edge: "inner", offset: { x: -0.07, y: -0.07 }, gridUnits: true })
                    .scaleIn(0.01, 500)
                    .scale(0.09)
                    .scaleOut(0.01, 900)
                    .filter("Glow", { distance: 2, color: 0x000000 })
                    .aboveInterface()
                    .duration(3000)
                    .fadeIn(400)
                    .fadeOut(800)
                    .play();
            }
        },
        "Boot Up": {
            category: "General",
            comments: "Remove Shutdown Effects",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            actionType: "Full Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                await api.removeEffectsByNameFromTokens({
                    tokens: [reactorToken],
                    effectNames: ["shutdown", "stunned"]
                });
            }
        },
        "Hide": {
            category: "General",
            comments: "Apply Hidden Effect",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                await api.applyEffectsToTokens({
                    tokens: [reactorToken],
                    effectNames: ["hidden"],
                    duration: { label: "unlimited" }
                });

                if (typeof Sequencer === 'undefined')
                    return;

                new Sequence()
                    .effect()
                    .file("jb2a.smoke.puff.centered.grey")
                    .atLocation(reactorToken)
                    .scale(1.1)
                    .sound()
                    .file("modules/lancer-automations/SFX/PuffSmoke.wav")
                    .volume(game.modules.get("lancer-weapon-fx")?.api?.getEffectVolume(0.7) || 0.7)
                    .effect()
                    .file("modules/lancer-automations/SFX/Hide.svg")
                    .attachTo(reactorToken, { align: "bottom-left", edge: "inner", offset: { x: -0.07, y: -0.07 }, gridUnits: true })
                    .scaleIn(0.01, 500)
                    .scale(0.09)
                    .scaleOut(0.01, 900)
                    .filter("Glow", { distance: 2, color: 0x000000 })
                    .aboveInterface()
                    .duration(3000)
                    .fadeIn(400)
                    .fadeOut(800)
                    .play();
            }
        },
        "Squeeze": {
            category: "General",
            comments: "Toggle Squeeze/Prone",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            actionType: "Free Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const squeezeProne = api.findEffectOnToken(reactorToken, e =>
                    e.statuses?.has("prone") &&
                    e.flags?.['lancer-automations']?.squeezeSource === reactorToken.id
                );
                if (squeezeProne) {
                    await api.removeEffectsByNameFromTokens({
                        tokens: [reactorToken],
                        effectNames: ["prone"],
                        extraFlags: { squeezeSource: reactorToken.id }
                    });
                } else {
                    await api.applyEffectsToTokens({
                        tokens: [reactorToken],
                        effectNames: ["prone"],
                        duration: { label: "unlimited" }
                    }, { squeezeSource: reactorToken.id });
                }
            }
        },
        "Dismount": {
            category: "General",
            comments: "Place pilot adjacent to mech",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            actionType: "Full Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            evaluate: function (triggerType, triggerData, reactorToken) {
                const mechActor = reactorToken.actor;
                if (mechActor?.type !== 'mech') {
                    ui.notifications.warn('Dismount: this action must be used by a mech token.');
                    return false;
                }
                const pilotRef = mechActor.system.pilot;
                const idStr = pilotRef ? (typeof pilotRef === 'object' ? pilotRef.id : pilotRef) : null;
                const pilotActor = idStr
                    ? (idStr.startsWith('Actor.') ? fromUuidSync(idStr) : game.actors.get(idStr))
                    : null;
                if (!pilotActor) {
                    ui.notifications.warn(`Dismount: no linked pilot found on ${mechActor.name}.`);
                    return false;
                }
                return true;
            },
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const mechActor = reactorToken.actor;
                const pilotRef = mechActor.system.pilot;
                const idStr = typeof pilotRef === 'object' ? pilotRef.id : pilotRef;
                const pilotActor = idStr.startsWith('Actor.') ? fromUuidSync(idStr) : game.actors.get(idStr);
                await api.placeToken({
                    actor: pilotActor,
                    range: 1,
                    origin: reactorToken,
                    count: 1,
                    title: "Dismount — Place Pilot",
                    description: `Place ${pilotActor.name} adjacent to ${mechActor.name}.`
                });
            }
        },
        "Scan": {
            category: "General",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                await api.executeScanOnActivation(reactorToken);
            }
        },
        "Search": {
            category: "General",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const targets = await api.chooseToken(reactorToken, {
                    title: "SEARCH",
                    count: 1,
                    range: reactorToken.actor?.system?.sensor_range ?? null,
                    includeHidden: true
                });
                if (!targets?.length)
                    return;
                const targetToken = targets[0];
                const result = await api.executeStatRoll(
                    reactorToken.actor, "SYS", "SEARCH — SYSTEMS vs AGILITY",
                    targetToken, { targetStat: "AGI" }
                );
                if (result?.completed && result.passed) {
                    await api.removeEffectsByNameFromTokens({ tokens: [targetToken], effectNames: ["hidden"] });
                    ui.notifications.info(`${reactorToken.name} found ${targetToken.name}!`);
                }
            }
        }

    };

    builtInDefaults["Mount"] = {
        category: "General",
        triggers: ["onActivation", "onStatusRemoved"],
        triggerDescription: "Manual / dismount.",
        effectDescription: "Pilot mounts mech.",
        triggerSelf: true,
        onlyOnSourceMatch: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        frequency: "Other",
        actionType: "Quick Action",
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken) {
            if (triggerType === "onActivation")
                return reactorToken.actor?.type === 'pilot';
            if (triggerType === "onStatusRemoved") {
                const effectName = triggerData.effect?.name ?? triggerData.statusId ?? "";
                return reactorToken.id === triggerData.triggeringToken?.id
                    && effectName.startsWith("Mount:");
            }
            return false;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            if (triggerType === "onActivation") {
                if (reactorToken.actor?.type !== 'pilot')
                    return;
                const pilotName = reactorToken.actor.name;
                const pilotActorId = reactorToken.actor.id;

                // Choose mech at range 1
                const targets = await api.chooseToken(reactorToken, {
                    range: 1,
                    includeSelf: false,
                    filter: (t) => t.actor?.type === 'mech' || t.actor?.type === 'npc',
                    title: "MOUNT",
                    description: `${pilotName} is mounting. Choose the mech to board.`,
                    icon: "cci cci-pilot"
                });
                const mechToken = targets?.[0];
                if (!mechToken)
                    return;

                // Apply Mount effect, store pilot ref
                await api.setEffect(
                    mechToken.id,
                    { name: `Mount: ${pilotName}`, isCustom: true },
                    { label: 'indefinite' },
                    `${pilotName} is mounted`,
                    reactorToken.id,
                    { pilotActorId }
                );

                // Remove pilot token
                await reactorToken.document.delete();
            }

            if (triggerType === "onStatusRemoved") {
                // Respawn pilot on dismount
                const pilotActorId = triggerData.effect?.flags?.['lancer-automations']?.pilotActorId;
                if (!pilotActorId)
                    return;
                const pilotActor = game.actors.get(pilotActorId);
                if (!pilotActor)
                    return;

                await api.placeToken({
                    actor: pilotActor,
                    origin: reactorToken,
                    range: 1,
                    count: 1,
                    title: "DISMOUNT",
                    description: `${pilotActor.name} dismounts from ${reactorToken.name}.`,
                    icon: "cci cci-pilot"
                });
            }
        }
    };

    builtInDefaults["Boost"] = {
        category: "General",
        triggers: ["onActivation"],
        triggerDescription: "You use the Boost action",
        effectDescription: "Increases your movement cap by your SPEED",
        actionType: "Quick Action",
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
            if (api.findEffectOnToken(reactorToken, 'slowed')) {
                ui.notifications.warn(`${reactorToken.name} is Slowed and cannot Boost.`);
                return false;
            }
            return true;
        },
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const speed = reactorToken.actor?.system?.speed ?? 0;
            api.increaseMovementCap(reactorToken, speed);

            const weaponFx = game.modules.get("lancer-weapon-fx");
            if (!weaponFx?.active || typeof Sequencer === 'undefined')
                return;

            await Sequencer.Preloader.preloadForClients([
                "modules/lancer-automations/SFX/boost.wav",
                "modules/lancer-automations/SFX/Boost.svg",
                "jb2a.zoning.directional.once.bluegreen.line200.02"
            ]);
            new Sequence()
                .sound()
                .file("modules/lancer-automations/SFX/boost.wav")
                .volume(weaponFx.api.getEffectVolume(0.3))
                .effect()
                .file("jb2a.zoning.directional.once.bluegreen.line200.02")
                .scaleToObject(1.5)
                .filter("Glow", { color: 0x00CED1 })
                .atLocation(reactorToken)
                .effect()
                .file("modules/lancer-automations/SFX/Boost.svg")
                .attachTo(reactorToken, { align: "bottom-left", edge: "inner", offset: { x: -0.07, y: -0.07 }, gridUnits: true })
                .scaleIn(0.01, 500)
                .scale(0.09)
                .scaleOut(0.01, 900)
                .filter("Glow", { distance: 2, color: 0x000000 })
                .aboveInterface()
                .duration(3000)
                .fadeIn(400)
                .fadeOut(800)
                .play();
        }
    };

    builtInDefaults["Overcharge (NPC)"] = {
        category: "General",
        triggers: ["onActivation"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        actionType: "Protocol",
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const roll = await new Roll("1d6").evaluate();
            await roll.toMessage({
                flavor: `${reactorToken.name} — Overcharge Heat`,
                speaker: ChatMessage.getSpeaker({ token: reactorToken.document })
            });
            const heatGained = roll.total;
            const currentHeat = reactorToken.actor.system?.heat?.value ?? 0;
            await reactorToken.actor.update({ "system.heat.value": currentHeat + heatGained });

            const weaponFx = game.modules.get("lancer-weapon-fx");
            if (!weaponFx?.active || typeof Sequencer === 'undefined')
                return;

            const pivotx = reactorToken.document.flags["hex-size-support"]?.pivotx || 0;
            const pivoty = reactorToken.document.flags["hex-size-support"]?.pivoty || 0;

            const svgFile = "modules/lancer-weapon-fx/advisories/OverchargeYellow.svg";

            await Sequencer.Preloader.preloadForClients([
                "modules/lancer-weapon-fx/soundfx/Overcharge.ogg",
                "jb2a.static_electricity.02.blue",
                "jb2a.template_circle.out_pulse.02.burst.bluewhite",
                "jb2a.static_electricity.03",
                "jb2a.smoke.plumes.01.grey",
                svgFile
            ]);

            new Sequence()
                .effect()
                .xray(weaponFx.api.isEffectIgnoreFogOfWar())
                .aboveInterface(weaponFx.api.isEffectIgnoreLightingColoration())
                .file(svgFile)
                .attachTo(reactorToken, { align: "bottom-left", edge: "inner", offset: { x: -0.07, y: -0.07 }, gridUnits: true })
                .scaleIn(0.01, 500)
                .scale(0.09)
                .scaleOut(0.01, 900)
                .filter("Glow", { distance: 2, color: 0x000000 })
                .aboveInterface()
                .duration(4000)
                .fadeIn(400)
                .fadeOut(800)
                .sound()
                .file("modules/lancer-weapon-fx/soundfx/Overcharge.ogg")
                .volume(weaponFx.api.getEffectVolume(0.5))
                .waitUntilFinished(-2700)
                .effect()
                .xray(weaponFx.api.isEffectIgnoreFogOfWar())
                .aboveInterface(weaponFx.api.isEffectIgnoreLightingColoration())
                .file("jb2a.static_electricity.02.blue")
                .atLocation(reactorToken, { offset: { x: -pivotx, y: -pivoty } })
                .scaleToObject(1.2)
                .randomSpriteRotation()
                .effect()
                .xray(weaponFx.api.isEffectIgnoreFogOfWar())
                .aboveInterface(weaponFx.api.isEffectIgnoreLightingColoration())
                .file("jb2a.template_circle.out_pulse.02.burst.bluewhite")
                .atLocation(reactorToken, { offset: { x: -pivotx, y: -pivoty } })
                .belowTokens()
                .playbackRate(1.3)
                .scaleToObject(2.0)
                .effect()
                .xray(weaponFx.api.isEffectIgnoreFogOfWar())
                .aboveInterface(weaponFx.api.isEffectIgnoreLightingColoration())
                .file("jb2a.static_electricity.03")
                .atLocation(reactorToken, { offset: { x: -pivotx, y: -pivoty } })
                .scaleToObject(1)
                .opacity(0.8)
                .mask(reactorToken)
                .delay(1500)
                .effect()
                .xray(weaponFx.api.isEffectIgnoreFogOfWar())
                .aboveInterface(weaponFx.api.isEffectIgnoreLightingColoration())
                .file("jb2a.smoke.plumes.01.grey")
                .atLocation(reactorToken, { offset: { x: -pivotx, y: -pivoty } })
                .opacity(0.29)
                .tint(0x33ddff)
                .filter("Glow", { color: 0x00a1e6 })
                .filter("Blur", { blur: 5 })
                .scaleToObject(2)
                .fadeIn(1500)
                .fadeOut(4700, { delay: -800 })
                .rotate(-35)
                .belowTokens()
                .play();
        }
    };

    return { ...builtInDefaults, ...externalGeneralReactions };
}

export const ReactionsAPI = {
    registerDefaultItemReactions: registerExternalItemReactions,
    registerDefaultGeneralReactions: registerExternalGeneralReactions
};
