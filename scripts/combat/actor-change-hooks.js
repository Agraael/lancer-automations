import { _buildCancelFn } from "../activations/flow-steps.js";
import { startChoiceCard, getActiveGMId } from "../interactive/index.js";
import { handleTrigger } from "../activations/reactions-engine.js";
import { updateStructure } from "../tools/wreck.js";

const previousHeatValues = new Map();
const previousHPValues = new Map();

Hooks.on('preUpdateActor', (actor, change, _options, userId) => {
    if (userId !== game.userId)
        return;
    try {
        if (game.settings.get('lancer-automations', 'syncActorImgToToken')) {
            const newTokenImg = foundry.utils.getProperty(change, 'prototypeToken.texture.src');
            if (newTokenImg && change.img === undefined)
                foundry.utils.setProperty(change, 'img', newTokenImg);
        }
    } catch { /* ignore */ }
    try {
        if (game.settings.get('lancer-automations', 'syncActorNameToToken')) {
            const newTokenName = foundry.utils.getProperty(change, 'prototypeToken.name');
            if (newTokenName && change.name === undefined)
                foundry.utils.setProperty(change, 'name', newTokenName);
        }
    } catch { /* ignore */ }
});

Hooks.on('preUpdateActor', (actor, change, options, userId) => {
    if (userId !== game.userId)
        return true;
    if (options._bypassPreChange)
        return true;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    if (!token)
        return true;

    let blocked = false;

    if (change.system?.hp?.value !== undefined) {
        const previousHP = previousHPValues.get(actor.id) ?? actor.system.hp.value;
        const newHP = change.system.hp.value;
        const delta = newHP - previousHP;
        if (delta !== 0) {
            const _cancelledBy = options._cancelledBy || [];
            let cancelHpTriggered = false;
            let modifyPromise = null;

            const cancelHpChange = _buildCancelFn({
                setFlag: () => {
                    cancelHpTriggered = true;
                },
                cancelledBy: _cancelledBy,
                getIgnoreCallback: () => async () => {
                    actor.update(change, { ...options, _bypassPreChange: true, _cancelledBy });
                },
                defaultReason: "HP change has been prevented.",
                defaultTitle: "HP CHANGE PREVENTED",
            });

            /** @type {any} */
            const modifyHpChange = (newValue, reasonText = "HP change has been modified.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, { item = null, originToken = null, relatedToken = null } = {}) => {
                cancelHpTriggered = true;
                const identity = modifyHpChange._reactorIdentity;
                if (identity)
                    _cancelledBy.push(identity);
                const def = modifyHpChange._defaultContext ?? {};
                item = item ?? def.item ?? null;
                originToken = originToken ?? def.originToken ?? null;
                relatedToken = relatedToken ?? def.relatedToken ?? null;

                const executeModify = async () => {
                    await actor.update({ "system.hp.value": newValue }, { ...options, _bypassPreChange: true, _cancelledBy });
                };
                const executeOriginal = async () => {
                    await actor.update(change, { ...options, _bypassPreChange: true, _cancelledBy });
                };

                modifyPromise = (async () => {
                    await Promise.resolve();
                    if (preConfirm) {
                        const confirmed = await preConfirm();
                        if (!confirmed) {
                            await executeOriginal();
                            return;
                        }
                    }
                    if (!allowConfirm) {
                        await executeModify();
                        await postChoice?.(true);
                        return;
                    }
                    await startChoiceCard({
                        mode: "or",
                        title: "HP MODIFIED",
                        description: reasonText,
                        item,
                        originToken,
                        relatedToken,
                        userIdControl: userIdControl ?? getActiveGMId(),
                        choices: [
                            { text: "Confirm",
                                icon: "fas fa-check",
                                callback: async () => {
                                    await executeModify();
                                    await postChoice?.(true);
                                } },
                            { text: "Ignore",
                                icon: "fas fa-times",
                                callback: async () => {
                                    await postChoice?.(false);
                                    await executeOriginal();
                                } }
                        ]
                    });
                })();
                return modifyPromise;
            };
            modifyHpChange.wait = () => modifyPromise;

            handleTrigger('onPreHpChange', {
                triggeringToken: token,
                previousHP,
                newHP,
                delta,
                cancelHpChange,
                modifyHpChange,
                _cancelledBy
            });

            if (cancelHpTriggered) {
                cancelHpChange.wait()?.catch(() => {});
                modifyHpChange.wait()?.catch(() => {});
                blocked = true;
            }
        }
    }

    if (change.system?.heat?.value !== undefined) {
        const previousHeat = previousHeatValues.get(actor.id) ?? actor.system.heat.value;
        const newHeat = change.system.heat.value;
        const delta = newHeat - previousHeat;
        if (delta !== 0) {
            const _cancelledBy = options._cancelledBy || [];
            let cancelHeatTriggered = false;
            let modifyPromise = null;

            const cancelHeatChange = _buildCancelFn({
                setFlag: () => {
                    cancelHeatTriggered = true;
                },
                cancelledBy: _cancelledBy,
                getIgnoreCallback: () => async () => {
                    actor.update(change, { ...options, _bypassPreChange: true, _cancelledBy });
                },
                defaultReason: "Heat change has been prevented.",
                defaultTitle: "HEAT CHANGE PREVENTED",
            });

            /** @type {any} */
            const modifyHeatChange = (newValue, reasonText = "Heat change has been modified.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, { item = null, originToken = null, relatedToken = null } = {}) => {
                cancelHeatTriggered = true;
                const identity = modifyHeatChange._reactorIdentity;
                if (identity)
                    _cancelledBy.push(identity);
                const def = modifyHeatChange._defaultContext ?? {};
                item = item ?? def.item ?? null;
                originToken = originToken ?? def.originToken ?? null;
                relatedToken = relatedToken ?? def.relatedToken ?? null;

                const executeModify = async () => {
                    await actor.update({ "system.heat.value": newValue }, { ...options, _bypassPreChange: true, _cancelledBy });
                };
                const executeOriginal = async () => {
                    await actor.update(change, { ...options, _bypassPreChange: true, _cancelledBy });
                };

                modifyPromise = (async () => {
                    await Promise.resolve();
                    if (preConfirm) {
                        const confirmed = await preConfirm();
                        if (!confirmed) {
                            await executeOriginal();
                            return;
                        }
                    }
                    if (!allowConfirm) {
                        await executeModify();
                        await postChoice?.(true);
                        return;
                    }
                    await startChoiceCard({
                        mode: "or",
                        title: "HEAT MODIFIED",
                        description: reasonText,
                        item,
                        originToken,
                        relatedToken,
                        userIdControl: userIdControl ?? getActiveGMId(),
                        choices: [
                            { text: "Confirm",
                                icon: "fas fa-check",
                                callback: async () => {
                                    await executeModify();
                                    await postChoice?.(true);
                                } },
                            { text: "Ignore",
                                icon: "fas fa-times",
                                callback: async () => {
                                    await postChoice?.(false);
                                    await executeOriginal();
                                } }
                        ]
                    });
                })();
                return modifyPromise;
            };
            modifyHeatChange.wait = () => modifyPromise;

            handleTrigger('onPreHeatChange', {
                triggeringToken: token,
                previousHeat,
                newHeat,
                delta,
                cancelHeatChange,
                modifyHeatChange,
                _cancelledBy
            });

            if (cancelHeatTriggered) {
                cancelHeatChange.wait()?.catch(() => {});
                modifyHeatChange.wait()?.catch(() => {});
                blocked = true;
            }
        }
    }

    if (blocked)
        return false;
    return true;
});

