// grapple.js — Grapple automation for Lancer via lancer-automations
//
// Token flags (MODULE_ID / 'grappleState'):
//   Grappled : { grapplerIds: string[], immobilizedSide: "grappled"|"grapplers"|null }
//   Grappler : { grappledIds: string[] }  — one grappler can pin multiple targets
//
// Only 'grappled' is applied visually. IMMOBILIZED uses the flagged-effects system.
// ENGAGED is managed by overwatch.js based on proximity — not set here.

const MODULE_ID = 'lancer-automations';

function getGrappleState(token) {
    if (!token)
        return {};
    return token.document.getFlag(MODULE_ID, 'grappleState') || {};
}

async function setGrappleState(token, state) {
    if (!token)
        return;
    await token.document.setFlag(MODULE_ID, 'grappleState', state);
}

async function clearGrappleState(token) {
    if (!token)
        return;
    try {
        await token.document.unsetFlag(MODULE_ID, 'grappleState');
    } catch (_) { /* flag may not exist */ }
}

function getTokenSize(token) {
    return token?.actor?.system?.size || 1;
}

function getGrapplerCombinedSize(grappledToken) {
    const state = getGrappleState(grappledToken);
    if (!state.grapplerIds?.length)
        return 0;
    return state.grapplerIds.reduce((sum, id) => sum + getTokenSize(canvas.tokens.get(id)), 0);
}

function isImmobilizedByGrapple(token) {
    const state = getGrappleState(token);
    if (state.grapplerIds?.length > 0 && state.immobilizedSide === "grappled")
        return true;
    if (state.grappledIds?.length > 0) {
        for (const id of state.grappledIds) {
            const grappledState = getGrappleState(canvas.tokens.get(id));
            if (grappledState.immobilizedSide === "grapplers")
                return true;
        }
    }
    return false;
}

async function updateImmobilized(api, grappledToken, isInit = false) {
    const state = getGrappleState(grappledToken);
    if (!state.grapplerIds?.length)
        return;

    const grapplerSize = getGrapplerCombinedSize(grappledToken);
    const grappledSize = getTokenSize(grappledToken);
    const grapplerTokens = state.grapplerIds.map(id => canvas.tokens.get(id)).filter(Boolean);

    let newImmobilizedSide;
    if (grapplerSize > grappledSize)
        newImmobilizedSide = "grappled";
    else if (grappledSize > grapplerSize)
        newImmobilizedSide = "grapplers";
    else
        // Equal size: on init grappled starts immobilized; after a HULL contest preserve the winner's result.
        newImmobilizedSide = isInit ? "grappled" : state.immobilizedSide;

    await setGrappleState(grappledToken, { ...state, immobilizedSide: newImmobilizedSide });

    if (newImmobilizedSide === "grappled") {
        await api.applyFlaggedEffectToTokens({
            tokens: [grappledToken],
            effectNames: ['lancer.statusIconsNames.immobilized'],
            note: 'Grapple',
            customOriginId: state.grapplerIds[0]
        });
        await api.removeFlaggedEffectToTokens({ tokens: grapplerTokens, effectNames: ['lancer.statusIconsNames.immobilized'] });
    } else if (newImmobilizedSide === "grapplers") {
        await api.applyFlaggedEffectToTokens({
            tokens: grapplerTokens,
            effectNames: ['lancer.statusIconsNames.immobilized'],
            note: 'Grapple',
            customOriginId: grappledToken.id
        });
        await api.removeFlaggedEffectToTokens({ tokens: [grappledToken], effectNames: ['lancer.statusIconsNames.immobilized'] });
    }
}

