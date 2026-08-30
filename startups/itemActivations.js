/*global game, Sequencer, Sequence, canvas, ui, ChatMessage, Roll, api */

function whiteIcon(img)
{
    return String(img ?? '').replace('lancer/assets/icons/', 'lancer/assets/icons/white/');
}

const OWNER_ONLY_AURA_VISIBILITY = {
    onlyEnabledInCombat: true,
    ownerVisibility:    { default: true,  hovered: true,  controlled: true,  dragging: true,  targeted: true,  turn: true  },
    nonOwnerVisibility: { default: false, hovered: false, controlled: false, dragging: false, targeted: false, turn: false }
};

/** @type {ReactionGroup} */
const suppressArcherAutomation = {
    category: "NPC (LaSossis)",
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
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            if (triggerType === "onActivation")
                return triggerData.triggeringToken?.id === reactorToken.id && triggerData.item?.system?.lid === item?.system?.lid;
            if (triggerType === "onDamage")
            {
                if (triggerData.triggeringToken?.id === reactorToken.id)
                    return false;
                const target = triggerData.target;
                if (!target)
                    return false;
                return api.findEffectsOnToken(target, "Suppress", { extraFlags: { suppressSourceId: reactorToken.id } }).length > 0;
            }
            if (triggerType === "onStatusApplied")
            {
                if (triggerData.triggeringToken?.id !== reactorToken.id)
                    return false;
                const statusId = (triggerData.statusId || '').toLowerCase();
                const effectName = (triggerData.effect?.name || '').toLowerCase();
                return statusId.includes('stunned') || statusId.includes('jammed') || effectName.includes('stunned') || effectName.includes('jammed');
            }
            if (triggerType === "onDestroyed")
                return triggerData.triggeringToken?.id === reactorToken.id;
            return false;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
            if (!customStatusApi)
                return;

            const removeSuppressFromAll = async () =>
            {
                const marked = api.findMarkedTokens(reactorToken, "Suppress", { flagKey: 'suppressSourceId' });
                if (marked.length)
                {
                    await api.removeEffectsByNameFromTokens({
                        tokens: marked,
                        effectNames: ["Suppress", "impaired"],
                        extraFlags: { suppressSourceId: reactorToken.id }
                    });
                }
            };
            const isItemActive = () => !!api.getActivatedItems?.(reactorToken)?.some(active => active.id === item.id);

            if (triggerType === "onActivation")
            {
                if (triggerData.endActivation)
                {
                    await removeSuppressFromAll();
                    return;
                }

                // Remove existing suppress from previous activation
                await removeSuppressFromAll();

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
                    note: "Suppressed by Archer"
                }, {
                    suppressSourceId: reactorToken.id,
                    suppressSourceName: reactorToken.name
                });

                await api.setItemAsActivated(item, reactorToken, "Free", "Deactivate Suppress");
            }
            else if (triggerType === "onDamage")
            {
                const target = triggerData.target;
                const token = target.token?.object || canvas.tokens.placeables.find(tok => tok.actor?.id === target.actor?.id);

                if (token && api?.removeEffectsByNameFromTokens)
                {
                    await api.removeEffectsByNameFromTokens({
                        tokens: [token],
                        effectNames: ["Suppress", "impaired"],
                        extraFlags: { suppressSourceId: reactorToken.id }
                    });
                }
                if (isItemActive())
                    await api.endItemActivation(item, reactorToken);
            }
            else if (triggerType === "onStatusApplied" || triggerType === "onDestroyed")
            {
                await removeSuppressFromAll();
                if (isItemActive())
                    await api.endItemActivation(item, reactorToken);
            }
        }
    }]
};

/** @type {ReactionGroup} */
const movingTargetSniperAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onPreMove"],
        triggerSelf: false,
        triggerOther: true,
        outOfCombat: false,
        actionType: "Reaction",
        frequency: "1/Round",
        autoActivate: true,
        awaitActivationCompletion: true,
        requireCanProvoke: true,
        checkReaction: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const mover = triggerData.triggeringToken;
            if (triggerData.moveInfo?.isInvoluntary)
                return false;
            if (triggerData.distanceToTrigger > 20)
                return false;
            if (!api.hasLineOfSight(reactorToken, mover))
                return false;
            if (api.isFriendly(reactorToken, mover))
                return false;
            return true;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const mover = triggerData.triggeringToken;
            let preConfirmResponderIds = [];
            const preConfirm = async () =>
            {
                const ask = await api.askCard({
                    title: "INTERRUPT MOVEMENT?",
                    description: `<b>${mover.name}</b> is moving into <b>${reactorToken.name}</b> sights. It movement can be interrupted`,
                    item,
                    originToken: mover,
                    relatedToken: reactorToken,
                    owner: reactorToken,
                    yesText: "Interrupt",
                    yesIcon: "fas fa-crosshairs",
                    noText: "Let pass"
                });
                preConfirmResponderIds = ask.responderIds;
                if (ask.confirmed)
                    triggerData.startRelatedFlowToReactor(preConfirmResponderIds[0]);
                return ask.confirmed;
            };
            const postChoice = async (chose) =>
            {
                if (!chose && preConfirmResponderIds.length > 0)
                {
                    await (/** @type {any} */(triggerData.sendMessageToReactor))({ moverTokenId: mover.id }, preConfirmResponderIds[0], {
                        wait: true,
                        waitTitle: "MOVING TARGET",
                        waitDescription: `Waiting for <b>${reactorToken.name}</b>'s player to fire…`,
                        waitItem: item,
                        waitOriginToken: reactorToken,
                        waitRelatedToken: mover
                    });
                }
            };
            triggerData.cancelTriggeredMove?.(
                `<b>${reactorToken.name}</b> is interrupting <b>${mover.name}</b>'s movement.`,
                true,
                api.getTokenOwnerUserId(mover),
                preConfirm,
                postChoice,
                { item, originToken: reactorToken, relatedToken: mover }
            );
        },
        onMessage: async function (triggerType, data, reactorToken, item, activationName, api)
        {
            const mover = canvas.tokens.get(data.moverTokenId) ?? null;
            const rifle = api.findItemByLid(reactorToken.actor, "npcf_anti_materiel_rifle_sniper");
            if (!rifle)
            {
                ui.notifications.warn(`Moving Target: Anti-materiel Rifle not found on ${reactorToken.name}.`);
                return;
            }
            const fire = await api.confirmCard({
                title: "MOVING TARGET",
                description: `<b>${mover?.name ?? 'Target'}</b> is pushing through your sights. Fire!`,
                item,
                originToken: reactorToken,
                relatedToken: mover,
                userIdControl: api.getTokenOwnerUserId(reactorToken),
                confirmText: "Fire",
                confirmIcon: "fas fa-crosshairs"
            });
            if (!fire)
                return;
            const attack = await api.attackWith(rifle, mover ? [mover] : null, { reloadIfEmpty: true });
            if (attack.reloaded)
            {
                ChatMessage.create({
                    content: `<div class="lancer-chat-message"><b>${reactorToken.name} - Moving Target</b><br>The Anti-materiel Rifle wasn't loaded. ${reactorToken.name} reloads.</div>`,
                    speaker: ChatMessage.getSpeaker({ token: reactorToken })
                });
            }
        }
    }]
};

/** @type {ReactionGroup} */
const movingTargetArcherAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onPreMove"],
        triggerSelf: false,
        triggerOther: true,
        outOfCombat: true,
        actionType: "Reaction",
        frequency: "1/Round",
        autoActivate: true,
        awaitActivationCompletion: true,
        requireCanProvoke: true,
        checkReaction: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const mover = triggerData.triggeringToken;
            if (!mover)
                return false;
            return api.findEffectsOnToken(mover, "Suppress", { extraFlags: { suppressSourceId: reactorToken.id } }).length > 0;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const mover = triggerData.triggeringToken;
            if (!mover)
                return;
            let preConfirmResponderIds = [];
            const preConfirm = async () =>
            {
                const ask = await api.askCard({
                    title: "INTERRUPT MOVEMENT?",
                    icon: api.getActivationIcon("reaction"),
                    description: `<b>${mover.name}</b> is suppressed by <b>${reactorToken.name}</b>. Its movement can be interrupted.`,
                    item,
                    originToken: mover,
                    relatedToken: reactorToken,
                    owner: reactorToken,
                    yesText: "Interrupt",
                    yesIcon: "fas fa-crosshairs",
                    noText: "Let pass"
                });
                preConfirmResponderIds = ask.responderIds;
                if (ask.confirmed)
                    await api.addActorFlags(reactorToken.actor, { movingTargetArcherMoverId: mover.id });
                return ask.confirmed;
            };
            const postChoice = async (chose) =>
            {
                if (chose && preConfirmResponderIds.length > 0)
                    await triggerData.startRelatedFlowToReactor(preConfirmResponderIds[0]);
            };
            triggerData.cancelTriggeredMove?.(
                `<b>${reactorToken.name}</b> is interrupting <b>${mover.name}</b>'s movement.`,
                true,
                api.getTokenOwnerUserId(mover),
                preConfirm,
                postChoice,
                { item, originToken: reactorToken, relatedToken: mover }
            );
        }
    }, {
        triggers: ["onActivation"],
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: false,
        actionType: "Reaction",
        frequency: "1/Round",
        autoActivate: true,
        onlyOnSourceMatch: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const moverId = api.getActorFlags(reactorToken.actor, 'movingTargetArcherMoverId');
            await api.removeActorFlags(reactorToken.actor, { movingTargetArcherMoverId: true });
            const mover = moverId ? canvas.tokens.get(moverId) ?? null : null;
            if (api?.removeEffectsByNameFromTokens && mover)
            {
                await api.removeEffectsByNameFromTokens({
                    tokens: [mover],
                    effectNames: ["Suppress", "impaired"],
                    extraFlags: { suppressSourceId: reactorToken.id }
                });
            }
            await api.executeSkirmish(reactorToken.actor, null, mover);
        }
    }]
};

/** @type {ReactionGroup} */
const sealantGunAutomation = {
    category: "NPC (LaSossis)",
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
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
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

            if (isFriendly)
            {
                // Allied Path: Clear Burn, Apply Slowed
                await api.removeEffectsByNameFromTokens({ tokens: [target], effectNames: ['burn'] });
                await api.updateTokenSystem(target, { 'system.burn': 0 });
                await api.applyEffectsToTokens({
                    tokens: [target],
                    effectNames: ["slowed"],
                    note: "Sealant Gun (Allied)",
                    duration: { label: 'end', turns: 1, rounds: 0 }
                });
            }
            else
            {
                // Hostile/Neutral Path: Save, Apply Slowed on fail, Always Place Zone
                await api.executeSaveVsEffect([target], {
                    stat: "AGI",
                    title: "Sealant Gun Save",
                    origin: reactorToken,
                    sendToOwner: false,
                    effects: ["slowed"],
                    note: "Sealant Gun (Hostile)",
                    duration: { label: 'end', turns: 1, rounds: 0 }
                });
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

const ENGINEER_MARK_NAME = "Engineer's Mark";

/** @type {ReactionGroup} */
const engineersMarkAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onActivation"],
        onlyOnSourceMatch: true,
        actionType: "Quick Action",
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        checkUsage: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            await api.clearMarks(reactorToken, ENGINEER_MARK_NAME, { flagKey: 'engineersMarkSourceId' });

            const chosen = await api.chooseToken(reactorToken, {
                count: 1,
                range: 10,
                title: "ENGINEER'S MARK",
                description: "Choose the target the turrets will fire on."
            });
            if (!chosen?.length)
                return;
            await api.applyMark(reactorToken, [chosen[0]], {
                effect: { name: ENGINEER_MARK_NAME, isCustom: true, icon: "modules/lancer-automations/icons/cross-mark.svg" },
                note: "Turrets target this character",
                duration: { label: 'start', turns: 1, rounds: 0, overrideTurnOriginId: reactorToken.id },
                flagKey: 'engineersMarkSourceId'
            });
        }
    }]
};

const turretShutdownOnDeathAutomation = {
    triggers: ["onDestroyed"],
    triggerSelf: true,
    triggerOther: false,
    autoActivate: true,
    outOfCombat: true,
    activationType: "code",
    activationMode: "instead",
    activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
    {
        const ownerUuid = reactorToken?.actor?.uuid;
        if (!ownerUuid)
            return;
        const turrets = (canvas.tokens?.placeables ?? []).filter(token =>
            token.actor?.type === 'deployable'
            && token.document?.getFlag?.('lancer-automations', 'ownerActorUuid') === ownerUuid);
        if (turrets.length)
            await api.applyEffectsToTokens({ tokens: turrets, effectNames: ['shutdown'], note: 'Owner destroyed', duration: { label: 'unlimited' } });
    }
};

const turretDeployOverlayAutomation = {
    triggers: ["onDeploy"],
    triggerSelf: true,
    triggerOther: false,
    autoActivate: true,
    activationType: "code",
    activationMode: "instead",
    onlyOnSourceMatch: true,
    outOfCombat: true,
    activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
    {
        const tier = api.getTier(reactorToken);
        for (const deployedToken of (triggerData.deployedTokens ?? []))
        {
            if (!deployedToken?.actor)
                continue;
            await api.setActionOverlay(deployedToken.actor, "Turret Attack (Auto)", {
                laCombat: "attack",
                attack_bonus: tier,
                attack_type: "Ranged",
                damage: [{ val: String(3 + tier), type: "Kinetic" }]
            });
        }
    }
};

const baserunnerDefenseAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.lockActorAction(item, item.name, "Fires only at the end of the turn");
        }
    }, {
        triggers: ["onTurnEnd"],
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            return !item.system?.destroyed;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const fire = await api.confirmCard({
                title: item.name,
                description: "Fire as a free action?",
                icon: "mdi mdi-target",
                relatedToken: reactorToken,
                item,
                confirmText: "Fire"
            });
            if (fire)
                await item.beginWeaponAttackFlow();
        }
    }]
};

/** @type {ReactionGroup} */
const restockDroneSupportAutomation = {
    category: "NPC (LaSossis)",
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
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const deployedTokens = triggerData.deployedTokens;
            if (!deployedTokens?.length)
                return;

            const deployedToken = deployedTokens[0];
            if (!deployedToken)
                return;

            const isRebake = item.system.lid?.includes('rebake') || item.name.toLowerCase().includes("rebake");

            const healAmount = api.tierValue(reactorToken, isRebake ? [5, 8, 10] : [5, 10, 15]);

            await api.createAura(deployedToken, {
                name: "Restock Drone Zone",
                radius: 1,
                elevationAware: true,
                disposition: 1, // Allied
                height: { top: null, bottom: null },
                shape: {
                    type: "cylinder",
                    radius: 1
                },
                macros: [{
                    mode: "ENTER",
                    function: async (token, parent, aura, options) =>
                    {
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
                                callback: async () =>
                                {
                                    const currentHP = token.actor.system.hp.value;
                                    const maxHP = token.actor.system.hp.max;
                                    const newHP = Math.min(maxHP, currentHP + healAmount);
                                    await token.actor.update({ "system.hp.value": newHP });
                                    await parent.delete();
                                }
                            }
                        ];

                        if (isRebake && unloadedWeapons.length > 0)
                        {
                            choices.push({
                                text: "Reload a Loading Weapon",
                                icon: "fas fa-sync",
                                callback: async () =>
                                {
                                    const chosenWeapon = await lancerApi.reloadOneWeapon(token);
                                    if (chosenWeapon)
                                        await parent.delete();
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
        onInit: async function (token, item, api)
        {
            await api.addItemFlags(item, { deployRange: 5 });

            const isRebake = item.system.lid?.includes('rebake') || item.name.toLowerCase().includes("rebake");
            if (isRebake)
            {
                await api.addExtraDeploymentLids(item, [
                    { lid: "dep_support_rebake_restock_drone_t1_(npc)", tier: 1 },
                    { lid: "dep_support_rebake_restock_drone_t2_(npc)", tier: 2 },
                    { lid: "dep_support_rebake_restock_drone_t3_(npc)", tier: 3 }
                ]);
            }
            else
            {
                await api.addExtraDeploymentLids(item, [
                    { lid: "dep_support_restock_drone_t1_(npc)", tier: 1 },
                    { lid: "dep_support_restock_drone_t2_(npc)", tier: 2 },
                    { lid: "dep_support_restock_drone_t3_(npc)", tier: 3 }
                ]);
            }
            await api.setHidePrimaryAction(item);
        }
    }]
};

/** @type {ReactionGroup} */
const insulatedAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.ensureLinkedBonus({
                items: [item],
                bonusData: {
                    id: `insulated_${item.id}`,
                    name: "Insulated",
                    type: "multi",
                    bonuses: [
                        { type: "immunity", subtype: "effect", effects: ["burn"] },
                        { type: "immunity", subtype: "damage", damageTypes: ["Burn"] }
                    ]
                },
                addOptions: { duration: 'constant' }
            });
        }
    }]
};

/** @type {ReactionGroup} */
const regenerativeShieldingAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.ensureLinkedBonus({
                items: [item],
                bonusData: {
                    id: `regenerative_shielding_${item.id}`,
                    name: "Regenerative Shielding",
                    type: "multi",
                    bonuses: [
                        { type: "immunity", subtype: "effect", effects: ["slow", "impaired"] },
                        { type: "immunity", subtype: "crit" }
                    ]
                },
                addOptions: { duration: 'constant' }
            });
        }
    }]
};
// Defense Net & Ring of Fire


async function teardownDefenseNet(reactorToken, item, api, forced = false)
{
    const cleanup = async () =>
    {
        const affected = api.getTokensInAura(reactorToken, 'Defense Net') ?? [];

        await api.removeEffectsByNameFromTokens({
            tokens: affected,
            effectNames: ['shredded'],
            extraFlags: { ringOfFireSource: reactorToken.id }
        });

        await api.removeEffectsByNameFromTokens({
            tokens: [reactorToken],
            effectNames: ['immobilized'],
            extraFlags: { defenseNetSource: reactorToken.id }
        });

        for (const token of affected)
        {
            if (token.id === reactorToken.id)
                continue;
            await api.removeGlobalBonus(token.actor, bonus => bonus.context?.ownerTokenId === reactorToken.id);
        }

        const deletedAuras = await api.deleteAuras(reactorToken, { name: 'Defense Net' });
        if (deletedAuras.length && game.modules.get('sequencer')?.active)
        {
            for (const aura of deletedAuras)
                Sequencer.EffectManager.endEffects({ origin: aura.id });
        }

        if (forced)
            await api.endItemActivation(item, reactorToken);
    };

    if (forced)
    {
        await api.startChoiceCard({
            title: 'DEFENSE NET - FORCED OFFLINE',
            description: `<b>${reactorToken.name}</b>'s Defense Net has been forcibly shut down.`,
            icon: 'fas fa-shield-alt',
            mode: 'or',
            choices: [{ text: 'Acknowledged', icon: 'fas fa-check', callback: cleanup }]
        });
    }
    else
        await cleanup();
}

