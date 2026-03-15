/*global game, Sequencer, canvas, ui, ChatMessage, Roll, api */

/** @type {ReactionGroup} */
const suppressArcherReaction = {
    category: "NPC",
    itemType: "npc_feature",
    reactions: [{
        name: "Suppress",
        triggers: ["onActivation", "onDamage", "onStatusApplied", "onDestroyed"],
        triggerSelf: true,
        triggerOther: true,
        outOfCombat: true,
        actionType: "Quick Action",
        frequency: "Unlimited",
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
            if (triggerType === "onActivation") {
                return triggerData.triggeringToken?.id === reactorToken.id && triggerData.item?.system?.lid === item?.system?.lid;
            }
            if (triggerType === "onDamage") {
                if (triggerData.triggeringToken?.id === reactorToken.id)
                    return false;
                const target = triggerData.target;
                if (!target)
                    return false;
                return !!api?.findEffectOnToken(target, e => e.name === "Suppress" && e.flags?.['lancer-automations']?.suppressSourceId === reactorToken.id);
            }
            if (triggerType === "onStatusApplied") {
                if (triggerData.triggeringToken?.id !== reactorToken.id)
                    return false;
                const statusId = (triggerData.statusId || '').toLowerCase();
                const effectName = (triggerData.effect?.name || '').toLowerCase();
                return statusId.includes('stunned') || statusId.includes('jammed') || effectName.includes('stunned') || effectName.includes('jammed');
            }
            if (triggerType === "onDestroyed") {
                return triggerData.triggeringToken?.id === reactorToken.id;
            }
            return false;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
            if (!customStatusApi)
                return;

            if (triggerType === "onActivation") {
                // Remove existing suppress from previous activation
                const suppressEffect = canvas.tokens.placeables
                    .map(t => api.findEffectOnToken(t, e => e.name === "Suppress" && e.flags?.['lancer-automations']?.suppressSourceId === reactorToken.id))
                    .filter(Boolean);

                if (suppressEffect.length > 0) {
                    for (const effect of suppressEffect) {
                        const token = canvas.tokens.placeables.find(t => t.actor?.id === effect.parent?.id);
                        if (token) {
                            if (api?.removeEffectsByNameFromTokens) {
                                await api.removeEffectsByNameFromTokens({
                                    tokens: [token],
                                    effectNames: ["Suppress", "impaired"],
                                    extraFlags: { suppressSourceId: reactorToken.id }
                                });
                            }
                        }
                    }
                }

                // Choose new target
                const targets = await api.chooseToken(reactorToken, {
                    range: 10,
                    includeHidden: false,
                    title: "SUPPRESS",
                    description: "Select a target within Range 10 to suppress.",
                    icon: "fas fa-crosshairs"
                });
                const target = targets?.[0];
                if (!target)
                    return;

                // Apply suppress and impaired
                await api.applyEffectsToTokens({
                    tokens: [target],
                    effectNames: [
                        {
                            name: "Suppress",
                            icon: "worlds/Lancer/VTT stuff/virtual-marker.svg",
                            isCustom: true
                        },
                        "impaired"
                    ],
                    note: "Suppressed by Archer",
                    duration: { label: 'end', turns: 1, rounds: 0, overrideTurnOriginId: reactorToken.id },
                }, {
                    suppressSourceId: reactorToken.id,
                    suppressSourceName: reactorToken.name
                });

            } else if (triggerType === "onDamage") {
                const target = triggerData.target;
                const token = target.token?.object || canvas.tokens.placeables.find(t => t.actor?.id === target.actor?.id);

                if (token) {
                    if (api?.removeEffectsByNameFromTokens) {
                        await api.removeEffectsByNameFromTokens({
                            tokens: [token],
                            effectNames: ["Suppress", "impaired"],
                            extraFlags: { suppressSourceId: reactorToken.id }
                        });
                    }
                }
            } else if (triggerType === "onStatusApplied" || triggerType === "onDestroyed") {
                const suppressEffect = canvas.tokens.placeables
                    .map(t => api.findEffectOnToken(t, e => e.name === "Suppress" && e.flags?.['lancer-automations']?.suppressSourceId === reactorToken.id))
                    .filter(Boolean);

                for (const effect of suppressEffect) {
                    const token = canvas.tokens.placeables.find(t => t.actor?.id === effect.parent?.id);
                    if (token) {
                        if (api?.removeEffectsByNameFromTokens) {
                            await api.removeEffectsByNameFromTokens({
                                tokens: [token],
                                effectNames: ["Suppress", "impaired"],
                                extraFlags: { suppressSourceId: reactorToken.id }
                            });
                        }
                    }
                }
            }
        }
    }]
};

/** @type {ReactionGroup} */
const movingTargetSniperReaction = {
    category: "NPC",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onPreMove"],
        triggerSelf: false,
        triggerOther: true,
        outOfCombat: false,
        actionType: "Reaction",
        frequency: "1/Round",
        autoActivate: true,
        forceSynchronous: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const mover = triggerData.triggeringToken;
            if (triggerData.moveInfo?.isInvoluntary)
                return false;
            if (triggerData.distanceToTrigger > 20)
                return false;
            if (api.isFriendly(reactorToken, mover))
                return false;
            return true;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const mover = triggerData.triggeringToken;
            triggerData.cancelTriggeredMove?.(
                `Moving Target: ${mover.name} is in the Sniper's sights. Give up this movement or proceed and face an attack with the Anti-materiel Rifle.`,
                true,
                api.getTokenOwnerUserId(mover)
            );
        }
    }, {
        triggers: ["onMove"],
        triggerSelf: false,
        triggerOther: true,
        outOfCombat: false,
        actionType: "Reaction",
        frequency: "1/Round",
        autoActivate: false,
        activationType: "code",
        activationMode: "after",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const mover = triggerData.triggeringToken;
            if (triggerData.moveInfo?.isInvoluntary)
                return false;
            if (triggerData.distanceToTrigger > 20)
                return false;
            if (api.isFriendly(reactorToken, mover))
                return false;
            return true;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const mover = triggerData.triggeringToken;

            const rifle = api.findItemByLid(reactorToken.actor, "npcf_anti_materiel_rifle_sniper");
            if (!rifle) {
                ui.notifications.warn(`Moving Target: Anti-materiel Rifle not found on ${reactorToken.name}.`);
                return;
            }

            const isLoaded = rifle.system?.loaded !== false;
            if (!isLoaded) {
                await api.reloadOneWeapon(reactorToken);
                ChatMessage.create({
                    content: `<div class="lancer-chat-message"><b>${reactorToken.name} — Moving Target</b><br>The Anti-materiel Rifle wasn't loaded. ${reactorToken.name} reloads.</div>`,
                    speaker: ChatMessage.getSpeaker({ token: reactorToken })
                });
                return;
            }

            game.user.updateTokenTargets([mover.id]);
            await api.beginWeaponAttackFlow(rifle, {});
        }
    }]
};

