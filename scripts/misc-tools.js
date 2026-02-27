import { removeFlaggedEffectToTokens, applyFlaggedEffectToTokens, findFlaggedEffectOnToken } from "./flagged-effects.js";
import { getMaxGroundHeightUnderToken } from "./terrain-utils.js";
import { chooseToken } from "./interactive-tools.js";

const STAT_PATHS = {
    HULL: "system.hull",
    AGI: "system.agi",
    SYS: "system.sys",
    ENG: "system.eng",
    GRIT: "system.grit"
};

/**
 * Checks the token height and applies fall damage if necessary
 * If the token is above the ground, adds the "falling" tag and reduces height by 10 per tick
 * For every 3 spaces fallen, applies 3 AP kinetic damage
 * @param {Token} paramToken - Token to check
 */
export async function executeFall(paramToken) {
    if (!paramToken) {
        ui.notifications.error('lancer-automations | executeFall requires a target token.');
        return;
    }

    const targetToken = paramToken;
    const tokenDoc = targetToken.document;
    const actor = targetToken.actor;
    const terrainAPI = globalThis.terrainHeightTools;

    // Remove Flying status if present - falling means no longer flying
    const hasFlyingStatus = !!findFlaggedEffectOnToken(targetToken, "flying");
    if (hasFlyingStatus) {
        await removeFlaggedEffectToTokens({
            tokens: [targetToken],
            effectNames: ["Flying"]
        });
    }

    const tokenElevation = tokenDoc.elevation || 0;
    const maxGroundHeight = terrainAPI ? getMaxGroundHeightUnderToken(targetToken, terrainAPI) : 0;

    const hasFallingEffect = !!findFlaggedEffectOnToken(targetToken, "falling");

    // Check if token is on the ground
    if (tokenElevation <= maxGroundHeight) {
        if (hasFallingEffect) {
            ui.notifications.warn('Token is already on the ground');
            await removeFlaggedEffectToTokens({
                tokens: [targetToken],
                effectNames: ["Falling"]
            });
        }
        return;
    }

    // Calculate fall distance
    let fallStartElevation = Math.max(tokenElevation, tokenDoc.getFlag('lancer-automations', 'fallStartElevation') || 0);
    const fallDistance = tokenElevation - maxGroundHeight;
    const fallAmount = Math.min(10, fallDistance); // Maximum 10 per tick
    const newElevation = tokenElevation - fallAmount;
    const totalFallAmount = fallStartElevation - newElevation;

    // Update token elevation
    await tokenDoc.update({ elevation: newElevation });
    ui.notifications.info(`Token has fallen ${fallAmount} space${fallAmount !== totalFallAmount ? ` (for a total of ${totalFallAmount})` : ''}`);

    // If the token reaches the ground, calculate damage
    if (newElevation <= maxGroundHeight) {
        await removeFlaggedEffectToTokens({
            tokens: [targetToken],
            effectNames: ["Falling"]
        });

        const totalFallDistance = fallStartElevation - maxGroundHeight;

        // Calculate damage: 3 damage for every 3 spaces
        const damageGroups = Math.min(3, Math.floor(totalFallDistance / 3));

        if (damageGroups > 0) {
            const totalDamage = damageGroups * 3;
            await executeDamageRoll(targetToken, [targetToken], totalDamage, "Kinetic", "Fall", { ap: true, action: { name: "Fall" } });
        }

        // Adjust final elevation to be exactly at ground level
        if (newElevation < maxGroundHeight) {
            await tokenDoc.update({ elevation: maxGroundHeight });
        }

        // Clean up the flag
        await tokenDoc.unsetFlag('lancer-automations', 'fallStartElevation');

    } else if (!hasFallingEffect) {
        await applyFlaggedEffectToTokens({
            tokens: [targetToken],
            effectNames: ["Falling"],
            duration: { label: "unlimited" }
        });
        await tokenDoc.setFlag('lancer-automations', 'fallStartElevation', fallStartElevation);
    } else {
        await tokenDoc.setFlag('lancer-automations', 'fallStartElevation', fallStartElevation);
    }
}

export function getItemLID(item) {
    return item.system?.lid || null;
}

export function isItemAvailable(item, reactionPath) {
    if (!item || item.system?.destroyed || item.system?.disabled) {
        return false;
    }

    if (item.type === "talent" && reactionPath) {
        const rankMatch = reactionPath.match(/ranks\[(\d+)\]/);
        if (rankMatch) {
            const requiredRank = parseInt(rankMatch[1]) + 1;
            if ((item.system?.curr_rank || 0) < requiredRank) {
                return false;
            }
        }
    }

    if (item.type === "mech_weapon" && reactionPath) {
        const profileMatch = reactionPath.match(/profiles\[(\d+)\]/);
        if (profileMatch) {
            const requiredProfile = parseInt(profileMatch[1]);
            const currentProfile = item.system?.selected_profile_index ?? 0;
            if (currentProfile !== requiredProfile) {
                return false;
            }
        }
    }

    return true;
}