const RING_OF_FIRE_LIDS = ['npcf_ring_of_fire_aegis', 'npc-rebake_npcf_ring_of_fire_aegis'];

// Driven by the Defense Net aura; registered so the HUD marks it automated.
/** @type {ReactionGroup} */
const ringOfFireAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none"
    }]
};

function hasRingOfFire(parent, la)
{
    return RING_OF_FIRE_LIDS.some(lid => la.findItemByLid(parent.actor, lid));
}

// Heat is once per round per victim; shredded tracks presence so it comes back on re-entry.
async function applyRingOfFire(token, parent, la)
{
    if (await la.consumeOncePerRound(parent, 'ring_of_fire', token))
        await la.executeDamageRoll(parent, [token], 2, 'Heat', 'Ring of Fire');
    await la.applyEffectsToTokens(
        { tokens: [token], effectNames: ['shredded'], duration: { label: 'indefinite' } },
        { ringOfFireSource: parent.id }
    );
}

function buildRingOfFireTurnStartCallback()
{
    return async (token, parent) =>
    {
        const la = game.modules.get('lancer-automations')?.api;
        if (!la || !token?.actor || !parent?.actor)
            return;
        if (!hasRingOfFire(parent, la) || !la.isHostile(token, parent))
            return;
        await applyRingOfFire(token, parent, la);
    };
}

function buildDefenseNetAuraCallback()
{
    return async (token, parent, aura, options) =>
    {
        const applyDefenseNetBonuses = async (token, reactorToken, api) =>
        {
            if (token.id === reactorToken.id)
                return;

            const defNetCondition = (_state, actor) =>
            {
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

        if (options.hasEntered)
            await applyDefenseNetBonuses(token, parent, la);
        else
            await la.removeGlobalBonus(token.actor, b => b.context?.ownerTokenId === parent.id);

        if (!hasRingOfFire(parent, la) || !la.isHostile(token, parent))
            return;

        if (options.hasEntered)
            await applyRingOfFire(token, parent, la);
        else
        {
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
function buildDefenseNetAutomation(radius, isRebake = false)
{

    /** @type {ReactionConfig[]} */
    const reactions = [
        {
            triggers: ["onActivation"],
            actionType: "Full Action",
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (triggerData.endActivation)
                {
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
                    elevationAware: true,
                    macros: [
                        { function: buildDefenseNetAuraCallback() },
                        { function: buildRingOfFireTurnStartCallback(), mode: 'TARGET_TURN_START' }
                    ]
                });

                if (aura && game.modules.get('sequencer')?.active)
                {
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
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (!api.getActivatedItems(reactorToken)?.some(i => i.id === item.id))
                    return false;
                return ['stunned', 'jammed'].includes(triggerData.statusId);
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                await teardownDefenseNet(reactorToken, item, api, true);
            }
        }
    ];

    if (isRebake)
    {
        reactions.push(
            {
                triggers: ["onHeatGain"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    if (!api.getActivatedItems(reactorToken)?.some(i => i.id === item.id))
                        return false;
                    const actor = reactorToken.actor;
                    return (triggerData.currentHeat ?? 0) >= (actor.system?.heat?.max ?? Infinity);
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
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
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    if (!api.getActivatedItems(reactorToken)?.some(i => i.id === item.id))
                        return false;
                    return (triggerData.targets ?? []).some(t =>
                        api.getGlobalBonuses(t.target?.actor)
                            .some(b => b.context?.ownerTokenId === reactorToken.id)
                    );
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    api.afterFx(() => api.executeDamageRoll(
                        triggerData.triggeringToken ?? reactorToken,
                        [reactorToken],
                        2, 'Heat', 'Defense Net - Tech Miss'
                    ));
                }
            }
        );
    }

    return { category: "NPC (LaSossis)", itemType: "npc_feature", reactions };
}

const defenseNetAutomation       = buildDefenseNetAutomation(3);
const defenseNetRebakeAutomation = buildDefenseNetAutomation(2, true);

// Sniper's Mark
const SNIPER_MARK_NAME = "Sniper's Mark";

/** @type {ReactionGroup} */
const sniperMarkAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            actionType: "Full Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const chosen = await api.chooseToken(reactorToken, {
                    count: 1,
                    range: 25,
                    filter: target => api.hasLineOfSight(reactorToken, target),
                    filterWarning: "No line of sight",
                    title: "SNIPER'S MARK",
                    description: "Choose a target to mark. Same target removes the mark."
                });
                if (!chosen?.length)
                    return;
                const target = chosen[0];
                const wasMarked = api.findEffectsOnToken(target, SNIPER_MARK_NAME, { extraFlags: { sniperSourceId: reactorToken.id } }).length > 0;

                await api.clearMarks(reactorToken, SNIPER_MARK_NAME, { flagKey: 'sniperSourceId' });

                if (!wasMarked)
                {
                    await api.applyMark(reactorToken, [target], {
                        effect: { name: SNIPER_MARK_NAME, isCustom: true, icon: "icons/svg/target.svg" },
                        flagKey: 'sniperSourceId'
                    });
                    ui.notifications.info(`Sniper's Mark: ${target.name} is now marked.`);
                }
                else
                    ui.notifications.info(`Sniper's Mark: removed from ${target.name}.`);
            }
        },
        {
            triggers: ["onStatusApplied", "onStatusRemoved"],
            triggerSelf: false,
            triggerOther: true,
            autoActivate: true,
            outOfCombat: true,
            actionType: "Full Action",
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData)
            {
                return triggerData.statusId === SNIPER_MARK_NAME || triggerData.effect?.name === SNIPER_MARK_NAME;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const markedToken = triggerData.triggeringToken;
                if (!markedToken)
                    return;
                const ACTION_NAME = "Fall Prone (Sniper's Mark)";

                if (triggerType === 'onStatusApplied')
                {
                    await api.addExtraActions(markedToken.actor, {
                        name: ACTION_NAME,
                        activation: "Free",
                        detail: "Fall prone as required by Sniper's Mark."
                    });
                }
                else
                {
                    const stillMarked = api.findEffectsOnToken(markedToken, SNIPER_MARK_NAME, { excludeId: triggerData.effect?.id }).length > 0;
                    if (!stillMarked)
                        await api.removeExtraActions(markedToken.actor, ACTION_NAME);
                }
            }
        }
    ]
};

// Anti-Materiel Rifle
/** @type {ReactionGroup} */
const antiMaterielRifleAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onPreDamage"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        awaitActivationCompletion: true,
        outOfCombat: true,
        checkUsage: false,
        actionType: "Automation",
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            let replacedDamage = false;

            for (const target of triggerData.hitTokens ?? [])
            {
                const actor = target?.actor;
                if (!actor)
                    continue;
                if (!api.findEffectOnToken(target, SNIPER_MARK_NAME))
                    continue;
                if (api.hasStatus(target, 'prone', 'cover_hard', 'cover_soft'))
                    continue;

                const confirmed = await api.confirmCard({
                    title: "SNIPER'S MARK - EXPOSED",
                    description: `<b>${target.name}</b> is marked and exposed. Replace the rifle's damage with 1 structure?`,
                    item,
                    originToken: reactorToken,
                    relatedToken: target,
                    userIdControl: null,
                    confirmText: "-1 Structure",
                    confirmIcon: "fas fa-skull"
                });
                if (!confirmed)
                    continue;

                await (/** @type {any} */(actor)).update({ "system.hp.value": actor.system.hp.value - actor.system.hp.max });
                replacedDamage = true;
            }

            if (replacedDamage)
                await triggerData.cancelDamage("Sniper's Mark replaces the Anti-Materiel Rifle's damage.", "SNIPER'S MARK", false);
        }
    }]
};

/** @type {ReactionGroup} */
const lesserSightAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        // R0: onInit - constant target_modifier bonus bypassing invisibility within 3
        {
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.ensureLinkedBonus({
                    items: [item],
                    bonusData: {
                        id: `lesser-sight-no-invisible-${item.id}`,
                        name: "Lesser Sight",
                        type: "target_modifier",
                        subtype: "no_invisible",
                        applyToCondition: (target, state, reactorToken) =>
                        {
                            if (!reactorToken || !target?.target)
                                return false;
                            const laApi = game.modules.get('lancer-automations')?.api;
                            if (!laApi)
                                return false;
                            if (laApi.getTokenDistance(reactorToken, target.target) > 3)
                                return false;
                            return target.target.actor?.effects?.some(effect => effect.statuses?.has('invisible'));
                        }
                    },
                    addOptions: { duration: 'constant' }
                });
            }
        },
        // R1: onInitActivation - block Hide for hostile within range 3
        {
            triggers: ["onInitActivation"],
            triggerSelf: false,
            triggerOther: true,
            autoActivate: true,
            outOfCombat: true,
            awaitActivationCompletion: true,
            checkReaction: false,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (triggerData.actionName !== 'Hide')
                    return false;
                const token = triggerData.triggeringToken;
                if (!token?.actor)
                    return false;
                if (!api.isHostile(reactorToken, token))
                    return false;
                return (triggerData.distanceToTrigger ?? Infinity) <= 3;
            },
            activationCode: async function (triggerType, triggerData, reactorToken)
            {
                triggerData.cancelAction(`Cannot Hide - within Lesser Sight of ${reactorToken.name}.`);
            }
        }
    ]
};

/** @type {ReactionGroup} */
const guardianTraitAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.ensureLinkedEffect({
                items: [item],
                effectNames: ['guardian'],
                note: item.name,
                duration: { label: 'permanent' }
            });
        }
    }]
};

/** @type {ReactionGroup} */
const reboundAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onPreDamage"],
        actionType: "Reaction",
        frequency: "1/Round",
        triggerSelf: false,
        triggerOther: true,
        outOfCombat: false,
        autoActivate: true,
        awaitActivationCompletion: true,
        checkReaction: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            if (!triggerData.targets?.some(target => target?.id === reactorToken.id))
                return false;
            if (triggerData.flowState?.data?.invade)
                return false;
            return triggerData.isRangedAttack();
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const attacker = triggerData.triggeringToken;
            const ask = await api.askCard({
                title: "REBOUND",
                description: `Use <b>Rebound</b> against <b>${attacker?.name ?? 'the attacker'}</b>'s attack?`,
                item,
                originToken: reactorToken,
                relatedToken: attacker,
                owner: reactorToken
            });
            if (!ask.confirmed)
                return;

            await triggerData.startRelatedFlowToReactor(null, null, { wait: true });

            const result = await api.rollCard({
                title: "REBOUND",
                roll: "1d6",
                originToken: reactorToken,
                relatedToken: attacker,
                item
            });
            if (!result)
                return;
            if (result.total >= 4)
            {
                await api.injectBonusToFlowState(triggerData.flowState, {
                    name: "Rebound",
                    type: "target_modifier",
                    subtype: "half_damage",
                    applyTo: [reactorToken.id]
                });
                const weapon = triggerData.weapon;
                if (weapon && attacker)
                    api.afterFlow(triggerData, () => api.attackRollWith(weapon, [attacker], { fxSourceToken: reactorToken }));
            }
            else
            {
                api.afterFlow(triggerData, async () =>
                {
                    const boost = await api.askCard({
                        title: "REBOUND",
                        description: `Boost towards <b>${attacker?.name ?? 'the attacker'}</b>?`,
                        yesText: "Boost",
                        yesIcon: "fas fa-forward",
                        item,
                        originToken: reactorToken,
                        relatedToken: attacker
                    });
                    if (!boost?.confirmed)
                        return;
                    await api.boostMove(reactorToken, {
                        title: "REBOUND",
                        description: "Boost towards the attacker."
                    });
                });
            }
        }
    }]
};

const instinctModeAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                await api.applyEffectsToTokens({
                    tokens: [reactorToken],
                    effectNames: [{ name: "Instinct Mode", isCustom: true, icon: whiteIcon(item.img) }],
                    duration: api.untilEndOfTurn(reactorToken),
                    refresh: true
                });
            }
        },
        {
            triggers: ["onAttack"],
            triggerSelf: false,
            triggerOther: true,
            outOfCombat: false,
            autoActivate: true,
            awaitActivationCompletion: true,
            dispositionFilter: ['hostile'],
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const effect = api.findEffectOnToken(reactorToken, effect => effect.name === "Instinct Mode");
                if (!effect)
                    return false;
                if (!api.hasReactionAvailable(reactorToken))
                    return false;
                const attacker = triggerData.triggeringToken;
                if (!attacker)
                    return false;
                if (!triggerData.isRangedAttack())
                    return false;
                if (!api.hasLineOfSight(reactorToken, attacker))
                    return false;
                return effect.flags['lancer-automations']?.instinctTurnKey !== api.currentTurnKey();
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const attacker = triggerData.triggeringToken;
                const effect = api.findEffectOnToken(reactorToken, effect => effect.name === "Instinct Mode");
                await effect?.setFlag('lancer-automations', 'instinctTurnKey', api.currentTurnKey());
                const ask = await api.askCard({
                    title: "INSTINCT MODE",
                    description: `Boost towards <b>${attacker?.name ?? 'the attacker'}</b> and strike with the Carbon Fiber Sword?`,
                    item,
                    originToken: reactorToken,
                    relatedToken: attacker,
                    owner: reactorToken
                });
                if (!ask.confirmed)
                    return;

                await api.executeSimpleActivation(reactorToken, {
                    title: "Instinct Mode",
                    action: { name: "Instinct Mode", activation: "Reaction" },
                    detail: "Boost towards the attacker, then strike with the Carbon Fiber Sword."
                });

                api.afterFlow(triggerData, async () =>
                {
                    await api.boostMove(reactorToken, {
                        title: "INSTINCT MODE",
                        description: "Boost towards the attacker."
                    });
                    const sword = api.findItemByLid(reactorToken, "npc-rebake_npcf_carbon_fiber_sword_ronin");
                    if (!sword)
                        return;
                    const threat = api.getMaxWeaponRanges_WithBonus(sword).Threat ?? 1;
                    if (api.getTokenDistance(reactorToken, attacker) <= threat)
                        await api.attackWith(sword, [attacker]);
                });
            }
        }
    ]
};

const RONIN_MARK_NAME = "Ronin's Mark";
const RONIN_MARK_FLAG = 'roninMarkSourceId';
const RONIN_SWORD_LID = "npc-rebake_npcf_carbon_fiber_sword_ronin";

const counterBallisticAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: ["onAttack"],
            triggerSelf: false,
            triggerOther: true,
            outOfCombat: false,
            autoActivate: true,
            awaitActivationCompletion: true,
            dispositionFilter: ['hostile'],
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const attacker = triggerData.triggeringToken;
                if (!attacker || triggerData.distanceToTrigger > 5)
                    return false;
                if (!triggerData.isRangedAttack())
                    return false;
                const marked = api.findMarkedTokens(reactorToken, RONIN_MARK_NAME, { flagKey: RONIN_MARK_FLAG });
                return !marked.some(mark => mark.id === attacker.id);
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const attacker = triggerData.triggeringToken;
                const ask = await api.askCard({
                    title: "COUNTER-BALLISTIC SUITE",
                    description: `Give <b>${attacker?.name ?? 'the attacker'}</b> a Ronin's Mark?`,
                    item,
                    originToken: reactorToken,
                    relatedToken: attacker,
                    owner: reactorToken
                });
                if (!ask.confirmed)
                    return;
                await triggerData.startRelatedFlow();
                await api.clearMarks(reactorToken, RONIN_MARK_NAME, { flagKey: RONIN_MARK_FLAG });
                await api.applyMark(reactorToken, [attacker], {
                    effect: { name: RONIN_MARK_NAME, isCustom: true, icon: "modules/lancer-automations/icons/cross-mark.svg" },
                    note: "Carbon Fiber Sword hits can consume this for +1d6 bonus damage",
                    duration: { label: 'indefinite' },
                    flagKey: RONIN_MARK_FLAG
                });
            }
        },
        {
            triggers: ["onHit"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: false,
            autoActivate: true,
            awaitActivationCompletion: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (triggerData.weapon?.system?.lid !== RONIN_SWORD_LID)
                    return false;
                const marked = api.findMarkedTokens(reactorToken, RONIN_MARK_NAME, { flagKey: RONIN_MARK_FLAG });
                if (!marked.length)
                    return false;
                return (triggerData.hitTokens ?? []).some(hit => marked.some(mark => mark.id === hit.id));
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const marked = api.findMarkedTokens(reactorToken, RONIN_MARK_NAME, { flagKey: RONIN_MARK_FLAG });
                const target = (triggerData.hitTokens ?? []).find(hit => marked.some(mark => mark.id === hit.id));
                if (!target)
                    return;
                const ask = await api.askCard({
                    title: "COUNTER-BALLISTIC SUITE",
                    description: `Consume the Ronin's Mark on <b>${target.name}</b> for <b>+1d6 bonus damage</b>?`,
                    item,
                    originToken: reactorToken,
                    relatedToken: target,
                    owner: reactorToken
                });
                if (!ask.confirmed)
                    return;
                await api.clearMarks(reactorToken, RONIN_MARK_NAME, { flagKey: RONIN_MARK_FLAG });
                await api.injectBonusToFlowState(triggerData.flowState, {
                    name: RONIN_MARK_NAME,
                    type: "damage",
                    damage: [{ val: "1d6", type: "Kinetic" }],
                    applyTo: [target.id]
                });
            }
        }
    ]
};

const chaffLaunchersAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.ensureLinkedBonus({
                    items: [item],
                    bonusData: {
                        id: `chaff-launchers-${item.id}`,
                        name: "Chaff Launchers",
                        type: "difficulty",
                        val: 1,
                        applyToTargetter: true,
                        rollTypes: ["attack"],
                        condition: (state) =>
                        {
                            if (!state?.actor?.system?.statuses?.engaged)
                                return false;
                            const api = game.modules.get('lancer-automations').api;
                            const attackType = api.getWeaponType(state.item) || state.data?.attack_type || 'Ranged';
                            return !attackType.includes('Melee');
                        }
                    },
                    addOptions: { duration: 'constant' }
                });
            }
        },
        {
            triggers: ["onActivation"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName)
            {
                return triggerData.actionName === "Boost";
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (api.findEffectOnToken(reactorToken, "Soft Cover"))
                    return;
                await triggerData.startRelatedFlow();
                await api.applyEffectsToTokens({
                    tokens: [reactorToken],
                    effectNames: ["cover_soft"],
                    note: "Chaff Launchers",
                    duration: api.untilStartOfTurn(reactorToken)
                });
            }
        }
    ]
};

const magFieldAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onDamage"],
        triggerSelf: false,
        triggerOther: false,
        triggerTarget: true,
        outOfCombat: false,
        autoActivate: true,
        awaitActivationCompletion: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            if (triggerData.isHit)
                return false;
            return (triggerData.damages ?? []).some(value => Number(value) > 0);
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const attacker = triggerData.triggeringToken;
            api.afterFlow(triggerData, async () =>
            {
                const ask = await api.askCard({
                    title: "MAG FIELD",
                    description: "Use <b>Mag Field</b>?",
                    item,
                    originToken: reactorToken,
                    relatedToken: attacker,
                    owner: reactorToken
                });
                if (!ask.confirmed)
                    return;
                await triggerData.startRelatedFlow();
                const chosen = await api.chooseToken(reactorToken, {
                    range: 5,
                    count: 1,
                    includeSelf: false,
                    title: "MAG FIELD",
                    description: "Choose a character to also take the damage."
                });
                if (!chosen?.length)
                    return;
                const damage = (triggerData.damages ?? []).map((value, index) => ({
                    val: String(value),
                    type: triggerData.types?.[index] ?? 'Kinetic'
                }));
                await api.executeDamageRoll(attacker ?? reactorToken, [chosen[0]], null, null, "Mag Field", { damage });
            });
        }
    }]
};

const SCOURER_LANCE_LID = "npc-rebake_npcf_thermal_lance_scourer";
const SCOURER_MARK_NAME = "Thermal Lance Mark";
const SCOURER_MARK_FLAG = 'thermalLanceSourceId';

async function _stampThermalLanceHits(api, reactorToken, targets)
{
    await api.applyMark(reactorToken, targets, {
        effect: { name: SCOURER_MARK_NAME, isCustom: true, icon: "modules/lancer-automations/icons/dice-fire.svg" },
        note: "Hit by the Thermal Lance",
        duration: api.untilEndOfTurn(reactorToken),
        flagKey: SCOURER_MARK_FLAG,
        extraOptions: { refresh: true }
    });
}

const ablativeShieldingAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.ensureLinkedEffect({
                items: [item],
                effectNames: ['resistance_energy'],
                note: item.name,
                duration: { label: 'permanent' }
            });
        }
    }]
};

const SCOURER_PULSE_LID = "npc-rebake_npcf_pulse_laser_scourer";

const coolingModuleAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: ["onTurnEnd"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: false,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                await reactorToken.document.setFlag('lancer-automations', 'coolingModulePos', {
                    combatId: game.combat?.id ?? null,
                    ...api.getTokenPosition(reactorToken)
                });
            }
        },
        {
            triggers: ["onTurnStart"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: false,
            autoActivate: true,
            awaitActivationCompletion: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const saved = reactorToken.document.getFlag('lancer-automations', 'coolingModulePos');
                if (!saved || saved.combatId !== (game.combat?.id ?? null))
                    return false;
                if (!api.samePosition(saved, api.getTokenPosition(reactorToken)))
                    return false;
                const pulse = api.findItemByLid(reactorToken, SCOURER_PULSE_LID);
                return (reactorToken.actor.system.heat?.value ?? 0) > 0 || pulse?.system?.charged === false;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                await triggerData.startRelatedFlow();
            }
        },
        {
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if ((reactorToken.actor.system.heat?.value ?? 0) > 0)
                    await reactorToken.actor.update({ 'system.heat.value': 0 });
                const pulse = api.findItemByLid(reactorToken, SCOURER_PULSE_LID);
                if (pulse?.system?.charged === false)
                    await pulse.update({ 'system.charged': true });
            }
        }
    ]
};

const SCOURER_FOCUS_DOWN_LID = "npc-rebake_npcf_focus_down_scourer";

const emergencyVentAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onHeatGain", "onStatusApplied"],
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        awaitActivationCompletion: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            if (triggerType === 'onHeatGain')
                return (triggerData.currentHeat ?? 0) > (reactorToken.actor.system.heat?.max ?? 0);
            return ['jammed', 'stunned'].includes(triggerData.statusId);
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            if (api.findEffectOnToken(reactorToken, "Invisible"))
                return;
            await triggerData.startRelatedFlow();
            await api.applyEffectsToTokens({
                tokens: [reactorToken],
                effectNames: ["invisible"],
                note: "Emergency Vent",
                duration: api.untilStartOfTurn(reactorToken)
            });
        }
    }]
};

const pulseLaserAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onActivation"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            await api.addGlobalBonus(reactorToken.actor, {
                name: "Pulse Laser",
                type: "target_modifier",
                subtype: "half_damage"
            }, {
                origin: reactorToken,
                consumption: { trigger: "onAttack", itemLid: SCOURER_LANCE_LID }
            });
        }
    }]
};

const meltAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            if (!api.getActionOverlay(item, item.name)?.range)
                await api.setActionOverlay(item, item.name, { range: [{ type: "Range", val: 10 }] });
        }
    },
    {
        triggers: ["onActivation"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        awaitActivationCompletion: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const chosen = await api.chooseToken(reactorToken, {
                range: 10,
                count: 1,
                includeSelf: false,
                includeHidden: false,
                filter: target => target.actor?.type === 'deployable',
                filterWarning: "Not an object, Deployable or Drone",
                title: "MELT",
                description: "Choose an object, deployable or Drone within Range 10."
            });
            if (!chosen?.length)
                return;
            const target = chosen[0];
            const lance = api.findItemByLid(reactorToken, SCOURER_LANCE_LID);
            await api.executeBasicAttack(reactorToken.actor, {
                item,
                targets: [target],
                flat_bonus: api.getTier(reactorToken),
                damage: [{ val: "20", type: "Energy" }],
                tags: [{ lid: 'tg_ap', name: 'Armor Piercing' }],
                ...(lance ? { fxItem: lance } : {})
            });
        }
    },
    {
        triggers: ["onDamage"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            new Sequence()
                .sound()
                .file("modules/lancer-automations/FX/audio/extra/melt.wav")
                .volume(0.75)
                .effect()
                .file("jb2a.lava_spout.001.001.complete.orangeyellow")
                .atLocation(triggerData.target)
                .preset("la_scaleToBurst", 1)
                .play();
            if (api.findItemByLid(reactorToken, SCOURER_FOCUS_DOWN_LID))
            {
                const splashed = api.getTokensInRange(triggerData.target, { range: 2, includeSelf: true });
                await _stampThermalLanceHits(api, reactorToken, splashed);
            }
        }
    }]
};

const focusDownAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: ["onHit"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: false,
            autoActivate: true,
            awaitActivationCompletion: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (triggerData.weapon?.system?.lid !== SCOURER_LANCE_LID)
                    return false;
                return (triggerData.hitTokens ?? []).length > 0;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const hitTokens = triggerData.hitTokens ?? [];
                const burnTargets = hitTokens.filter(target => api.findEffectOnToken(target, effect =>
                    effect.name === SCOURER_MARK_NAME && effect.flags['lancer-automations']?.[SCOURER_MARK_FLAG] === reactorToken.id));
                if (burnTargets.length)
                {
                    await api.injectBonusToFlowState(triggerData.flowState, {
                        name: "Focus Down",
                        type: "damage",
                        damage: [{ val: String(api.tierValue(reactorToken, [5, 6, 7])), type: "Burn" }],
                        applyTo: burnTargets.map(target => target.id)
                    });
                }
                await _stampThermalLanceHits(api, reactorToken, hitTokens);
            }
        },
        {
            triggers: ["onExitCombat"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                await api.clearMarks(reactorToken, SCOURER_MARK_NAME, { flagKey: SCOURER_MARK_FLAG });
            }
        }
    ]
};

const submachineGunAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onInitAttack"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            return !!triggerData.flowState?.data?.acc_diff?.weapon?.engaged;
        },
        activationCode: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            triggerData.flowState.data.acc_diff.weapon.engaged = false;
        }
    }]
};

const flankerAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onTurnStart"],
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const unseen = canvas.tokens.placeables.filter(other => other.id !== reactorToken.id
                && api.isHostile(reactorToken, other)
                && !api.hasLineOfSight(reactorToken, other));
            if (!unseen.length)
                return;
            await api.addGlobalBonus(reactorToken.actor, {
                id: `flanker-${item.id}`,
                name: "Flanker",
                type: "accuracy",
                val: 1,
                rollTypes: ["attack", "tech_attack"],
                applyTo: unseen.map(target => target.id)
            }, { duration: "end", origin: reactorToken });
        }
    }]
};

const thunderboltJumpjetsAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onActivation"],
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData)
        {
            return triggerData.actionName === "Boost";
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            await api.applyEffectsToTokens({
                tokens: [reactorToken],
                effectNames: ['flying'],
                note: "Thunderbolt Jumpjets",
                duration: api.untilEndOfTurn(reactorToken)
            });
            await api.addGlobalBonus(reactorToken.actor, {
                id: `thunderbolt-jumpjets-${item.id}`,
                name: "Thunderbolt Jumpjets",
                type: "difficulty",
                val: 1,
                applyToTargetter: true,
                rollTypes: ["attack"]
            }, { duration: "end", origin: reactorToken });
        }
    }]
};

const stormfallAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onActivation"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        awaitActivationCompletion: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const caught = await api.chooseToken(reactorToken, {
                title: "STORMFALL",
                description: "Burst 2 pulse of disrupting electricity.",
                pattern: 'burst',
                areaRange: 2,
                disposition: 'hostile',
                filterWarning: "Not an enemy",
                count: -1,
                allowEmptyConfirm: true
            });
            if (!caught?.length)
                return;
            const results = await api.executeSaveVsEffect(caught, {
                stat: "SYS",
                title: "Stormfall",
                origin: reactorToken,
                cardTitle: "STORMFALL - SYSTEMS SAVE",
                cardDescription: (target) => `<b>${target.name}</b> must pass a Systems save or take energy damage and be <b>Impaired</b>.`,
                onFail: (target) => api.applyEffectsToTokens({
                    tokens: [target], effectNames: ['impaired'], note: "Stormfall", duration: api.untilEndOfTurn(target)
                })
            });
            const failed = results.filter(entry => !entry.passed).map(entry => entry.target);
            if (failed.length)
                await api.executeDamageRoll(reactorToken, failed, api.tierValue(reactorToken, [1, 2, 3]), "Energy", "Stormfall");
        }
    }]
};

const fullSpectrumOverloadAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onTechHit"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        awaitActivationCompletion: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const targets = triggerData.hitTokens ?? [];
            if (!targets.length)
                return;
            api.afterFx(async () =>
            {
                await api.executeDamageRoll(reactorToken, targets, api.tierValue(reactorToken, [2, 3, 4]), "Heat", "Full-Spectrum Overload");
                for (const target of targets)
                {
                    await api.applyEffectsToTokens({
                        tokens: [target],
                        effectNames: [{ name: "No Reactions", isCustom: true, icon: whiteIcon("systems/lancer/assets/icons/reaction.svg") }],
                        note: "Full-Spectrum Overload",
                        duration: api.untilEndOfTurn(target)
                    }, {
                        changes: [{ key: "system.action_tracker.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" }]
                    });
                }
            });
        }
    }]
};

const smokeChargesAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onActivation"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            await api.placeZone(reactorToken, {
                range: 5,
                size: 2,
                type: "Blast",
                fillColor: "#808080",
                borderColor: "#ffffff",
                statusEffects: ["cover_soft"],
                title: "SMOKE CHARGES",
                description: "Place a Blast 2 smoke zone within Range 5.",
                icon: "fas fa-smog",
                centerLabel: "Smoke",
                expires: { on: 'ownerTurnEnd', turns: 2 }
            });
        }
    }]
};

const harpyTurbojetsAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onActivation"],
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: true,
        autoActivate: true,
        awaitActivationCompletion: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item)
        {
            return triggerData.actionName === "Boost" && item.system?.charged !== false;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const ask = await api.askCard({
                title: "HARPY TURBOJETS",
                description: "Use <b>Harpy Turbojets</b>?",
                item,
                originToken: reactorToken,
                owner: reactorToken
            });
            if (!ask.confirmed)
                return;
            await triggerData.startRelatedFlow();
            api.recordMovementExtra(reactorToken, reactorToken.actor.system.speed ?? 0, { leg: 'boost' });
        }
    }]
};

const weatherProofingAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.ensureLinkedEffect({
                items: [item],
                effectNames: ['surefoot'],
                note: item.name,
                duration: { label: 'permanent' }
            });
        }
    }]
};

const perceptiveAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.ensureLinkedBonus({
                items: [item],
                bonusData: {
                    id: `perceptive-${item.id}`,
                    name: "Perceptive",
                    type: "accuracy",
                    val: 1,
                    rollTypes: ["stat_roll"],
                    condition: (state) => state?.la_extraData?.sourceAction === "Search"
                },
                addOptions: { duration: 'constant' }
            });
        }
    }]
};

const guerillaWarfareAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onAttack"],
        triggerSelf: true,
        triggerOther: false,
        outOfCombat: false,
        autoActivate: true,
        awaitActivationCompletion: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            return !!triggerData.weapon && api.hasStatus(reactorToken, 'hidden');
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            if (!await api.consumeOncePerRound(reactorToken, 'guerilla_warfare'))
                return;
            await api.injectBonusToFlowState(triggerData.flowState, {
                name: "Guerilla Warfare",
                type: "damage",
                damage: [{ val: "1d6", type: "Kinetic" }]
            });
        }
    }]
};

// Terrain Printer waypoint hook: friendly token in the zone may spend 1 movement to travel to the twin waypoint.
async function _terrainPrinterHookFn(template, scene, token)
{
    const api = game.modules.get('lancer-automations')?.api;
    if (!api || !token)
        return;
    const data = template.getFlag('lancer-automations', 'terrainPrinterData');
    if (!data)
        return;
    const architect = canvas.tokens.get(data.architectTokenId);
    if (!architect || !api.isFriendly(architect, token))
        return;
    const otherTemplate = canvas.scene.templates.get(data.otherTemplateId);
    if (!otherTemplate)
        return;
    const ask = await api.askCard({
        title: "TERRAIN PRINTER",
        description: '<b>' + token.name + '</b> can spend 1 movement to travel to the other waypoint.',
        originToken: architect,
        relatedToken: token,
        owner: token,
        yesText: "Travel",
        yesIcon: "fas fa-route",
        noText: "Stay"
    });
    if (!ask.confirmed)
        return;
    await api.moveToken(token, {
        destination: { x: otherTemplate.x, y: otherTemplate.y },
        cost: 1,
        canBeBlocked: true
    });
}

// Sandblast entered/onInside hook: add invisible target_modifier bonus + soft cover to tokens in the zone.
async function _sandblastEnteredHookFn(template, scene, token)
{
    const api = game.modules.get('lancer-automations')?.api;
    if (!api || !token?.actor)
        return;
    const existing = (token.actor.getFlag('lancer-automations', 'global_bonuses') || []);
    if (existing.some(bonus => bonus.id === 'sandblast-invis-' + template.id))
        return;
    await api.addGlobalBonus(token.actor, {
        id: 'sandblast-invis-' + template.id,
        name: 'Sandblast',
        type: 'target_modifier',
        subtype: 'invisible'
    }, { duration: 'indefinite' });
    await api.applyEffectsToTokens({
        tokens: [token],
        effectNames: ['cover_soft'],
        note: 'Sandblast'
    }, { sandblastTemplateId: template.id });
}
// Sandblast left hook: remove invisible bonus and soft cover when token leaves the zone.
async function _sandblastLeftHookFn(template, scene, token)
{
    const api = game.modules.get('lancer-automations')?.api;
    if (!api || !token?.actor)
        return;
    await api.removeGlobalBonus(token.actor, 'sandblast-invis-' + template.id);
    await api.removeEffectsByNameFromTokens({
        tokens: [token],
        effectNames: ['cover_soft'],
        extraFlags: { sandblastTemplateId: template.id }
    });
}
async function _sandblastDeletedHookFn(template, scene, token, context)
{
    const api = game.modules.get('lancer-automations')?.api;
    if (!api)
        return;
    for (const inside of context?.contained ?? [])
    {
        if (!inside?.actor)
            continue;
        await api.removeGlobalBonus(inside.actor, 'sandblast-invis-' + template.id);
        await api.removeEffectsByNameFromTokens({
            tokens: [inside],
            effectNames: ['cover_soft'],
            extraFlags: { sandblastTemplateId: template.id }
        });
    }
}
// Sandblast turn-end hook: deal 3 AP Kinetic damage (no save, bypasses armor).
async function _sandblastTurnEndHookFn(template, scene, token)
{
    if (!token?.actor)
        return;
    const current = token.actor.system.hp.value;
    await token.actor.update({ 'system.hp.value': current - 3 });
    ui.notifications.info(`${token.name} takes 3 AP Kinetic damage from Sandblast.`);
}

async function _remoteCloudHealHookFn(template, scene, token)
{
    const api = game.modules.get('lancer-automations')?.api;
    const data = template?.getFlag?.('lancer-automations', 'remoteCloud');
    if (!api || !data || !token?.actor || token.actor.type === 'deployable')
        return;
    const reactorActor = await fromUuid(data.reactorUuid);
    const reactorTok = reactorActor?.getActiveTokens?.()?.[0];
    if (!reactorTok || !api.isFriendly(reactorTok, token))
        return;
    if (!await api.consumeOncePerRound(reactorTok, 'remote_cloud', token))
        return;
    const hp = token.actor.system.hp;
    const healed = Math.min(hp.max, hp.value + data.heal);
    if (healed > hp.value)
        await token.actor.update({ 'system.hp.value': healed });
}

