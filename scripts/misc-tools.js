import { removeEffectsByNameFromTokens, applyEffectsToTokens, findEffectOnToken } from "./flagged-effects.js";
import { getMaxGroundHeightUnderToken } from "./terrain-utils.js";
import { chooseToken, choseMount, chooseInvade, InteractiveAPI, getTokenOwnerUserId } from "./interactive/index.js";
import { flattenBonuses, isBonusApplicable, applyTagBonus, mutateRangeWithBonus } from "./genericBonuses.js";
import { getItemActions } from "./interactive/deployables.js";

/** Maps activation type strings to the NPC feature tag LID that signals that activation. */
export const ACTIVATION_TAG_MAP = {
    'Quick':      'tg_quick_action',
    'Full':       'tg_full_action',
    'Quick Tech': 'tg_quick_tech',
    'Full Tech':  'tg_full_tech',
    'Protocol':   'tg_protocol',
    'Reaction':   'tg_reaction',
    'Free':       'tg_free_action',
    'Invade':     'tg_invade',
};

/**
 * Returns all actor items (with their source item) whose activation matches `activationType`.
 *
 * - Mech / pilot: scans loadout systems, weapon slots (weapon + mod), and frame passive actions.
 *   Uses `getItemActions(item)` so extraActions flags are included.
 * - NPC: scans npc_feature items by tag (e.g. tg_quick_action → "Quick").
 *   Also checks getItemActions() in case an NPC feature has an explicit actions array.
 *
 * @param {Actor} actor
 * @param {string} activationType  e.g. "Quick", "Full", "Quick Tech", "Full Tech", "Invade"
 * @returns {{ action: Object, sourceItem: Item }[]}
 */
export function getActorActionItems(actor, activationType) {
    const results = [];

    if (actor?.type === 'npc') {
        const tagLid = ACTIVATION_TAG_MAP[activationType];
        for (const item of (actor.items ?? [])) {
            if (item.type !== 'npc_feature')
                continue;
            const itemTags = item.system?.tags ?? [];
            const tagMatched = tagLid ? itemTags.some(t => t.lid === tagLid) : false;
            const extraActions = getItemActions(item).filter(a =>
                a.activation === activationType || a.activation === activationType + ' Action'
            );
            // Fallback: match by system.type when no tag and no explicit actions found
            const typeMatched = !tagMatched && !extraActions.length && item.system?.type === activationType;
            if (tagMatched || typeMatched) {
                results.push({
                    action: {
                        name: item.name,
                        activation: activationType,
                        detail: item.system?.effect ?? '',
                        tags: itemTags,
                        tech_attack: item.system?.tech_attack ?? false,
                        attack_bonus: item.system?.attack_bonus ?? null,
                        accuracy: item.system?.accuracy ?? null,
                        range: item.system?.range ?? [],
                        damage: item.system?.damage ?? [],
                        on_hit: item.system?.on_hit ?? '',
                    },
                    sourceItem: item,
                });
            }
            for (const action of extraActions) {
                results.push({ action, sourceItem: item });
            }
        }
    } else {
        for (const s of (actor?.system?.loadout?.systems ?? [])) {
            const item = s?.value;
            if (!item)
                continue;
            for (const action of getItemActions(item)) {
                if (action.activation === activationType)
                    results.push({ action, sourceItem: item });
            }
        }
        for (const mount of (actor?.system?.loadout?.weapon_mounts ?? [])) {
            for (const slot of (mount.slots ?? [])) {
                const weapon = slot.weapon?.value;
                if (weapon) {
                    for (const action of getItemActions(weapon)) {
                        if (action.activation === activationType)
                            results.push({ action, sourceItem: weapon });
                    }
                }
                const mod = slot.mod?.value;
                if (mod) {
                    for (const action of getItemActions(mod)) {
                        if (action.activation === activationType)
                            results.push({ action, sourceItem: mod });
                    }
                }
            }
        }
        const frame = actor?.system?.loadout?.frame?.value;
        if (frame) {
            const cs = frame.system?.core_system;
            if (cs?.activation === activationType) {
                results.push({
                    action: { name: cs.active_name ?? 'Core Power', activation: cs.activation, detail: cs.active_effect ?? '' },
                    sourceItem: frame,
                    _coreActive: true,
                });
            }
            for (const action of (cs?.active_actions ?? [])) {
                if (action.activation === activationType)
                    results.push({ action, sourceItem: frame });
            }
            for (const action of (cs?.passive_actions ?? [])) {
                if (action.activation === activationType)
                    results.push({ action, sourceItem: frame });
            }
            for (const trait of (frame.system?.traits ?? [])) {
                for (const action of (trait.actions ?? [])) {
                    if (action.activation === activationType)
                        results.push({ action, sourceItem: frame });
                }
            }
        }

        // Pilot items: talents (by rank) and core bonuses only
        const pilot = actor?.system?.pilot?.value;
        if (pilot) {
            for (const item of (pilot.items ?? [])) {
                if (item.type === 'talent') {
                    const currRank = item.system?.curr_rank ?? 0;
                    for (let n = 0; n < currRank; n++) {
                        for (const action of (item.system?.ranks?.[n]?.actions ?? [])) {
                            if (action.activation === activationType)
                                results.push({ action, sourceItem: item, rankIdx: n });
                        }
                    }
                } else if (item.type === 'core_bonus') {
                    for (const action of getItemActions(item)) {
                        if (action.activation === activationType)
                            results.push({ action, sourceItem: item });
                    }
                }
            }
        }
    }

    // Actor-level extra actions (stored on actor flag via addExtraActions(actor, ...))
    const actorExtraActions = actor?.getFlag?.('lancer-automations', 'extraActions') || [];
    for (const action of actorExtraActions) {
        if (action.activation === activationType)
            results.push({ action, sourceItem: null });
    }

    return results;
}

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
/**
 * Stand up from prone: removes the Prone status and adds +speed to the movement cap.
 * Costs the standard move (not a quick/full action).
 * @param {Token} token
 */
/**
 * Add a virtual movement entry to both LA and Elevation Ruler history.
 * Used for actions that cost movement without physically moving the token.
 */
async function addVirtualMovement(token, cost) {
    const tokenDoc = token.document;
    // LA movement history
    const laHistory = tokenDoc.getFlag('lancer-automations', 'moveHistory') ?? { moves: [] };
    const moves = laHistory.moves || [];
    moves.push({
        distanceMoved: cost,
        movementCost: cost,
        isDrag: true,
        isFreeMovement: false,
        boostSet: [],
        startPos: { x: tokenDoc.x, y: tokenDoc.y },
    });
    await tokenDoc.update({ 'flags.lancer-automations.moveHistory': { ...laHistory, moves } });
    // Elevation Ruler combat history — update both in-memory trail and flag
    if (game.modules.get('elevationruler')?.active && game.combat?.started) {
        const canvasToken = canvas.tokens?.get(tokenDoc.id) ?? token;
        // Token center (pixel position, not top-left document x/y)
        const cx = tokenDoc.x + (canvasToken.w / 2);
        const cy = tokenDoc.y + (canvasToken.h / 2);
        const z = tokenDoc.elevation ?? 0;
        // In-memory measurement history (visual trail)
        canvasToken.elevationruler ??= {};
        const mh = canvasToken.elevationruler.measurementHistory ?? [];
        // If empty, add origin entry first (cost 0)
        if (!mh.length) {
            mh.push({ x: cx, y: cy, teleport: false, cost: 0, z });
        }
        // Add standing-up entry at same position with the movement cost
        mh.push({ x: cx, y: cy, teleport: false, cost, z });
        canvasToken.elevationruler.measurementHistory = mh;
        // Flag persistence (speed color calculation)
        const erFlag = tokenDoc.getFlag('elevationruler', 'movementHistory') ?? {};
        const combatId = game.combat.id;
        const combatData = erFlag.combatMoveData?.[combatId] ?? { lastMoveDistance: 0, lastRound: -1, numDiagonal: 0 };
        if (combatData.lastRound < game.combat.round)
            combatData.lastMoveDistance = cost;
        else
            combatData.lastMoveDistance += cost;
        combatData.lastRound = game.combat.round;
        const newFlag = {
            ...erFlag,
            lastMoveDistance: cost,
            combatMoveData: { ...(erFlag.combatMoveData ?? {}), [combatId]: combatData },
        };
        await tokenDoc.setFlag('elevationruler', 'movementHistory', newFlag);
    }
}