export function hasReactionAvailable(token) {
    const reaction = token.actor?.system?.action_tracker?.reaction;
    return reaction !== undefined && reaction > 0;
}

export async function executeStatRoll(actor, stat, title, target = 10, extraData = {}) {
    const StatRollFlow = game.lancer.flows.get("StatRollFlow");
    if (!StatRollFlow) {
        console.error("lancer-automations | StatRollFlow not found");
        return { completed: false };
    }

    const { targetStat, ...restExtraData } = (extraData && typeof extraData === 'object') ? extraData : {};

    let targetVal = target;
    let targetToken = null;
    let chooseTokenInFlow = target === "token";
    let rollTitle = title;
    const upperStat = stat.toUpperCase();

    // Handle "token" target selection or object target
    const useFlowTargeting = game.settings.get('lancer-automations', 'statRollTargeting');

    if (target === "token" && !useFlowTargeting) {
        const token = actor.token?.object;
        if (!token) {
            ui.notifications.warn("No source token found for choosing target.");
            return { completed: false };
        }

        const targets = await chooseToken(token, {
            title: `${upperStat} SAVE TARGET`,
            description: `Select a target for the ${upperStat} Save.`,
            count: 1,
            range: null
        });

        if (targets && targets.length > 0) {
            targetToken = targets[0];
        } else {
            return { completed: false };
        }
    } else if (typeof target === 'object') {
        if (typeof TokenDocument !== 'undefined' && target instanceof TokenDocument) {
            targetToken = target.object;
        } else if (target.actor) {
            targetToken = target;
        } else {
            console.error("lancer-automations | executeStatRoll | Invalid target type");
        }
    }

    if (targetToken && targetToken.actor) {
        const targetActor = targetToken.actor;
        rollTitle = rollTitle || `${upperStat} Save`;

        // Dynamic Difficulty
        if (targetActor.type === "npc" || targetActor.type === "deployable") {
            targetVal = targetActor.system.save || 10;
        } else if (targetActor.type === "mech") {
            const lookupStat = targetStat ? targetStat.toUpperCase() : upperStat;
            const path = STAT_PATHS[lookupStat] || lookupStat.toLowerCase();
            targetVal = foundry.utils.getProperty(targetActor, path) || 10;
        }
    }

    rollTitle = rollTitle || `${upperStat} Check`;
    if (targetToken && typeof targetVal === 'number') rollTitle += ` (>= ${targetVal})`;

    const isNpcGrit = actor.type === "npc" && upperStat === "GRIT";
    const statPath = isNpcGrit ? "system.tier" : (STAT_PATHS[upperStat] || stat);

    const flowOptions = { path: statPath, title: rollTitle };
    const flow = new StatRollFlow(actor, flowOptions);
    if (targetToken) {
        flow.state.data.targetToken = targetToken;
        chooseTokenInFlow = false;
    }
    flow.state.data.targetVal = targetVal;
    flow.state.data.chooseToken = chooseTokenInFlow;

    if (restExtraData && typeof restExtraData === 'object') {
        foundry.utils.mergeObject(flow.state.data, restExtraData);
    }

    const completed = await flow.begin();
    if (!completed) {
        return { completed: false };
    }
    const total = flow.state.data?.result?.roll?.total ?? null;
    return {
        completed: true,
        total,
        roll: flow.state.data?.result?.roll ?? null,
        passed: total !== null ? (targetVal !== undefined ? total >= targetVal : false) : false
    };
}