async function establishGrapples(api, grappler, grappledTokens) {
    const grapplerState = getGrappleState(grappler);
    const existingIds = grapplerState.grappledIds || [];
    const newIdSet = new Set(grappledTokens.map(t => t.id));

    for (const oldId of [...existingIds]) {
        if (!newIdSet.has(oldId)) {
            const oldTarget = canvas.tokens.get(oldId);
            if (oldTarget)
                await releaseGrappler(api, grappler, oldTarget);
        }
    }

    for (const grappledToken of grappledTokens) {
        const existingState = getGrappleState(grappledToken);

        if (existingState.grapplerIds?.length > 0) {
            if (existingState.grapplerIds.includes(grappler.id))
                continue;
            await setGrappleState(grappledToken, {
                grapplerIds: [...existingState.grapplerIds, grappler.id],
                immobilizedSide: existingState.immobilizedSide
            });
        } else {
            await setGrappleState(grappledToken, { grapplerIds: [grappler.id], immobilizedSide: null });
            await api.applyFlaggedEffectToTokens({
                tokens: [grappledToken],
                effectNames: ['grappled'],
                note: `Grappled by ${grappler.name}`,
                customOriginId: grappler.id
            });
        }

        await api.applyFlaggedEffectToTokens({
            tokens: [grappler],
            effectNames: ['grappling'],
            note: `Grappling ${grappledToken.name}`,
            customOriginId: grappledToken.id
        });

        await updateImmobilized(api, grappledToken, true);
    }

    await setGrappleState(grappler, { grappledIds: grappledTokens.map(t => t.id) });
}

async function releaseGrappler(api, grappler, grappledToken) {
    const grappledState = getGrappleState(grappledToken);
    const newGrapplerIds = (grappledState.grapplerIds || []).filter(id => id !== grappler.id);

    if (newGrapplerIds.length === 0) {
        await cancelGrappleForToken(api, grappledToken);
    } else {
        await setGrappleState(grappledToken, { grapplerIds: newGrapplerIds, immobilizedSide: grappledState.immobilizedSide });
        await api.removeFlaggedEffectToTokens({
            tokens: [grappler],
            effectNames: ['grappling', 'lancer.statusIconsNames.immobilized']
        });
        await updateImmobilized(api, grappledToken);
    }

    const grapplerState = getGrappleState(grappler);
    const newGrappledIds = (grapplerState.grappledIds || []).filter(id => id !== grappledToken.id);
    if (newGrappledIds.length === 0)
        await clearGrappleState(grappler);
    else
        await setGrappleState(grappler, { grappledIds: newGrappledIds });
}

async function cancelGrappleForToken(api, token) {
    const state = getGrappleState(token);

    if (state.grappledIds?.length > 0) {
        for (const grappledId of [...state.grappledIds]) {
            const grappledToken = canvas.tokens.get(grappledId);
            if (grappledToken)
                await releaseGrappler(api, token, grappledToken);
        }
        await clearGrappleState(token); // ensure cleared even if some targets were missing
    } else if (state.grapplerIds?.length > 0) {
        const grapplerTokens = state.grapplerIds.map(id => canvas.tokens.get(id)).filter(Boolean);

        await api.removeFlaggedEffectToTokens({
            tokens: [token],
            effectNames: ['grappled', 'lancer.statusIconsNames.immobilized']
        });
        if (grapplerTokens.length > 0) {
            await api.removeFlaggedEffectToTokens({
                tokens: grapplerTokens,
                effectNames: ['grappling', 'lancer.statusIconsNames.immobilized']
            });
        }

        for (const t of [token, ...grapplerTokens])
            await clearGrappleState(t);
    }
}