/** @type {ReactionGroup} */
const movingTargetArcherReaction = {
    category: "NPC",
    itemType: "npc_feature",
    reactions: [{
        name: "Moving Target",
        triggers: ["onPreMove"],
        triggerSelf: false,
        triggerOther: true,
        outOfCombat: false,
        actionType: "Reaction",
        frequency: "1/Round",
        autoActivate: false,
        activationType: "code",
        activationMode: "after",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const mover = triggerData.triggeringToken;
            if (!mover)
                return false;
            const isSuppressed = !!api?.findEffectOnToken(mover, e => e.name === "Suppress" && e.flags?.['lancer-automations']?.suppressSourceId === reactorToken.id);
            if (isSuppressed)
                triggerData.cancelTriggeredMove?.(`Moving Target: ${mover.name}'s movement could be cancelled by ${reactorToken.name}.`, true, api.getTokenOwnerUserId(reactorToken));
            return isSuppressed;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            const mover = triggerData.triggeringToken;
            if (!mover)
                return;

            if (api?.removeEffectsByNameFromTokens) {
                await api.removeEffectsByNameFromTokens({
                    tokens: [mover],
                    effectNames: ["Suppress", "impaired"],
                    extraFlags: { suppressSourceId: reactorToken.id }
                });
            }
        }
    }]
};

/** @type {ReactionGroup} */
const sealantGunReaction = {
    category: "NPC",
    itemType: "npc_feature",
    reactions: [{
        name: "Sealant Gun",
        triggers: ["onActivation"],
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        actionType: "Quick Action",
        frequency: "Unlimited",
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        onlyOnSourceMatch: true,
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            if (!api)
                return;

            const targets = await api.chooseToken(reactorToken, {
                range: 5,
                count: 1,
                title: "SEALANT GUN",
                description: "Select a character within Range 5.",
                icon: "fas fa-sticky-note"
            });
            const target = targets?.[0];
            if (!target)
                return;

            const isFriendly = api.isFriendly(reactorToken, target);

            if (isFriendly) {
                // Allied Path: Clear Burn, Apply Slowed
                await api.removeEffectByName(target, 'burn');
                await api.updateTokenSystem(target, { 'system.burn': 0 });
                await api.applyEffectsToTokens({
                    tokens: [target],
                    effectNames: ["slowed"],
                    note: "Sealant Gun (Allied)",
                    duration: { label: 'end', turns: 1, rounds: 0 }
                });
            } else {
                // Hostile/Neutral Path: Save, Apply Slowed on fail, Always Place Zone
                const result = await api.executeStatRoll(target.actor, "AGI", "Sealant Gun Save", reactorToken);
                if (!result.passed) {
                    await api.applyEffectsToTokens({
                        tokens: [target],
                        effectNames: ["slowed"],
                        note: "Sealant Gun (Hostile)",
                        duration: { label: 'end', turns: 1, rounds: 0 },
                    });
                }
                // Burst 1 centered on target
                await api.placeZone(target, {
                    size: 1,
                    type: "Burst",
                    difficultTerrain: { movementPenalty: 1, isFlatPenalty: true },
                    title: "Sealant",
                    icon: "fas fa-sticky-note",
                    centerLabel: "Sealant"
                });
            }
        }
    }]
};

/** @type {ReactionGroup} */
const veterancyVeteranReaction = {
    category: "NPC",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onEnterCombat"],
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken) {
            const bonuses = api.getConstantBonuses(reactorToken.actor);
            return !bonuses.some(b => b.id === `veterancy_${reactorToken.actor.id}`);
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            if (!api)
                return;

            const skills = [
                { text: "Hull", icon: "cci cci-hull", tag: "hull" },
                { text: "Agility", icon: "cci cci-agility", tag: "agility" },
                { text: "Systems", icon: "cci cci-systems", tag: "systems" },
                { text: "Engineering", icon: "cci cci-engineering", tag: "engineering" }
            ];

            const choices = skills.map(s => ({
                text: s.text,
                icon: s.icon,
                callback: async () => {
                    const bonusId = `veterancy_${reactorToken.actor.id}`;
                    await api.addConstantBonus(reactorToken.actor, {
                        id: bonusId,
                        name: `Veterancy (${s.text})`,
                        val: 1,
                        type: "accuracy",
                        rollTypes: [s.tag]
                    });
                }
            }));

            await api.startChoiceCard({
                title: "VETERANCY",
                description: `Choose a skill for ${reactorToken.name}:`,
                choices,
                icon: "cci cci-rank-veteran"
            });
        }
    }, {
        triggers: ["onExitCombat"],
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            if (!api)
                return;
            const bonusId = `veterancy_${reactorToken.actor.id}`;
            await api.removeConstantBonus(reactorToken.actor, bonusId);
        }
    }]
};