export async function executeStandingUp(token) {
    if (!token?.actor)
        return;
    const hasProne = !!findEffectOnToken(token, e => e.statuses?.has('prone'));
    if (!hasProne) {
        ui.notifications.info(`${token.name} is not Prone.`);
        return;
    }
    await removeEffectsByNameFromTokens({ tokens: [token], effectNames: ['prone'] });
    const speed = token.actor.system?.speed ?? 0;
    await addVirtualMovement(token, speed);
    ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token: token.document }),
        content: `<b>${token.name}</b> stands up, using their standard move (+${speed} speed).`,
    });
}

export async function executeTeleport(token, cost) {
    if (!token?.actor)
        return;
    const api = game.modules.get('lancer-automations')?.api;
    if (!api)
        return;
    const speed = token.actor.system?.speed ?? 0;
    const moveCost = cost ?? speed;
    await api.moveToken(token, {
        teleport: true,
        range: speed,
        cost: moveCost,
        title: "TELEPORT",
        description: `Select destination within Range ${speed}. Costs ${moveCost} movement.`
    });
}

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
    const hasFlyingStatus = !!findEffectOnToken(targetToken, "flying");
    if (hasFlyingStatus) {
        await removeEffectsByNameFromTokens({
            tokens: [targetToken],
            effectNames: ["Flying"]
        });
    }

    const tokenElevation = tokenDoc.elevation || 0;
    const maxGroundHeight = terrainAPI ? getMaxGroundHeightUnderToken(targetToken, terrainAPI) : 0;

    const hasFallingEffect = !!findEffectOnToken(targetToken, "falling");

    // Check if token is on the ground
    if (tokenElevation <= maxGroundHeight) {
        if (hasFallingEffect) {
            ui.notifications.warn('Token is already on the ground');
            await removeEffectsByNameFromTokens({
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
        await removeEffectsByNameFromTokens({
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
        await applyEffectsToTokens({
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

/**
 * Find an item on an actor by its LID.
 * @param {Actor} actor
 * @param {string} lid
 * @returns {Item|null}
 */
export function findItemByLid(actor, lid) {
    return actor?.items?.find(i => i.system?.lid === lid) ?? null;
}

export function isItemAvailable(item, reactionPath) {
    if (!item || item.system?.destroyed || item.system?.disabled) {
        return false;
    }

    if (item.type === "talent" && reactionPath) {
        const rankMatch = reactionPath.match(/ranks\[(\d+)\]/);
        if (rankMatch) {
            const requiredRank = Number.parseInt(rankMatch[1]) + 1;
            if ((item.system?.curr_rank || 0) < requiredRank) {
                return false;
            }
        }
    }

    if (item.type === "mech_weapon" && reactionPath) {
        const profileMatch = reactionPath.match(/profiles\[(\d+)\]/);
        if (profileMatch) {
            const requiredProfile = Number.parseInt(profileMatch[1]);
            const currentProfile = item.system?.selected_profile_index ?? 0;
            if (currentProfile !== requiredProfile) {
                return false;
            }
        }
    }

    return true;
}

export function hasReactionAvailable(tokenOrActor) {
    const actor = tokenOrActor?.actor || tokenOrActor;
    const reaction = actor?.system?.action_tracker?.reaction;
    return reaction !== undefined && Number(reaction) > 0;
}

/**
 * Sets reaction availability for an actor.
 * @param {Token|Actor} actorOrToken
 * @param {boolean} value  true = reaction available, false = reaction spent
 * @returns {Promise<void>}
 */
export async function setReaction(actorOrToken, value) {
    const actor = actorOrToken?.actor ?? actorOrToken;
    if (!actor)
        return;
    await actor.update({ "system.action_tracker.reaction": Boolean(value) });
}

/**
 * Sets a resource value on an item — uses, loaded, charged, or talent counter.
 *
 * Detection order:
 *   1. Talent items               → system.counters[counterIndex].value (clamped to counter min/max)
 *   2. Items with uses.max > 0    → system.uses.value (clamped 0..max)
 *   3. Items with a loaded field  → system.loaded (Boolean(nb))
 *   4. Items with a charged field → system.charged (Boolean(nb))
 *
 * @param {Item} item
 * @param {number|boolean} nb  Target value. For loaded/charged: truthy/falsy. For uses/counters: number.
 * @param {number} [counterIndex=0]  For talent items: index into system.counters.
 * @returns {Promise<void>}
 */
export async function setItemResource(item, nb, counterIndex = 0) {
    if (!item)
        return;

    if (item.type === 'talent') {
        const counters = item.system?.counters ?? [];
        const counter = counters[counterIndex];
        if (!counter)
            return;
        const clamped = Math.max(counter.min ?? 0, Math.min(counter.max ?? Infinity, Math.round(Number(nb))));
        await item.update({ [`system.counters.${counterIndex}.value`]: clamped });
        return;
    }

    const uses = item.system?.uses;
    if (uses && uses.max > 0) {
        const clamped = Math.max(0, Math.min(uses.max, Math.round(Number(nb))));
        await item.update({ "system.uses.value": clamped });
        return;
    }

    if (item.system?.loaded !== undefined) {
        await item.update({ "system.loaded": Boolean(nb) });
        return;
    }

    if (item.system?.charged !== undefined) {
        await item.update({ "system.charged": Boolean(nb) });
    }
}

/**
 * Adds a tag to an item.
 * @param {Item} item - The item document to modify.
 * @param {Object} tagData - The tag object to add (e.g. { id: "tg_heat_self", val: "2" }).
 * @returns {Promise<Item>} The updated item.
 */
export async function addItemTag(item, tagData) {
    if (!item || !tagData?.id)
        return item;

    const currentTags = globalThis.foundry.utils.deepClone(item.system?.tags || []);

    // Check if a tag with this ID already exists
    const existingIndex = currentTags.findIndex(t => t.id === tagData.id);
    if (existingIndex >= 0) {
        currentTags[existingIndex] = tagData; // Update existing
    } else {
        currentTags.push(tagData); // Add new
    }

    return item.update(/** @type {any} */ ({ system: { tags: currentTags } }));
}

/**
 * Removes a tag from an item by its ID.
 * @param {Item} item - The item document to modify.
 * @param {string} tagId - The ID of the tag to remove.
 * @returns {Promise<Item>} The updated item.
 */
export async function removeItemTag(item, tagId) {
    if (!item || !tagId)
        return item;

    const currentTags = item.system?.tags || [];
    const newTags = currentTags.filter(t => t.id !== tagId);

    // Only update if something was actually removed
    if (newTags.length !== currentTags.length) {
        return item.update(/** @type {any} */ ({ system: { tags: newTags } }));
    }
    return item;
}

/**
 * Execute a Lancer stat roll (hull, agi, sys, eng, grit) via StatRollFlow.
 * @param {Actor} actor - The rolling actor.
 * @param {string} stat - Stat key: "hull", "agi", "sys", "eng", or "grit".
 * @param {string} title - Chat card title (defaults to "<STAT> Check" or "<STAT> Save").
 * @param {number|"token"|Token|TokenDocument} [target=10] - Difficulty value, "token" to let the user pick, or a Token/TokenDocument to auto-derive difficulty from.
 * @param {{ targetStat?: string, [key: string]: any }} [extraData={}] - Extra state passed to the flow. `targetStat` overrides which stat is read from a mech target.
 * @returns {Promise<{ completed: boolean, [key: string]: any }>}
 */
export async function executeStatRoll(actor, stat, title, target = 10, extraData = {}) {
    const StatRollFlow = game.lancer.flows.get("StatRollFlow");
    if (!StatRollFlow) {
        console.error("lancer-automations | StatRollFlow not found");
        return { completed: false };
    }

    const { targetStat, sendToOwner, cardTitle, cardDescription, ...restExtraData } = (extraData && typeof extraData === 'object') ? extraData : {};

    // Send the roll to the token owner's client via socket so they roll it themselves.
    if (sendToOwner) {
        const ownerToken = actor.token?.object ?? actor.getActiveTokens()?.[0];
        if (ownerToken) {
            const ownerIds = getTokenOwnerUserId(ownerToken);
            const firstOwner = Array.isArray(ownerIds) ? ownerIds[0] : ownerIds;
            const isLocal = firstOwner === game.user.id;

            if (!isLocal && firstOwner) {
                const requestId = foundry.utils.randomID();
                const targetVal = typeof target === 'object'
                    ? (target.actor?.system?.save ?? 10)
                    : (typeof target === 'number' ? target : 10);

                game.socket.emit('module.lancer-automations', {
                    action: 'statRollRequest',
                    payload: {
                        requestId,
                        actorUuid: actor.uuid,
                        stat,
                        title,
                        targetVal,
                        cardTitle: cardTitle || null,
                        cardDescription: cardDescription || null,
                        targetUserId: firstOwner
                    }
                });

                // Wait for the remote client to complete the roll and send back the result.
                const _pendingFlowWaits = /** @type {any} */ (game.modules.get('lancer-automations'))._pendingFlowWaits;
                return await new Promise(resolve => _pendingFlowWaits.set(requestId, resolve));
            }
            // If local owner, fall through to normal roll below.
        }
    }

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

    if (targetToken?.actor) {
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
    if (targetToken && typeof targetVal === 'number')
        rollTitle += ` (>= ${targetVal})`;

    const isNpcGrit = actor.type === "npc" && upperStat === "GRIT";
    const statPath = isNpcGrit ? "system.tier" : (STAT_PATHS[upperStat] || stat);

    const flowOptions = { path: statPath, title: rollTitle };
    const flow = new StatRollFlow(actor, flowOptions);
    flow.state.la_extraData = flow.state.la_extraData || {};

    if (targetToken) {
        flow.state.la_extraData.targetTokenId = targetToken.id;
        chooseTokenInFlow = false;
    }
    flow.state.la_extraData.targetVal = targetVal;
    flow.state.la_extraData.chooseToken = chooseTokenInFlow;

    if (restExtraData && typeof restExtraData === 'object') {
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, restExtraData);
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

export async function executeDamageRoll(attacker, targets, damageValue = null, damageType = null, title = "Damage Roll", options = {}, extraData = {}) {
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

    const typeMap = { kinetic: "Kinetic", energy: "Energy", explosive: "Explosive", burn: "Burn", heat: "Heat", infection: "Infection", variable: "Variable" };
    const resolvedType = damageType ? (typeMap[damageType.toLowerCase()] || "Kinetic") : "Kinetic";

    const flowData = {
        title: title,
        damage: damageValue != null ? [{ val: String(damageValue), type: resolvedType }] : [],
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
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
}

async function beginWeaponThrowFlow(weapon, options, extraData = {}) {
    const WeaponAttackFlow = game.lancer.flows.get("WeaponAttackFlow");
    if (!WeaponAttackFlow) {
        return { completed: false };
    }
    const flow = new WeaponAttackFlow(weapon, options);
    if (extraData && typeof extraData === 'object') {
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    }
    flow.state.la_extraData = flow.state.la_extraData || {};
    flow.state.la_extraData.is_throw = true;
    const completed = await flow.begin();
    return { completed, flow };
}


async function beginWeaponAttackFlow(weapon, options, extraData = {}) {
    const WeaponAttackFlow = game.lancer.flows.get("WeaponAttackFlow");
    if (!WeaponAttackFlow) {
        return { completed: false };
    }
    const flow = new WeaponAttackFlow(weapon, options);
    if (extraData && typeof extraData === 'object') {
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
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
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
}

export async function executeTechAttack(target, options = {}, extraData = {}) {
    const TechAttackFlow = game.lancer?.flows?.get("TechAttackFlow");
    if (!TechAttackFlow) {
        return { completed: false };
    }
    if (!target) {
        ui.notifications.error("lancer-automations | executeTechAttack: target (actor or item) is required.");
        return { completed: false };
    }
    const flow = new TechAttackFlow(target, options);
    if (extraData && typeof extraData === 'object') {
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
}

export async function executeReactorMeltdown(tokenOrActor, turns = null) {
    if (!tokenOrActor) {
        ui.notifications.error('lancer-automations | executeReactorMeltdown requires a token or actor.');
        return;
    }
    const actor = tokenOrActor.actor ?? tokenOrActor;

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
                        const turnValue = Number.parseInt($(this).data('turn'));
                        if (turnValue) {
                            resolve(turnValue);
                            dialog.close();
                        }
                    });
                }
            }, {
                classes: ["lancer-dialog-base", 'lancer-no-title'],
                width: 480,
                top: 450,
                left: 150
            });
            dialog.render(true);
        });
    }

    if (selectedTurns === null) {
        ui.notifications.info('Reactor Meltdown cancelled.');
        return;
    }

    await executeSimpleActivation(actor, {
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
    const gpW = Math.max(1, token.document.width);
    const gpH = Math.max(1, token.document.height);
    const tokenCenterX = token.document.x + (gpW * canvas.grid.size) / 2;
    const tokenCenterY = token.document.y + (gpH * canvas.grid.size) / 2;
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
        // @ts-ignore
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
            await canvas.scene.createEmbeddedDocuments("AmbientLight", /** @type {any[]} */ ([{
                x: tokenCenterX,
                y: tokenCenterY,
                config: {
                    color: "#ff9117",
                    dim: 10 * scaleFactor,
                    bright: 5 * scaleFactor,
                    animation: { type: "pulse" },
                },
            }]));
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
    const item = extraData?.item;
    const uuid = item?.uuid || actor.uuid;
    const flow = new SimpleActivationFlow(uuid, options);

    if (extraData && typeof extraData === 'object') {
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
}

// ---------------------------------------------------------------------------
// Add Reserve / Project / Organization to Pilot
// ---------------------------------------------------------------------------

function _resolvePilot(tokenOrActor) {
    const actor = tokenOrActor?.actor ?? tokenOrActor;
    if (!actor)
        return null;
    if (actor.type === 'pilot')
        return actor;
    if (actor.type === 'mech')
        return actor.system?.pilot?.value ?? null;
    return null;
}

const _ORG_TYPES = ['Military', 'Scientific', 'Academic', 'Criminal', 'Humanitarian', 'Industrial', 'Entertainment', 'Political'];
const _PROJECT_REQS = ['Quality materials', 'Specific knowledge or techniques', 'Specialized tools', 'A good workspace'];

async function _fetchReservesByType() {
    const map = { Bonus: [], Resources: [], Tactical: [], Mech: [] };
    const RESOURCE_NAMES = new Set([
        'Access', 'Backing', 'Supplies', 'Disguise', 'Diversion', 'Blackmail',
        'Reputation', 'Safe Harbor', 'Tracking', 'Knowledge', 'Golden Ticket',
        'Stash Of Private Moonshine', "Governor's Farm Advanced Access",
        "Fielding's Workshop Access", 'Patience Hookup', 'Causality Fragment',
    ]);
    const normalize = (t, name) => {
        if (!t)
            return null;
        if (t === 'Resource' || RESOURCE_NAMES.has(name))
            return 'Resources';
        return t;
    };
    for (const pack of game.packs) {
        if (pack.documentName !== 'Item')
            continue;
        const index = await pack.getIndex({ fields: ['system.lid', 'system.type', 'system.description', 'type'] });
        for (const e of index) {
            if (e.type !== 'reserve')
                continue;
            const rawType = e.system?.type;
            const t = normalize(rawType, e.name);
            if (t && map[t])
                map[t].push({ name: e.name, lid: e.system?.lid ?? '', desc: e.system?.description ?? '', uuid: e.uuid });
        }
    }
    for (const arr of Object.values(map)) {
        arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
}

export async function openAddReserveDialog(tokenOrActor) {
    const pilot = _resolvePilot(tokenOrActor);
    if (!pilot) {
        ui.notifications.warn('Select a pilot or mech token.'); return;
    }

    const reserveMap = await _fetchReservesByType();

    const TABS = [
        { key: 'bonus',    label: 'Pilot Bonuses' },
        { key: 'resource', label: 'Resource' },
        { key: 'tactical', label: 'Tactical' },
        { key: 'mech',     label: 'Mech' },
        { key: 'custom',   label: 'Custom' },
        { key: 'project',  label: 'Project' },
        { key: 'org',      label: 'Organization' },
    ];
    const tabNav = TABS.map((t, i) =>
        `<a class="la-rtab${i === 0 ? ' active' : ''}" data-tab="${t.key}" style="padding:4px 6px;font-size:0.78em;white-space:nowrap;cursor:pointer;text-align:center;border:1px solid #999;border-radius:3px;background:${i === 0 ? 'var(--primary-color)' : '#eee'};color:${i === 0 ? '#fff' : '#333'};user-select:none;">${t.label}</a>`
    ).join('');

    const buildList = (items) => items.map(r => {
        const shortDesc = r.desc.replace(/<[^>]+>/g, '').slice(0, 80);
        return `<div class="la-reserve-row" data-uuid="${r.uuid}" style="padding:5px 8px;border-bottom:1px solid rgba(0,0,0,0.08);cursor:pointer;display:flex !important;flex-direction:row !important;align-items:center;gap:6px;">
            <div style="flex:1;min-width:0;overflow:hidden;">
                <div style="font-weight:bold;font-size:0.88em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.name}</div>
                ${shortDesc ? `<div style="font-size:0.72em;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${shortDesc}</div>` : ''}
            </div>
            <a class="la-add-btn" data-uuid="${r.uuid}" style="flex-shrink:0;padding:2px 8px;font-size:0.78em;cursor:pointer;border:1px solid #999;border-radius:3px;background:#eee;color:#333;"><i class="fas fa-plus"></i></a>
        </div>`;
    }).join('') || '<div style="padding:20px;text-align:center;color:#888;">No items found.</div>';

    const orgOpts = _ORG_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
    const reqCbs = _PROJECT_REQS.map(r => `<label style="display:flex;align-items:center;gap:4px;font-size:0.82em;"><input type="checkbox" class="proj-req" value="${r}"> ${r}</label>`).join('');
    const subtypeBtns = ['Resources', 'Mech', 'Tactical'].map((t, i) => `<a class="la-subtype-btn${i === 0 ? ' active' : ''}" data-val="${t}" style="flex:1;padding:3px;font-size:0.8em;text-align:center;cursor:pointer;border:1px solid #999;border-radius:3px;background:${i === 0 ? 'var(--primary-color)' : '#eee'};color:${i === 0 ? '#fff' : '#333'};user-select:none;">${t}</a>`).join('');

    const BODY = `
        <div class="lancer-dialog-header" style="margin:-8px -8px 8px -8px;">
            <h1 class="lancer-dialog-title" style="font-size:1em;">Reserves & Bonuses</h1>
            <p class="lancer-dialog-subtitle" style="font-size:0.78em;">${pilot.name}</p>
        </div>
        <nav style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:6px;">${tabNav}</nav>
        <div style="height:340px;overflow-y:auto;" id="la-reserve-body">
            <div class="la-rtab-content" data-tab="bonus">${buildList(reserveMap.Bonus)}</div>
            <div class="la-rtab-content" data-tab="resource" style="display:none;">${buildList(reserveMap.Resources)}</div>
            <div class="la-rtab-content" data-tab="tactical" style="display:none;">${buildList(reserveMap.Tactical)}</div>
            <div class="la-rtab-content" data-tab="mech" style="display:none;">${buildList(reserveMap.Mech)}</div>
            <div class="la-rtab-content" data-tab="custom" style="display:none;">
                <div style="display:flex;gap:2px;margin-bottom:6px;">${subtypeBtns}</div>
                <div class="form-group"><label style="font-size:0.85em;">Resource Name</label><input type="text" id="cr-name" placeholder="Name"></div>
                <div class="form-group"><label style="font-size:0.85em;">Details</label><textarea id="cr-desc" rows="2" style="width:100%;" placeholder="Details"></textarea></div>
                <button type="button" id="cr-add" style="width:100%;margin-top:4px;"><i class="fas fa-plus"></i> Add Reserve</button>
            </div>
            <div class="la-rtab-content" data-tab="project" style="display:none;">
                <div class="form-group"><label style="font-size:0.85em;">Project Name</label><input type="text" id="pj-name" placeholder="Name"></div>
                <div class="form-group"><label style="font-size:0.85em;">Details</label><textarea id="pj-desc" rows="2" style="width:100%;" placeholder="Details"></textarea></div>
                <div style="display:flex;gap:10px;margin:4px 0;">
                    <label style="display:flex;align-items:center;gap:3px;font-size:0.82em;"><input type="checkbox" id="pj-complicated"> Complicated</label>
                    <label style="display:flex;align-items:center;gap:3px;font-size:0.82em;"><input type="checkbox" id="pj-finished"> Finished</label>
                </div>
                <div class="form-group"><label style="font-size:0.85em;">Requirements</label>${reqCbs}</div>
                <div class="form-group"><label style="font-size:0.85em;">Other</label><input type="text" id="pj-custom-req" placeholder="Custom requirement"></div>
                <button type="button" id="pj-add" style="width:100%;margin-top:4px;"><i class="fas fa-plus"></i> Add Project</button>
            </div>
            <div class="la-rtab-content" data-tab="org" style="display:none;">
                <div class="form-group"><label style="font-size:0.85em;">Name</label><input type="text" id="org-name" placeholder="Organization Name"></div>
                <div class="form-group"><label style="font-size:0.85em;">Type</label><select id="org-type">${orgOpts}</select></div>
                <div class="form-group"><label style="font-size:0.85em;">Description</label><textarea id="org-desc" rows="2" style="width:100%;" placeholder="Purpose / Goal"></textarea></div>
                <div class="form-group"><label style="font-size:0.85em;">Start with</label>
                    <div style="display:flex;gap:3px;">
                        <a class="la-org-start active" data-val="efficiency" style="flex:1;padding:4px;font-size:0.82em;text-align:center;cursor:pointer;border:1px solid #999;border-radius:3px;background:var(--primary-color);color:#fff;user-select:none;">Efficiency (+2)</a>
                        <a class="la-org-start" data-val="influence" style="flex:1;padding:4px;font-size:0.82em;text-align:center;cursor:pointer;border:1px solid #999;border-radius:3px;background:#eee;color:#333;user-select:none;">Influence (+2)</a>
                    </div>
                </div>
                <button type="button" id="org-add" style="width:100%;margin-top:4px;"><i class="fas fa-plus"></i> Add Organization</button>
            </div>
        </div>`;

    new Dialog({
        title: `Reserves — ${pilot.name}`,
        content: BODY,
        buttons: { close: { label: 'Close' } },
        render: (html) => {
            html.find('.la-rtab').on('click', function () {
                html.find('.la-rtab').removeClass('active').css({ background: '#eee', color: '#333' });
                $(this).addClass('active').css({ background: 'var(--primary-color)', color: '#fff' });
                html.find('.la-rtab-content').hide();
                html.find(`.la-rtab-content[data-tab="${$(this).data('tab')}"]`).show();
                html.find('#la-reserve-body').scrollTop(0);
            });
            html.find('.la-subtype-btn').on('click', function () {
                html.find('.la-subtype-btn').removeClass('active').css({ background: '#eee', color: '#333' });
                $(this).addClass('active').css({ background: 'var(--primary-color)', color: '#fff' });
            });
            html.find('.la-org-start').on('click', function () {
                html.find('.la-org-start').removeClass('active').css({ background: '#eee', color: '#333' });
                $(this).addClass('active').css({ background: 'var(--primary-color)', color: '#fff' });
            });

            // Add compendium reserve
            html.on('click', '.la-add-btn', async (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const uuid = $(ev.currentTarget).data('uuid');
                const doc = await fromUuid(uuid);
                if (!doc)
                    return;
                const data = doc.toObject(); delete data._id;
                await pilot.createEmbeddedDocuments('Item', [data]);
                ui.notifications.info(`Added "${doc.name}" to ${pilot.name}.`);
            });
            // Custom reserve
            html.find('#cr-add').on('click', async () => {
                const name = String(html.find('#cr-name').val()).trim();
                if (!name) {
                    ui.notifications.warn('Enter a name.'); return;
                }
                await pilot.createEmbeddedDocuments('Item', [{ name,
                    type: 'reserve',
                    img: 'systems/lancer/assets/icons/reserve_tac.svg',
                    system: { lid: 'reserve_custom', type: html.find('.la-subtype-btn.active').data('val') || 'Resources', description: String(html.find('#cr-desc').val()), consumable: true, used: false } }]);
                ui.notifications.info(`Added "${name}" to ${pilot.name}.`);
            });
            // Project
            html.find('#pj-add').on('click', async () => {
                const name = String(html.find('#pj-name').val()).trim();
                if (!name) {
                    ui.notifications.warn('Enter a name.'); return;
                }
                const finished = html.find('#pj-finished').is(':checked');
                const reqs = []; html.find('.proj-req:checked').each(function () {
                    reqs.push($(this).val());
                });
                const cr = String(html.find('#pj-custom-req').val()).trim(); if (cr)
                    reqs.push(cr);
                let desc = String(html.find('#pj-desc').val());
                if (html.find('#pj-complicated').is(':checked'))
                    desc += '\n<b>Complicated</b>';
                if (!finished && reqs.length)
                    desc += `\nRequires: ${reqs.join(', ')}`;
                await pilot.createEmbeddedDocuments('Item', [{ name: finished ? name : `${name} (In Progress)`,
                    type: 'reserve',
                    img: 'systems/lancer/assets/icons/reserve_tac.svg',
                    system: { lid: 'reserve_project', type: 'Project', label: 'Project', description: desc, consumable: false, used: false } }]);
                ui.notifications.info(`Added project "${name}" to ${pilot.name}.`);
            });
            // Organization
            html.find('#org-add').on('click', async () => {
                const name = String(html.find('#org-name').val()).trim();
                if (!name) {
                    ui.notifications.warn('Enter a name.'); return;
                }
                const s = html.find('.la-org-start.active').data('val') || 'efficiency';
                await pilot.createEmbeddedDocuments('Item', [{ name,
                    type: 'organization',
                    img: 'systems/lancer/assets/icons/encounter.svg',
                    system: { purpose: html.find('#org-type').val(), description: String(html.find('#org-desc').val()), efficiency: s === 'efficiency' ? 2 : 0, influence: s === 'influence' ? 2 : 0, actions: '' } }]);
                ui.notifications.info(`Added "${name}" to ${pilot.name}.`);
            });
        }
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 520, height: 520, resizable: false }).render(true);
}

// ---------------------------------------------------------------------------
// Shared item browser
// ---------------------------------------------------------------------------

let _sharedPackItemCache = null;

Hooks.on('lancer-automations.clearCaches', () => {
    _sharedPackItemCache = null;
});

async function _fetchPackItems() {
    if (_sharedPackItemCache)
        return _sharedPackItemCache;

    const items = [];
    for (const pack of game.packs) {
        if (pack.documentName !== "Item")
            continue;
        const index = await pack.getIndex({ fields: ["system.lid", "type", "system.actions", "system.ranks", "system.profiles", "system.trigger"] });
        for (const entry of index) {
            if (!entry.system?.lid)
                continue;
            let actionCount = 0;
            if (entry.type === "npc_feature") {
                if (entry.system?.trigger)
                    actionCount++;
                if (entry.system?.actions)
                    actionCount += entry.system.actions.length;
            } else {
                if (entry.system?.ranks)
                    entry.system.ranks.forEach(r => {
                        actionCount += (r.actions?.length || 0);
                    });
                if (entry.system?.profiles)
                    entry.system.profiles.forEach(p => {
                        actionCount += (p.actions?.length || 0);
                    });
                if (entry.system?.actions)
                    actionCount += entry.system.actions.length;
            }
            if (actionCount === 0)
                actionCount = 1;
            items.push({ name: entry.name, lid: entry.system.lid, type: entry.type, uuid: entry.uuid, actionCount });
        }
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    _sharedPackItemCache = items;
    return items;
}

/**
 * Open a shared item browser dialog.
 * Empty by default; debounced search; 50-result cap unless "Show all".
 * Right-click an entry to open its item sheet.
 * @returns {Promise<{lid: string, uuid: string}|null>}
 */
export async function openItemBrowserDialog() {
    const items = await _fetchPackItems();

    const sortedTypes = [...new Set(items.map(i => i.type))].sort();
    const typeOptions = sortedTypes.map(t =>
        `<option value="${t}">${game.i18n.localize(CONFIG.Item.typeLabels?.[t]) || t}</option>`
    ).join('');

    const MAX_RESULTS = 50;

    const buildItemHtml = (item) => {
        const countLabel = item.actionCount > 1
            ? `<span style="font-size:0.8em;opacity:0.7;font-weight:normal;">(${item.actionCount} actions)</span>`
            : '';
        return `<div class="lancer-item-card item-browser-entry" data-lid="${item.lid}" data-uuid="${item.uuid}" data-type="${item.type}" style="margin-bottom:6px;padding:10px;">
            <div class="lancer-item-icon"><i class="fas fa-cube"></i></div>
            <div class="lancer-item-content" style="flex:1;min-width:0;">
                <div class="lancer-item-name">${item.name} ${countLabel}</div>
                <div class="lancer-item-details">${item.type} | LID: ${item.lid}</div>
            </div>
            <a class="copy-lid-btn" title="Copy LID" style="color:var(--primary-color);cursor:pointer;font-size:1.1em;flex:0 0 auto;padding:0 4px;"><i class="fas fa-copy"></i></a>
        </div>`;
    };

    return new Promise((resolve) => {
        const dialog = new Dialog({
            title: "Find Item",
            content: `
                <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                    <h1 class="lancer-dialog-title">Find Item</h1>
                    <p class="lancer-dialog-subtitle">Search for an item by name or filter by category. Click <i class="fas fa-copy"></i> to copy LID.</p>
                </div>
                <div class="lancer-search-container" style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">
                    <div style="flex:2;position:relative;">
                        <i class="fas fa-search lancer-search-icon"></i>
                        <input type="text" id="item-search" placeholder="Search by name or LID..." style="padding-left:35px;">
                    </div>
                    <select id="type-filter" style="flex:1;">
                        <option value="">All Types</option>
                        ${typeOptions}
                    </select>
                    <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;font-size:0.85em;cursor:pointer;">
                        <input type="checkbox" id="show-all-items"> Show all
                    </label>
                </div>
                <div id="item-list" style="height:400px;overflow-y:auto;padding:4px;border:1px solid #ddd;background:#fafafa;border-radius:4px;">
                    <div style="padding:20px;text-align:center;color:#888;font-style:italic;">
                        <i class="fas fa-search" style="margin-right:6px;"></i>Type to search items…
                    </div>
                </div>
            `,
            buttons: {
                cancel: { label: '<i class="fas fa-times"></i> Cancel', callback: () => resolve(null) }
            },
            render: (html) => {
                const searchInput = html.find('#item-search');
                const typeFilter = html.find('#type-filter');
                const showAllCb = html.find('#show-all-items');
                const listContainer = html.find('#item-list');

                const updateList = () => {
                    const query = (String)(searchInput.val()).toLowerCase().trim();
                    const type = typeFilter.val();
                    const showAll = showAllCb.is(':checked');

                    if (!query && !showAll) {
                        listContainer.html(`<div style="padding:20px;text-align:center;color:#888;font-style:italic;"><i class="fas fa-search" style="margin-right:6px;"></i>Type to search items…</div>`);
                        return;
                    }

                    const matched = items.filter(item => {
                        if (type && item.type !== type)
                            return false;
                        if (!query)
                            return true;
                        return item.name.toLowerCase().includes(query) || item.lid.toLowerCase().includes(query);
                    });

                    if (matched.length === 0) {
                        listContainer.html(`<div style="padding:20px;text-align:center;color:#888;font-style:italic;">No items found.</div>`);
                        return;
                    }

                    const slice = showAll ? matched : matched.slice(0, MAX_RESULTS);
                    const more = matched.length - slice.length;
                    const moreHtml = more > 0
                        ? `<div style="padding:8px;text-align:center;color:#888;font-style:italic;font-size:0.85em;">${more} more — keep typing to narrow down.</div>`
                        : '';
                    listContainer.html(slice.map(buildItemHtml).join('') + moreHtml);
                };

                let _debounceTimer = null;
                const debouncedUpdate = () => {
                    clearTimeout(_debounceTimer);
                    _debounceTimer = setTimeout(updateList, 120);
                };

                searchInput.on('input', debouncedUpdate);
                typeFilter.on('change', updateList);
                showAllCb.on('change', updateList);

                listContainer.on('click', '.item-browser-entry', (ev) => {
                    const el = $(ev.currentTarget);
                    resolve({ lid: el.data('lid'), uuid: el.data('uuid') });
                    dialog.close();
                });

                listContainer.on('contextmenu', '.item-browser-entry', async (ev) => {
                    ev.preventDefault();
                    const uuid = $(ev.currentTarget).data('uuid');
                    if (uuid) {
                        const item = /** @type {Item} */ (await fromUuid(uuid));
                        if (item)
                            item.sheet.render(true);
                    }
                });

                listContainer.on('click', '.copy-lid-btn', async function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const lid = $(this).closest('.item-browser-entry').data('lid');
                    if (lid) {
                        await navigator.clipboard.writeText(lid);
                        ui.notifications.info(`Copied LID: ${lid}`);
                    }
                });

                searchInput.trigger('focus');
            },
            default: "cancel"
        }, {
            width: 500,
            classes: ["lancer-dialog-base", "lancer-item-browser-dialog", "lancer-no-title"]
        });
        dialog.render(true);
    });
}

/**
 * Update actor system data on a token, routing through the GM via socket if the current user is not the owner.
 * @param {Token} token
 * @param {object} data - Update data, e.g. { 'system.burn': 0 }
 * @returns {Promise<void>}
 */
export async function updateTokenSystem(token, data) {
    if (!token?.actor)
        return;
    if (token.actor.isOwner) {
        await token.actor.update(data);
    } else {
        game.socket.emit('module.lancer-automations', {
            action: 'updateActorSystem',
            payload: { actorId: token.actor.id, data }
        });
    }
}

/**
 * Executes a Skirmish action: target validation, weapon selection, and attack/damage flow.
 * @param {Actor|Token|TokenDocument} actorOrToken - The acting entity.
 * @param {any} [bypassMount=null] - Direct mount to use, skipping selection.
 * @param {Token|null} [preTarget=null] - Token to pre-target before each attack flow.
 * @returns {Promise<void>}
 */
export async function executeSkirmish(actorOrToken, bypassMount = null, preTarget = null, weaponFilter = null) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);

    if (!actor) {
        ui.notifications.error("lancer-automations | skirmish requires a token.");
        return;
    }

    let weapons;
    if (bypassMount) {
        weapons = (bypassMount.slots ?? [])
            .map(s => s.weapon?.value ?? (s.weapon?.id ? actor.items.get(s.weapon.id) : null))
            .filter(Boolean);
        if (!weapons.length)
            return;
    } else {
        // 2. Weapon Selection
        // Filter: 1 one/mount , no superheavy.
        // Display non-fitting weapons as unselectable.
        const filterPredicate = (w) => {
            const size = w.system?.size || w.system?.type || "";
            if (size.toLowerCase() === 'superheavy')
                return false;
            if (weaponFilter)
                return weaponFilter(w);
            return true;
        };

        const choices = await choseMount(actor, 1, filterPredicate, null, "SKIRMISH");
        if (!choices || choices.length === 0)
            return;

        const chosen = choices[0];
        if (chosen.slots) {
            weapons = chosen.slots
                .map(s => s.weapon?.value)
                .filter(Boolean);
        } else {
            weapons = [chosen];
        }
    }

    if (weapons.length === 1) {
        if (preTarget)
            game.user.updateTokenTargets([preTarget.id]);
        await beginWeaponAttackFlow(weapons[0]);
    } else {
        let primaryChosen = false;
        const choices = weapons.map(weapon => ({
            text: weapon.name,
            icon: weapon.img,
            callback: async () => {
                const extraData = {};
                if (primaryChosen) {
                    extraData._csmNoBonusDmg = { enabled: true };
                }
                primaryChosen = true;
                if (preTarget)
                    game.user.updateTokenTargets([preTarget.id]);
                await beginWeaponAttackFlow(weapon, {}, extraData);
            }
        }));

        await InteractiveAPI.startChoiceCard({
            title: "SKIRMISH WEAPON ORDER",
            description: "Select weapons in order. First is primary, others get no bonus damage.",
            mode: "and",
            choices
        });
    }
}

/**
 * Executes a Fight action for a pilot: choose one pilot weapon and attack.
 * @param {Actor|Token|TokenDocument} actorOrToken
 * @param {Item|null} bypassWeapon  Direct weapon item to attack with (skips selection dialog).
 * @returns {Promise<void>}
 */
export async function executeFight(actorOrToken, bypassWeapon = null) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor)
        return;
    let weapon = bypassWeapon;
    if (!weapon) {
        const choices = await choseMount(actor, 1, null, null, 'FIGHT');
        if (!choices?.length)
            return;
        const chosen = choices[0];
        weapon = chosen.slots
            ? chosen.slots.find(/** @type {any} */ s => s.weapon?.value)?.weapon?.value ?? null
            : chosen;
    }
    if (weapon)
        await beginWeaponAttackFlow(weapon);
}

/**
 * Executes a Barrage action: attacks with either two different mounts or one superheavy mount.
 * @param {Actor|Token|TokenDocument} actorOrToken - The acting entity.
 * @param {any} [bypassMount=null] - Direct mount(s) to use, skipping selection.
 * @param {Token|null} [preTarget=null] - Token to pre-target before each attack flow.
 * @returns {Promise<void>}
 */
export async function executeBarrage(actorOrToken, bypassMount = null, preTarget = null) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);

    if (!actor) {
        ui.notifications.error("lancer-automations | barrage requires a token.");
        return;
    }

    // Helper to check if a mount or weapon contains a Superheavy weapon
    const hasSuperheavy = (selectedItem) => {
        if (selectedItem?.slots) {
            return selectedItem.slots.some(s => {
                const w = s.weapon?.value;
                if (!w) {
                    return false;
                }
                const size = w.system?.size || w.system?.type || "";
                return size.toLowerCase() === 'superheavy';
            });
        }
        const size = selectedItem?.system?.size || selectedItem?.system?.type || "";
        return size.toLowerCase() === 'superheavy';
    };

    // 2. Weapon Selection Validator
    // 1 mount = valid if superheavy weapon equipped
    // 2 mounts = valid if both DO NOT have superheavy weapons (and they must be different mounts, which the interface enforces)
    const barrageValidator = (selected) => {
        if (selected.length === 0)
            return { valid: false, message: "Select 1 Superheavy mount or 2 different mounts.", level: "info" };

        if (selected.length === 1) {
            const isSH = hasSuperheavy(selected[0]);
            return isSH
                ? { valid: true, message: "Superheavy weapon selected.", level: "success" }
                : { valid: false, message: "Single mount must have a Superheavy weapon. Or select 2 mounts.", level: "error" };
        }

        if (selected.length === 2) {
            const anySH = selected.some(s => hasSuperheavy(s));
            return anySH
                ? { valid: false, message: "Cannot mix a Superheavy weapon with another mount.", level: "error" }
                : { valid: true, message: "2 mounts selected.", level: "success" };
        }

        return { valid: false, message: "Invalid selection.", level: "error" };
    };

    const choices = bypassMount
        ? [bypassMount]
        : await choseMount(actor, 2, null, null, "BARRAGE", barrageValidator);
    if (!choices || choices.length === 0)
        return;

    // Helper to fire all weapons on a single mount (AND card if multiple)
    const fireMountWeapons = async (mount) => {
        let weapons;
        if (mount.slots) {
            weapons = mount.slots
                .map(s => s.weapon?.value ?? (s.weapon?.id ? actor.items.get(s.weapon.id) : null))
                .filter(Boolean);
        } else {
            weapons = [mount];
        }

        const options = { half_damage: true };
        const extraData = { _csmNoBonusDmg: { enabled: true } };

        if (weapons.length === 1) {
            if (preTarget)
                game.user.updateTokenTargets([preTarget.id]);
            await beginWeaponAttackFlow(weapons[0], options, extraData);
        } else if (weapons.length > 1) {
            const choices = weapons.map(weapon => ({
                text: weapon.name,
                icon: weapon.img,
                callback: async () => {
                    if (preTarget)
                        game.user.updateTokenTargets([preTarget.id]);
                    await beginWeaponAttackFlow(weapon, options, extraData);
                }
            }));
            await InteractiveAPI.startChoiceCard({
                title: "WEAPON ORDER",
                description: `Firing weapons from ${mount.type || "Mount"}. All attacks receive half damage and no bonus damage.`,
                mode: "and",
                choices
            });
        }
    };

    if (choices.length === 1) {
        // Superheavy, just fire its weapons
        await fireMountWeapons(choices[0]);
    } else {
        // 2 mounts, create an AND card for mount order
        const mountChoices = choices.map((mount, index) => ({
            text: `Fire ${mount.name || mount.type || "Mount " + (index + 1)}`,
            icon: mount.slots?.[0]?.weapon?.value?.img || "icons/svg/item-bag.svg",
            callback: async () => {
                await fireMountWeapons(mount);
            }
        }));

        await InteractiveAPI.startChoiceCard({
            title: "BARRAGE MOUNT ORDER",
            description: "Select which mount to trigger. All attacks receive half damage and no bonus damage.",
            mode: "and",
            choices: mountChoices
        });
    }
}


// ---------------------------------------------------------------------------
// Weapon / Item utility functions (bonus-aware)
// ---------------------------------------------------------------------------

const REACH_RANGE_TYPES = new Set(["Range", "Threat", "Line", "Burst", "Cone"]);

/**
 * Returns the base { tags, range } for an item, handling mech_weapon profiles.
 * Both arrays are shallow-cloned so originals are never mutated.
 */
function _getItemBaseData(item) {
    let tags, range;
    if (item.type === "mech_weapon") {
        const profileIdx = item.system?.selected_profile_index ?? 0;
        const profile = item.system?.profiles?.[profileIdx];
        tags = profile?.all_tags ?? item.system?.tags ?? [];
        range = profile?.all_range ?? profile?.range ?? item.system?.range ?? [];
    } else {
        tags = item.system?.tags ?? [];
        range = item.system?.range ?? [];
    }
    return { tags: tags.map(t => ({ ...t })), range: range.map(r => ({ ...r })) };
}

/**
 * Resolves input (Actor | Token | Item | mixed array) to { weapons, actor }.
 */
function _resolveWeaponsAndActor(input) {
    const entries = Array.isArray(input) ? input.flat() : [input];
    const weapons = [];
    let actor = null;

    for (const entry of entries) {
        if (!entry) {
            continue;
        }
        if (entry.documentName === "Token" || entry.actor) {
            // Token
            const a = entry.actor;
            if (a) {
                actor = actor ?? a;
                weapons.push(..._getActorWeapons(a));
            }
        } else if (entry.documentName === "Actor" || entry.items) {
            // Actor
            actor = actor ?? entry;
            weapons.push(..._getActorWeapons(entry));
        } else if (entry.system) {
            // Item
            actor = actor ?? entry.parent ?? null;
            if (entry.type === "mech_weapon" || (entry.type === "npc_feature" && entry.system?.type === "Weapon")) {
                weapons.push(entry);
            }
        }
    }
    return { weapons, actor };
}

function _getActorWeapons(actor) {
    return (actor?.items ?? []).filter(i =>
        i.type === "mech_weapon" ||
        i.type === "pilot_weapon" ||
        (i.type === "npc_feature" && i.system?.type === "Weapon")
    );
}

/**
 * Applies tag and range bonuses from actor onto the given tags/range arrays (mutates in-place).
 */
function _applyItemBonuses(item, actor, tags, range) {
    if (!actor) {
        return;
    }
    const bonuses = flattenBonuses([
        ...(actor.getFlag("lancer-automations", "global_bonuses") || []),
        ...(actor.getFlag("lancer-automations", "constant_bonuses") || [])
    ]);
    const flowTags = new Set(["all", "attack"]);
    const state = { actor, item, data: { tags, range } };
    for (const bonus of bonuses) {
        if (!isBonusApplicable(bonus, flowTags, state)) {
            continue;
        }
        if (bonus.type === "tag") {
            applyTagBonus(state, bonus);
        }
        if (bonus.type === "range") {
            mutateRangeWithBonus(state, bonus);
        }
    }
}

/**
 * Returns the weapon's profiles with fully merged range:
 * native Lancer bonuses (all_range) + LA actor range bonuses.
 * Each returned profile is a shallow copy with `range` replaced by the merged array.
 * Falls back gracefully for pilot weapons and items without profiles.
 * @param {Item} weapon
 * @param {Actor} [actor] - Defaults to weapon.parent
 * @returns {Array}
 */
export function getWeaponProfiles_WithBonus(weapon, actor) {
    if (!weapon?.system)
        return [];
    const a = actor ?? weapon.parent ?? null;
    const rawProfiles = weapon.system.profiles;

    if (rawProfiles?.length > 0) {
        return rawProfiles.map(p => {
            const base = (p.all_range ?? p.range ?? []).map(r => ({ ...r }));
            const base_range = (p.range ?? []).map(r => ({ ...r })); // true original, no bonuses
            const tags = (p.all_tags ?? p.tags ?? []).map(t => ({ ...t }));
            const mockState = { actor: a, item: weapon, data: { tags, range: base } };
            const bonuses = flattenBonuses([
                ...(a?.getFlag("lancer-automations", "global_bonuses") || []),
                ...(a?.getFlag("lancer-automations", "constant_bonuses") || [])
            ]);
            const flowTags = new Set(["all", "attack"]);
            for (const bonus of bonuses) {
                if (bonus.type === 'range' && isBonusApplicable(bonus, flowTags, mockState))
                    mutateRangeWithBonus(mockState, bonus);
            }
            return { ...p, range: base, all_range: base, base_range };
        });
    }

    // Pilot weapon / simple item: single synthetic profile
    const base = (weapon.system.range ?? []).map(r => ({ ...r }));
    const base_range = base.map(r => ({ ...r })); // snapshot before LA bonuses
    const tags = (weapon.system.tags ?? []).map(t => ({ ...t }));
    const mockState = { actor: a, item: weapon, data: { tags, range: base } };
    const bonuses = flattenBonuses([
        ...(a?.getFlag("lancer-automations", "global_bonuses") || []),
        ...(a?.getFlag("lancer-automations", "constant_bonuses") || [])
    ]);
    const flowTags = new Set(["all", "attack"]);
    for (const bonus of bonuses) {
        if (bonus.type === 'range' && isBonusApplicable(bonus, flowTags, mockState))
            mutateRangeWithBonus(mockState, bonus);
    }
    // NPC features store damage/attack_bonus/accuracy as tier arrays — resolve to current tier
    let damage = weapon.system.damage;
    let attack_bonus = weapon.system.attack_bonus;
    let accuracy = weapon.system.accuracy;
    if (weapon.type === 'npc_feature') {
        const tierOverride = weapon.system.tier_override ?? 0;
        const tier = tierOverride > 0 ? tierOverride : (a?.system?.tier ?? 1);
        const tierIdx = Math.max(0, Math.min(2, tier - 1));
        if (Array.isArray(damage?.[0]))
            damage = damage[tierIdx] ?? [];
        if (Array.isArray(attack_bonus))
            attack_bonus = attack_bonus[tierIdx] ?? 0;
        if (Array.isArray(accuracy))
            accuracy = accuracy[tierIdx] ?? 0;
    }
    return [{ ...weapon.system, damage, attack_bonus, accuracy, range: base, base_range }];
}

/**
 * Returns the effective tag list for a single item, with actor bonuses applied.
 * @param {Item} item
 * @param {Actor} [actor] - Defaults to item.parent
 * @returns {Promise<Array>}
 */
export async function getItemTags_WithBonus(item, actor) {
    if (!item) {
        return [];
    }
    const a = actor ?? item.parent ?? null;
    const { tags, range } = _getItemBaseData(item);
    await _applyItemBonuses(item, a, tags, range);
    return tags;
}

/**
 * Returns the maximum range value per range type across all weapons of the input.
 * @param {Actor|Token|Item|Array} input
 * @returns {Object} e.g. { Range: 25, Burst: 3 }
 */
export function getMaxWeaponRanges_WithBonus(input) {
    const { weapons, actor } = _resolveWeaponsAndActor(input);
    const maxPerType = {};
    for (const weapon of weapons) {
        const { tags, range } = _getItemBaseData(weapon);
        _applyItemBonuses(weapon, actor, tags, range);
        for (const r of range) {
            const val = Number.parseInt(r.val) || 0;
            if (maxPerType[r.type] === undefined || val > maxPerType[r.type]) {
                maxPerType[r.type] = val;
            }
        }
    }
    return maxPerType;
}

/**
 * Returns the maximum threat range for an actor, accounting for active bonuses.
 * @param {Actor} actor
 * @returns {number}
 */
export function getActorMaxThreat(actor) {
    if (!actor)
        return 0;
    const ranges = getMaxWeaponRanges_WithBonus(actor);
    return ranges.Threat || 1;
}

/**
 * Returns the single maximum reach across all weapons of the input.
 * Counts Range, Threat, Line, Burst, Cone (not Blast). Also checks tg_thrown tag.
 * @param {Actor|Token|Item|Array} input
 * @returns {Promise<number>}
 */
export async function getMaxWeaponReach_WithBonus(input) {
    const { weapons, actor } = _resolveWeaponsAndActor(input);
    let max = 0;
    for (const weapon of weapons) {
        const { tags, range } = _getItemBaseData(weapon);
        await _applyItemBonuses(weapon, actor, tags, range);
        for (const r of range) {
            if (REACH_RANGE_TYPES.has(r.type)) {
                const val = Number.parseInt(r.val) || 0;
                if (val > max) {
                    max = val;
                }
            }
        }
        // Check throw tag
        const thrownTag = tags.find(t => t.lid === "tg_thrown" || t.id === "tg_thrown");
        if (thrownTag) {
            const throwVal = Number.parseInt(thrownTag.val || thrownTag.num_val) || 0;
            if (throwVal > max) {
                max = throwVal;
            }
        }
    }
    return max;
}

/**
 * Returns the maximum range value per range type for any item.
 * Covers: item.system.range, per-action ranges, tg_thrown tag ("Thrown"), and deployRange flag ("Deploy").
 * Actor bonuses are applied when an actor is available.
 * @param {Item} item
 * @param {Actor} [actor] - Defaults to item.parent.
 * @returns {Promise<Object>} e.g. { Range: 5, Cone: 5, Thrown: 3, Deploy: 3 }
 */
export async function getMaxItemRanges_WithBonus(item, actor) {
    if (!item)
        return {};
    const a = actor ?? item.parent ?? null;

    // Base range + tags (handles mech_weapon profiles)
    const { tags, range: baseRange } = _getItemBaseData(item);

    // Ranges from each action
    const actionRanges = (item.system?.actions ?? []).flatMap(action => (action.range ?? []).map(r => ({ ...r })));

    const allRanges = [...baseRange, ...actionRanges];

    // Apply actor bonuses
    await _applyItemBonuses(item, a, tags, allRanges);

    // tg_thrown tag → "Thrown" range type
    const thrownTag = tags.find(t => t.lid === "tg_thrown" || t.id === "tg_thrown");
    if (thrownTag) {
        const throwVal = Number.parseInt(thrownTag.val || thrownTag.num_val) || 0;
        if (throwVal > 0)
            allRanges.push({ type: "Thrown", val: throwVal });
    }

    // deployRange flag → "Deploy" range type
    const deployRange = item.getFlag?.("lancer-automations", "deployRange");
    if (deployRange)
        allRanges.push({ type: "Deploy", val: deployRange });

    // Compute max per type
    const maxPerType = {};
    for (const r of allRanges) {
        const val = Number.parseInt(r.val) || 0;
        if (val > 0 && (maxPerType[r.type] === undefined || val > maxPerType[r.type]))
            maxPerType[r.type] = val;
    }
    return maxPerType;
}

/**
 * Returns the weapon subtype string (e.g. "Superheavy Rifle", "Melee").
 * Synchronous — no bonus application.
 * @param {Item} item
 * @returns {string}
 */
export function getWeaponType(item) {
    if (!item) {
        return "";
    }
    if (item.type === "mech_weapon") {
        const profileIdx = item.system?.selected_profile_index ?? 0;
        return item.system?.profiles?.[profileIdx]?.weapon_type ?? item.system?.weapon_type ?? "";
    }
    return item.system?.weapon_type ?? "";
}

/**
 * Returns the Lancer item type string (e.g. "Weapon", "System", "mech_weapon").
 * Prefers item.system.type (Lancer type) over item.type (Foundry type).
 * Synchronous — no bonus application.
 * @param {Item} item
 * @returns {string}
 */
export function getItemType(item) {
    if (!item) {
        return "";
    }
    return item.system?.type || item.type || "";
}

export async function executeInvade(actorOrToken) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor) {
        ui.notifications.error("lancer-automations | executeInvade requires a token or actor.");
        return;
    }

    const selected = await chooseInvade(actor);
    if (!selected)
        return;

    if (selected.isFragmentSignal) {
        await executeTechAttack(actor, {
            title: "Fragment Signal",
            invade: true,
            effect: selected.detail,
            grit: actor.system.tech_attack,
            attack_type: "Tech"
        });
    } else {
        await executeTechAttack(selected.item, {
            title: selected.name,
            invade: true,
            attack_type: "Tech",
            action: selected.action,
            effect: selected.detail,
            tags: selected.tags
        });
    }
}

/**
 * Returns the icon for a Lancer activation. Accepts an action object or a plain activation string.
 * When the action has tech_attack:true, uses tech_quick/tech_full SVGs instead of hex icons.
 * @param {Object|string} actionOrActivation
 * @returns {string|null}
 */
export function getActivationIcon(actionOrActivation) {
    const isTech = actionOrActivation?.tech_attack === true;
    const activation = typeof actionOrActivation === 'string' ? actionOrActivation : (actionOrActivation?.activation || '');
    const a = activation.toLowerCase();
    if (isTech || a.includes('tech')) {
        if (a.includes('full'))
            return 'systems/lancer/assets/icons/tech_full.svg';
        return 'systems/lancer/assets/icons/tech_quick.svg';
    }
    if (a.includes('full'))
        return 'mdi mdi-hexagon-slice-6';
    if (a.includes('protocol'))
        return 'systems/lancer/assets/icons/protocol.svg';
    if (a.includes('free'))
        return 'systems/lancer/assets/icons/free_action.svg';
    if (a.includes('reaction'))
        return 'systems/lancer/assets/icons/reaction.svg';
    if (a.includes('quick'))
        return 'mdi mdi-hexagon-slice-3';
    if (a.includes('invade'))
        return 'modules/lancer-automations/icons/cpu-shot.svg';
    return null;
}

export const MiscAPI = {
    executeStatRoll,
    executeDamageRoll,
    executeBasicAttack,
    executeTechAttack,
    executeSimpleActivation,
    executeReactorMeltdown,
    executeReactorExplosion,
    setReaction,
    setItemResource,
    addItemTag,
    removeItemTag,
    findItemByLid,
    updateTokenSystem,
    getItemTags_WithBonus,
    getActorMaxThreat,
    getMaxWeaponRanges_WithBonus,
    getMaxWeaponReach_WithBonus,
    getMaxItemRanges_WithBonus,
    getWeaponProfiles_WithBonus,
    getWeaponType,
    getItemType,
    executeSkirmish,
    executeBarrage,
    executeInvade,
    beginWeaponThrowFlow,
    beginWeaponAttackFlow,
    getActivationIcon,
    executeFall,
    executeStandingUp,
    executeTeleport,
    openAddReserveDialog,
};