/** @type {ReactionGroup} */
const squadStrengthInNumbersAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.ensureLinkedBonus({
                    items: [item],
                    bonusData: {
                        id: `squad_sin_immunities_${item.id}`,
                        name: "Strength in Numbers",
                        type: "multi",
                        bonuses: [
                            { type: "immunity", subtype: "effect", effects: ["grappled"] },
                            { type: "immunity", subtype: "effect", effects: ["stunned"] }
                        ]
                    },
                    addOptions: { duration: 'constant' }
                });
                await api.ensureLinkedBonus({
                    items: [item],
                    bonusData: {
                        id: `squad_sin_resist_${item.id}`,
                        name: "Strength in Numbers",
                        type: "target_modifier",
                        subtype: "half_damage",
                        applyToTargetter: true,
                        condition: (state) =>
                        {
                            const weapon = state?.item;
                            const profile = weapon?.currentProfile?.();
                            const ranges = weapon?.rangesFor?.(profile) ?? profile?.range ?? weapon?.system?.range ?? [];
                            return !ranges.some(range => ['line', 'cone', 'burst', 'blast']
                                .includes(String(range?.type ?? '').toLowerCase()));
                        }
                    },
                    addOptions: { duration: 'constant' }
                });
            }
        },
        {
            triggers: ["onInvoluntaryMove"],
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            isReaction: false,
            checkReaction: false,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken)
            {
                return triggerData.token?.id === reactorToken.id;
            },
            activationCode: function (triggerType, triggerData, reactorToken)
            {
                triggerData.cancel(`${reactorToken.name} is immune to Knockback.`);
            }
        },
        {
            triggers: ["onInitAttack"],
            triggerSelf: false,
            triggerOther: true,
            autoActivate: true,
            awaitActivationCompletion: true,
            isReaction: false,
            checkReaction: false,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken)
            {
                return String(triggerData.actionName ?? '').toLowerCase() === 'ram'
                    && (triggerData.targets ?? []).some(target => target?.id === reactorToken.id);
            },
            activationCode: function (triggerType, triggerData, reactorToken)
            {
                triggerData.cancelAttack(`${reactorToken.name} is immune to Ram.`);
            }
        }
    ]
};

/** @type {ReactionGroup} */
const squadSpreadOutAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.lockActorAction(item, "Grapple", { reason: "Spread Out: the Squad has no mass to grapple with." });
            await api.lockActorAction(item, "Ram", { reason: "Spread Out: the Squad has no mass to ram with." });
        }
    }]
};

/** @type {ReactionGroup} */
const squadUndersizeAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.ensureLinkedBonus({
                items: [item],
                bonusData: {
                    id: `squad_undersize_${item.id}`,
                    name: "Undersize",
                    type: "target_modifier",
                    subtype: "soft_cover",
                    applyToTargetter: true
                },
                addOptions: { duration: 'constant' }
            });
        }
    }]
};

/** @type {ReactionGroup} */
const squadPrimaryWeaponAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onInitAttack"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        awaitActivationCompletion: true,
        isReaction: false,
        checkReaction: false,
        outOfCombat: true,
        activationType: "code",
        activationMode: "instead",
        evaluate: function (triggerType, triggerData, reactorToken)
        {
            if (triggerData.flowState?.la_extraData?.squadExtraShot)
                return false;
            const hp = reactorToken.actor?.system?.hp;
            return !!hp?.max && hp.value * 2 >= hp.max;
        },
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const ask = await api.askCard({
                title: "PRIMARY WEAPON",
                description: `<b>${reactorToken.name}</b> can attack twice. Fire the extra attack first?`,
                item,
                originToken: reactorToken,
                owner: reactorToken,
                yesText: "Attack twice",
                yesIcon: "fas fa-crosshairs",
                noText: "Once"
            });
            if (ask?.confirmed)
                await api.beginWeaponAttackFlow(item, {}, { squadExtraShot: true });
        }
    }]
};

/** @type {ReactionGroup} */
const heavyFrameAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: ["onInvoluntaryMove"],
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            isReaction: false,
            checkReaction: false,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken)
            {
                if (triggerData.token?.id !== reactorToken.id)
                    return false;
                const moverSize = triggerData.triggeringToken?.actor?.system?.size;
                const ownSize = reactorToken.actor?.system?.size;
                return Number.isFinite(moverSize) && Number.isFinite(ownSize) && moverSize < ownSize;
            },
            activationCode: function (triggerType, triggerData, reactorToken)
            {
                triggerData.cancel(`${reactorToken.name} has Heavy Frame and cannot be moved by a smaller actor.`);
            }
        },
        {
            triggers: ["onPreStatusApplied"],
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            isReaction: false,
            checkReaction: false,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken)
            {
                return triggerData.statusId === 'prone' && triggerData.triggeringToken?.id === reactorToken.id;
            },
            activationCode: function (triggerType, triggerData, reactorToken)
            {
                const ownSize = reactorToken.actor?.system?.size ?? '?';
                triggerData.cancelChange(
                    `${reactorToken.name} has Heavy Frame: it can only be knocked Prone by an actor of Size ${ownSize} or larger. Confirm to block it, Ignore to let it through.`,
                    "HEAVY FRAME"
                );
            }
        }
    ]
};

const TUNNELLER_BURROW_ID = 'tunneller-burrow';

/** @type {ReactionGroup} */
const tunnellerAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onActivation"],
        onlyOnSourceMatch: true,
        actionType: "Quick Action",
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            if (triggerData.endActivation)
            {
                new Sequence()
                    .sound()
                    .file("modules/lancer-automations/FX/audio/extra/earthImpact.wav")
                    .volume(0.75)
                    .effect()
                    .file("jb2a.impact.earth.01")
                    .atLocation(reactorToken)
                    .preset("la_scaleToBurst", 1)
                    .play();

                await api.removeEffectsByNameFromTokens({
                    tokens: [reactorToken],
                    effectNames: ['invisible'],
                    extraFlags: { tunnellerSourceId: reactorToken.id }
                });
                await api.removeGlobalBonus(reactorToken.actor, `${TUNNELLER_BURROW_ID}-${item.id}`);
                await api.enableActorActionTypes(item);

                const check = await api.openForceCheckCard({
                    tokenA: reactorToken,
                    skill: "HULL",
                    saveVs: reactorToken,
                    range: [{ type: "Burst", val: 1 }]
                });
                const failed = (check?.results ?? [])
                    .filter(result => result.completed && !result.passed)
                    .map(result => result.token)
                    .filter(target => target?.actor && target.actor.type !== 'deployable');
                if (failed.length)
                {
                    await api.applyEffectsToTokens({
                        tokens: failed,
                        effectNames: ['prone'],
                        note: "Tunneller",
                        duration: { label: 'indefinite' }
                    });
                }
                return;
            }

            new Sequence()
                .sound()
                .file("modules/lancer-automations/FX/audio/extra/groundExplosion.wav")
                .effect()
                .file("jb2a.burrow.out.01.brown.1")
                .atLocation(reactorToken)
                .preset("la_scaleToBurst", 0)
                .play();

            await api.applyEffectsToTokens({
                tokens: [reactorToken],
                effectNames: ['invisible'],
                note: "Tunnelling",
                duration: { label: 'indefinite' }
            }, { tunnellerSourceId: reactorToken.id });

            await api.addGlobalBonus(reactorToken.actor, {
                id: `${TUNNELLER_BURROW_ID}-${item.id}`,
                name: "Burrow",
                type: "immunity",
                subtype: "obstacle"
            }, {
                duration: 'indefinite',
                origin: reactorToken
            });

            await api.disableActorActionTypes(item, ["Quick", "Full", "Protocol", "Reaction", "Free", "Quick Tech", "Full Tech", "Invade"], {
                except: ["Boost", item.name],
                reason: "Tunnelling: only Move, Boost or Emerge."
            });

            await api.setItemAsActivated(item, reactorToken, "Quick", "Emerge");
        }
    }]
};

const PULVERIZER_MINE_LIDS = [
    "dep_miner_pulverizer_charge_t1_(npc)",
    "dep_miner_pulverizer_charge_t2_(npc)",
    "dep_miner_pulverizer_charge_t3_(npc)"
];

/** @type {ReactionGroup} */
const pulverizerChargeAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.addItemFlags(item, { deployRange: 3, deployCount: 1 });
                await api.addExtraDeploymentLids(item, PULVERIZER_MINE_LIDS.map((lid, index) => ({ lid, tier: index + 1 })));
                await api.setHidePrimaryAction(item);
            }
        },
        {
            triggers: ["onDeploy"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                for (const mine of (triggerData.deployedTokens ?? []))
                {
                    if (mine?.actor)
                        await api.addActorFlags(mine.actor, { customMineDetection: true });
                }
            }
        }
    ]
};

/** @type {ReactionGroup} */
const pulverizerDetonationAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onActivation"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const [zone] = await api.placeZone(reactorToken, {
                x: reactorToken.center.x,
                y: reactorToken.center.y,
                size: 1,
                type: "Burst",
                fillColor: "#8b5a2b",
                borderColor: "#5c3a1a",
                difficultTerrain: { movementPenalty: 1, isFlatPenalty: true },
                title: "PULVERIZER CHARGE",
                centerLabel: "Rubble"
            });

            const caught = api.tokensInTemplate(zone).filter(target => target.id !== reactorToken.id);
            const objects = caught.filter(target => target.actor.type === 'deployable');
            const characters = caught.filter(target => target.actor.type !== 'deployable');
            const burrowed = characters.filter(target =>
                api.getImmunityBonuses(target.actor, 'obstacle').some(bonus => bonus.name === 'Burrow'));

            if (objects.length)
                await api.executeDamageRoll(reactorToken, objects, 10, "Explosive", "Pulverizer Charge", { ap: true });

            if (burrowed.length)
            {
                const tier = Math.max(1, PULVERIZER_MINE_LIDS.indexOf(reactorToken.actor?.system?.lid) + 1);
                await api.executeDamageRoll(reactorToken, burrowed, [5, 7, 9][tier - 1], "Explosive", "Pulverizer Charge");
            }

            if (characters.length)
            {
                await api.executeSaveVsEffect(characters, {
                    stat: "HULL",
                    title: "Pulverizer Charge - Hull Save",
                    origin: reactorToken,
                    cardTitle: "PULVERIZER CHARGE - HULL SAVE",
                    cardDescription: (target) => `<b>${target.name}</b> must pass a Hull save or be knocked Prone.`,
                    effects: ['prone'],
                    note: "Pulverizer Charge"
                });
            }

            await reactorToken.document.delete();
        }
    }]
};

/** @type {ReactionGroup} */
const collapsePlatingAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.ensureLinkedBonus({
                items: [item],
                bonusData: {
                    id: `collapse_plating_${item.id}`,
                    name: "Collapse Plating",
                    type: "immunity",
                    subtype: "resistance",
                    damageTypes: ["Kinetic"]
                },
                addOptions: { duration: 'constant' }
            });
        }
    }]
};

/** @type {ReactionGroup} */
const rockGrinderAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onHit"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const shredded = (triggerData.hitTokens ?? []).filter(target => api.hasStatus(target, 'prone', 'stunned'));
            if (!shredded.length)
                return;
            await api.applyEffectsToTokens({
                tokens: shredded,
                effectNames: ["shredded"],
                note: "Rock Grinder",
                duration: { label: 'end', turns: 1, rounds: 0 }
            });
        }
    }]
};

const WITCH_TEAR_DOWN_EFFECT = "Tear Down";
const WITCH_TEAR_DOWN_FLAG = "tearDownWitchId";
const WITCH_PETRIFY_EFFECT = "Petrify";
const WITCH_PETRIFY_FLAG = "petrifyWitchId";
const WITCH_PAIN_TRANSFERENCE_LID = "npc-rebake_npcf_pain_transference_witch";
const WITCH_PETRIFY_CHAIN = ['slowed', 'immobilized', 'stunned'];

function witchTechTargets(triggerData)
{
    return (triggerData.targets ?? []).map(entry => entry.target).filter(target => target?.actor);
}

/** @type {ReactionGroup} */
const witchTearDownAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: ["onTechHit"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const targets = witchTechTargets(triggerData);
                if (!targets.length)
                    return;
                api.afterFx(() => api.executeDamageRoll(reactorToken, targets, api.tierValue(reactorToken, [1, 2, 3]), "Heat", "Tear Down"));

                const fresh = targets.filter(target => !api.findEffectOnToken(target, WITCH_TEAR_DOWN_EFFECT));
                if (!fresh.length)
                    return;
                await api.applyMark(reactorToken, fresh, {
                    effect: { name: WITCH_TEAR_DOWN_EFFECT, icon: whiteIcon(item.img), isCustom: true },
                    note: "Tear Down",
                    duration: { label: 'indefinite' },
                    flagKey: WITCH_TEAR_DOWN_FLAG
                });
            }
        },
        {
            triggers: ["onTurnStart"],
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const marked = api.findMarkedTokens(reactorToken, WITCH_TEAR_DOWN_EFFECT, { flagKey: WITCH_TEAR_DOWN_FLAG });
                if (!marked.length)
                    return;
                const painTransference = !!api.findItemByLid(reactorToken.actor, WITCH_PAIN_TRANSFERENCE_LID);
                for (const token of marked)
                {
                    await api.executeDamageRoll(reactorToken, [token], 4, "Heat", "Tear Down");
                    if (!painTransference)
                        continue;
                    const splash = canvas.tokens.placeables.filter(other => other.id !== token.id
                        && other.actor
                        && api.isHostile(reactorToken, other)
                        && api.getTokenDistance(token, other) <= 3);
                    if (splash.length)
                        await api.executeDamageRoll(reactorToken, splash, 4, "Heat", "Pain Transference");
                }
                await api.clearMarks(reactorToken, WITCH_TEAR_DOWN_EFFECT, { flagKey: WITCH_TEAR_DOWN_FLAG });
            }
        },
        {
            triggers: ["onActivation"],
            triggerSelf: false,
            triggerOther: true,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (triggerData.actionName !== 'Stabilize' || !triggerData.triggeringToken)
                    return false;
                const stabilizer = triggerData.triggeringToken;
                return api.findMarkedTokens(reactorToken, WITCH_TEAR_DOWN_EFFECT, { flagKey: WITCH_TEAR_DOWN_FLAG })
                    .some(token => token.id === stabilizer.id || api.getTokenDistance(stabilizer, token) <= 1);
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const stabilizer = triggerData.triggeringToken;
                const reachable = api.findMarkedTokens(reactorToken, WITCH_TEAR_DOWN_EFFECT, { flagKey: WITCH_TEAR_DOWN_FLAG })
                    .filter(token => token.id === stabilizer.id || api.getTokenDistance(stabilizer, token) <= 1);
                const picked = reachable.length === 1
                    ? reachable[0]
                    : await api.pickCard(reachable, {
                        title: "TEAR DOWN",
                        description: `${stabilizer.name} can end Tear Down in place of cooling.`,
                        owner: stabilizer
                    });
                if (!picked)
                    return;
                const ask = await api.askCard({
                    title: "TEAR DOWN",
                    description: `End Tear Down on <b>${picked.name}</b> instead of cooling?`,
                    yesText: "End Tear Down",
                    noText: "Cool",
                    owner: stabilizer
                });
                if (!ask?.confirmed)
                    return;
                await api.removeEffectsByName(picked.id, WITCH_TEAR_DOWN_EFFECT, null, { [WITCH_TEAR_DOWN_FLAG]: reactorToken.id });
            }
        }
    ]
};

/** @type {ReactionGroup} */
const witchBlindAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onTechHit"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const targets = witchTechTargets(triggerData);
            if (!targets.length)
                return;
            api.afterFx(async () =>
            {
                await api.executeDamageRoll(reactorToken, targets, api.tierValue(reactorToken, [2, 3, 4]), "Heat", "Blind");
                await api.executeSaveVsEffect(targets, {
                    stat: "SYS",
                    title: "Blind",
                    origin: reactorToken,
                    difficulty: (target) => api.inDangerZone(target) ? 1 : 0,
                    cardTitle: "BLIND - SYSTEMS SAVE",
                    cardDescription: (target) => `<b>${target.name}</b> must pass a Systems save or be <b>Blinded</b>; on a success they are <b>Impaired</b> instead.`,
                    onFail: (target) => api.applyEffectsToTokens({
                        tokens: [target], effectNames: ['blinded'], note: "Blind", duration: api.untilEndOfTurn(target)
                    }),
                    onPass: (target) => api.applyEffectsToTokens({
                        tokens: [target], effectNames: ['impaired'], note: "Blind", duration: api.untilEndOfTurn(target)
                    })
                });
            });
        }
    }]
};

/** @type {ReactionGroup} */
const witchPredatoryLogicAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: ["onTechHit"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationType: "code",
        activationMode: "instead",
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const target = witchTechTargets(triggerData)[0];
            if (!target)
                return;

            if (!api.inDangerZone(target) && target.actor?.type === 'mech' && api.hasReactionAvailable(target))
            {
                const brace = await api.askCard({
                    title: "PREDATORY LOGIC",
                    description: `<b>${target.name}</b> can take the <b>Brace</b> reaction to ignore this.`,
                    yesText: "Brace",
                    noText: "Take it",
                    owner: target
                });
                if (brace?.confirmed)
                {
                    await api.activateGeneralAction(target, "Brace");
                    return;
                }
            }

            api.afterFx(async () =>
            {
                const weapons = api.getWeapons(target).filter(weapon =>
                    !weapon.system?.tags?.some(tag => (tag.id ?? tag.lid) === 'tg_superheavy'));
                if (!weapons.length)
                    return ui.notifications.info(`Predatory Logic: ${target.name} has no non-Superheavy weapon.`);

                const weapon = await api.pickCard(weapons, {
                    title: "PREDATORY LOGIC",
                    description: `Choose the weapon <b>${target.name}</b> attacks with.`,
                    entryIcon: (entry) => entry.img
                });
                if (!weapon)
                    return;

                await api.beginWeaponAttackFlow(weapon, {}, { predatoryLogic: true });
            });
        }
    }]
};