/** @type {ReactionGroup} */
const restockDroneSupportReaction = {
    category: "NPC",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onDeploy"],
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        onlyOnSourceMatch: true,
        outOfCombat: true,
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
            if (!api)
                return;

            const deployedTokens = triggerData.deployedTokens;
            if (!deployedTokens?.length)
                return;

            const deployedToken = deployedTokens[0];
            if (!deployedToken)
                return;

            const isRebake = item.system.lid?.includes('rebake') || item.name.toLowerCase().includes("rebake");

            let healAmount = 5;
            const tier = reactorToken.actor.system.tier;
            if (isRebake) {
                if (tier === 2)
                    healAmount = 8;
                if (tier === 3)
                    healAmount = 10;
            } else {
                if (tier === 2)
                    healAmount = 10;
                if (tier === 3)
                    healAmount = 15;
            }

            await api.createAura(deployedToken, {
                name: "Restock Drone Zone",
                radius: 1,
                disposition: 1, // Allied
                height: { top: null, bottom: null },
                shape: {
                    type: "cylinder",
                    radius: 1
                },
                macros: [{
                    mode: "ENTER",
                    function: async (token, parent, aura, options) => {
                        const lancerApi = game.modules.get('lancer-automations')?.api;
                        if (!lancerApi || !options.hasEntered)
                            return;
                        if (!lancerApi.isFriendly(token, parent))
                            return;

                        // Find any loading weapons the entered token has that are unloaded
                        const weapons = lancerApi.getWeapons(token);
                        const unloadedWeapons = weapons.filter(i =>
                            i.system.tags?.some(t => t.id === "tg_loading") &&
                            i.system.loaded === false
                        );

                        const choices = [
                            {
                                text: `Regain ${healAmount} HP`,
                                icon: "fas fa-heart",
                                callback: async () => {
                                    const currentHP = token.actor.system.hp.value;
                                    const maxHP = token.actor.system.hp.max;
                                    const newHP = Math.min(maxHP, currentHP + healAmount);
                                    await token.actor.update({ "system.hp.value": newHP });
                                    await parent.delete();
                                }
                            }
                        ];

                        if (isRebake && unloadedWeapons.length > 0) {
                            choices.push({
                                text: "Reload a Loading Weapon",
                                icon: "fas fa-sync",
                                callback: async () => {
                                    const chosenWeapon = await lancerApi.reloadOneWeapon(token);
                                    if (chosenWeapon) {
                                        await parent.delete();
                                    }
                                }
                            });
                        }

                        await lancerApi.startChoiceCard({
                            title: "RESTOCK DRONE",
                            description: `${token.name} entered the Restock Drone's zone. Choose an interaction:`,
                            choices: choices,
                            icon: "fas fa-battery-full"
                        });
                    }
                }]
            });
        }
    }, {
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api) {
            await item.setFlag("lancer-automations", "deployRange", 5);

            const isRebake = item.system.lid?.includes('rebake') || item.name.toLowerCase().includes("rebake");
            if (isRebake) {
                await api.addExtraDeploymentLids(item, [
                    "dep_(npc)_support_rebake_restock_drone_t1",
                    "dep_(npc)_support_rebake_restock_drone_t2",
                    "dep_(npc)_support_rebake_restock_drone_t3"
                ]);
            } else {
                await api.addExtraDeploymentLids(item, [
                    "dep_(npc)_support_restock_drone_t1",
                    "dep_(npc)_support_restock_drone_t2",
                    "dep_(npc)_support_restock_drone_t3"
                ]);
            }
        }
    }]
};

/** @type {ReactionGroup} */
const npcInsulatedBonus = {
    category: "NPC",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api) {
            if (!api || !token.actor) {
                return;
            }
            const bonusId = `insulated_${item.id}`;
            const bonuses = api.getConstantBonuses(token.actor);

            if (!bonuses.some(b => b.id === bonusId)) {
                await api.addConstantBonus(token.actor, {
                    id: bonusId,
                    name: "Insulated",
                    type: "multi",
                    bonuses: [
                        {
                            type: "immunity",
                            subtype: "effect",
                            effects: ["burn"]
                        },
                        {
                            type: "immunity",
                            subtype: "damage",
                            damageTypes: ["Burn"]
                        }
                    ]
                });
            }
        }
    }]
};

/** @type {ReactionGroup} */
const npcRegenerativeShieldingAegis = {
    category: "NPC",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api) {
            if (!api || !token.actor) {
                return;
            }
            const bonusId = `regenerative_shielding_${item.id}`;
            const bonuses = api.getConstantBonuses(token.actor);

            if (!bonuses.some(b => b.id === bonusId)) {
                await api.addConstantBonus(token.actor, {
                    id: bonusId,
                    name: "Regenerative Shielding",
                    type: "multi",
                    bonuses: [
                        {
                            type: "immunity",
                            subtype: "effect",
                            effects: ["slow", "impaired"]
                        },
                        {
                            type: "immunity",
                            subtype: "crit",
                        }
                    ]
                });
            }
        }
    }]
};
// ─── Defense Net & Ring of Fire ───────────────────────────────────────────────


async function teardownDefenseNet(reactorToken, item, api, forced = false) {
    const cleanup = async () => {
        const RING_OF_FIRE_LIDS = ['npcf_ring_of_fire_aegis', 'npc-rebake_npcf_ring_of_fire_aegis'];

        if (RING_OF_FIRE_LIDS.some(lid => api.findItemByLid(reactorToken.actor, lid))) {
            for (const tokenDoc of game.scenes.active?.tokens ?? []) {
                const token = canvas.tokens.get(tokenDoc.id);
                if (!token)
                    continue;
                await api.removeEffectsByNameFromTokens({
                    tokens: [token],
                    effectNames: ['shredded'],
                    extraFlags: { ringOfFireSource: reactorToken.id }
                });
            }
        }

        await api.removeEffectsByNameFromTokens({
            tokens: [reactorToken],
            effectNames: ['immobilized'],
            extraFlags: { defenseNetSource: reactorToken.id }
        });

        for (const tokenDoc of game.scenes.active?.tokens ?? []) {
            const token = canvas.tokens.get(tokenDoc.id);
            if (!token || token.id === reactorToken.id)
                continue;
            await api.removeGlobalBonus(token.actor, b => b.context?.ownerTokenId === reactorToken.id);
        }

        const deletedAuras = await api.deleteAuras(reactorToken, { name: 'Defense Net' });
        if (deletedAuras.length && game.modules.get('sequencer')?.active) {
            for (const aura of deletedAuras) {
                Sequencer.EffectManager.endEffects({ origin: aura.id });
            }
        }

        if (forced)
            await api.endItemActivation(item, reactorToken);
    };

    if (forced) {
        await api.startChoiceCard({
            title: 'DEFENSE NET – FORCED OFFLINE',
            description: `<b>${reactorToken.name}</b>'s Defense Net has been forcibly shut down.`,
            icon: 'fas fa-shield-alt',
            mode: 'or',
            choices: [{ text: 'Acknowledged', icon: 'fas fa-check', callback: cleanup }]
        });
    } else {
        await cleanup();
    }
}