Hooks.on('updateActor', async (actor, change, options, userId) => {
    if (userId !== game.userId) {
        return;
    }
    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    if (!token)
        return;

    if (change.system?.heat?.value !== undefined) {
        const previousHeat = previousHeatValues.get(actor.id) ?? actor.system.heat.value;
        const currentHeat = change.system.heat.value;
        const heatChange = currentHeat - previousHeat;

        if (heatChange > 0) {
            const heatMax = actor.system.heat.max;
            const inDangerZone = currentHeat >= Math.floor(heatMax / 2);
            await handleTrigger('onHeatGain', { triggeringToken: token, heatChange, currentHeat, inDangerZone });
        } else if (heatChange < 0) {
            const heatCleared = Math.abs(heatChange);
            await handleTrigger('onHeatLoss', { triggeringToken: token, heatCleared, currentHeat });
        }

        previousHeatValues.set(actor.id, currentHeat);
    }

    if (change.system?.hp?.value !== undefined) {
        const previousHP = previousHPValues.get(actor.id) ?? actor.system.hp.value;
        const currentHP = change.system.hp.value;
        const hpChange = currentHP - previousHP;

        if (hpChange > 0) {
            const maxHP = actor.system.hp.max;
            await handleTrigger('onHpGain', { triggeringToken: token, hpChange, currentHP, maxHP });
        } else if (hpChange < 0) {
            const hpLost = Math.abs(hpChange);
            await handleTrigger('onHpLoss', { triggeringToken: token, hpLost, currentHP });
        }

        previousHPValues.set(actor.id, currentHP);
    }

    if (change.system?.structure !== undefined && game.userId === userId) {
        try {
            if (game.settings.get('lancer-automations', 'enableWrecks')) {
                await updateStructure(token);
            }
        } catch (e) {
            console.warn('lancer-automations | wreck updateStructure error:', e);
        }
    }

    if (change.system?.hp !== undefined
        && actor.type === 'deployable'
        && (actor.system?.hp?.value ?? 1) <= 0
        && game.userId === userId) {
        console.log(`lancer-automations | Deployable ${token.name} destroyed (HP <= 0)`);
        if (game.combat && token.combatant) {
            await game.combat.combatants.get(token.combatant._id)?.delete();
        }
        await token.document.delete();
    }
});