/** @type {ReactionGroup} */
const witchBlurAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        onInit: async function (token, item, api)
        {
            await api.ensureLinkedBonus({
                items: [item],
                bonusData: {
                    id: `witch_blur_${item.id}`,
                    name: "Blur",
                    type: "target_modifier",
                    subtype: "invisible",
                    applyToTargetter: true,
                    applyToCondition: (target, state) =>
                        !!game.modules.get('lancer-automations')?.api?.inDangerZone(state?.actor)
                },
                addOptions: { duration: 'constant' }
            });
        }
    }]
};

// Driven by Tear Down's burn; registered so the HUD marks it automated.
/** @type {ReactionGroup} */
const witchPainTransferenceAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [{
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none"
    }]
};

/** @type {ReactionGroup} */
const witchPetrifyAutomation = {
    category: "NPC (LaSossis)",
    itemType: "npc_feature",
    reactions: [
        {
            triggers: ["onTechHit"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (api.findMarkedTokens(reactorToken, WITCH_PETRIFY_EFFECT, { flagKey: WITCH_PETRIFY_FLAG }).length)
                    return ui.notifications.info("Petrify is already affecting a character.");

                const target = witchTechTargets(triggerData)[0];
                if (!target)
                    return;
                const sceneId = canvas.scene?.id ?? '';
                const petrified = api.getActorFlags(target.actor, 'petrifiedScenes') ?? [];
                if (petrified.includes(sceneId))
                    return ui.notifications.info(`Petrify: ${target.name} was already petrified this scene.`);

                await api.addActorFlags(target.actor, { petrifiedScenes: [...petrified, sceneId] });
                await api.applyEffectsToTokens({
                    tokens: [target],
                    effectNames: [WITCH_PETRIFY_CHAIN[0]],
                    note: "Petrify",
                    duration: api.untilEndOfTurn(target)
                });
                await api.applyMark(reactorToken, [target], {
                    effect: { name: WITCH_PETRIFY_EFFECT, icon: whiteIcon(item.img), isCustom: true },
                    note: "Petrify",
                    duration: { label: 'indefinite' },
                    flagKey: WITCH_PETRIFY_FLAG,
                    extraOptions: { petrifyStage: 0, petrifyAppliedAt: api.currentTurnKey() }
                });
            }
        },
        {
            triggers: ["onTurnEnd"],
            triggerSelf: false,
            triggerOther: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const marker = api.findEffectOnToken(triggerData.triggeringToken, WITCH_PETRIFY_EFFECT,
                    { extraFlags: { [WITCH_PETRIFY_FLAG]: reactorToken.id } });
                return !!marker && marker.flags?.['lancer-automations']?.petrifyAppliedAt !== api.currentTurnKey();
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const target = triggerData.triggeringToken;
                const marker = api.findEffectOnToken(target, WITCH_PETRIFY_EFFECT,
                    { extraFlags: { [WITCH_PETRIFY_FLAG]: reactorToken.id } });
                const stage = marker?.flags?.['lancer-automations']?.petrifyStage ?? 0;

                await api.clearMarks(reactorToken, WITCH_PETRIFY_EFFECT, { flagKey: WITCH_PETRIFY_FLAG });

                const next = WITCH_PETRIFY_CHAIN[stage + 1];
                if (!next || !api.hasStatus(target, WITCH_PETRIFY_CHAIN[stage]))
                    return;
                await api.applyEffectsToTokens({
                    tokens: [target],
                    effectNames: [next],
                    note: "Petrify",
                    duration: api.untilEndOfTurn(target)
                });
                await api.applyMark(reactorToken, [target], {
                    effect: { name: WITCH_PETRIFY_EFFECT, icon: whiteIcon(item.img), isCustom: true },
                    note: "Petrify",
                    duration: { label: 'indefinite' },
                    flagKey: WITCH_PETRIFY_FLAG,
                    extraOptions: { petrifyStage: stage + 1, petrifyAppliedAt: api.currentTurnKey() }
                });
            }
        }
    ]
};