function buildDefenseNetAuraCallback() {
    return async (token, parent, aura, options) => {
        const applyDefenseNetBonuses = async (token, reactorToken, api) => {
            if (token.id === reactorToken.id)
                return;

            const defNetCondition = (_state, actor) => {
                const bonuses = api.getGlobalBonuses(actor);
                return !bonuses.some(b => b.context?.ownerTokenId === reactorToken.id);
            };

            /** @type {any[]} */
            const subBonuses = [
                { type: 'difficulty', val: 2, applyToTargetter: true, condition: defNetCondition },
                { type: 'immunity', subtype: 'crit', applyToTargetter: true, condition: defNetCondition }
            ];

            if (api.isFriendly(token, reactorToken))
                subBonuses.push({ type: 'immunity', subtype: 'effect', effects: ['impaired', 'slow'] });

            await api.addGlobalBonus(token.actor, {
                id: `defense-net-${reactorToken.id}`,
                name: 'Defense Net',
                type: 'multi',
                bonuses: subBonuses,
                context: { ownerTokenId: reactorToken.id }
            }, { duration: 'indefinite' });
        };
        if (options.isPreview)
            return;
        const la = game.modules.get('lancer-automations')?.api;
        if (!la)
            return;

        if (options.hasEntered) {
            await applyDefenseNetBonuses(token, parent, la);
        } else {
            await la.removeGlobalBonus(token.actor, b => b.context?.ownerTokenId === parent.id);
        }

        const RING_OF_FIRE_LIDS = ['npcf_ring_of_fire_aegis', 'npc-rebake_npcf_ring_of_fire_aegis'];
        if (!RING_OF_FIRE_LIDS.some(lid => la.findItemByLid(parent.actor, lid)))
            return;
        if (!la.isHostile(token, parent))
            return;

        if (options.hasEntered) {
            await la.executeDamageRoll(parent, [token], 2, 'Heat', 'Ring of Fire');
            await la.applyEffectsToTokens(
                { tokens: [token], effectNames: ['shredded'], duration: { label: 'unlimited' } },
                { ringOfFireSource: parent.id }
            );
        } else {
            await la.removeEffectsByNameFromTokens({
                tokens: [token],
                effectNames: ['shredded'],
                extraFlags: { ringOfFireSource: parent.id }
            });
        }
    };
}

/**
 * @returns {ReactionGroup}
 */
function buildDefenseNetReaction(radius, isRebake = false) {

    /** @type {ReactionConfig[]} */
    const reactions = [
        {
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (triggerData.endActivation) {
                    await teardownDefenseNet(reactorToken, item, api, false);
                    return;
                }
                await api.setItemAsActivated(item, reactorToken, "Protocol", "Collapse the Defense Net");
                await api.applyEffectsToTokens(
                    { tokens: [reactorToken], effectNames: ['immobilized'], duration: { label: 'unlimited' } },
                    { defenseNetSource: reactorToken.id }
                );
                const aura = await api.createAura(reactorToken, {
                    name: 'Defense Net',
                    radius,
                    macros: [{ function: buildDefenseNetAuraCallback() }]
                });

                if (aura && game.modules.get('sequencer')?.active) {
                    const tokenSize = reactorToken.document.width;
                    const diameter = (radius + 0.33 + tokenSize) * 2 * (canvas.grid.size || 100);
                    new Sequence()
                        .effect()
                        .file("jb2a.shield.03.loop.white")
                        .attachTo(reactorToken)
                        .size(diameter)
                        .persist()
                        .origin(aura.id)
                        .play();
                }
            }
        },
        {
            triggers: ["onStatusApplied"],
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (!api.getActivatedItems(reactorToken)?.some(i => i.id === item.id))
                    return false;
                return ['stunned', 'jammed'].includes(triggerData.statusId);
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                await teardownDefenseNet(reactorToken, item, api, true);
            }
        }
    ];

    if (isRebake) {
        reactions.push(
            {
                triggers: ["onHeat"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    if (!api.getActivatedItems(reactorToken)?.some(i => i.id === item.id))
                        return false;
                    const actor = reactorToken.actor;
                    return (triggerData.currentHeat ?? 0) >= (actor.system?.heat?.max ?? Infinity);
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    await teardownDefenseNet(reactorToken, item, api, true);
                }
            },
            {
                triggers: ["onTechMiss"],
                triggerSelf: false,
                triggerOther: true,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    if (!api.getActivatedItems(reactorToken)?.some(i => i.id === item.id))
                        return false;
                    return (triggerData.targets ?? []).some(t =>
                        api.getGlobalBonuses(t.target?.actor)
                            .some(b => b.context?.ownerTokenId === reactorToken.id)
                    );
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    await api.executeDamageRoll(
                        triggerData.triggeringToken ?? reactorToken,
                        [reactorToken],
                        2, 'Heat', 'Defense Net – Tech Miss'
                    );
                }
            }
        );
    }

    return { category: "NPC", itemType: "npc_feature", reactions };
}