Hooks.on('lancer-automations.ready', (api) => {

    api.registerDefaultGeneralReactions({

        "Grapple": {
            category: "General",
            reactions: [

                {
                    triggers: ["onActivation"],
                    onlyOnSourceMatch: true,
                    comments: "Choice card: Grapple / End / Break Free",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    consumesReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        await api.startChoiceCard({
                            mode: "or",
                            title: "GRAPPLE",
                            description: "Choose a grapple action:",
                            choices: [
                                {
                                    text: "Grapple (Melee Attack)",
                                    icon: "cci cci-reticule",
                                    callback: async () => {
                                        await api.executeBasicAttack(reactorToken.actor, {
                                            title: "Grapple",
                                            attack_type: "Melee"
                                        });
                                    }
                                },
                                {
                                    text: "End Grapple (Free Action)",
                                    icon: "fas fa-unlink",
                                    callback: async () => {
                                        await api.executeSimpleActivation(reactorToken.actor, {
                                            title: "End Grapple",
                                            action: { name: "End Grapple", activation: "Free" },
                                            detail: "End your grapple as a free action."
                                        });
                                    }
                                },
                                {
                                    text: "Break Free (Quick Action)",
                                    icon: "cci cci-structure",
                                    callback: async () => {
                                        await api.executeSimpleActivation(reactorToken.actor, {
                                            title: "Break Free",
                                            action: { name: "Break Free", activation: "Quick" },
                                            detail: "Attempt to break free from a grapple with a contested HULL check."
                                        });
                                    }
                                }
                            ]
                        });
                    }
                },

                {
                    triggers: ["onHit"],
                    onlyOnSourceMatch: true,
                    comments: "On hit: establish grapple",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    consumesReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        const targets = triggerData.targets?.map(t => t.target) || [];
                        if (targets.length > 0)
                            await establishGrapples(api, reactorToken, targets);
                    }
                },

                {
                    triggers: ["onMove"],
                    comments: "Drag immobilized side on move",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    consumesReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken) {
                        const movedToken = triggerData.triggeringToken;
                        const state = getGrappleState(movedToken);
                        if (state.grappledIds?.length > 0) {
                            return state.grappledIds.some(id => {
                                const t = canvas.tokens.get(id);
                                return t && getGrappleState(t).immobilizedSide === "grappled";
                            });
                        }
                        if (state.grapplerIds?.length > 0)
                            return state.immobilizedSide === "grapplers";
                        return false;
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        const state = getGrappleState(reactorToken);
                        let tokensToMove = [];

                        if (state.grappledIds?.length > 0) {
                            tokensToMove = state.grappledIds
                                .map(id => canvas.tokens.get(id))
                                .filter(t => t && getGrappleState(t).immobilizedSide === "grappled");
                        } else if (state.grapplerIds?.length > 0) {
                            tokensToMove = state.grapplerIds.map(id => canvas.tokens.get(id)).filter(Boolean);
                        }

                        if (!tokensToMove.length)
                            return;

                        await api.knockBackToken(tokensToMove, -1, {
                            title: "GRAPPLE — Follow Movement",
                            description: `Place ${tokensToMove.map(t => t.name).join(', ')} to follow ${reactorToken.name}.`,
                            triggeringToken: reactorToken,
                            actionName: "Grapple"
                        });
                    }
                },

                {
                    triggers: ["onPreMove"],
                    forceSynchronous: true,
                    comments: "Block movement while IMMOBILIZED",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    consumesReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken) {
                        return isImmobilizedByGrapple(reactorToken);
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        await triggerData.cancelTriggeredMove(
                            `${reactorToken.name} is IMMOBILIZED by a grapple and cannot move voluntarily.`
                        );
                    }
                },

                {
                    triggers: ["onKnockback"],
                    comments: "Knockback ends the grapple",
                    triggerSelf: false,
                    autoActivate: true,
                    isReaction: false,
                    consumesReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken) {
                        if (triggerData.actionName === "Grapple")
                            return false;
                        const state = getGrappleState(reactorToken);
                        if (!state.grapplerIds?.length && !state.grappledIds?.length)
                            return false;
                        return triggerData.pushedActors?.some(a => a.id === reactorToken.actor?.id) ?? false;
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        await cancelGrappleForToken(api, reactorToken);
                    }
                },

                {
                    triggers: ["onTurnStart"],
                    comments: "Equal size: HULL contest",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    consumesReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: false,
                    evaluate: function(triggerType, triggerData, reactorToken) {
                        const state = getGrappleState(reactorToken);

                        if (state.grapplerIds?.length > 0) {
                            const grapplerSize = getGrapplerCombinedSize(reactorToken);
                            const grappledSize = getTokenSize(reactorToken);
                            return grapplerSize === grappledSize && isImmobilizedByGrapple(reactorToken);
                        }

                        if (state.grappledIds?.length > 0) {
                            return state.grappledIds.some(id => {
                                const grappledToken = canvas.tokens.get(id);
                                if (!grappledToken)
                                    return false;
                                const grapplerSize = getGrapplerCombinedSize(grappledToken);
                                const grappledSize = getTokenSize(grappledToken);
                                return grapplerSize === grappledSize && isImmobilizedByGrapple(reactorToken);
                            });
                        }

                        return false;
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        const state = getGrappleState(reactorToken);
                        const contests = [];

                        if (state.grapplerIds?.length > 0) {
                            const grapplerSize = getGrapplerCombinedSize(reactorToken);
                            const grappledSize = getTokenSize(reactorToken);
                            if (grapplerSize === grappledSize && isImmobilizedByGrapple(reactorToken))
                                contests.push({ grappledToken: reactorToken, reactorSide: "grappled" });
                        } else if (state.grappledIds?.length > 0) {
                            for (const id of state.grappledIds) {
                                const grappledToken = canvas.tokens.get(id);
                                if (!grappledToken)
                                    continue;
                                const grapplerSize = getGrapplerCombinedSize(grappledToken);
                                const grappledSize = getTokenSize(grappledToken);
                                if (grapplerSize === grappledSize && isImmobilizedByGrapple(reactorToken))
                                    contests.push({ grappledToken, reactorSide: "grapplers" });
                            }
                        }

                        for (const { grappledToken, reactorSide } of contests) {
                            await api.startChoiceCard({
                                mode: "or",
                                title: "GRAPPLE CONTEST",
                                description: `${reactorToken.name}: Make a HULL check to determine who controls the grapple. On success your side counts as larger — the other side becomes IMMOBILIZED.`,
                                choices: [
                                    {
                                        text: "Contest Grapple (HULL Check)",
                                        icon: "cci cci-structure",
                                        callback: async () => {
                                            const roll = await api.executeStatRoll(
                                                reactorToken.actor, "HULL",
                                                `Grapple Contest`,
                                                10
                                            );
                                            if (!roll?.completed)
                                                return;

                                            const grappledState = getGrappleState(grappledToken);
                                            const losingSide = roll.passed
                                                ? (reactorSide === "grappled" ? "grapplers" : "grappled")
                                                : reactorSide;

                                            await setGrappleState(grappledToken, { ...grappledState, immobilizedSide: losingSide });
                                            await updateImmobilized(api, grappledToken);

                                            const losingLabel = losingSide === "grapplers" ? "Grapplers are" : "Grappled token is";
                                            ui.notifications.info(
                                                roll.passed
                                                    ? `${reactorToken.name} wins the contest! ${losingLabel} now IMMOBILIZED.`
                                                    : `${reactorToken.name} loses the contest. ${losingLabel} now IMMOBILIZED.`
                                            );
                                        }
                                    },
                                    {
                                        text: "Skip Contest",
                                        icon: "fas fa-times",
                                        callback: async () => {}
                                    }
                                ]
                            });
                        }
                    }
                }

            ]
        },

        "End Grapple": {
            category: "General",
            comments: "Free action: end your grapple",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            isReaction: false,
            consumesReaction: false,
            activationType: "code",
            activationMode: "instead",
            outOfCombat: true,
            activationCode: async function(triggerType, triggerData, reactorToken) {
                await cancelGrappleForToken(api, reactorToken);
            }
        },

        "Break Free": {
            category: "General",
            comments: "Quick: contested HULL to escape",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            isReaction: false,
            consumesReaction: false,
            activationType: "code",
            activationMode: "instead",
            outOfCombat: true,
            activationCode: async function(triggerType, triggerData, reactorToken) {
                const state = getGrappleState(reactorToken);
                if (!state.grapplerIds?.length) {
                    ui.notifications.warn(`${reactorToken.name} is not grappled.`);
                    return;
                }

                const primaryGrappler = canvas.tokens.get(state.grapplerIds[0]);
                if (!primaryGrappler) {
                    await cancelGrappleForToken(api, reactorToken); return;
                }

                const grapplerRoll = await api.executeStatRoll(
                    primaryGrappler.actor, "HULL",
                    `HULL Contest — ${primaryGrappler.name} (Grappler)`
                );
                if (!grapplerRoll?.completed)
                    return;

                const myRoll = await api.executeStatRoll(
                    reactorToken.actor, "HULL",
                    `Break Free — ${reactorToken.name}`,
                    grapplerRoll.total
                );
                if (!myRoll?.completed)
                    return;

                if (myRoll.passed) {
                    await cancelGrappleForToken(api, reactorToken);
                    ui.notifications.info(`${reactorToken.name} breaks free from the grapple!`);
                } else {
                    ui.notifications.info(`${reactorToken.name} fails to break free.`);
                }
            }
        }

    });

    console.log("lancer-automations | Grapple automation registered.");
});