api.registerDefaultItemReactions({
    "npc-rebake_npcf_tear_down_witch": witchTearDownAutomation,
    "npc-rebake_npcf_blind_witch": witchBlindAutomation,
    "npc-rebake_npcf_predatory_logic_witch": witchPredatoryLogicAutomation,
    "npc-rebake_npcf_blur_witch": witchBlurAutomation,
    "npc-rebake_npcf_petrify_witch": witchPetrifyAutomation,
    "npc-rebake_npcf_pain_transference_witch": witchPainTransferenceAutomation,
    "ubrg_npcf_collapse_plating_miner": collapsePlatingAutomation,
    "ubrg_npcf_rock_grinder_miner": rockGrinderAutomation,
    "ubrg_npcf_tunneller_miner": tunnellerAutomation,
    "ubrg_npcf_pulverizer_charge_miner": pulverizerChargeAutomation,
    "dep_miner_pulverizer_charge_t1_(npc)": pulverizerDetonationAutomation,
    "dep_miner_pulverizer_charge_t2_(npc)": pulverizerDetonationAutomation,
    "dep_miner_pulverizer_charge_t3_(npc)": pulverizerDetonationAutomation,
    "ubrg_npcf_heavy_frame_bridgelayer": heavyFrameAutomation,
    "npcf_strength_in_numbers_squad": squadStrengthInNumbersAutomation,
    "npcf_spread_out_squad": squadSpreadOutAutomation,
    "npcf_undersize_squad": squadUndersizeAutomation,
    "npcf_primary_weapon_squad": squadPrimaryWeaponAutomation,
    "npc-rebake_npcf_insulated_pyro": insulatedAutomation,
    "npc_clademaster_insulated": insulatedAutomation,
    "npcf_insulated_morningstar": insulatedAutomation,
    "npc_morozko_insulated": insulatedAutomation,
    "ppg_npcf_insulated_napalm": insulatedAutomation,
    "ubrg_npcf_insulated_cryo": insulatedAutomation,
    "npcf_insulated_arsonist_maxt": insulatedAutomation,
    "ubrg_npcf_insulated_salamander": insulatedAutomation,
    "npcf_insulated_pyro": insulatedAutomation,
    "moff_insulated_firebug": insulatedAutomation,
    "npcf_insulated_veteran": insulatedAutomation,
    "npc-rebake_npcf_suppress_archer": suppressArcherAutomation,
    "npcf_suppress_archer": suppressArcherAutomation,
    "npc-rebake_npcf_regenerative_shielding_aegis": regenerativeShieldingAutomation,
    "npcf_regenerative_shielding_aegis": regenerativeShieldingAutomation,
    ...Object.fromEntries(RING_OF_FIRE_LIDS.map(lid => [lid, ringOfFireAutomation])),
    "npcf_defense_net_aegis": defenseNetAutomation,
    "npc-rebake_npcf_defense_net_aegis": defenseNetRebakeAutomation,
    "ubrg_npcf_battlefield_diagnostics_armourer": {
        category: "NPC (LaSossis)",
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
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
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
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const targetData = triggerData.targets?.[0];
                const target = targetData.target;

                if (triggerData.targets.length > 1)
                    ui.notifications.info("Battlefield Diagnostics: Multiple targets hit. Only applying to the first target.");

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

                if (unloadedWeapons.length > 0)
                {
                    actionChoices.push({
                        text: "Reload a Loading Weapon",
                        icon: "fas fa-sync",
                        callback: async () =>
                        {
                            await api.reloadOneWeapon(target);
                        }
                    });
                }

                if (ordnanceWeapons.length > 0)
                {
                    actionChoices.push({
                        text: "Remove Ordnance",
                        icon: "fas fa-minus-circle",
                        callback: async () =>
                        {
                            const chosenWeapon = await api.pickItem(ordnanceWeapons, {
                                title: "CHOOSE WEAPON",
                                description: "Select which weapon loses Ordnance:",
                                icon: "fas fa-minus-circle",
                                formatText: (w) => `Remove Ordnance from ${w.name}`
                            });
                            if (chosenWeapon)
                            {
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

                for (const tag of allowedTags)
                {
                    const eligibleWeapons = weapons.filter(w => !w.system.tags?.some(t => t.id === tag.id));
                    if (eligibleWeapons.length > 0)
                    {
                        let tagDisplayName = tag.name;
                        if (tag.id === "tg_reliable")
                            tagDisplayName = "Reliable 2";
                        if (tag.id === "tg_knockback")
                            tagDisplayName = "Knockback 3";
                        actionChoices.push({
                            text: `Add ${tagDisplayName}`,
                            icon: "fas fa-tag",
                            callback: async () =>
                            {
                                const chosenWeapon = await api.pickItem(eligibleWeapons, {
                                    title: "CHOOSE WEAPON",
                                    description: `Select which weapon gains ${tagDisplayName}:`,
                                    icon: "fas fa-tag",
                                    formatText: (w) => `Add ${tagDisplayName} to ${w.name}`
                                });
                                if (chosenWeapon)
                                {
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

                if (actionChoices.length === 0)
                {
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
    "npc-rebake_npcf_sealant_gun_support": sealantGunAutomation,
    "npcf_sealant_gun_support": sealantGunAutomation,
    "npcf_mech_splint_triage_maxt": {
        category: "NPC (LaSossis)",
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
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const targets = await api.chooseToken(reactorToken, {
                    range: 1,
                    count: 1,
                    disposition: 'friendly',
                    title: "SPLINT TRIAGE",
                    description: "Select an adjacent ally to clear a condition.",
                    icon: "fas fa-briefcase-medical"
                });
                const target = targets?.[0];
                if (!target)
                    return;

                const conditions = api.getAllEffects(target);

                if (conditions.length === 0)
                {
                    ui.notifications.info(`${target.name} has no conditions to clear.`);
                    return;
                }

                // Multiple conditions - let user choose
                const chosenCondition = await api.pickCard(conditions, {
                    label: (effect) => effect.name,
                    entryIcon: (effect) => effect.icon || "fas fa-notes-medical",
                    title: "CLEAR CONDITION",
                    description: `Select a condition to clear from ${target.name}.`,
                    icon: "fas fa-briefcase-medical"
                });
                if (chosenCondition)
                {
                    api.deleteEffect(target, chosenCondition);
                    ui.notifications.info(`Cleared ${chosenCondition.name} from ${target.name}.`);
                }
            }
        }]
    },
    "npc-rebake_npcf_moving_target_archer": movingTargetArcherAutomation,
    "npcf_moving_target_archer": movingTargetArcherAutomation,
    "npcf_moving_target_sniper": movingTargetSniperAutomation,
    "Maneuver": {
        category: "NPC (LaSossis)",
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
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName)
            {
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
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onCheck"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Free Action",
            frequency: "1/Round",
            autoActivate: false,
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName)
            {
                return triggerData.success === true;
            },
        }, {
            triggers: ["onActivation"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Free Action",
            frequency: "Unlimited",
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName)
            {
                return triggerData.actionName === "Boost";
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const hasSoftCover = api.findEffectOnToken(reactorToken, "Soft Cover");
                if (!hasSoftCover)
                {
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
        category: "NPC (LaSossis)",
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
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {

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
        category: "NPC (LaSossis)",
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
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
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
        category: "NPC (LaSossis)",
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
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName)
            {
                return triggerData.triggeringToken?.id === reactorToken.id;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (triggerType === "onHit")
                {
                    const targets = triggerData.hitTokens;
                    if (targets.length)
                    {
                        await api.applyEffectsToTokens({
                            tokens: targets,
                            effectNames: ["impaired"],
                            note: "Remote Machine Gun",
                            duration: { label: 'end', turns: 1, rounds: 0 },
                            checkEffectCallback: (token) =>
                                api.findEffectsOnToken(token, 'impaired', { extraFlags: { RemoteMachineGunID: reactorToken.id } }).length > 0
                        }, {
                            RemoteMachineGunID: reactorToken.id
                        });
                    }
                }
                else if (triggerType === "onDestroyed")
                {
                    for (const token of canvas.tokens.placeables)
                    {
                        for (const effect of api.findEffectsOnToken(token, 'impaired', { extraFlags: { RemoteMachineGunID: reactorToken.id } }))
                            await effect.delete();
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
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const mover = triggerData.triggeringToken;
                const effect = api.findEffectsOnToken(mover, 'impaired', { extraFlags: { RemoteMachineGunID: reactorToken.id } })[0];
                if (!effect)
                    return false;
                if (triggerData.moveInfo?.isInvoluntary)
                    return false;
                return true;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const mover = triggerData.triggeringToken;
                const effect = api.findEffectsOnToken(mover, 'impaired', { extraFlags: { RemoteMachineGunID: reactorToken.id } })[0];
                if (effect)
                {
                    const damage = api.getTier(reactorToken) + 1;

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
        category: "NPC (LaSossis)",
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
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {

                // 1. Select allied target or self
                const targets = await api.chooseToken(reactorToken, {
                    count: 1,
                    range: reactorToken.actor.system.sensor_range,
                    includeSelf: true,
                    disposition: 'friendly',
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

                await api.applyEffectsToTokens({
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
    ...(function ()
    {
        /** @type {ReactionGroup} */
        const smokeLaunchers = {
            category: "NPC (LaSossis)",
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
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    await api.placeZone(reactorToken, {
                        range: 5,
                        size: 2,
                        count: 2,
                        type: "Blast",
                        fillColor: "#808080",
                        borderColor: "#ffffff",
                        statusEffects: ["cover_soft"],
                        title: "SMOKE LAUNCHERS",
                        description: "Place one or two Blast 2 smoke zones within Range 5.",
                        icon: "fas fa-smog",
                        centerLabel: "Smoke",
                        expires: { on: 'ownerTurnStart' }
                    });
                }
            }]
        };
        return {
            "nrfaw-npc_carrier_SmokeLaunchers": smokeLaunchers,
            "npc_carrier_SmokeLaunchers": smokeLaunchers
        };
    })(),
    ...(function ()
    {
        /** @type {ReactionGroup} */
        const nanoRepairCloud = {
            category: "NPC (LaSossis)",
            itemType: "npc_feature",
            reactions: [
                {
                    triggers: [],
                    triggerSelf: false,
                    triggerOther: false,
                    autoActivate: false,
                    activationType: "none",
                    onInit: async function (token, item, api)
                    {
                        await api.ensureAura(item, {
                            name: "Nano-Repair Cloud",
                            radius: 1,
                            elevationAware: true,
                            lineColor: "#7ec0ee",
                            lineWidth: 2,
                            lineOpacity: 0.7,
                            fillColor: "#7ec0ee",
                            fillOpacity: 0.05,
                            ...OWNER_ONLY_AURA_VISIBILITY
                        });
                    }
                },
                {
                    triggers: ["onRoll"],
                    triggerSelf: false,
                    triggerOther: true,
                    outOfCombat: true,
                    autoActivate: true,
                    awaitActivationCompletion: true,
                    activationType: "code",
                    activationMode: "instead",
                    evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
                    {
                        if (triggerData.rollType !== 'skillRoll')
                            return false;
                        if (triggerData.isReroll)
                            return false;
                        const ally = triggerData.triggeringToken;
                        if (!ally?.actor || ally.actor.type === 'deployable')
                            return false;
                        if (!api.isFriendly(reactorToken, ally))
                            return false;
                        if (api.getMinGridDistance(reactorToken, ally) > 1)
                            return false;
                        return true;
                    },
                    activationCode: async function (triggerType, triggerData, reactorToken)
                    {
                        await triggerData.reroll(`${reactorToken.name} - Nano-Repair Cloud`, 'highest', 'NANO-REPAIR CLOUD', true);
                    }
                }
            ]
        };
        return {
            "npcf_nano_repair_cloud_support": nanoRepairCloud,
            "npc-rebake_npcf_nano-repair_cloud_support": nanoRepairCloud
        };
    })(),
    "npcf_remote_cloud_support": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                triggerSelf: true,
                triggerOther: false,
                outOfCombat: true,
                actionType: "Quick Action",
                autoActivate: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const result = await api.placeZone(reactorToken, {
                        range: 5,
                        size: 2,
                        type: "Blast",
                        fillColor: "#7ec0ee",
                        borderColor: "#1e90ff",
                        title: "REMOTE CLOUD",
                        description: "Place a Blast 2 nanite cloud within Range 5.",
                        icon: "fas fa-cloud-meatball",
                        centerLabel: "Cloud",
                        expires: { on: 'ownerTurnStart' },
                        hooks: {
                            entered: { function: _remoteCloudHealHookFn, asGM: true },
                            turnStart: { function: _remoteCloudHealHookFn, asGM: true }
                        }
                    });

                    const template = (Array.isArray(result) ? result : [result])[0]?.template;
                    if (template)
                    {
                        await template.setFlag('lancer-automations', 'remoteCloud', {
                            heal: api.tierValue(reactorToken, [2, 4, 6]),
                            reactorUuid: reactorToken.actor.uuid
                        });
                    }
                }
            }
        ]
    },
    "npc_sergeant_SquadLeader": {
        category: "NPC (LaSossis)",
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
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                return !api.hasStatus(reactorToken, 'jammed');
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const targets = await api.chooseToken(reactorToken, {
                    range: 'sensors',
                    title: "SQUAD LEADER",
                    description: "Select an ally",
                    includeSelf: true,
                    disposition: 'friendly'
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
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const target = triggerData.checkAgainstToken;
                if (!target)
                    return false;
                const effect = api.findEffectFrom(target, "Squad Leader", reactorToken);
                return !!effect;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const target = triggerData.checkAgainstToken;
                const roller = triggerData.triggeringToken;

                const effect = api.findEffectFrom(target, "Squad Leader", reactorToken);

                if (effect && roller)
                {
                    if (triggerType === "onInitCheck")
                    {
                        triggerData.flowState.injectBonus({
                            name: "Squad Leader",
                            val: 1,
                            type: "difficulty"
                        });

                    }
                    else if (triggerType === "onCheck")
                        await api.consumeEffectCharge(effect);
                }
            }
        }]
    },
    "npc_sergeant_AssaultCarbine": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [
            // R0: onInitAttack - offer "Move 2 before attacking"
            {
                triggers: ["onInitAttack"],
                onlyOnSourceMatch: true,
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                awaitActivationCompletion: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const ask = await api.askCard({
                        title: "ASSAULT CARBINE",
                        description: `${reactorToken.name} may move 2 spaces before attacking - ignores engagement, doesn't provoke reactions.`,
                        item,
                        originToken: reactorToken,
                        owner: reactorToken,
                        yesText: "Move 2 before",
                        yesIcon: "modules/lancer-automations/icons/black/push.svg"
                    });
                    if (!ask.confirmed)
                        return;
                    await api.knockBackToken([reactorToken], 2, {
                        title: "ASSAULT CARBINE - MOVE",
                        description: "Move 2 spaces. Ignores engagement, no reactions.",
                        triggeringToken: reactorToken,
                        actionName: "Assault Carbine Move",
                        item
                    });
                    api.setFlowFlag(triggerData, '_sergeantAssaultCarbineMoveUsed');
                }
            },
            // R1: onAttack - offer "Move 2 after attacking" (only if not used before)
            {
                triggers: ["onAttack"],
                onlyOnSourceMatch: true,
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                awaitActivationCompletion: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    return !api.getFlowFlag(triggerData, '_sergeantAssaultCarbineMoveUsed');
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const ask = await api.askCard({
                        title: "ASSAULT CARBINE",
                        description: `${reactorToken.name} may move 2 spaces after attacking - ignores engagement, doesn't provoke reactions.`,
                        item,
                        originToken: reactorToken,
                        owner: reactorToken,
                        yesText: "Move 2 after",
                        yesIcon: "modules/lancer-automations/icons/black/push.svg"
                    });
                    if (!ask.confirmed)
                        return;
                    await api.knockBackToken([reactorToken], 2, {
                        title: "ASSAULT CARBINE - MOVE",
                        description: "Move 2 spaces. Ignores engagement, no reactions.",
                        triggeringToken: reactorToken,
                        actionName: "Assault Carbine Move",
                        item
                    });
                }
            }
        ]
    },
    "npcf_voice_of_authority_commander": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onRoll"],
            actionType: "Reaction",
            frequency: "1/Round",
            triggerSelf: false,
            triggerOther: true,
            outOfCombat: false,
            autoActivate: true,
            awaitActivationCompletion: true,
            checkReaction: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (!['attackRoll', 'techAttackRoll', 'skillRoll'].includes(triggerData.rollType))
                    return false;
                if (triggerData.success !== false)
                    return false;
                if (reactorToken.actor?.statuses?.has('jammed'))
                    return false;
                if (api.getFlowFlag(triggerData, '_voiceOfAuthorityUsed'))
                    return false;
                return api.isFriendly(reactorToken, triggerData.triggeringToken);
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const ally = triggerData.triggeringToken;
                const ask = await api.askCard({
                    title: "VOICE OF AUTHORITY",
                    description: `Let <b>${ally?.name ?? 'the ally'}</b> reroll?`,
                    item,
                    originToken: reactorToken,
                    relatedToken: ally,
                    owner: reactorToken
                });
                if (!ask.confirmed)
                    return;

                await triggerData.startRelatedFlowToReactor();

                api.setFlowFlag(triggerData, '_voiceOfAuthorityUsed');
                await triggerData.reroll(`${reactorToken.name} offers a reroll.`, 'retry');
            }
        }]
    },
    "npc_sergeant_TrueGrit": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onPreHpChange"],
            actionType: "Reaction",
            frequency: "1/Round",
            triggerSelf: false,
            triggerOther: true,
            outOfCombat: false,
            autoActivate: true,
            awaitActivationCompletion: true,
            checkReaction: true,
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                if (triggerData.newHP > 0)
                    return false;
                if (triggerData.previousHP <= 0)
                    return false;
                const sensors = reactorToken.actor?.system?.sensor_range ?? 0;
                if ((triggerData.distanceToTrigger ?? Infinity) > sensors)
                    return false;
                return api.isFriendly(reactorToken, triggerData.triggeringToken);
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const ally = triggerData.triggeringToken;
                let preConfirmResponderIds = [];
                const preConfirm = async () =>
                {
                    const ask = await api.askCard({
                        title: "TRUE GRIT",
                        description: `<b>${ally.name}</b> would fall to 0 HP. Keep at 1 HP?`,
                        item,
                        originToken: ally,
                        relatedToken: reactorToken,
                        owner: reactorToken
                    });
                    preConfirmResponderIds = ask.responderIds;
                    if (ask.confirmed)
                        triggerData.startRelatedFlowToReactor(preConfirmResponderIds[0]);
                    return ask.confirmed;
                };
                triggerData.modifyHpChange(
                    1,
                    `<b>${reactorToken.name}</b> keeps <b>${ally.name}</b> alive at 1 HP via True Grit.`,
                    false,
                    api.getTokenOwnerUserId(ally),
                    preConfirm,
                    null,
                    { item, originToken: reactorToken, relatedToken: ally }
                );
            }
        }]
    },
    "npc_sergeant_5RR": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            awaitActivationCompletion: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const chosen = await api.chooseToken(reactorToken, {
                    count: 2,
                    range: 'sensors',
                    disposition: 'friendly',
                    filter: (token) =>
                    {
                        const combatant = game.combat?.combatants?.find(entry => entry.tokenId === token.id);
                        if (!combatant)
                            return false;
                        const acts = /** @type {any} */ (combatant).activations ?? { value: 1, max: 1 };
                        return acts.value >= acts.max;
                    },
                    filterWarning: "Ally has already acted this round",
                    title: "5RR",
                    description: "Pick up to 2 unspent allies in Sensors. Sergeant + allies each Skirmish; allies then count as having acted.",
                    item,
                    originToken: reactorToken
                });
                if (!chosen || chosen.length === 0)
                    return;
                const skirmishers = [reactorToken, ...chosen];
                for (const t of skirmishers)
                {
                    try
                    {
                        await api.executeSkirmish(t.actor);
                    }
                    catch (e)
                    {
                        console.warn(`lancer-automations | 5RR skirmish for ${t.name} failed:`, e);
                    }
                }
                for (const ally of chosen)
                {
                    const combatant = /** @type {any} */ (game.combat?.combatants?.find(c => c.tokenId === ally.id));
                    const remaining = combatant?.activations?.value ?? 0;
                    if (combatant && remaining > 0)
                        await combatant.modifyCurrentActivations(-remaining);
                }
            }
        }]
    },
    "npc_sergeant_CoordinatedManeuvers": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            awaitActivationCompletion: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const chosen = await api.chooseToken(reactorToken, {
                    count: 2,
                    range: 'sensors',
                    disposition: 'friendly',
                    filterWarning: "Target is not a friendly ally",
                    title: "COORDINATED MANEUVERS",
                    description: "Pick up to 2 allied characters within Sensors. Each moves up to 3 spaces, ignoring engagement and reactions.",
                    item,
                    originToken: reactorToken
                });
                if (!chosen || chosen.length === 0)
                    return;
                for (const ally of chosen)
                {
                    await api.knockBackToken([ally], 3, {
                        title: `COORDINATED MANEUVERS - ${ally.name}`,
                        description: "Move up to 3 spaces in any direction. Ignores engagement, no reactions.",
                        triggeringToken: reactorToken,
                        actionName: "Coordinated Maneuvers",
                        item
                    });
                }
            }
        }]
    },
    "moff_triangulation_ping_sysadmin": {
        category: "NPC (LaSossis)",
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
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const triggerer = triggerData.triggeringToken;

                if (api.isFriendly(reactorToken, triggerer))
                    return false;

                const sensors = reactorToken.actor.system.sensor_range;
                const dist = triggerData.distanceToTrigger;
                if (dist > sensors)
                    return false;

                const round = game.combat?.round ?? 0;
                const flagKey = `triangulation_ping_round_${round}`;
                const existingFlags = api.getActorFlags(reactorToken.actor, flagKey) || [];
                if (existingFlags.includes(triggerer.id))
                    return false;

                return true;
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const triggerer = triggerData.triggeringToken;
                const round = game.combat?.round ?? 0;

                if (round > 1)
                {
                    const prevRoundKey = `triangulation_ping_round_${round - 1}`;
                    if (api.getActorFlags(reactorToken.actor, prevRoundKey))
                        await api.removeActorFlags(reactorToken.actor, { [prevRoundKey]: true });
                }

                await api.executeSaveVsEffect([triggerer], {
                    stat: "SYS",
                    title: "Triangulation Ping Save",
                    origin: reactorToken,
                    sendToOwner: false,
                    effects: ["lockon"],
                    note: "Failed Triangulation Ping Save",
                    onFail: async () =>
                    {
                        const flagKey = `triangulation_ping_round_${round}`;
                        const existingFlags = api.getActorFlags(reactorToken.actor, flagKey) || [];
                        await api.addActorFlags(reactorToken.actor, { [flagKey]: [...existingFlags, triggerer.id] });
                    }
                });
            }
        }]
    },
    "npc-rebake_npcf_deployable_turret_engineer": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.addItemFlags(item, { deployRange: 1 });
                await api.addExtraDeploymentLids(item, [
                    { lid: "dep_engineer_rebake_turret_t1_(npc)", tier: 1 },
                    { lid: "dep_engineer_rebake_turret_t2_(npc)", tier: 2 },
                    { lid: "dep_engineer_rebake_turret_t3_(npc)", tier: 3 }
                ]);
                await api.setHidePrimaryAction(item);
            }
        }, turretDeployOverlayAutomation, turretShutdownOnDeathAutomation]
    },
    "npcf_deployable_turret_engineer": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.addItemFlags(item, { deployRange: 1 });
                await api.addExtraDeploymentLids(item, [
                    { lid: "dep_engineer_turret_t1_(npc)", tier: 1 },
                    { lid: "dep_engineer_turret_t2_(npc)", tier: 2 },
                    { lid: "dep_engineer_turret_t3_(npc)", tier: 3 }
                ]);
                await api.setHidePrimaryAction(item);
            }
        }, turretDeployOverlayAutomation, turretShutdownOnDeathAutomation]
    },
    "npcf_engineers_mark_engineer": engineersMarkAutomation,
    "npc-rebake_npcf_engineers_mark_engineer": engineersMarkAutomation,
    "baserunner_defense_system": baserunnerDefenseAutomation,
    "npcf_stealth_scanner_specialist_maxt": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                if (!api.getActionOverlay(item, "Lock On"))
                    await api.setActionOverlay(item, "Lock On", { range: [{ type: "Range", val: 10 }] });
            }
        }]
    },
    "npcf_restock_drone_support": restockDroneSupportAutomation,
    "npc-rebake_npcf_restock_drone_support": restockDroneSupportAutomation,
    "npcf_marker_rifle_scout": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [
            {
                triggers: ["onHit"],
                triggerSelf: true,
                onlyOnSourceMatch: true,
                triggerOther: false,
                outOfCombat: true,
                autoActivate: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const targets = triggerData.hitTokens;
                    for (const target of targets)
                    {
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
                awaitActivationCompletion: true,
                checkReaction: false,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    if (triggerData.actionName !== 'Hide')
                        return false;
                    const token = triggerData.triggeringToken;
                    if (!token?.actor)
                        return false;
                    return api.findEffectsOnToken(token, 'lockon', { extraFlags: { markerRifleSource: reactorToken.id } }).length > 0;
                },
                activationCode: async function (triggerType, triggerData, reactorToken)
                {
                    triggerData.cancelAction("This unit is Marked - it cannot Hide while under Marker Rifle lock.");
                }
            },
            {
                triggers: ["onPreStatusApplied"],
                triggerSelf: false,
                triggerOther: true,
                outOfCombat: false,
                autoActivate: true,
                awaitActivationCompletion: true,
                checkReaction: false,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken)
                {
                    const stealthStatuses = ['invisible', 'hidden', 'stealth'];
                    if (!stealthStatuses.includes(triggerData.statusId))
                        return false;
                    const token = triggerData.triggeringToken;
                    if (!token?.actor)
                        return false;
                    return api.findEffectsOnToken(token, 'lockon', { extraFlags: { markerRifleSource: reactorToken.id } }).length > 0;
                },
                activationCode: async function (triggerType, triggerData, reactorToken)
                {
                    triggerData.cancelChange("This unit is Marked - it cannot become invisible while under Marker Rifle lock.");
                }
            }
        ]
    },
    "npc-rebake_npcf_marker_rifle_scout": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onHit"],
            triggerSelf: true,
            onlyOnSourceMatch: true,
            triggerOther: false,
            outOfCombat: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                triggerData.targets.forEach(target =>
                {
                    api.applyEffectsToTokens({
                        tokens: [target],
                        effectNames: ["lockon"],
                    });
                    api.applyEffectsToTokens({
                        tokens: [target],
                        effectNames: ["shredded"],
                        duration: { label: 'end', turns: 1, rounds: 0 }
                    });
                });
            }
        }]
    },
    "nrfaw-npc_npcf_marksman_kit_duck_strider": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onHit"],
            triggerSelf: false,
            triggerOther: true,
            outOfCombat: true,
            autoActivate: true,
            checkReaction: true,
            checkUsage: true,
            actionType: "Reaction",
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                return triggerData.distanceToTrigger > 8 && triggerData.targets.some(t => t.target?.id === reactorToken.id);
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                await api.startChoiceCard({
                    title: "DUCK STRIDER",
                    description: `${triggerData.triggeringToken?.name ?? "An attacker"} hit you from long range! Duck to evade?`,
                    userIdControl: api.getTokenOwnerUserId(reactorToken),
                    item: item,
                    icon: api.getActivationIcon("reaction"),
                    relatedToken: reactorToken,
                    originToken: triggerData.triggeringToken,
                    choices: [
                        { text: "Duck!",
                            icon: api.getActivationIcon("reaction"),
                            callback: () =>
                            {
                                const hitResults = triggerData.actionData.flowState.data.hit_results;
                                const entry = hitResults.find(r => r.target?.id === reactorToken.id);
                                if (entry)
                                {
                                    entry.hit = false;
                                    entry.crit = false;
                                    api.applyEffectsToTokens({
                                        tokens: [reactorToken],
                                        effectNames: ["Resist All"],
                                        duration: {
                                            label: 'end',
                                            turns: 1,
                                            rounds: 0,
                                            overrideTurnOriginId: triggerData.triggeringToken?.id
                                        }
                                    });
                                }
                                triggerData.startRelatedFlow();
                            } },
                        { text: "Ignore", icon: "fas fa-times", value: "ignore" },
                    ],
                });
            },
        }]
    },
    "npcf_deadmetal_rounds_sniper": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            actionType: "Quick Action",
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                await api.addGlobalBonus(reactorToken.actor, {
                    id: `deadmetal-rounds-${reactorToken.id}`,
                    name: "Deadmetal Rounds",
                    type: "range",
                    rangeType: "Line",
                    rangeMode: "change",
                    val: 20,
                    itemLids: ["npcf_anti_materiel_rifle_sniper"]
                }, {
                    duration: "indefinite",
                    consumption: {
                        trigger: "onAttack",
                        itemLid: "npcf_anti_materiel_rifle_sniper"
                    }
                });
            }
        }]
    },
    ...Object.fromEntries([
        "npcf_lightning_reflexes_veteran",
        "npc-rebake_npcf_lightning_reflexes_veteran"
    ].map(lid => [lid, {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onAttack"],
            onlyOnSourceMatch: false,
            triggerSelf: false,
            triggerOther: true,
            autoActivate: true,
            outOfCombat: true,
            actionType: "Automation",
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken)
            {
                return triggerData.targets?.some(t => t.id === reactorToken.id);
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const weaponSize = triggerData.flowState?.item?.system?.size ?? "";
                const isHeavyOrSuperheavy = weaponSize === "Heavy" || weaponSize === "Superheavy";
                if (!isHeavyOrSuperheavy)
                    return;

                const targetOwnerId = api.getTokenOwnerUserId(reactorToken)?.[0];
                const result = /** @type {any} */(await (/** @type {any} */(triggerData.sendMessageToReactor))({}, targetOwnerId, {
                    wait: true,
                    waitTitle: "LIGHTNING REFLEXES",
                    waitDescription: `Waiting for <b>${reactorToken.name}</b>'s player to roll…`,
                    waitItem: item,
                    waitOriginToken: reactorToken,
                }));
                if (result?.hitImmune)
                {
                    api.injectBonusToFlowState(triggerData.flowState, {
                        id: `lightning-reflexes-${reactorToken.id}`,
                        name: "Lightning Reflexes",
                        type: "immunity",
                        subtype: "hit"
                    });
                }
            },
            onMessage: async function (_triggerType, _data, reactorToken, item, _activationName, api)
            {
                let hitImmune = false;
                await api.startChoiceCard({
                    title: "LIGHTNING REFLEXES",
                    description: `<b>${reactorToken.name}</b> is hit by a heavy weapon - roll 1d6, on 5+ avoid the hit!`,
                    item,
                    originToken: reactorToken,
                    userIdControl: null,
                    choices: [{
                        text: "Roll 1d6",
                        icon: "fas fa-dice",
                        callback: async () =>
                        {
                            const roll = await new Roll("1d6").evaluate();
                            await roll.toMessage({
                                flavor: `Lightning Reflexes - ${roll.total >= 5 ? "Hit avoided!" : "Failed."}`,
                                speaker: ChatMessage.getSpeaker({ token: reactorToken.document })
                            });
                            hitImmune = roll.total >= 5;
                        }
                    }]
                });
                return { hitImmune };
            }
        }]
    }])),
    ...Object.fromEntries([
        "npcf_feign_death_veteran",
        "npc-rebake_npcf_feign_death_veteran"
    ].map(lid => [lid, {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onDestroyed"],
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            actionType: "Automation",
            activationType: "code",
            activationMode: "instead",
            evaluate: function (triggerType, triggerData, reactorToken)
            {
                return !reactorToken.document.getFlag("lancer-automations", "feign_death");
            },
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const gmUserId = game.users.find(u => u.isGM && u.active)?.id;
                await api.startChoiceCard({
                    title: "FEIGN DEATH",
                    description: `Does <b>${reactorToken.name}</b> feign death?`,
                    item,
                    originToken: reactorToken,
                    userIdControl: gmUserId,
                    choices: [{
                        text: "Feign Death",
                        icon: "fas fa-skull",
                        callback: async () =>
                        {
                            const tokenData = reactorToken.document.toObject();
                            tokenData.hidden = true;
                            foundry.utils.setProperty(tokenData, "flags.lancer-automations.feign_death", true);
                            const [newTokenDoc] = await canvas.scene.createEmbeddedDocuments("Token", [tokenData]);
                            await (/** @type {any} */(newTokenDoc.actor)).update({
                                "system.hp.value": 1,
                                "system.structure.value": 1,
                                "system.stress.value": 1
                            });
                        }
                    }]
                });
            }
        }]
    }])),
    "npcf_snipers_mark_sniper": sniperMarkAutomation,
    "npcf_anti_materiel_rifle_sniper": antiMaterielRifleAutomation,
    ...Object.fromEntries([
        "npc-rebake_npcf_climber_sniper",
        "moff_climber_infiltrator",
        "npcf_climber_sniper",
        "ubrg_npcf_climber_spider",
        "ubrg_npcf_climber_ghul"
    ].map(lid => [lid, {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.ensureLinkedEffect({
                    items: [item],
                    effectNames: ['climber'],
                    note: "Climber",
                    duration: { label: 'permanent' }
                });
            }
        }]
    }])),

    "moving_building": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.ensureLinkedEffect({
                    items: [item],
                    effectNames: ['bulwark'],
                    note: "Moving Building",
                    duration: { label: 'permanent' }
                });
            }
        }]
    },

    "nrfaw-npc_npcf_cqb_training_strider": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                for (const status of ["slowed", "grappled"])
                {
                    await api.ensureLinkedBonus({
                        items: [item],
                        bonusData: {
                            id: `cqb-training-${status}-immunity-${item.id}`,
                            name: "CQB Training",
                            type: "immunity",
                            subtype: "effect",
                            effects: [status]
                        },
                        addOptions: { duration: 'constant' }
                    });
                }
            }
        }]
    },

    "npcf_lesser_sight_veteran": lesserSightAutomation,
    "npc-rebake_npcf_lesser_sight_veteran": lesserSightAutomation,
    "npcf_lesser_sight_ranger_maxt": lesserSightAutomation,

    "cap_npc_architect_slurry_cannon": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onAttack"],
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            onlyOnSourceMatch: true,
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const hardCovers = await api.spawnHardCover(reactorToken, {
                    range: 5,
                    count: 1,
                    name: "Slurry Hard Cover",
                    title: "SLURRY CANNON",
                    description: "Place Hard Cover within the attack Range."
                });

                if (hardCovers?.length)
                {
                    const hcToken = hardCovers[0];

                    const hcW = (hcToken.width ?? 1) * canvas.grid.sizeX;
                    const hcH = (hcToken.height ?? 1) * canvas.grid.sizeY;
                    await api.placeZone(reactorToken, {
                        x: hcToken.x + hcW / 2,
                        y: hcToken.y + hcH / 2,
                        size: 1,
                        type: "Burst",
                        difficultTerrain: { movementPenalty: 1, isFlatPenalty: true },
                        title: "SLURRY CANNON",
                        centerLabel: "Slurry",
                        expires: { on: 'ownerTurnStart' }
                    });
                }
            }
        }]
    },

    "cap_npc_architect_sealant_blend": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [
            {
                triggers: ["onHit"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken)
                {
                    return triggerData.weapon?.system?.lid === "cap_npc_architect_slurry_cannon"
                        && triggerData.triggeringToken?.id === reactorToken.id;
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    api.afterFx(() => api.executeSaveVsEffect(triggerData.hitTokens, {
                        stat: "HULL",
                        title: "Sealant Blend - Hull Save",
                        origin: reactorToken,
                        cardTitle: "SEALANT BLEND - HULL SAVE",
                        cardDescription: (target) => `<b>${target.name}</b> must pass a Hull save or become Immobilized until they spend a Quick Action to Break Free.`,
                        effects: ['immobilized'],
                        note: "Sealant Blend",
                        extraFlags: { sealantBlendSourceId: reactorToken.id },
                        onFail: async (target) =>
                        {
                            await api.addExtraActions(target.actor, {
                                name: "Break Free (Sealant)",
                                activation: "Quick",
                                detail: "Break free from the Sealant Blend immobilization."
                            });
                        }
                    }));
                }
            },
            // R1: onStatusRemoved - cleanup Break Free action when last sealant immobilized ends
            {
                triggers: ["onStatusRemoved"],
                triggerSelf: false,
                triggerOther: true,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData)
                {
                    if (triggerData.statusId !== 'immobilized')
                        return false;
                    return !!triggerData.effect?.flags?.['lancer-automations']?.sealantBlendSourceId;
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const target = triggerData.triggeringToken;
                    if (!target?.actor)
                        return;
                    const stillSealed = api.findEffectsOnToken(target, 'immobilized', { hasFlags: ['sealantBlendSourceId'], excludeId: triggerData.effect?.id }).length > 0;
                    if (!stillSealed)
                        await api.removeExtraActions(target.actor, "Break Free (Sealant)");
                }
            }
        ]
    },

    "cap_npc_architect_protector": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.ensureLinkedEffect({
                    items: [item],
                    effectNames: ['terrain_immunity', 'guardian'],
                    note: "Architect Protector",
                    duration: { label: 'permanent' }
                });
            }
        }]
    },

    "npc-rebake_npcf_rebound_ronin": reboundAutomation,
    "npc-rebake_npcf_instinct_mode_ronin": instinctModeAutomation,
    "npc-rebake_npcf_counter-ballistic_suite_ronin": counterBallisticAutomation,
    "npc-rebake_npcf_mag_field_ronin": magFieldAutomation,
    "npc-rebake_npcf_chaff_launchers_ronin": chaffLaunchersAutomation,
    "npc-rebake_npcf_focus_down_scourer": focusDownAutomation,
    "npc-rebake_npcf_cooling_module_scourer": coolingModuleAutomation,
    "npc-rebake_npcf_ablative_shielding_scourer": ablativeShieldingAutomation,
    "npc-rebake_npcf_emergency_vent_scourer": emergencyVentAutomation,
    "npc-rebake_npcf_pulse_laser_scourer": pulseLaserAutomation,
    "npc-rebake_npcf_melt_scourer": meltAutomation,
    "ubrg_npcf_submachine_gun_stormwing": submachineGunAutomation,
    "ubrg_npcf_flanker_stormwing": flankerAutomation,
    "ubrg_npcf_thunderbolt_jumpjets_stormwing": thunderboltJumpjetsAutomation,
    "ubrg_npcf_stormfall_stormwing": stormfallAutomation,
    "ubrg_npcf_full_spectrum_overload_stormwing": fullSpectrumOverloadAutomation,
    "ubrg_npcf_smoke_charges_stormwing": smokeChargesAutomation,
    "ubrg_npcf_harpy_turbojets_stormwing": harpyTurbojetsAutomation,
    "npcf_weather_proofing_ranger_maxt": weatherProofingAutomation,
    "npcf_perceptive_ranger_maxt": perceptiveAutomation,
    "npcf_guerilla_warfare_ranger_maxt": guerillaWarfareAutomation,
    "npc-rebake_npcf_guardian_bastion": guardianTraitAutomation,
    "npc-rebake_npcf_guardian_sentinel": guardianTraitAutomation,
    "nrfaw-npc-rebake_npcf_guardian_spite": guardianTraitAutomation,
    "npc-rebake_npcf_guardian_aegis": guardianTraitAutomation,
    "npc-rebake_npcf_guardian_defender_grunt": guardianTraitAutomation,
    "npc-rebake_npcf_guardian_goliath": guardianTraitAutomation,
    "npc-rebake-npcf_guardian_barricade_cube": guardianTraitAutomation,
    "nrfaw-npc_npcf_guardian_spite": guardianTraitAutomation,
    "npcf_guardian_aegis": guardianTraitAutomation,
    "ubrg_npcf_guardian_blitzer": guardianTraitAutomation,
    "npcf_guardian_goliath": guardianTraitAutomation,
    "moff_guardian_fusillade": guardianTraitAutomation,
    "ubrg_npcf_guardian_apc": guardianTraitAutomation,
    "npcf_guardian_bastion": guardianTraitAutomation,
    "moff_guardian_knight": guardianTraitAutomation,
    "ubrg_npcf_guardian_bridgelayer": guardianTraitAutomation,
    "npcf_guardian_sentinel": guardianTraitAutomation,

    "cap_npc_architect_citadel_combat_terraformer": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [
        // R0: onInit - inject four sub-actions
            {
                triggers: [],
                triggerSelf: false,
                triggerOther: false,
                autoActivate: false,
                activationType: "none",
                onInit: async function (token, item, api)
                {
                    await api.addExtraActions(item, [
                        { name: "Print",
                            activation: "Quick Action",
                            recharge: 4,
                            charged: true,
                            detail: "Recharge 4+: Place up to 3 blocks of size 1 hard cover within Range 3, or one block of Size 2 cover." },
                        { name: "Rift",
                            activation: "Quick Action",
                            detail: "Choose a Line 5 area in Range 5. At the start of its next turn the area collapses." },
                        { name: "Sharpen",
                            activation: "Quick Action",
                            detail: "A Blast 1 area in Sensors becomes difficult terrain until end of scene or next use." },
                        { name: "Tremor",
                            activation: "Quick Action",
                            detail: "All characters in a Blast 1 area in Sensors must pass a Hull save or be knocked Prone." }
                    ]);
                }
            },
            // R0b: onActivation of base system - choice card for sub-actions
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const extraActions = api.getItemFlags(item, 'extraActions') || [];
                    const chosenAction = await api.pickCard(extraActions, {
                        label: (action) => action.recharge ? `${action.name} ${action.charged !== false ? '▣' : '□'}` : action.name,
                        title: "CITADEL COMBAT TERRAFORMER",
                        description: "Choose an action:",
                        originToken: reactorToken
                    });
                    if (chosenAction)
                        await api.executeSimpleActivation(reactorToken.actor, { title: chosenAction.name, action: chosenAction, detail: chosenAction.detail ?? '' }, { item });
                }
            },
            // R1: onActivation "Print" - place hard covers
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                reactionPath: "extraActions.Print",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    await api.startChoiceCard({
                        title: "PRINT",
                        description: "Choose cover configuration:",
                        originToken: reactorToken,
                        choices: [
                            {
                                text: "3\u00d7 Size 1 Hard Cover",
                                callback: async () =>
                                {
                                    await api.spawnHardCover(reactorToken, {
                                        range: 3,
                                        count: 3,
                                        name: "Printed Cover",
                                        title: "PRINT",
                                        description: "Place Size 1 hard cover within Range 3."
                                    });
                                }
                            },
                            {
                                text: "1\u00d7 Size 2 Hard Cover",
                                callback: async () =>
                                {
                                    await api.spawnHardCover(reactorToken, {
                                        range: 3,
                                        count: 1,
                                        size: 2,
                                        name: "Printed Cover (Size 2)",
                                        title: "PRINT",
                                        description: "Place Size 2 hard cover within Range 3."
                                    });
                                }
                            }
                        ]
                    });
                }
            },
            // R2: onActivation "Rift" - place Line 5 zone
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                reactionPath: "extraActions.Rift",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const result = await api.placeZone(reactorToken, {
                        range: 5,
                        size: 5,
                        type: "Line",
                        fillColor: "#8B4513",
                        borderColor: "#654321",
                        title: "RIFT",
                        centerLabel: "Rift"
                    });
                    if (result?.[0]?.template)
                    {
                        const existing = api.getActorFlags(reactorToken.actor, 'riftTemplates') || [];
                        existing.push(result[0].template.id);
                        await api.addActorFlags(reactorToken.actor, { riftTemplates: existing });
                    }
                }
            },
            // R3: onActivation "Sharpen" - Blast 1 difficult terrain
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                reactionPath: "extraActions.Sharpen",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const previousId = api.getActorFlags(reactorToken.actor, 'sharpenTemplate');
                    if (previousId)
                    {
                        const prev = canvas.scene.templates.get(previousId);
                        if (prev)
                            await prev.delete();
                        await api.removeActorFlags(reactorToken.actor, { sharpenTemplate: true });
                    }
                    const sensors = reactorToken.actor.system.sensor_range;
                    const damage = api.tierValue(reactorToken, [3, 5, 7]);
                    const result = await api.placeZone(reactorToken, {
                        range: sensors,
                        size: 1,
                        type: "Blast",
                        fillColor: "#A0522D",
                        borderColor: "#8B4513",
                        difficultTerrain: { movementPenalty: 1, isFlatPenalty: true },
                        title: "SHARPEN",
                        description: `Blast 1 difficult terrain. Prone characters take ${damage} Kinetic.`,
                        centerLabel: "Sharp"
                    });
                    if (result?.[0]?.template)
                        await api.addActorFlags(reactorToken.actor, { sharpenTemplate: result[0].template.id });
                }
            },
            // R3b: onStatusApplied - Sharpen prone damage
            {
                triggers: ["onStatusApplied"],
                triggerSelf: false,
                triggerOther: true,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    if (triggerData.statusId !== 'prone')
                        return false;
                    const templateId = api.getActorFlags(reactorToken.actor, 'sharpenTemplate');
                    if (!templateId)
                        return false;
                    const templateDoc = canvas.scene.templates.get(templateId);
                    if (!templateDoc)
                        return false;
                    const tmApi = game.modules.get('templatemacro')?.api;
                    return tmApi?.findContained?.(templateDoc)?.includes(triggerData.triggeringToken?.document?.id) ?? false;
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const damage = api.tierValue(reactorToken, [3, 5, 7]);
                    await api.executeDamageRoll(reactorToken, [triggerData.triggeringToken], damage, "Kinetic", "Sharpen - Prone Damage");
                }
            },
            // R4: onActivation "Tremor" - Blast 1, Hull saves, Prone + AP
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                reactionPath: "extraActions.Tremor",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const sensors = reactorToken.actor.system.sensor_range;
                    const result = await api.placeZone(reactorToken, {
                        range: sensors,
                        size: 1,
                        type: "Blast",
                        fillColor: "#CD853F",
                        borderColor: "#8B7355",
                        title: "TREMOR",
                        centerLabel: "Tremor"
                    });
                    if (!result?.[0]?.template)
                        return;
                    const templateDoc = result[0].template;

                    const tmApi = game.modules.get('templatemacro')?.api;
                    const containedIds = tmApi?.findContained?.(templateDoc) ?? [];
                    const contained = containedIds.map(id => canvas.tokens.get(id)).filter(t => t?.actor);
                    const characters = contained.filter(t => t.actor.type !== 'deployable');
                    const deployables = contained.filter(t => t.actor.type === 'deployable');

                    await api.executeSaveVsEffect(characters, {
                        stat: "HULL",
                        title: "Tremor - Hull Save",
                        origin: reactorToken,
                        cardTitle: "TREMOR - HULL SAVE",
                        effects: ['prone'],
                        note: "",
                        duration: {}
                    });

                    // 10 AP Kinetic to all deployables in one roll
                    if (deployables.length > 0)
                    {
                        await api.executeDamageRoll(
                            reactorToken, deployables, 10, "Kinetic",
                            "Tremor - Objects & Terrain", { ap: true }
                        );
                    }

                    await templateDoc.delete();
                }
            },
            // R5: onTurnStart - Rift collapse
            {
                triggers: ["onTurnStart"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    return (api.getActorFlags(reactorToken.actor, 'riftTemplates') || []).length > 0;
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const riftIds = api.getActorFlags(reactorToken.actor, 'riftTemplates') || [];
                    const tmApi = game.modules.get('templatemacro')?.api;

                    for (const templateId of riftIds)
                    {
                        const templateDoc = canvas.scene.templates.get(templateId);
                        if (!templateDoc)
                            continue;

                        const containedIds = tmApi?.findContained?.(templateDoc) ?? [];
                        const contained = containedIds.map(id => canvas.tokens.get(id)).filter(t => t?.actor);
                        const characters = contained.filter(t => t.actor.type !== 'deployable');
                        const deployables = contained.filter(t => t.actor.type === 'deployable');

                        // Destroy deployables (HP to 0)
                        for (const dep of deployables)
                            await dep.actor.update({ "system.hp.value": 0 });

                        await api.executeSaveVsEffect(characters, {
                            stat: "AGI",
                            title: "Rift Collapse - Agility Save",
                            origin: reactorToken,
                            cardTitle: "RIFT COLLAPSE - AGILITY SAVE",
                            cardDescription: (target) => `<b>${target.name}</b> must pass an Agility save or become Immobilized with soft cover until they pass a Hull save (Quick Action).`,
                            effects: ['immobilized', 'cover_soft'],
                            note: "",
                            duration: { label: 'unlimited' },
                            extraFlags: { riftSourceId: reactorToken.id }
                        });

                        ChatMessage.create({
                            content: `<b>${reactorToken.name} - RIFT COLLAPSE</b><br>Objects and terrain in the Rift area are destroyed.`,
                            speaker: ChatMessage.getSpeaker({ token: reactorToken })
                        });
                        await templateDoc.delete();
                    }
                    await api.removeActorFlags(reactorToken.actor, { riftTemplates: true });
                }
            }]
    },

    "cap_npc_architect_insertion_catapult": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [
        // R0: onInit - remove tg_quick_action tag (system is Protocol, not Quick)
            {
                triggers: [],
                triggerSelf: false,
                triggerOther: false,
                autoActivate: false,
                activationType: "none",
                onInit: async function (token, item, api)
                {
                    const tags = item.system.tags ?? [];
                    const filtered = tags.filter(t => t.lid !== 'tg_quick_action');
                    if (filtered.length !== tags.length)
                        await item.update({ 'system.tags': filtered.map(t => ({ lid: t.lid, val: t.val })) });
                }
            },
            // R1: Protocol - Immobilized + inject Throw Ally
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    await api.applyEffectsToTokens({
                        tokens: [reactorToken],
                        effectNames: ['immobilized'],
                        duration: { label: 'start', turns: 1, rounds: 0 }
                    });
                    await api.addExtraActions(item, [{
                        name: "Throw Ally",
                        activation: "Quick Action",
                        detail: "Throw an adjacent ally (same size or smaller) to any space within Range 10."
                    }]);
                }
            },
            // R2: Throw Ally - pick ally, throw, collision
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                reactionPath: "extraActions.Throw Ally",
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const architectSize = reactorToken.actor.system.size ?? 2;
                    const allies = await api.chooseToken(reactorToken, {
                        range: 1,
                        count: 1,
                        disposition: 'friendly',
                        filter: token => (token.actor?.system?.size ?? 1) <= architectSize,
                        title: "THROW ALLY",
                        description: `Choose an adjacent ally (size ${architectSize} or smaller) to throw.`
                    });
                    if (!allies?.length)
                        return;
                    const ally = allies[0];

                    await api.knockBackToken(ally, 10, {
                        title: "INSERTION CATAPULT",
                        description: "Choose destination within Range 10.",
                        triggeringToken: reactorToken,
                        item
                    });

                    const adjacent = canvas.tokens.placeables.filter(t =>
                        t.id !== ally.id
                    && t.id !== reactorToken.id
                    && t.actor
                    && api.isHostile(reactorToken, t)
                    && api.getTokenDistance(ally, t) <= 1
                    );
                    if (adjacent.length > 0)
                    {
                        const choices = [
                            ...adjacent.map(t => ({
                                text: t.name,
                                callback: async () =>
                                {
                                    await api.executeSaveVsEffect([t], {
                                        stat: "HULL",
                                        title: "Insertion Catapult - Hull Save",
                                        origin: reactorToken,
                                        cardTitle: "INSERTION CATAPULT - HULL SAVE",
                                        effects: ['prone'],
                                        note: "",
                                        duration: {}
                                    });
                                }
                            })),
                            { text: "No collision",
                                callback: async () =>
                                {} }
                        ];
                        await api.startChoiceCard({
                            title: "INSERTION CATAPULT - COLLISION",
                            description: `Did ${ally.name} hit a character?`,
                            originToken: reactorToken,
                            choices
                        });
                    }
                }
            },
            // R3: onStatusRemoved - clean up Throw Ally
            {
                triggers: ["onStatusRemoved"],
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    if (triggerData.statusId !== 'immobilized')
                        return false;
                    const ea = api.getItemFlags(item, 'extraActions') || [];
                    return ea.some(a => a.name === 'Throw Ally');
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    await api.removeExtraActions(item, 'Throw Ally');
                }
            }]
    },

    "cap_npc_architect_civil_class_terrain_printer": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            outOfCombat: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                // Delete previous waypoints
                const prev = api.getActorFlags(reactorToken.actor, 'terrainPrinterWaypoints') || [];
                for (const wp of prev)
                {
                    const t = canvas.scene.templates.get(wp.templateId);
                    if (t)
                        await t.delete();
                }
                await api.removeActorFlags(reactorToken.actor, { terrainPrinterWaypoints: true });

                const hookObj = {
                    entered: { function: _terrainPrinterHookFn, asGM: true },
                    turnStart: { function: _terrainPrinterHookFn, asGM: true }
                };

                // Waypoint 1: within Range 3 of Architect
                const wp1Result = await api.placeZone(reactorToken, {
                    range: 3,
                    size: 0.33,
                    type: "Blast",
                    count: 1,
                    fillColor: "#00cc66",
                    borderColor: "#009944",
                    title: "TERRAIN PRINTER - WAYPOINT 1",
                    description: "Place first waypoint within Range 3.",
                    centerLabel: "TP",
                    hooks: hookObj
                });
                if (!wp1Result?.[0]?.template)
                    return;
                const wp1 = wp1Result[0];

                // Waypoint 2: range 5 from waypoint 1's position
                const wp1Center = canvas.grid.getCenterPoint({ x: wp1.template.x, y: wp1.template.y });
                const wp2Result = await api.placeZone(reactorToken, {
                    range: 5,
                    rangeOrigin: wp1Center,
                    size: 0.33,
                    type: "Blast",
                    count: 1,
                    fillColor: "#00cc66",
                    borderColor: "#009944",
                    title: "TERRAIN PRINTER - WAYPOINT 2",
                    description: "Place second waypoint within Range 5 of the first.",
                    centerLabel: "TP",
                    hooks: hookObj
                });
                if (!wp2Result?.[0]?.template)
                {
                    await wp1.template.delete();
                    return;
                }
                const wp2 = wp2Result[0];

                // Cross-reference each waypoint with the other
                await wp1.template.setFlag('lancer-automations', 'terrainPrinterData', {
                    otherTemplateId: wp2.template.id,
                    architectTokenId: reactorToken.id
                });
                await wp2.template.setFlag('lancer-automations', 'terrainPrinterData', {
                    otherTemplateId: wp1.template.id,
                    architectTokenId: reactorToken.id
                });
                await api.addActorFlags(reactorToken.actor, {
                    terrainPrinterWaypoints: [
                        { templateId: wp1.template.id },
                        { templateId: wp2.template.id }
                    ]
                });
            }
        }]
    },

    "cap_npc_architect_sandblast": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                triggerSelf: true,
                triggerOther: false,
                autoActivate: true,
                outOfCombat: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const prev = api.getActorFlags(reactorToken.actor, 'sandblastTemplates') || [];
                    for (const id of prev)
                    {
                        const t = canvas.scene.templates.get(id);
                        if (t)
                            await t.delete();
                    }
                    await api.removeActorFlags(reactorToken.actor, { sandblastTemplates: true });

                    const result = await api.placeZone(reactorToken, {
                        range: reactorToken.actor.system.sensor_range,
                        size: 2,
                        type: "Blast",
                        count: 1,
                        fillColor: "#c4a55a",
                        borderColor: "#8b7355",
                        title: "SANDBLAST",
                        description: "Place a Blast 2 particulate zone within Sensors.",
                        icon: "fas fa-wind",
                        centerLabel: "Sand",
                        expires: { on: 'ownerTurnEnd', turns: 2 },
                        hooks: {
                            onInside: { function: _sandblastEnteredHookFn, asGM: true },
                            onLeave: { function: _sandblastLeftHookFn, asGM: true },
                            turnEnd: { function: _sandblastTurnEndHookFn, asGM: true },
                            deleted: { function: _sandblastDeletedHookFn, asGM: true }
                        }
                    });

                    if (result?.[0]?.template)
                        await api.addActorFlags(reactorToken.actor, { sandblastTemplates: [result[0].template.id] });
                }
            }]
    },

    "npcf_quick_march_commander": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Protocol",
            frequency: "1/Round",
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const targets = await api.chooseToken(reactorToken, {
                    range: 'sensors',
                    count: 1,
                    disposition: 'friendly',
                    filter: token => api.hasLineOfSight(reactorToken, token),
                    filterWarning: "No line of sight",
                    title: "QUICK MARCH",
                    description: `Select an ally within line of sight. They may Boost.`,
                    icon: "fas fa-running"
                });
                const target = targets?.[0];
                if (!target)
                    return;

                await api.executeSimpleActivation(target.actor, {
                    action: { name: "Boost", activation: "Quick" }
                });
            }
        }]
    },
    "npcf_press_on_commander": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Quick Action",
            frequency: "Unlimited",
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const targets = await api.chooseToken(reactorToken, {
                    count: 1,
                    disposition: 'friendly',
                    filter: token => api.hasStatus(token, 'stunned', 'jammed') && api.hasLineOfSight(reactorToken, token),
                    filterWarning: "Not Stunned or Jammed, or no line of sight",
                    title: "PRESS ON",
                    description: "Select an ally (Stunned or Jammed) within line of sight.",
                    icon: "fas fa-bullhorn"
                });
                const target = targets?.[0];
                if (!target)
                    return;

                const hasStunned = target.actor?.statuses?.has('stunned');
                const hasJammed = target.actor?.statuses?.has('jammed');

                const clear = async (statusId) =>
                {
                    await api.removeEffectsByNameFromTokens({
                        tokens: [target],
                        effectNames: [statusId]
                    });
                    ui.notifications.info(`${target.name}: ${statusId} cleared.`);
                };

                if (hasStunned && !hasJammed)
                {
                    await clear('stunned');
                    return;
                }
                if (hasJammed && !hasStunned)
                {
                    await clear('jammed');
                    return;
                }

                await api.startChoiceCard({
                    title: "PRESS ON",
                    description: `Clear which condition from <b>${target.name}</b>?`,
                    item,
                    originToken: reactorToken,
                    relatedToken: target,
                    userIdControl: api.getTokenOwnerUserId(reactorToken),
                    choices: [
                        { text: "Stunned", icon: "fas fa-bolt", callback: async () => clear('stunned') },
                        { text: "Jammed", icon: "fas fa-radiation", callback: async () => clear('jammed') }
                    ]
                });
            }
        }]
    },
    "npc_sergeant_PourItOn": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Quick Action",
            frequency: "Unlimited",
            autoActivate: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const targets = await api.chooseToken(reactorToken, {
                    range: 'sensors',
                    count: 1,
                    disposition: 'friendly',
                    title: "POUR IT ON",
                    description: "Select an ally within Sensors. Their next ranged or melee attack deals +1d6 bonus damage on hit.",
                    icon: "fas fa-fire"
                });
                const target = targets?.[0];
                if (!target)
                    return;

                await api.addGlobalBonus(target.actor, {
                    name: "Pour It On",
                    type: "damage",
                    damage: [{ val: "1d6", type: "Variable" }],
                    rollTypes: ["melee", "ranged"],
                    uses: 1
                }, {
                    origin: reactorToken,
                    consumption: { trigger: "onDamage" }
                });
            }
        }]
    },

    "npcf_press_the_attack_commander": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [
            // R0: onDamage - ally damaged → choice card → provoke the reaction's activation
            {
                triggers: ["onDamage"],
                triggerSelf: false,
                triggerOther: true,
                outOfCombat: false,
                actionType: "Reaction",
                frequency: "1/Round",
                autoActivate: true,
                isReaction: true,
                checkReaction: true,
                requireCanProvoke: true,
                awaitActivationCompletion: true,
                activationType: "code",
                activationMode: "instead",
                evaluate: function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const attacker = triggerData.triggeringToken;
                    const damaged = triggerData.target;
                    if (!attacker || !damaged)
                        return false;
                    if (damaged.id === reactorToken.id)
                        return false;
                    if (!triggerData.isHit)
                        return false;
                    if (!api?.isFriendly?.(reactorToken, damaged))
                        return false;
                    if (!api?.isHostile?.(reactorToken, attacker))
                        return false;
                    return true;
                },
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const attacker = triggerData.triggeringToken;
                    if (!attacker)
                        return;
                    const result = await api.startChoiceCard({
                        title: "PRESS THE ATTACK",
                        description: `<b>${attacker.name}</b> damaged <b>${triggerData.target?.name}</b>. Use Press the Attack? On hit, <b>${reactorToken.name}</b> deals half damage / heat / burn.`,
                        item,
                        originToken: reactorToken,
                        relatedToken: attacker,
                        userIdControl: api.getTokenOwnerUserId(reactorToken),
                        choices: [
                            { text: "Press the Attack",
                                icon: "fas fa-crosshairs",
                                callback: async () =>
                                {} },
                            { text: "Skip",
                                icon: "fas fa-times",
                                callback: async () =>
                                {} }
                        ]
                    });
                    if (result?.choiceIdx !== 0)
                        return;
                    triggerData.startRelatedFlowToReactor(
                        result?.responderIds?.[0],
                        { pressTheAttackTargetId: attacker.id }
                    );
                }
            },
            // R1: onActivation - picks a weapon and fires it with a flow-scoped half-damage bonus
            {
                triggers: ["onActivation"],
                onlyOnSourceMatch: true,
                triggerSelf: true,
                triggerOther: false,
                outOfCombat: true,
                autoActivate: true,
                activationType: "code",
                activationMode: "instead",
                activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
                {
                    const attackerId = triggerData.extraData?.pressTheAttackTargetId;
                    const attacker = attackerId ? canvas.tokens.get(attackerId) : null;

                    const weapons = api.getWeapons(reactorToken)
                        .filter(w => !w.system?.destroyed && !w.system?.disabled);
                    const weapon = await api.pickItem(weapons, {
                        title: "PRESS THE ATTACK - Choose Weapon",
                        description: attacker
                            ? `Fire at <b>${attacker.name}</b>. The attack deals half damage.`
                            : `Choose a weapon. The attack deals half damage.`,
                        icon: "fas fa-crosshairs",
                        relatedToken: attacker ?? reactorToken
                    });
                    if (!weapon)
                        return;

                    const halfDamageBonus = {
                        id: `press-the-attack-${foundry.utils.randomID()}`,
                        name: 'Press the Attack',
                        type: 'target_modifier',
                        subtype: 'half_damage'
                    };
                    if (attacker)
                        /** @type {any} */ (canvas.tokens).setTargets([attacker.id]);
                    await api.beginWeaponAttackFlow(weapon, {}, { flow_bonus: [halfDamageBonus] });
                }
            }
        ]
    },

    "npcf_volley_rainmaker": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            outOfCombat: true,
            actionType: "Full Action",
            autoActivate: true,
            awaitActivationCompletion: true,
            activationType: "code",
            activationMode: "instead",
            activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
            {
                const damageVal = api.tierValue(reactorToken, [4, 6, 8]);

                const targets = await api.chooseToken(reactorToken, {
                    range: 20,
                    count: 2,
                    title: "VOLLEY - RAINMAKER",
                    icon: item.img,
                    item,
                    originToken: reactorToken
                });
                if (!targets || !targets.length)
                    return;

                const wfx = game.modules.get("lancer-weapon-fx")?.api;
                if (wfx && globalThis.Sequencer)
                {
                    await Sequencer.Preloader.preloadForClients([
                        "modules/lancer-weapon-fx/soundfx/Missile_Launch.ogg",
                        "modules/lancer-weapon-fx/soundfx/Missile_Travel.ogg",
                        "jb2a.pack_hound_missile",
                        "jb2a.explosion.01.orange",
                        "modules/lancer-weapon-fx/soundfx/Missile_Impact.ogg"
                    ]);
                    const sequence = new Sequence();
                    for (let i = 0; i < targets.length; i++)
                    {
                        const target = targets[i];
                        sequence
                            .sound()
                            .file("modules/lancer-weapon-fx/soundfx/Missile_Launch.ogg")
                            .volume(wfx.getEffectVolume(0.5));
                        sequence
                            .sound()
                            .file("modules/lancer-weapon-fx/soundfx/Missile_Travel.ogg")
                            .volume(wfx.getEffectVolume(0.5))
                            .timeRange(700, 2000);
                        sequence
                            .effect()
                            .xray(wfx.isEffectIgnoreFogOfWar())
                            .aboveInterface(wfx.isEffectIgnoreLightingColoration())
                            .file("jb2a.pack_hound_missile")
                            .atLocation(reactorToken)
                            .stretchTo(target)
                            .name(`rainmakerImpact${i}`)
                            .waitUntilFinished(-3200);
                        sequence
                            .effect()
                            .xray(wfx.isEffectIgnoreFogOfWar())
                            .aboveInterface(wfx.isEffectIgnoreLightingColoration())
                            .file("jb2a.explosion.01.orange")
                            .atLocation(`rainmakerImpact${i}`)
                            .scale(0.8)
                            .zIndex(1)
                            .waitUntilFinished(-1300);
                        sequence
                            .sound()
                            .file("modules/lancer-weapon-fx/soundfx/Missile_Impact.ogg")
                            .volume(wfx.getEffectVolume(0.5))
                            .waitUntilFinished(-8500);
                    }
                    await sequence.play();
                }

                await api.executeSaveVsEffect(targets, {
                    stat: "AGI",
                    title: "Rainmaker - Agility Save",
                    origin: reactorToken,
                    cardTitle: "RAINMAKER - AGILITY SAVE",
                    cardDescription: (target) => `<b>${target.name}</b> takes <b>${damageVal} Explosive</b>, half on a successful Agility save.`,
                    halfDamageOnSave: { value: damageVal, type: "Explosive", title: `${item.name} - Rainmaker Volley` }
                });
            }
        }]
    },

    "npcf_bulky_construction_industrial_mech": {
        category: "NPC (LaSossis)",
        itemType: "npc_feature",
        reactions: [{
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.lockActorAction(item, "Boost");
                await api.addExtraActions(item, [{
                    name: "Boost (Industrial)",
                    activation: "Full",
                    detail: "Move up to your SPEED. Industrial frames Boost as a full action."
                }]);
            }
        }]
    },

    "mf_standard_pattern_i_everest": {
        category: "MECH (LaSossis)",
        itemType: "frame",
        reactions: [{
            name: "Power Up",
            triggers: [],
            triggerSelf: false,
            triggerOther: false,
            outOfCombat: true,
            autoActivate: false,
            activationType: "none",
            onInit: async function (token, item, api)
            {
                await api.ensureLinkedBonus({
                    items: [item],
                    bonusData: {
                        id: `everest_power_up_${item.id}`,
                        name: "Power Up",
                        type: "accuracy",
                        val: 1,
                        condition: (state, actor) => actor?.system?.statuses?.core_power_active === true
                    },
                    addOptions: { duration: 'constant' }
                });
            }
        }]
    }
});