const defenseNetReaction       = buildDefenseNetReaction(3);
const defenseNetRebakeReaction = buildDefenseNetReaction(2, true);
api.registerDefaultItemReactions({
    "npc-rebake_npcf_insulated_pyro": npcInsulatedBonus,
    "npc_clademaster_insulated": npcInsulatedBonus,
    "npcf_insulated_morningstar": npcInsulatedBonus,
    "npc_morozko_insulated": npcInsulatedBonus,
    "ppg_npcf_insulated_napalm": npcInsulatedBonus,
    "ubrg_npcf_insulated_cryo": npcInsulatedBonus,
    "npcf_insulated_arsonist_maxt": npcInsulatedBonus,
    "ubrg_npcf_insulated_salamander": npcInsulatedBonus,
    "npcf_insulated_pyro": npcInsulatedBonus,
    "moff_insulated_firebug": npcInsulatedBonus,
    "npcf_insulated_veteran": npcInsulatedBonus,
    "npc-rebake_npcf_suppress_archer": suppressArcherReaction,
    "npcf_suppress_archer": suppressArcherReaction,
    "npc-rebake_npcf_regenerative_shielding_aegis": npcRegenerativeShieldingAegis,
    "npcf_regenerative_shielding_aegis": npcRegenerativeShieldingAegis,
    "npcf_defense_net_aegis": defenseNetReaction,
    "npc-rebake_npcf_defense_net_aegis": defenseNetRebakeReaction,
    "ubrg_npcf_battlefield_diagnostics_armourer": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onTechHit"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Quick Action",
            frequency: "Unlimited",
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const targetData = triggerData.targets?.[0];
                if (!targetData)
                    return false;

                const target = targetData.target;
                if (!api.isFriendly(reactorToken, target))
                    return false;

                const weapons = api.getWeapons(target);
                if (!weapons.length)
                    return false;

                return true;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (!api)
                    return;

                const targetData = triggerData.targets?.[0];
                const target = targetData.target;

                if (triggerData.targets.length > 1) {
                    ui.notifications.info("Battlefield Diagnostics: Multiple targets hit. Only applying to the first target.");
                }

                const weapons = api.getWeapons(target);

                const unloadedWeapons = weapons.filter(w => w.system.tags?.some(t => t.id === "tg_loading") && w.system.loaded === false);
                const ordnanceWeapons = weapons.filter(w => w.system.tags?.some(t => t.id === "tg_ordnance"));
                const allowedTags = [
                    { id: "tg_ap", name: "Armor Piercing" },
                    { id: "tg_seeking", name: "Seeking" },
                    { id: "tg_reliable", name: "Reliable" },
                    { id: "tg_knockback", name: "Knockback" }
                ];

                const actionChoices = [];

                if (unloadedWeapons.length > 0) {
                    actionChoices.push({
                        text: "Reload a Loading Weapon",
                        icon: "fas fa-sync",
                        callback: async () => {
                            await api.reloadOneWeapon(target);
                        }
                    });
                }

                if (ordnanceWeapons.length > 0) {
                    actionChoices.push({
                        text: "Remove Ordnance",
                        icon: "fas fa-minus-circle",
                        callback: async () => {
                            const chosenWeapon = await api.pickItem(ordnanceWeapons, {
                                title: "CHOOSE WEAPON",
                                description: "Select which weapon loses Ordnance:",
                                icon: "fas fa-minus-circle",
                                formatText: (w) => `Remove Ordnance from ${w.name}`
                            });
                            if (chosenWeapon) {
                                await api.addGlobalBonus(target.actor, {
                                    type: "tag",
                                    tagId: "tg_ordnance",
                                    name: "Remove Ordnance",
                                    removeTag: true,
                                    itemId: chosenWeapon.id
                                }, { duration: "end", origin: reactorToken });
                                ui.notifications.info(`${target.name}'s ${chosenWeapon.name} loses Ordnance until the end of their next turn!`);
                            }
                        }
                    });
                }

                for (const tag of allowedTags) {
                    const eligibleWeapons = weapons.filter(w => !w.system.tags?.some(t => t.id === tag.id));
                    if (eligibleWeapons.length > 0) {
                        let tagDisplayName = tag.name;
                        if (tag.id === "tg_reliable")
                            tagDisplayName = "Reliable 2";
                        if (tag.id === "tg_knockback")
                            tagDisplayName = "Knockback 3";
                        actionChoices.push({
                            text: `Add ${tagDisplayName}`,
                            icon: "fas fa-tag",
                            callback: async () => {
                                const chosenWeapon = await api.pickItem(eligibleWeapons, {
                                    title: "CHOOSE WEAPON",
                                    description: `Select which weapon gains ${tagDisplayName}:`,
                                    icon: "fas fa-tag",
                                    formatText: (w) => `Add ${tagDisplayName} to ${w.name}`
                                });
                                if (chosenWeapon) {
                                    let tagVal = "";
                                    if (tag.id === "tg_reliable")
                                        tagVal = "2";
                                    if (tag.id === "tg_knockback")
                                        tagVal = "3";

                                    await api.addGlobalBonus(target.actor, {
                                        type: "tag",
                                        tagId: tag.id,
                                        tagName: tag.name,
                                        name: `Battlefield Diagnostics`,
                                        tagMode: "add",
                                        val: tagVal,
                                        itemId: chosenWeapon.id
                                    }, { duration: "end", origin: reactorToken });
                                    ui.notifications.info(`${target.name}'s ${chosenWeapon.name} gains ${tagDisplayName} until the end of their next turn!`);
                                }
                            }
                        });
                    }
                }

                if (actionChoices.length === 0) {
                    ui.notifications.info(`${target.name} has no valid weapons to calibrate.`);
                    return;
                }

                await api.startChoiceCard({
                    title: "BATTLEFIELD DIAGNOSTICS",
                    description: `Choose an upgrade for ${target.name}'s weapons:`,
                    choices: actionChoices,
                    icon: "fas fa-wrench"
                });
            }
        }]
    },
    "npc-rebake_npcf_sealant_gun_support": sealantGunReaction,
    "npcf_sealant_gun_support": sealantGunReaction,
    "npcf_mech_splint_triage_maxt": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Full Action",
            frequency: "Unlimited",
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            onlyOnSourceMatch: true,
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (!api)
                    return;

                const targets = await api.chooseToken(reactorToken, {
                    range: 1,
                    count: 1,
                    filter: (t) => api.isFriendly(reactorToken, t),
                    title: "SPLINT TRIAGE",
                    description: "Select an adjacent ally to clear a condition.",
                    icon: "fas fa-briefcase-medical"
                });
                const target = targets?.[0];
                if (!target)
                    return;

                const conditions = api.getAllEffects(target);

                if (conditions.length === 0) {
                    ui.notifications.info(`${target.name} has no conditions to clear.`);
                    return;
                }

                // Multiple conditions - let user choose
                const choices = conditions.map(e => ({
                    text: e.name,
                    icon: e.icon || "fas fa-notes-medical",
                    callback: () => {
                        api.deleteEffect(target, e);
                        ui.notifications.info(`Cleared ${e.name} from ${target.name}.`);
                    }
                }));

                await api.startChoiceCard({
                    choices,
                    title: "CLEAR CONDITION",
                    description: `Select a condition to clear from ${target.name}.`,
                    icon: "fas fa-briefcase-medical"
                });
            }
        }]
    },
    "npc-rebake_npcf_moving_target_archer": movingTargetArcherReaction,
    "npcf_moving_target_archer": movingTargetArcherReaction,
    "npcf_moving_target_sniper": movingTargetSniperReaction,
    "Maneuver": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onDamage"],
            triggerSelf: false,
            triggerOther: true,
            outOfCombat: false,
            actionType: "Free Action",
            frequency: "1/Round",
            autoActivate: false,
            activationType: "flow",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                if (triggerData.target?.id !== reactorToken.id)
                    return false;
                if (triggerData.isHit)
                    return false;
                const tags = triggerData.weapon?.system?.tags || [];
                return tags.some(t => t.lid === 'tg_reliable');
            }
        }],
    },
    "fast_vehicle": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onCheck"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Free Action",
            frequency: "1/Round",
            autoActivate: false,
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                return triggerData.success === true;
            },
        }, {
            triggers: ["onActivation"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: false,
            actionType: "Free Action",
            frequency: "Unlimited",
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                return triggerData.actionName === "Boost";
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const hasSoftCover = api.findEffectOnToken(reactorToken, e => e.name === "Soft Cover");
                if (!hasSoftCover) {
                    await api.applyEffectsToTokens({
                        tokens: [reactorToken],
                        effectNames: ["cover_soft"],
                        note: "Fast Vehicle Boost",
                        duration: { label: 'start', turns: 1, rounds: 0 }
                    });
                }
            }
        }],
    },
    "nrfaw-npc_npcf_sapper_kit_smoke_grenade_strider": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Quick Action",
            usesPerRound: 1,
            onlyOnSourceMatch: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (!api?.placeZone) {
                    ui.notifications.warn("lancer-automations module required for smoke grenade placement");
                    return;
                }

                await api.placeZone(reactorToken, {
                    range: 5,
                    size: 1,
                    type: "Blast",
                    fillColor: "#808080",
                    borderColor: "#ffffff",
                    statusEffects: ["cover_soft"],
                    title: "SMOKE GRENADE",
                    description: "Place a Blast 1 smoke zone within Range 5.",
                    icon: "fas fa-smog",
                    centerLabel: "Smoke"
                });
            }
        }]
    },
    "ubrg_npcf_scorcher_missile_rack_avenger": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onAttack"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: false,
            actionType: "Free Action",
            frequency: "Unlimited",
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (!api?.placeZone)
                    return;

                await api.placeZone(reactorToken, {
                    size: 0.5,
                    type: "Blast",
                    dangerous: {
                        damageType: "burn",
                        damageValue: 5
                    },
                    title: "SCORCHER MISSILE",
                    description: "Place a single hex dangerous zone.",
                    icon: "fas fa-fire",
                    centerLabel: "Scorched Ground"
                });
            }
        }]
    },
    "npc_carrier_RemoteMachineGun": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onHit", "onDestroyed"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: false,
            actionType: "Free Action",
            frequency: "Unlimited",
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName) {
                return triggerData.triggeringToken?.id === reactorToken.id;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (triggerType === "onHit") {
                    const targets = triggerData.targets?.map(t => t.target) || (triggerData.target ? [triggerData.target] : []);
                    if (targets.length) {
                        await api.applyEffectToTokens({
                            tokens: targets,
                            effectNames: ["lancer.statusIconsNames.impaired"],
                            note: "Remote Machine Gun",
                            duration: { label: 'end', turns: 1, rounds: 0 },
                            checkEffectCallback: (token, effect) => {
                                const lancerAutomations = game.modules.get('lancer-automations');
                                return !!lancerAutomations?.api?.findEffectOnToken(token, e =>
                                    e.flags?.['lancer-automations']?.RemoteMachineGunID === reactorToken.id &&
                                        e.name.toLowerCase().includes("impaired")
                                );
                            }
                        }, {
                            RemoteMachineGunID: reactorToken.id
                        });
                    }
                } else if (triggerType === "onDestroyed") {
                    for (const t of canvas.tokens.placeables) {
                        if (!t.actor)
                            continue;

                        const impairedEffect = api.findEffectOnToken(t, e =>
                            e.flags?.['lancer-automations']?.RemoteMachineGunID === reactorToken.id &&
                            e.name.toLowerCase().includes("impaired")
                        );
                        if (impairedEffect)
                            await impairedEffect.delete();
                    }
                }
            }
        }, {
            triggers: ["onMove"],
            triggerSelf: false,
            triggerOther: true,
            outOfCombat: false,
            actionType: "Free Action",
            frequency: "Unlimited",
            autoActivate: false,
            activationType: "code",
            activationMode: "after",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const mover = triggerData.triggeringToken;
                const effect = api?.findEffectOnToken(mover, e =>
                    e.flags?.['lancer-automations']?.RemoteMachineGunID === reactorToken.id &&
                        e.name.toLowerCase().includes("impaired")
                );
                if (!effect)
                    return false;
                if (triggerData.moveInfo?.isInvoluntary)
                    return false;
                return true;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const mover = triggerData.triggeringToken;
                const effect = api?.findEffectOnToken(mover, e =>
                    e.flags?.['lancer-automations']?.RemoteMachineGunID === reactorToken.id &&
                        e.name.toLowerCase().includes("impaired")
                );
                if (effect) {
                    const tier = reactorToken.actor?.system?.tier || 1;
                    const damage = tier + 1;

                    await effect.delete();
                    const DamageRollFlow = game.lancer.flows.get("DamageRollFlow");
                    if (!DamageRollFlow)
                        return;
                    const flow = new DamageRollFlow(mover.actor.uuid, {
                        title: "Remote Machine Gun",
                        damage: [{ val: String(damage), type: "Kinetic" }],
                        tags: [],
                        hit_results: [],
                        has_normal_hit: true
                    });
                    await flow.begin();
                }
            }
        }]
    },
    "npcf_dispersal_shield_priest": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Quick Action",
            frequency: "Unlimited",
            onlyOnSourceMatch: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (!api?.applyEffectToTokens) {
                    ui.notifications.error("lancer-automations module required");
                    return;
                }

                // 1. Select allied target or self
                const targets = await api.chooseToken(reactorToken, {
                    count: 1,
                    range: reactorToken.actor.system.sensor_range,
                    includeSelf: true,
                    filter: (t) => api.isFriendly(reactorToken, t),
                    title: "DISPERSAL SHIELD",
                    description: "Select an allied target (or self) within Sensor Range.",
                    icon: "fas fa-shield-alt"
                });
                const target = targets?.[0];
                if (!target)
                    return;
                const roll = await new Roll("1d3").evaluate();
                await roll.toMessage({
                    speaker: ChatMessage.getSpeaker({ token: reactorToken.document }),
                    flavor: `${activationName} - Resistance charges`
                });
                const charges = roll.total;
                const resistances = ["Resist All"];

                await api.applyEffectToTokens({
                    tokens: [target],
                    effectNames: resistances,
                    note: `Dispersal Shield (${charges} charges)`,
                    duration: { label: 'indefinite', turns: null, rounds: null, overrideTurnOriginId: reactorToken.id },
                }, {
                    stack: charges,
                    consumption: {
                        trigger: "onDamage",
                        originId: target.id,
                        grouped: true
                    }
                });
            }
        }]
    },
    "nrfaw-npc_carrier_SmokeLaunchers": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Quick Action",
            usesPerRound: 1,
            onlyOnSourceMatch: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (!api?.placeZone) {
                    ui.notifications.warn("lancer-automations module required for smoke placement");
                    return;
                }

                const result = await api.placeZone(reactorToken, {
                    range: 5,
                    size: 2,
                    type: "Blast",
                    fillColor: "#808080",
                    borderColor: "#ffffff",
                    statusEffects: ["cover_soft"],
                    title: "SMOKE LAUNCHERS",
                    description: "Place a Blast 2 smoke zone within Range 5.",
                    icon: "fas fa-smog",
                    centerLabel: "Smoke"
                }, 2);

                if (result?.template) {
                    const existing = reactorToken.actor.getFlag("lancer-automations", "smokeTemplates") || [];
                    existing.push(result.template.id);
                    await reactorToken.actor.setFlag("lancer-automations", "smokeTemplates", existing);
                }
            }
        }, {
            triggers: ["onTurnStart"],
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName) {
                const templates = reactorToken.actor.getFlag("lancer-automations", "smokeTemplates") || [];
                if (!templates.length)
                    return;

                for (const id of templates) {
                    const template = canvas.scene.templates.get(id);
                    if (template)
                        await template.delete();
                }

                await reactorToken.actor.unsetFlag("lancer-automations", "smokeTemplates");
            }
        }]
    },
    "npc_sergeant_SquadLeader": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Quick Action",
            frequency: "1/Round",
            autoActivate: true,
            activationType: "code",
            onlyOnSourceMatch: true,
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                if (!api)
                    return;

                const targets = await api.chooseToken(reactorToken, {
                    range: reactorToken.actor.system.sensor_range,
                    title: "SQUAD LEADER",
                    description: "Select an ally",
                    includeSelf: true,
                    filter: t => api.isFriendly(reactorToken, t)
                });
                const target = targets?.[0];
                if (!target)
                    return;

                await api.addGlobalBonus(target.actor, {
                    name: "Squad Leader",
                    val: 1,
                    type: "accuracy",
                    rollTypes: ["attack"],
                    uses: 1
                }, {
                    duration: "1 Round",
                    origin: reactorToken,
                    consumption: {
                        trigger: "onHit"
                    }
                });
            }
        }, {
            triggers: ["onInitCheck", "onCheck"],
            triggerSelf: false,
            triggerOther: true,
            outOfCombat: false,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const target = triggerData.checkAgainstToken;
                if (!target)
                    return false;
                const effect = api.findEffectOnToken(target, e =>
                    e.name === "Squad Leader" &&
                        e.flags?.['lancer-automations']?.originID === reactorToken.id
                );
                return !!effect;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const target = triggerData.checkAgainstToken;
                const roller = triggerData.triggeringToken;

                const effect = api.findEffectOnToken(target, e =>
                    e.name === "Squad Leader" &&
                        e.flags?.['lancer-automations']?.originID === reactorToken.id
                );

                if (effect && roller) {
                    if (triggerType === "onInitCheck") {
                        triggerData.flowState.injectBonus({
                            name: "Squad Leader",
                            val: 1,
                            type: "difficulty"
                        });

                    } else if (triggerType === "onCheck") {
                        await api.consumeEffectCharge(effect);
                    }
                }
            }
        }]
    },
    "moff_triangulation_ping_sysadmin": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            name: "Triangulation Ping",
            triggers: ["onTechAttack"],
            actionType: "Free Action",
            frequency: "Unlimited",
            triggerSelf: false,
            triggerOther: true,
            outOfCombat: false,
            autoActivate: false,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const triggerer = triggerData.triggeringToken;

                if (api.isFriendly(reactorToken, triggerer))
                    return false;

                const sensors = reactorToken.actor.system.sensor_range;
                const dist = triggerData.distanceToTrigger;
                if (dist > sensors)
                    return false;

                const round = game.combat?.round ?? 0;
                const flagKey = `triangulation_ping_round_${round}`;
                const existingFlags = reactorToken.actor.getFlag("lancer-automations", flagKey) || [];
                if (existingFlags.includes(triggerer.id))
                    return false;

                return true;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                const triggerer = triggerData.triggeringToken;
                const round = game.combat?.round ?? 0;

                if (round > 1) {
                    const prevRoundKey = `triangulation_ping_round_${round - 1}`;
                    if (reactorToken.actor.getFlag("lancer-automations", prevRoundKey)) {
                        await reactorToken.actor.unsetFlag("lancer-automations", prevRoundKey);
                    }
                }

                const result = await api.executeStatRoll(triggerer.actor, "SYS", "Triangulation Ping Save", reactorToken);
                if (!result.passed) {
                    const flagKey = `triangulation_ping_round_${round}`;
                    const existingFlags = reactorToken.actor.getFlag("lancer-automations", flagKey) || [];

                    await reactorToken.actor.setFlag("lancer-automations", flagKey, [...existingFlags, triggerer.id]);
                    await api.applyEffectToTokens({
                        tokens: [triggerer],
                        effectNames: ["lockon"],
                        note: "Failed Triangulation Ping Save"
                    });
                }
            }
        }]
    },
    "npc-rebake_npcf_deployable_turret_engineer": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api) {
                await api.addExtraDeploymentLids(item, [
                    "dep_(npc)_engineer_rebake_turret_t1",
                    "dep_(npc)_engineer_rebake_turret_t2",
                    "dep_(npc)_engineer_rebake_turret_t3"
                ]);
            }
        }]
    },
    "npcf_deployable_turret_engineer": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api) {
                await api.addExtraDeploymentLids(item, [
                    "dep_(npc)_engineer_turret_t1",
                    "dep_(npc)_engineer_turret_t2",
                    "dep_(npc)_engineer_turret_t3"
                ]);
            }
        }]
    },
    "npcf_restock_drone_support": restockDroneSupportReaction,
    "npc-rebake_npcf_restock_drone_support": restockDroneSupportReaction,
    "npcf_veterancy_veteran": veterancyVeteranReaction,
    "npc-rebake_npcf_veterancy_veteran": veterancyVeteranReaction,
    "npcf_marker_rifle_scout": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [
            {
                triggers: ["onHit"],
                triggerSelf: true,
                triggerOther: false,
                outOfCombat: true,
                autoActivate: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    const targets = triggerData.targets?.map(t => t.target).filter(Boolean) || [];
                    for (const target of targets) {
                        await api.applyEffectsToTokens(
                            { tokens: [target], effectNames: ["lockon"] },
                            { markerRifleSource: reactorToken.id }
                        );
                        await api.applyEffectsToTokens(
                            { tokens: [target], effectNames: ["shredded"] },
                            { consumption: { trigger: "onStatusRemoved", statusId: "lockon" } }
                        );
                    }
                }
            },
            {
                triggers: ["onInitActivation"],
                triggerSelf: false,
                triggerOther: true,
                outOfCombat: false,
                autoActivate: true,
                forceSynchronous: true,
                consumesReaction: false,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api) {
                    if (triggerData.actionName !== 'Hide')
                        return false;
                    const token = triggerData.triggeringToken;
                    if (!token?.actor)
                        return false;
                    const hasMarkerLockOn = !!api.findEffectOnToken(token, e =>
                        (e.statuses?.first() === 'lockon' || e.name?.toLowerCase().includes('lockon')) &&
                        e.flags?.['lancer-automations']?.markerRifleSource === reactorToken.id
                    );
                    return hasMarkerLockOn;
                },
                activationCode: async function (triggerType, triggerData, reactorToken) {
                    triggerData.cancelAction("This unit is Marked — it cannot Hide while under Marker Rifle lock.");
                }
            },
            {
                triggers: ["onPreStatusApplied"],
                triggerSelf: false,
                triggerOther: true,
                outOfCombat: false,
                autoActivate: true,
                forceSynchronous: true,
                consumesReaction: false,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken) {
                    const stealthStatuses = ['invisible', 'hidden', 'stealth'];
                    if (!stealthStatuses.includes(triggerData.statusId))
                        return false;
                    const token = triggerData.triggeringToken;
                    if (!token?.actor)
                        return false;
                    const hasMarkerLockOn = !!api.findEffectOnToken(token, e =>
                        (e.statuses?.first() === 'lockon' || e.name?.toLowerCase().includes('lockon')) &&
                        e.flags?.['lancer-automations']?.markerRifleSource === reactorToken.id
                    );
                    return hasMarkerLockOn;
                },
                activationCode: async function (triggerType, triggerData, reactorToken) {
                    triggerData.cancelChange("This unit is Marked — it cannot become invisible while under Marker Rifle lock.");
                }
            }
        ]
    },
    "npc-rebake_npcf_marker_rifle_scout": {
        category: "NPC",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onHit"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api) {
                triggerData.targets.forEach(target => {
                    api.applyEffectToTokens({
                        tokens: [target],
                        effectNames: ["lockon"],
                    });
                    api.applyEffectToTokens({
                        tokens: [target],
                        effectNames: ["shredded"],
                        duration: { label: 'end', turns: 1, rounds: 0 }
                    });
                });
            }
        }]
    }
});
