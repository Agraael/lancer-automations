import * as actionFX from '../fx/actionFX.js';
import { gainAction } from '../tools/misc-tools.js';

const externalItemReactions = {};
const externalGeneralReactions = {};

export function registerExternalItemReactions(reactions) {
    Object.assign(externalItemReactions, reactions);
}

export function registerExternalGeneralReactions(reactions) {
    Object.assign(externalGeneralReactions, reactions);
}

export function getDefaultItemReactionRegistry() {
    const builtInDefaults = {
        "ms_custom_paint_job": {
            category: "System",
            itemType: "mech_system",
            reactions: [{
                name: "Custom Paint Job",
                triggers: ["onPreStructure"],
                triggerSelf: true,
                triggerOther: false,
                outOfCombat: true,
                autoActivate: true,
                awaitActivationCompletion: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item) {
                    return triggerData.triggeringToken?.id === reactorToken.id
                        && !item.system?.destroyed && !item.system?.disabled;
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const result = await api.startChoiceCard({
                        title: "CUSTOM PAINT JOB",
                        item,
                        originToken: reactorToken,
                        choices: [
                            { text: "Use", icon: "fas fa-dice-d6", callback: async () => {} },
                            { text: "Skip", icon: "fas fa-times", callback: async () => {} }
                        ]
                    });
                    if (result?.choiceIdx !== 0)
                        return;
                    const roll = await new Roll("1d6").evaluate();
                    await roll.toMessage({
                        speaker: ChatMessage.getSpeaker({ actor: reactorToken.actor }),
                        flavor: `<b>Custom Paint Job</b>`
                    });
                    if (roll.total >= 6) {
                        await item.update({ "system.disabled": true });
                        await reactorToken.actor.update({ "system.hp.value": 1 });
                        ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor: reactorToken.actor }),
                            content: `<b>Custom Paint Job — Success!</b> The hit simply scratched the paint. Back to 1 HP.`
                        });
                        triggerData.cancelStructure(
                            "Custom Paint Job — scratched the paint.",
                            "CUSTOM PAINT JOB", false,
                            null, null, null,
                            { item, originToken: reactorToken }
                        );
                    } else {
                        ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor: reactorToken.actor }),
                            content: `<b>Custom Paint Job — Failed!</b> Rolled ${roll.total}, needed 6.`
                        });
                    }
                }
            }]
        }
    };

    // Limitless (Ultra / Veteran) — grants the "Overcharge (NPC)" extra action.
    /** @type {ReactionGroup} */
    const limitlessOvercharge = {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api) {
                await api.addExtraActions(item, {
                    name: "Overcharge (NPC)",
                    activation: "Free",
                    icon: "systems/lancer/assets/icons/overcharge.svg",
                    detail: item.system.effect
                });
            }
        }]
    };
    builtInDefaults["npcf_limitless_ultra"] = limitlessOvercharge;
    builtInDefaults["npcf_limitless_veteran"] = limitlessOvercharge;
    builtInDefaults["npc-rebake_npcf_limitless_ultra"] = limitlessOvercharge;
    builtInDefaults["npc-rebake_npcf_limitless_veteran"] = limitlessOvercharge;

    /** @type {ReactionGroup} */
    const treadsOrHover = {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api) {
                if (!api || !token.actor)
                    return;
                if (token.actor.statuses?.has('surefoot'))
                    return;
                await api.applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ['surefoot'],
                    note: "Treads or Hover",
                    duration: { label: 'permanent' }
                }, { treadsOrHoverSourceId: item.id });
            }
        }]
    };
    builtInDefaults["npcf_treads_or_hover_vehicle"] = treadsOrHover;

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
                triggerOther: true,
                actionType: "Reaction",
                outOfCombat: true,
                frequency: "Other",
                requireCanProvoke: true,
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
                requireCanProvoke: true,
                autoActivate: true,
                awaitActivationCompletion: true,
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
                    return distance >= 1 && maxThreat >= distance;
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
                outOfCombat: true,
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
                    await api.executeSkirmish(reactorToken.actor, null, mover, weaponFilter, { noFX: true });
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
                outOfCombat: true,
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

                    await Sequencer.Preloader.preloadForClients(["modules/lancer-weapon-fx/soundfx/PPC_Charge.ogg", "jb2a.shield.01.intro.blue", "modules/lancer-automations/FX/svg/Brace.svg"]);
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
                            .file("modules/lancer-automations/FX/svg/Brace.svg")
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

                        const dazedStatus = CONFIG.statusEffects.find(s => s.id === 'dazed');
                        if (dazedStatus) {
                            await api.applyEffectsToTokens({
                                tokens: [reactorToken],
                                effectNames: dazedStatus.id,
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
            autoActivate: true,
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
                        const statusName = triggerData.statusId.charAt(0).toUpperCase() + triggerData.statusId.slice(1);
                        await api.startChoiceCard({
                            title: `FLYING — ${statusName}`,
                            description: `<b>${reactorToken.name}</b> is Flying and received <b>${statusName}</b>. Remove Flying?`,
                            originToken: reactorToken,
                            choices: [
                                {
                                    text: "Remove Flying",
                                    icon: "fas fa-arrow-down",
                                    callback: async () => {
                                        await api.removeEffectsByNameFromTokens({ tokens: [reactorToken], effectNames: ["Flying"], notify: true });
                                    }
                                },
                                { text: "Ignore", icon: "fas fa-times" }
                            ]
                        });
                    }
                }

                if (triggerType === 'onStructure' || triggerType === 'onStress') {
                    const label = triggerType === 'onStructure' ? 'Structure damage' : 'Stress';
                    await api.startChoiceCard({
                        title: `FLYING — ${label}`,
                        description: `<b>${reactorToken.name}</b> took ${label} while Flying. Roll AGILITY save or lose Flying.`,
                        originToken: reactorToken,
                        choices: [
                            {
                                text: "Roll AGI Save",
                                icon: "fas fa-dice-d20",
                                callback: async () => {
                                    const result = await api.executeStatRoll(reactorToken.actor, "AGI", `AGILITY Save (${label} while Flying)`);
                                    if (result.completed && !result.passed) {
                                        await api.removeEffectsByNameFromTokens({ tokens: [reactorToken], effectNames: ["Flying"], notify: true });
                                    }
                                }
                            },
                            { text: "Skip", icon: "fas fa-times" }
                        ]
                    });
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
                const sensorRange = reactorToken?.actor?.system?.sensor_range ?? 10;
                const targets = await api.chooseToken(reactorToken, {
                    range: sensorRange,
                    count: 1,
                    title: 'LOCK ON — Select Target',
                    description: `Choose a target within Sensors (${sensorRange})`,
                    filter: t => t.actor?.type !== 'deployable',
                });
                if (!targets || targets.length === 0) {
                    return;
                }

                await api.applyEffectsToTokens({
                    tokens: targets,
                    effectNames: ["lockon"],
                    note: "Lock On"
                });

                const weaponFx = game.modules.get("lancer-weapon-fx");
                if (!weaponFx?.active || typeof Sequencer === 'undefined')
                    return;

                await Sequencer.Preloader.preloadForClients([
                    "modules/lancer-weapon-fx/soundfx/LockOn.ogg",
                    "jb2a.zoning.inward.square.once.redyellow.01.01",
                ]);


                for (const target of targets) {
                    let sequence = new Sequence()
                        .sound()
                        .file("modules/lancer-weapon-fx/soundfx/LockOn.ogg")
                        .volume(weaponFx.api.getEffectVolume(0.8))
                        .effect()
                        .file("modules/lancer-automations/FX/svg/Lockon.svg")
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
                            .file("modules/lancer-automations/FX/svg/Bolster.svg")
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
                awaitActivationCompletion: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    return !!api.findEffectOnToken(reactorToken, "bolster");
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
                            effectNames: ["bolster"]
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
                        "modules/lancer-automations/FX/audio/activation-sound-effect.wav",
                        "jb2a.healing_generic.400px.blue",
                    ]);

                    validTargets.forEach(target => {
                        let sequence = new Sequence()
                            .sound()
                            .file("modules/lancer-automations/FX/audio/activation-sound-effect.wav")
                            .volume(weaponFx.api.getEffectVolume(0.7))
                            .effect()
                            .file("modules/lancer-automations/FX/svg/Aid.svg")
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
                        filter: (t) => t.actor.system.size <= reactorToken.actor.system.size,
                        filterWarning: "Target is larger than you"
                    });
                    if (!chosen || chosen.length === 0)
                        return;
                    chosen[0].setTarget(true, { releaseOthers: true, groupSelection: false });
                    await actionFX.playRamFX(reactorToken, chosen[0]);
                    await api.executeBasicAttack(reactorToken.actor, {
                        title: "Ram",
                        attack_type: "Melee",
                        action: { name: "Ram", activation: "Quick" },
                        effect: "Make a melee attack against an adjacent character the same SIZE or smaller than you. On a success, your target is knocked PRONE and you may also choose to knock them back by one space, directly away from you.",
                        tags: [{ lid: 'tg_knockback', val: 1 }]
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

                    // Knockback is now handled by the Knockback tag on the damage card.
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

                    // Hover: airborne without movement requirement.
                    if (api.findEffectOnToken(reactorToken, "hover"))
                        return false;

                    // Climber holding onto an adjacent solid taller than the token.
                    if (api.findEffectOnToken(reactorToken, "climber") && api.hasTallerSolidAdjacent(reactorToken, terrainAPI))
                        return false;

                    const isFlying = !!api.findEffectOnToken(reactorToken, "flying");

                    if (!isFlying)
                        return true;

                    const movedDistance = api.getCumulativeMoveData(reactorToken.document.id)?.moved ?? 0;
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

                                    await actionFX.playFallFX(reactorToken);
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

                    await actionFX.playFallImpactFX(reactorToken);
                }
            }]
        },
        "Engagement": {
            category: "General",
            comments: "Stop Movement & Engagement",
            triggers: ["onUpdate", "onPreMove", "onTokenCreated", "onTokenRemoved", "onTokenVisibility"],
            triggerDescription: "When a character moves",
            effectDescription: "Targets of equal or greater size stop the character's movement, and engagement status is updated.",
            isReaction: false,
            checkReaction: false,
            autoActivate: true,
            awaitActivationCompletion: true,
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (triggerType === "onUpdate") {
                    const c = triggerData.change || {};
                    if (c.x !== undefined || c.y !== undefined || c.elevation !== undefined) {
                        return true;
                    }
                    return false;
                }

                if (triggerType === "onTokenCreated" || triggerType === "onTokenRemoved" || triggerType === "onTokenVisibility") {
                    return true;
                }

                if (triggerType === "onPreMove") {
                    if (!game.combat?.active)
                        return false;
                    const moveInfo = triggerData.moveInfo;
                    if (!moveInfo?.pathHexes || moveInfo.pathHexes.length === 0)
                        return false;
                    if (moveInfo.isTeleport || moveInfo.isModified)
                        return false;

                    if (api.findEffectOnToken(reactorToken, "hidden") ||
                        api.findEffectOnToken(reactorToken, "disengage") ||
                        api.findEffectOnToken(reactorToken, "intangible") ||
                        reactorToken.actor?.effects.some(e => e.statuses?.has("hidden") || e.statuses?.has("disengage") || e.statuses?.has("intangible"))) {
                        return false;
                    }

                    const isAlreadyEngaged = api.findEffectOnToken(reactorToken, "engaged") ||
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
                if (triggerType === "onUpdate" || triggerType === "onTokenCreated" || triggerType === "onTokenRemoved" || triggerType === "onTokenVisibility") {
                    const excludeTokenId = triggerType === "onTokenRemoved" ? triggerData.triggeringToken?.id : undefined;
                    api.updateAllEngagements({ excludeTokenId });
                    return;
                }

                if (triggerType === "onPreMove") {
                    const moveInfo = triggerData.moveInfo;
                    const allTokens = canvas.tokens.placeables;
                    const mover = reactorToken;

                    const historyStart = Math.max(1, moveInfo.pathHexes.historyStartIndex);
                    let stoppedBy = null;
                    let interceptIndex = -1;

                    // Mover Z per step: flying/hover uses end elevation; walking uses terrain
                    // top at the hex (via THT) so engagement tracks ground height changes.
                    // Falls back to current token elevation when THT is absent.
                    const is3D = (() => {
                        try {
                            return !!game.settings.get('lancer-automations', 'count3DDistance');
                        } catch {
                            return false;
                        }
                    })();
                    const terrainAPI = globalThis.terrainHeightTools;
                    const sceneGridDist = canvas.scene?.grid?.distance ?? 1;
                    const fallbackZ = mover.document.elevation ?? 0;
                    const isFlying = !!api.findEffectOnToken(mover, "flying")
                        || !!mover.actor?.effects?.some(e => e.statuses?.has("flying") && !e.disabled);
                    const endZ = triggerData.elevationToMove ?? fallbackZ;
                    let solidTypeIds = null;
                    const getSolidTypeIds = () => {
                        if (solidTypeIds)
                            return solidTypeIds;
                        solidTypeIds = new Set();
                        for (const t of terrainAPI?.getTerrainTypes?.() || []) {
                            if (t.usesHeight && t.isSolid)
                                solidTypeIds.add(t.id);
                        }
                        return solidTypeIds;
                    };
                    const terrainTopAt = (cx, cy) => {
                        try {
                            const off = canvas.grid.getOffset({ x: cx, y: cy });
                            const cell = terrainAPI.getCell(off.j, off.i) || [];
                            const solids = getSolidTypeIds();
                            let top = 0;
                            for (const t of cell) {
                                if (solids.has(t.terrainTypeId)) {
                                    const v = (t.elevation || 0) + (t.height || 0);
                                    if (v > top)
                                        top = v;
                                }
                            }
                            return top;
                        } catch {
                            return null;
                        }
                    };
                    const moverZAt = (step) => {
                        if (isFlying)
                            return endZ;
                        if (!terrainAPI)
                            return fallbackZ;
                        const top = terrainTopAt(step.cx, step.cy);
                        return (top == null) ? fallbackZ : top;
                    };

                    const scanEnd = Math.min(moveInfo.pathHexes.length, historyStart + triggerData.distanceToMove);
                    for (let i = historyStart; i < scanEnd; i++) {
                        const stepPos = moveInfo.pathHexes[i];
                        if (!stepPos)
                            continue;
                        const moverZ = is3D ? moverZAt(stepPos) : null;

                        for (const other of allTokens) {
                            if (!api.canEngage(mover, other))
                                continue;

                            const planar = api.getMinGridDistance(mover, other, stepPos, false);
                            let total = planar;
                            if (moverZ !== null) {
                                const otherZ = other.document.elevation ?? 0;
                                total += Math.round(Math.abs(moverZ - otherZ) / sceneGridDist);
                            }

                            if (total <= 1) {
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
                await actionFX.playDisengageFX(reactorToken);
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
                    const selectedTurns = triggerData.actionData.flowState.la_extraData.selectedTurns;
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

                await actionFX.playEjectFX(reactorToken, placed[0]);

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

                await actionFX.playShutDownFX(reactorToken);
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
                await actionFX.playBootUpFX(reactorToken);
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

                await actionFX.playHideFX(reactorToken);
            }
        },
        "Mine Stealth": {
            category: "General",
            comments: "Mines start Hidden",
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api) {
                if (!api || !token.actor)
                    return;
                if (token.actor.type !== "deployable" || token.actor.system?.type !== "Mine")
                    return;
                if (token.actor.statuses?.has("hidden"))
                    return;
                await api.applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["hidden"],
                    note: "Mine Stealth",
                    duration: { label: "unlimited" }
                });
            }
        },
        "Mine Arming": {
            category: "General",
            comments: "Arm Mines at end of any turn (one-time per token)",
            triggers: ["onTurnEnd"],
            triggerSelf: true,
            triggerOther: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const actor = reactorToken.actor;
                if (actor?.type !== "deployable" || actor.system?.type !== "Mine")
                    return false;
                // One-shot per token: skip if already armed before, even if status was removed.
                if (api.getTokenFlags(reactorToken.document, 'wasArmed'))
                    return false;
                return true;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                await api.applyEffectsToTokens({
                    tokens: [reactorToken],
                    effectNames: [{
                        name: "Armed",
                        icon: "modules/lancer-automations/icons/land-mine.svg",
                        isCustom: true
                    }],
                    note: "Mine Armed",
                    duration: { label: "permanent" }
                });
                await api.addTokenFlags(reactorToken.document, { wasArmed: true });
            }
        },
        // Tunable via api.addActorFlags: mineDetectionRadius, mineDetectionDisposition, customMineDetection.
        "Mine Zone": {
            category: "General",
            comments: "Mine trigger zone aura with ENTER macro (Detonate / Disarm / Let pass)",
            reactions: [
                {
                    triggers: ["onStatusApplied"],
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    outOfCombat: true,
                    activationType: "code",
                    activationMode: "instead",
                    evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                        if (triggerData.statusId !== "armed")
                            return false;
                        const actor = reactorToken.actor;
                        if (actor?.type !== "deployable" || actor.system?.type !== "Mine")
                            return false;
                        return !api.getActorFlags(actor, "customMineDetection");
                    },
                    activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                        if (api.findAura(reactorToken, "LA_MineZone"))
                            return;
                        const radius = String(api.getActorFlags(reactorToken.actor, "mineDetectionRadius") ?? 1);
                        const disposition = api.getActorFlags(reactorToken.actor, "mineDetectionDisposition") ?? "ALL";
                        await api.createAura(reactorToken, api.scaleAuraStroke({
                            name: "LA_MineZone",
                            unified: false,
                            radius,
                            lineWidth: 3,
                            lineColor: "#ffd600",
                            lineOpacity: 0.9,
                            lineDashSize: 8,
                            lineGapSize: 6,
                            lineDashOffsetAnimation: -10,
                            fillType: 0,
                            nonOwnerVisibility: { default: true },
                            macros: [{
                                mode: "ENTER",
                                targetTokens: disposition,
                                function: function (token, parent, aura, options) {
                                    if (options?.isInit || options?.isPreview)
                                        return;
                                    if (!game.users.activeGM?.isSelf)
                                        return;
                                    const mine = parent;
                                    const mover = token;
                                    if (!mine?.actor || !mover || mine.id === mover.id)
                                        return;
                                    const api = game.modules.get('lancer-automations')?.api;
                                    if (!api)
                                        return;
                                    if (!api.findEffectOnToken(mine, "armed"))
                                        return;

                                    const detonate = async () => {
                                        await api.removeEffectsByNameFromTokens({
                                            tokens: [mine],
                                            effectNames: ["Armed"]
                                        });
                                        await api.executeSimpleActivation(mine.actor, {
                                            title: mine.name + " Detonates",
                                            action: { name: "Detonate", activation: "Free" },
                                            detail: mine.actor.system?.detail || (mine.name + " triggers.")
                                        });
                                    };

                                    api.startChoiceCard({
                                        title: "MINE TRIGGER ZONE",
                                        description: "<b>" + mover.name + "</b> entered <b>" + mine.name + "</b>'s trigger zone. Detonate?",
                                        originToken: mine,
                                        relatedToken: mover,
                                        userIdControl: game.user.id,
                                        choices: [
                                            { text: "Detonate", icon: "fas fa-bomb", callback: detonate },
                                            {
                                                text: "Try disarm (SYS)",
                                                icon: "fas fa-screwdriver",
                                                callback: async () => {
                                                    const result = await api.executeStatRoll(
                                                        mover.actor,
                                                        "SYS",
                                                        "DISARM " + mine.name,
                                                        10,
                                                        { sendToOwner: true }
                                                    );
                                                    if (result?.passed) {
                                                        await api.removeEffectsByNameFromTokens({
                                                            tokens: [mine],
                                                            effectNames: ["Armed"]
                                                        });
                                                        ChatMessage.create({
                                                            speaker: ChatMessage.getSpeaker({ actor: mover.actor }),
                                                            content: "<b>" + mover.name + "</b> disarmed <b>" + mine.name + "</b>."
                                                        });
                                                    } else if (result?.completed) {
                                                        await detonate();
                                                    }
                                                }
                                            },
                                            { text: "Let pass", icon: "fas fa-times" }
                                        ]
                                    });
                                }
                            }]
                        }));
                    }
                },
                {
                    triggers: ["onStatusRemoved"],
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    outOfCombat: true,
                    activationType: "code",
                    activationMode: "instead",
                    evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                        if (triggerData.statusId !== "armed")
                            return false;
                        return !api.getActorFlags(reactorToken.actor, "customMineDetection");
                    },
                    activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                        for (let i = 0; i < 10; i++) {
                            await api.deleteAuras(reactorToken, { name: "LA_MineZone" });
                            if (!api.findAura(reactorToken, "LA_MineZone"))
                                break;
                        }
                    }
                }
            ]
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
                const placed = await api.placeToken({
                    actor: pilotActor,
                    range: 1,
                    origin: reactorToken,
                    count: 1,
                    title: "Dismount — Place Pilot",
                    description: `Place ${pilotActor.name} adjacent to ${mechActor.name}.`
                });
                if (placed && placed.length > 0)
                    await actionFX.playDismountFX(reactorToken);
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
                await actionFX.playSearchFX(reactorToken, targetToken);
                const result = await api.executeContestedCheck(
                    reactorToken, "SYS",
                    targetToken, "AGI",
                    { title: "SEARCH - SYSTEMS vs AGILITY", sendToOwner: true }
                );
                if (!result?.completed)
                    return;
                if (result.winner === reactorToken.actor) {
                    await api.removeEffectsByNameFromTokens({ tokens: [targetToken], effectNames: ["hidden"] });
                    ui.notifications.info(`${reactorToken.name} found ${targetToken.name}!`);
                    await actionFX.playSearchFoundFX(targetToken);
                } else {
                    await actionFX.playSearchFailFX(targetToken);
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

                await actionFX.playMountFX(reactorToken, mechToken);

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

    builtInDefaults["Jockey"] = {
        category: "General",
        triggers: ["onActivation"],
        actionType: "Full Action",
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const targets = await api.chooseToken(reactorToken, {
                range: 1,
                includeSelf: false,
                filter: (t) => t.actor?.type === 'mech' || t.actor?.type === 'npc',
                title: "JOCKEY",
                description: `Choose the adjacent mech to JOCKEY.`,
                icon: "modules/lancer-automations/icons/rope-dart.svg"
            });
            const mechToken = targets?.[0];
            if (!mechToken)
                return;
            await actionFX.playJockeyFX(reactorToken, mechToken);

            const result = await api.executeContestedCheck(
                reactorToken, "GRIT",
                mechToken,    "HULL",
                { title: "JOCKEY - GRIT vs HULL", sendToOwner: true }
            );
            if (!result?.completed)
                return;
            if (result.winner !== reactorToken.actor) {
                ui.notifications.info(`${reactorToken.name} failed to Jockey ${mechToken.name}.`);
                return;
            }

            const choice = await api.startChoiceCard({
                title: "JOCKEY",
                description: `${reactorToken.name} climbs onto ${mechToken.name}. Choose one:`,
                originToken: reactorToken,
                relatedToken: mechToken,
                choices: [
                    {
                        text: `Distract <span style="color:#aaa;font-size:0.85em;">-IMPAIR + SLOW</span>`,
                        icon: "modules/lancer-automations/icons/rope-dart.svg",
                        callback: async () => {
                            await api.applyEffectsToTokens({
                                tokens: [mechToken],
                                effectNames: ['impaired', 'slow'],
                                duration: { label: 'end', turns: 1, rounds: 0 }
                            });
                        }
                    },
                    {
                        text: `Shred <span style="color:#aaa;font-size:0.85em;">-2 Heat</span>`,
                        icon: "systems/lancer/assets/icons/white/condition_shredded.svg",
                        callback: async () => {
                            await api.executeDamageRoll(reactorToken, [mechToken], '2', 'Heat', `${reactorToken.name} - Jockey (Shred)`);
                        }
                    },
                    {
                        text: `Damage <span style="color:#aaa;font-size:0.85em;">-4 Kinetic</span>`,
                        icon: "systems/lancer/assets/icons/melee.svg",
                        callback: async () => {
                            await api.executeDamageRoll(reactorToken, [mechToken], '4', 'Kinetic', `${reactorToken.name} - Jockey (Damage)`);
                        }
                    },
                ]
            });
            if (choice?.choiceIdx == null)
                return;

            await api.moveToken(reactorToken, { destination: { x: mechToken.center.x, y: mechToken.center.y } });
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
            await gainAction(reactorToken, 'move');
            await actionFX.playBoostFX(reactorToken);
        }
    };

    builtInDefaults["Overcharge"] = {
        category: "General",
        triggers: ["onActivation"],
        actionType: "Free",
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            await gainAction(reactorToken, 'quick');
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
        actionType: "Free",
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

            await actionFX.playOverchargeNpcFX(reactorToken);
        }
    };

    const _guardianAuraPending = new Set();
    builtInDefaults["Guardian Aura"] = {
        category: "Automation",
        comments: "Just for visual indication",
        reactions: [
            {
                triggers: ["onStatusApplied"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData) {
                    return triggerData.statusId === 'guardian';
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    if (api.findAura(reactorToken, "LA_Guardian") || _guardianAuraPending.has(reactorToken.id))
                        return;
                    _guardianAuraPending.add(reactorToken.id);
                    try {
                        await api.createAura(reactorToken, api.scaleAuraStroke({
                            name: "LA_Guardian",
                            unified: false,
                            radiusOffset: -3,
                            innerRadius: "",
                            radius: "0",
                            lineWidth: 6,
                            lineColor: "#757575",
                            lineOpacity: 0.8,
                            lineDashSize: 15,
                            lineGapSize: 10,
                            fillType: 0,
                            lineDashOffsetAnimation: -5,
                            nonOwnerVisibility: { default: true }
                        }));
                    } finally {
                        _guardianAuraPending.delete(reactorToken.id);
                    }
                }
            },
            {
                triggers: ["onStatusRemoved"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData) {
                    return triggerData.statusId === 'guardian';
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    _guardianAuraPending.delete(reactorToken.id);
                    for (let i = 0; i < 10; i++) {
                        await api.deleteAuras(reactorToken, { name: "LA_Guardian" });
                        if (!api.findAura(reactorToken, "LA_Guardian"))
                            break;
                    }
                }
            }
        ]
    };

    const _bulwarkAuraPending = new Set();
    builtInDefaults["Bulwark Aura"] = {
        category: "Automation",
        comments: "Just for visual indication",
        reactions: [
            {
                triggers: ["onStatusApplied"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData) {
                    return triggerData.statusId === 'bulwark';
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    if (api.findAura(reactorToken, "LA_Bulwark") || _bulwarkAuraPending.has(reactorToken.id))
                        return;
                    _bulwarkAuraPending.add(reactorToken.id);
                    try {
                        await api.createAura(reactorToken, api.scaleAuraStroke({
                            name: "LA_Bulwark",
                            unified: false,
                            radiusOffset: -3,
                            innerRadius: "",
                            radius: "0",
                            lineWidth: 6,
                            lineColor: "#000000",
                            lineOpacity: 0.8,
                            lineDashSize: 15,
                            lineGapSize: 10,
                            fillType: 0,
                            lineDashOffsetAnimation: -5,
                            nonOwnerVisibility: { default: true }
                        }));
                    } finally {
                        _bulwarkAuraPending.delete(reactorToken.id);
                    }
                }
            },
            {
                triggers: ["onStatusRemoved"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData) {
                    return triggerData.statusId === 'bulwark';
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    _bulwarkAuraPending.delete(reactorToken.id);
                    for (let i = 0; i < 10; i++) {
                        await api.deleteAuras(reactorToken, { name: "LA_Bulwark" });
                        if (!api.findAura(reactorToken, "LA_Bulwark"))
                            break;
                    }
                }
            }
        ]
    };

    return { ...builtInDefaults, ...externalGeneralReactions };
}

export const ReactionsAPI = {
    registerDefaultItemReactions: registerExternalItemReactions,
    registerDefaultGeneralReactions: registerExternalGeneralReactions
};