export async function executeDamageRoll(attacker, targets, damageValue, damageType, title = "Damage Roll", options = {}, extraData = {}) {
    const DamageRollFlow = game.lancer.flows.get("DamageRollFlow");
    if (!DamageRollFlow) {
        return { completed: false };
    }

    const actor = attacker.actor || attacker;
    if (!actor) {
        return { completed: false };
    }

    if (targets && Array.isArray(targets)) {
        targets.forEach((t, i) => {
            const token = t.object || t;
            if (token?.setTarget) {
                token.setTarget(true, { releaseOthers: i === 0, groupSelection: true });
            }
        });
    }

    const typeMap = { kinetic: "Kinetic", energy: "Energy", explosive: "Explosive", burn: "Burn", heat: "Heat", variable: "Variable" };
    const resolvedType = typeMap[damageType.toLowerCase()] || "Kinetic";

    const flowData = {
        title: title,
        damage: [{
            val: String(damageValue),
            type: resolvedType
        }],
        tags: options.tags || [],
        hit_results: options.hit_results || [],
        has_normal_hit: options.has_normal_hit !== undefined ? options.has_normal_hit : true,
        has_crit_hit: options.has_crit_hit || false,
        ap: options.ap || false,
        paracausal: options.paracausal || false,
        half_damage: options.half_damage || false,
        overkill: options.overkill || false,
        reliable: options.reliable || false,
        add_burn: options.add_burn !== undefined ? options.add_burn : true,
        invade: options.invade || false,
        bonus_damage: options.bonus_damage || []
    };

    foundry.utils.mergeObject(flowData, options);
    const flow = new DamageRollFlow(actor.uuid, flowData);
    if (extraData && typeof extraData === 'object') {
        foundry.utils.mergeObject(flow.state.data, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
}

export async function executeBasicAttack(actor, options = {}, extraData = {}) {
    const BasicAttackFlow = game.lancer.flows.get("BasicAttackFlow");
    if (!BasicAttackFlow) {
        return { completed: false };
    }
    const flow = new BasicAttackFlow(actor.uuid, options);
    if (extraData && typeof extraData === 'object') {
        foundry.utils.mergeObject(flow.state.data, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
}

export async function executeTechAttack(actor, options = {}, extraData = {}) {
    const TechAttackFlow = game.lancer.flows.get("TechAttackFlow");
    if (!TechAttackFlow) {
        return { completed: false };
    }
    const flow = new TechAttackFlow(actor.uuid, options);
    if (extraData && typeof extraData === 'object') {
        foundry.utils.mergeObject(flow.state.data, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
}

export async function executeReactorMeltdown(token, turns = null) {
    if (!token) {
        ui.notifications.error('lancer-automations | executeReactorMeltdown requires a token.');
        return;
    }

    let selectedTurns = turns;

    if (selectedTurns === null) {
        selectedTurns = await new Promise((resolve) => {
            const dialog = new Dialog({
                title: "Reactor Meltdown",
                content: `
                    <div class="lancer-dialog-base">
                        <div class="lancer-dialog-header">
                            <div class="lancer-dialog-title">⚠ REACTOR MELTDOWN ⚠</div>
                            <div class="lancer-dialog-subtitle">Initiate Self-Destruct Sequence</div>
                        </div>
                        <p style="margin-bottom: 12px; color: #000;">As a Quick Action, you may initiate a reactor meltdown. Choose when the explosion occurs:</p>
                        <div class="lancer-items-grid">
                            <div class="lancer-item-card" data-turn="1">
                                <div class="lancer-item-icon"><i class="fas fa-bomb"></i></div>
                                <div class="lancer-item-content">
                                    <div class="lancer-item-name">1 TURN</div>
                                    <div class="lancer-item-details">Explodes at the end of your next turn</div>
                                </div>
                            </div>
                            <div class="lancer-item-card" data-turn="2">
                                <div class="lancer-item-icon"><i class="fas fa-bomb"></i></div>
                                <div class="lancer-item-content">
                                    <div class="lancer-item-name">2 TURNS</div>
                                    <div class="lancer-item-details">Explodes in 2 turns</div>
                                </div>
                            </div>
                            <div class="lancer-item-card" data-turn="3">
                                <div class="lancer-item-icon"><i class="fas fa-bomb"></i></div>
                                <div class="lancer-item-content">
                                    <div class="lancer-item-name">3 TURNS</div>
                                    <div class="lancer-item-details">Explodes in 3 turns</div>
                                </div>
                            </div>
                        </div>
                        <div class="lancer-info-box">
                            <i class="fas fa-info-circle"></i>
                            <span>Your mech will be annihilated, dealing <strong>4d6 Explosive</strong> damage in a <strong>Burst 2</strong> radius.</span>
                        </div>
                    </div>
                `,
                buttons: {
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                },
                default: "cancel",
                close: () => resolve(null),
                render: (html) => {
                    html.find('.lancer-item-card').click(function () {
                        const turnValue = parseInt($(this).data('turn'));
                        if (turnValue) {
                            resolve(turnValue);
                            dialog.close();
                        }
                    });
                }
            }, {
                classes: ["lancer-dialog-base"],
                width: 450
            });
            dialog.render(true);
        });
    }

    if (selectedTurns === null) {
        ui.notifications.info('Reactor Meltdown cancelled.');
        return;
    }

    await executeSimpleActivation(token.actor, {
        title: "Reactor Meltdown",
        action: { name: "Reactor Meltdown", activation: "Quick" },
        detail: `Reactor meltdown initiated. Explosion will occur at the end of turn ${selectedTurns}. Your mech will be annihilated, dealing 4d6 Explosive Damage in a Burst 2 radius.`
    }, { selectedTurns });
}

export async function executeReactorExplosion(token) {
    if (!token) {
        ui.notifications.error('lancer-automations | executeReactorExplosion requires a token.');
        return;
    }

    const myActor = token.actor;

    await canvas.animatePan({
        x: token.center.x,
        y: token.center.y,
        scale: 1.25,
        duration: 750
    });

    const template = await game.lancer.canvas.WeaponRangeTemplate.fromRange({
        type: "Burst",
        val: 2,
    }).placeTemplate();

    if (!template)
        return;

    const targets = await game.lancer.targetsFromTemplate(template.id);
    token.control({ releaseOthers: true });

    await executeDamageRoll(token, targets, "4d6", "Explosive", "REACTOR EXPLOSION");

    await template.delete();

    const BASE_SCALE = 0.2;
    const systemSize = Math.floor(myActor?.system?.size || 1);
    const scaleFactor = (systemSize + 2) * BASE_SCALE;
    const tokenCenterX = token.document.x + (token.document.width * canvas.grid.size) / 2;
    const tokenCenterY = token.document.y + (token.document.height * canvas.grid.size) / 2;
    const tokenCenter = { x: tokenCenterX, y: tokenCenterY };

    await Sequencer.Preloader.preloadForClients([
        "modules/lancer-weapon-fx/sprites/jetlancer_explosion_white_bg.png",
        "modules/lancer-weapon-fx/sprites/shockwave.png",
        "modules/lancer-weapon-fx/soundfx/pw_nuke.ogg",
        "modules/lancer-weapon-fx/video/pw_nuke_effect.webm",
        "jb2a.ground_cracks.01.orange",
        "modules/lancer-weapon-fx/sprites/scorch_mark_hires.png",
    ]);

    new Sequence()
        .effect("modules/lancer-weapon-fx/sprites/jetlancer_explosion_white_bg.png")
            .fadeIn(100)
            .duration(6000)
            .fadeOut(3000)
            .screenSpace()
        .effect("modules/lancer-weapon-fx/sprites/shockwave.png")
            .atLocation(tokenCenter)
            .duration(7000)
            .scale(0.2 * scaleFactor)
            .scaleOut(12 * scaleFactor, 7000)
            .fadeOut(7000)
            .delay(3000)
        .sound("modules/lancer-weapon-fx/soundfx/pw_nuke.ogg")
            .startTime(800)
            .delay(1000)
        .effect("modules/lancer-weapon-fx/video/pw_nuke_effect.webm")
            .delay(1000)
            .atLocation(tokenCenter)
            .aboveLighting()
            .xray()
            .scale(scaleFactor)
            .zIndex(100)
            .thenDo(async () => {
                await token.document.delete();
            })
        .effect("jb2a.ground_cracks.01.orange")
            .persist()
            .belowTokens()
            .aboveLighting()
            .zIndex(1)
            .xray()
            .randomRotation()
            .atLocation({ x: tokenCenterX, y: tokenCenterY })
            .scale(scaleFactor)
            .thenDo(async () => {
                await canvas.scene.createEmbeddedDocuments("AmbientLight", [{
                    x: tokenCenterX,
                    y: tokenCenterY,
                    config: {
                        color: "#ff9117",
                        dim: 10 * scaleFactor,
                        bright: 5 * scaleFactor,
                        animation: { type: "pulse" },
                    },
                }]);
            })
        .effect("modules/lancer-weapon-fx/sprites/scorch_mark_hires.png")
            .atLocation({ x: tokenCenterX, y: tokenCenterY })
            .scale(scaleFactor * 1.1)
            .persist()
            .belowTokens()
            .zIndex(0)
            .randomRotation()
            .xray()
        .canvasPan()
            .delay(1000)
            .atLocation(tokenCenter)
            .scale(0.5)
            .shake({
                duration: 20000,
                strength: 15 * scaleFactor,
                fadeOutDuration: 10000,
                rotation: true,
            })
        .play();
}

export async function executeSimpleActivation(actor, options = {}, extraData = {}) {
    const SimpleActivationFlow = game.lancer.flows.get("SimpleActivationFlow");
    if (!SimpleActivationFlow) {
        return { completed: false };
    }
    const flow = new SimpleActivationFlow(actor.uuid, options);
    if (extraData && typeof extraData === 'object') {
        foundry.utils.mergeObject(flow.state.data, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
}
