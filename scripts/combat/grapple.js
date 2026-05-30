import * as actionFX from '../fx/actionFX.js';

// IMMOBILIZED uses flagged-effects; ENGAGED is managed by overwatch.js, not here.

const MODULE_ID = 'lancer-automations';

function getGrappleState(token) {
    if (!token)
        return {};
    return token.document.getFlag(MODULE_ID, 'grappleState') || {};
}

async function setGrappleState(token, state) {
    if (!token)
        return;
    const api = game.modules.get(MODULE_ID)?.api;
    await api?.setTokenFlag?.(token.document, MODULE_ID, 'grappleState', state);
}

async function clearGrappleState(token) {
    if (!token)
        return;
    const api = game.modules.get(MODULE_ID)?.api;
    await api?.unsetTokenFlag?.(token.document, MODULE_ID, 'grappleState');
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
        // Equal size: init defaults grappled = immobilized; HULL contest preserves the winner.
        newImmobilizedSide = isInit ? "grappled" : state.immobilizedSide;

    await setGrappleState(grappledToken, { ...state, immobilizedSide: newImmobilizedSide });

    if (newImmobilizedSide === "grappled") {
        await api.applyEffectsToTokens({
            tokens: [grappledToken],
            effectNames: ['immobilized'],
            note: 'Grapple',
        }, { grappleSource: true });
        await api.removeEffectsByNameFromTokens({ tokens: grapplerTokens, effectNames: ['immobilized'], extraFlags: { grappleSource: true } });
    } else if (newImmobilizedSide === "grapplers") {
        await api.applyEffectsToTokens({
            tokens: grapplerTokens,
            effectNames: ['immobilized'],
            note: 'Grapple',
        }, { grappleSource: true });
        await api.removeEffectsByNameFromTokens({ tokens: [grappledToken], effectNames: ['immobilized'], extraFlags: { grappleSource: true } });
    }
}

async function establishGrapples(api, grappler, grappledTokens) {
    const grapplerState = getGrappleState(grappler);
    const existingIds = grapplerState.grappledIds || [];

    for (const grappledToken of grappledTokens) {
        const existingState = getGrappleState(grappledToken);
        const wasFresh = !(existingState.grapplerIds?.length > 0);

        if (!wasFresh) {
            if (existingState.grapplerIds.includes(grappler.id))
                continue;
            await setGrappleState(grappledToken, {
                grapplerIds: [...existingState.grapplerIds, grappler.id],
                immobilizedSide: existingState.immobilizedSide
            });
        } else {
            await setGrappleState(grappledToken, { grapplerIds: [grappler.id], immobilizedSide: null });
            await api.applyEffectsToTokens({
                tokens: [grappledToken],
                effectNames: ['grappled'],
                note: `Grappled by ${grappler.name}`,
            }, { grappleSource: true });
        }

        await updateImmobilized(api, grappledToken, wasFresh);
    }

    const merged = Array.from(new Set([...existingIds, ...grappledTokens.map(t => t.id)]));
    await setGrappleState(grappler, { grappledIds: merged });

    if (merged.length > 0) {
        const names = merged.map(id => canvas.tokens.get(id)?.name).filter(Boolean).join(', ');
        await api.applyEffectsToTokens({
            tokens: [grappler],
            effectNames: ['grappling'],
            note: names ? `Grappling ${names}` : 'Grappling',
        }, { grappleSource: true });
    }
}

async function releaseGrappler(api, grappler, grappledToken) {
    const grappledState = getGrappleState(grappledToken);
    const newGrapplerIds = (grappledState.grapplerIds || []).filter(id => id !== grappler.id);

    if (newGrapplerIds.length === 0) {
        await cancelGrappleForToken(api, grappledToken);
    } else {
        await setGrappleState(grappledToken, { grapplerIds: newGrapplerIds, immobilizedSide: grappledState.immobilizedSide });
        await updateImmobilized(api, grappledToken);
    }

    const grapplerState = getGrappleState(grappler);
    const newGrappledIds = (grapplerState.grappledIds || []).filter(id => id !== grappledToken.id);
    if (newGrappledIds.length === 0) {
        await clearGrappleState(grappler);
        await api.removeEffectsByNameFromTokens({
            tokens: [grappler],
            effectNames: ['grappling', 'immobilized'],
            extraFlags: { grappleSource: true }
        });
    } else {
        await setGrappleState(grappler, { grappledIds: newGrappledIds });
    }
}