api.registerDefaultGeneralReactions({
    "Fall Prone (Sniper's Mark)": {
        category: "NPC (LaSossis)",
        triggers: ["onActivation"],
        actionType: "Free Action",
        onlyOnSourceMatch: true,
        activationType: "code",
        activationMode: "instead",
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            await api.applyEffectsToTokens({
                tokens: [reactorToken],
                effectNames: ['prone']
            });
        }
    },
    "Break Free (Sealant)": {
        category: "NPC (LaSossis)",
        triggers: ["onActivation"],
        actionType: "Quick Action",
        onlyOnSourceMatch: true,
        activationType: "code",
        activationMode: "instead",
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const immEffects = api.findEffectsOnToken(reactorToken, 'immobilized', { hasFlags: ['sealantBlendSourceId'] });
            if (immEffects.length === 0)
            {
                ui.notifications.warn(`${reactorToken.name} has no Sealant Blend immobilization to break free from.`);
                return;
            }
            for (const effect of immEffects)
                await effect.delete();
            ui.notifications.info(`${reactorToken.name} breaks free from the Sealant Blend!`);
        }
    },
    "Boost (Industrial)": {
        category: "NPC (LaSossis)",
        triggers: ["onActivation"],
        actionType: "Full Action",
        onlyOnSourceMatch: true,
        activationType: "code",
        activationMode: "after",
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        activationCode: async function (triggerType, triggerData, reactorToken, item, activationName, api)
        {
            const speed = reactorToken.actor?.system?.speed ?? 0;
            if (speed > 0)
                api.recordBoostCast(reactorToken, speed);
            await api.actionFX?.playBoostFX?.(reactorToken);
        }
    }
});