async function cleanupGrappleReferences(api, deletedTokenId) {
    const sceneTokens = canvas?.scene?.tokens;
    if (!sceneTokens)
        return;
    for (const td of sceneTokens) {
        if (td.id === deletedTokenId)
            continue;
        const t = canvas.tokens.get(td.id);
        if (!t)
            continue;
        const state = td.getFlag(MODULE_ID, 'grappleState');
        if (!state)
            continue;
        if (state.grapplerIds?.includes(deletedTokenId)) {
            const newIds = state.grapplerIds.filter(id => id !== deletedTokenId);
            if (newIds.length === 0) {
                await cancelGrappleForToken(api, t);
            } else {
                await setGrappleState(t, { grapplerIds: newIds, immobilizedSide: state.immobilizedSide });
                await updateImmobilized(api, t);
            }
        }
        if (state.grappledIds?.includes(deletedTokenId)) {
            const newIds = state.grappledIds.filter(id => id !== deletedTokenId);
            if (newIds.length === 0) {
                await clearGrappleState(t);
                await api.removeEffectsByNameFromTokens({
                    tokens: [t],
                    effectNames: ['grappling', 'immobilized'],
                    extraFlags: { grappleSource: true }
                });
            } else {
                await setGrappleState(t, { grappledIds: newIds });
            }
        }
    }
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

        await api.removeEffectsByNameFromTokens({
            tokens: [token],
            effectNames: ['grappled', 'immobilized'],
            extraFlags: { grappleSource: true }
        });
        if (grapplerTokens.length > 0) {
            await api.removeEffectsByNameFromTokens({
                tokens: grapplerTokens,
                effectNames: ['grappling', 'immobilized'],
                extraFlags: { grappleSource: true }
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
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        const state = getGrappleState(reactorToken);
                        const isGrappling = (state.grappledIds?.length ?? 0) > 0;
                        const isGrappled = (state.grapplerIds?.length ?? 0) > 0;

                        const choices = [
                            {
                                text: "Grapple (Melee Attack)",
                                icon: "cci cci-reticule",
                                callback: async () => {
                                    await actionFX.playGrappleFX(reactorToken);
                                    await api.executeBasicAttack(reactorToken.actor, {
                                        title: "Grapple",
                                        attack_type: "Melee"
                                    });
                                }
                            },
                            {
                                text: "End Grapple (Free Action)",
                                icon: "fas fa-unlink",
                                disabled: !isGrappling,
                                disabledReason: "You aren't grappling anyone.",
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
                                disabled: !isGrappled,
                                disabledReason: "You aren't being grappled.",
                                callback: async () => {
                                    await api.executeSimpleActivation(reactorToken.actor, {
                                        title: "Break Free",
                                        action: { name: "Break Free", activation: "Quick" },
                                        detail: "Attempt to break free from a grapple with a contested HULL check."
                                    });
                                }
                            }
                        ];

                        await api.startChoiceCard({
                            mode: "or",
                            title: "GRAPPLE",
                            description: "Choose a grapple action:",
                            choices
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
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        const targets = triggerData.targets?.map(t => t.target) || [];
                        const validTargets = [];
                        for (const target of targets) {
                            if (api.checkEffectImmunities(target.actor, 'grappled').length > 0) {
                                ui.notifications.warn(`${target.name} is immune to grapple — grapple has no effect.`);
                            } else {
                                validTargets.push(target);
                            }
                        }
                        if (validTargets.length > 0)
                            await establishGrapples(api, reactorToken, validTargets);
                    }
                },

                {
                    triggers: ["onMove"],
                    comments: "Drag immobilized side on move",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
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
                    awaitActivationCompletion: true,
                    comments: "Block movement while IMMOBILIZED",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
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
                    triggers: ["onInvoluntaryMove"],
                    comments: "Involuntary move (e.g. knockback) ends the grapple",
                    triggerSelf: true,
                    triggerOther: true,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken) {
                        if (triggerData.actionName === "Grapple")
                            return false;
                        const state = getGrappleState(reactorToken);
                        if (!state.grapplerIds?.length && !state.grappledIds?.length)
                            return false;
                        return triggerData.token?.id === reactorToken.id;
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        await cancelGrappleForToken(api, reactorToken);
                    }
                },

                {
                    triggers: ["onTokenRemoved"],
                    comments: "Cleanup grapple references when this token is removed",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken) {
                        const state = getGrappleState(reactorToken);
                        return !!(state.grapplerIds?.length || state.grappledIds?.length);
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken) {
                        await cleanupGrappleReferences(api, reactorToken.id);
                    }
                },

                {
                    triggers: ["onTurnStart"],
                    comments: "Equal size: HULL contest",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
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
            checkReaction: false,
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
            checkReaction: false,
            activationType: "code",
            activationMode: "instead",
            outOfCombat: true,
            activationCode: async function(triggerType, triggerData, reactorToken) {
                const state = getGrappleState(reactorToken);
                if (!state.grapplerIds?.length) {
                    ui.notifications.warn(`${reactorToken.name} is not grappled.`);
                    return;
                }

                const grapplerTokens = state.grapplerIds.map(id => canvas.tokens.get(id)).filter(Boolean);
                if (grapplerTokens.length === 0) {
                    await cancelGrappleForToken(api, reactorToken); return;
                }

                let chosenGrappler;
                if (grapplerTokens.length === 1) {
                    chosenGrappler = grapplerTokens[0];
                } else {
                    const result = await api.startChoiceCard({
                        mode: "or",
                        title: "BREAK FREE",
                        description: `${reactorToken.name}: choose which grappler to contest.`,
                        choices: grapplerTokens.map(g => ({
                            text: g.name,
                            icon: "cci cci-structure",
                            callback: async () => {}
                        }))
                    });
                    if (result?.choiceIdx == null)
                        return;
                    chosenGrappler = grapplerTokens[result.choiceIdx];
                }

                const grapplerRoll = await api.executeStatRoll(
                    chosenGrappler.actor, "HULL",
                    `HULL Contest — ${chosenGrappler.name} (Grappler)`
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
                    await releaseGrappler(api, chosenGrappler, reactorToken);
                    ui.notifications.info(`${reactorToken.name} breaks free from ${chosenGrappler.name}!`);
                } else {
                    ui.notifications.info(`${reactorToken.name} fails to break free from ${chosenGrappler.name}.`);
                }
            }
        }

    });

    console.log("lancer-automations | Grapple automation registered.");
});
