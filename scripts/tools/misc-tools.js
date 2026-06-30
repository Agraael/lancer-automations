import { removeEffectsByNameFromTokens, applyEffectsToTokens, findEffectOnToken } from "../bonuses/flagged-effects.js";
import { getMaxGroundHeightUnderToken } from "../combat/terrain-utils.js";
import { chooseToken, choseMount, chooseInvade, InteractiveAPI, getTokenOwnerUserId, startWaitCard } from "../interactive/index.js";
import { flattenBonuses, isBonusApplicable, applyTagBonus, mutateRangeWithBonus } from "../bonuses/genericBonuses.js";
import { getItemActions } from "../interactive/deployables.js";
import { playSkirmishFX, playBarrageFX, playFightFX, playStandingUpFX, playTeleportFX, playSelfDestructFX, playContestedOutcomeFX } from "../fx/actionFX.js";
import { awaitPendingAck } from "../socket.js";
import { executeStandingUp, executeTeleport, executeFall } from "./movement-tools.js";
import { openAddReserveDialog } from "./pilot-reserves.js";
import {
    getWeaponProfiles_WithBonus, getItemTags_WithBonus,
    getMaxWeaponRanges_WithBonus, getActorMaxThreat,
    getMaxWeaponReach_WithBonus, getMaxItemRanges_WithBonus
} from "./weapon-bonus-utils.js";
export { executeStandingUp, executeTeleport, executeFall } from "./movement-tools.js";
export { openAddReserveDialog } from "./pilot-reserves.js";
export { openItemBrowserDialog } from "./item-browser.js";
export {
    getWeaponProfiles_WithBonus, getItemTags_WithBonus,
    getMaxWeaponRanges_WithBonus, getActorMaxThreat,
    getMaxWeaponReach_WithBonus, getMaxItemRanges_WithBonus
} from "./weapon-bonus-utils.js";

/** Maps activation type strings to the NPC feature tag LID that signals that activation. */
export const ACTIVATION_TAG_MAP = {
    'Quick':      'tg_quick_action',
    'Full':       'tg_full_action',
    'Quick Tech': 'tg_quick_tech',
    'Full Tech':  'tg_full_tech',
    'Protocol':   'tg_protocol',
    'Reaction':   'tg_reaction',
    'Free':       'tg_free_action',
    'Deactivate': 'tg_deactivate',
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
/** @returns {{color: string, label: string} | null} */
export function getTokenDispositionInfo(token) {
    if (!token?.document)
        return null;
    const disp = token.document.disposition;
    const dispMap = {
        [CONST.TOKEN_DISPOSITIONS.HOSTILE]:  { color: '#e53935', label: 'Hostile' },
        [CONST.TOKEN_DISPOSITIONS.NEUTRAL]:  { color: '#f9a825', label: 'Neutral' },
        [CONST.TOKEN_DISPOSITIONS.FRIENDLY]: { color: '#43a047', label: 'Friendly' },
        [CONST.TOKEN_DISPOSITIONS.SECRET]:   { color: '#7e57c2', label: 'Secret' },
    };
    const fallback = dispMap[disp] ?? { color: '#888', label: 'Unknown' };
    let color = fallback.color;
    let label = fallback.label;
    try {
        const tf = game.modules.get('token-factions');
        if (tf?.active) {
            let tfColor = /** @type {any} */ (tf).api?.getFactionColor?.(token.id)?.INT_S;
            if (!tfColor) {
                const helper = /** @type {any} */ (globalThis).__tokenFactionsHelpers?.colorBorderFaction;
                tfColor = helper?.(token)?.INT_S;
            }
            if (tfColor)
                color = tfColor;
            if (game.settings.get('token-factions', 'color-from') === 'advanced-factions') {
                const teamId = token.document.getFlag?.('token-factions', 'team')
                    || token.actor?.prototypeToken?.flags?.['token-factions']?.team;
                if (teamId) {
                    const teams = game.settings.get('token-factions', 'team-setup') || [];
                    const team = teams.find(/** @type {any} */ t => t.id === teamId);
                    if (team)
                        label = team.name;
                }
            }
        }
    } catch { /* ignore */ }
    return { color, label };
}

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
                        trigger: item.system?.trigger ?? '',
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

        if (actor?.type === 'pilot') {
            for (const item of (actor.items ?? [])) {
                if (item.type === 'pilot_gear' || item.type === 'pilot_armor' || item.type === 'pilot_weapon') {
                    for (const action of getItemActions(item)) {
                        if (action.activation === activationType)
                            results.push({ action, sourceItem: item });
                    }
                }
            }
        } else {
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
    const tokenId = tokenOrActor?.id && tokenOrActor !== actor ? tokenOrActor.id : actor?.token?.id;
    const combat = game.combat;
    const inCombat = !!combat?.started && combat.combatants.some(c =>
        (tokenId && c.tokenId === tokenId) || (actor && c.actor?.id === actor.id)
    );
    if (!inCombat)
        return true;
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

/** Mirrors Lancer's modAction cascade. spend=true consumes, spend=false refunds. */
export async function modifyAction(actorOrToken, kind, spend = true) {
    const actor = actorOrToken?.actor ?? actorOrToken;
    if (!actor)
        return;
    const at = /** @type {any} */ ({ ...(actor.system?.action_tracker ?? {}) });
    switch (kind) {
    case 'free':
        at.free = !spend;
        break;
    case 'quick':
        if (spend) {
            if (at.full)
                at.full = false;
            else
                at.quick = false;
        } else {
            at.quick = true;
        }
        break;
    case 'full':
        if (spend) {
            at.full = false;
            at.quick = false;
        } else {
            at.full = true;
        }
        break;
    case 'protocol':
        at.protocol = !spend;
        break;
    case 'reaction':
        at.reaction = !spend;
        break;
    case 'move':
        at.move = spend ? 0 : (actor.system?.speed ?? 0);
        break;
    default:
        at[kind] = !spend;
    }
    if (spend && kind !== 'protocol')
        at.protocol = false;
    await actor.update(/** @type {any} */ ({ 'system.action_tracker': at }));
}

export async function consumeAction(actorOrToken, kind) {
    return modifyAction(actorOrToken, kind, true);
}
export async function gainAction(actorOrToken, kind)    {
    return modifyAction(actorOrToken, kind, false);
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
                        targetUserId: firstOwner,
                        extraData: restExtraData ?? {}
                    }
                });

                const ownerName = game.users.get(firstOwner)?.name ?? 'player';
                const waitCard = startWaitCard({
                    title: cardTitle || title || 'STAT ROLL',
                    description: cardDescription || `<b>${actor.name ?? 'Actor'}</b> :: ${stat.toUpperCase()}`,
                    waitMessage: `Waiting for ${ownerName} to roll…`,
                    relatedToken: ownerToken
                });

                try {
                    return await awaitPendingAck(requestId);
                } finally {
                    waitCard.remove();
                }
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

/**
 * Run a contested stat check between two actors/tokens. Each rolls their own stat
 * (with FX suppressed during the rolls); higher total wins. The winner gets the success
 * overlay on its token, the loser gets the failure overlay. On a tie, no FX play and
 * `winner === null`.
 *
 * @param {any} input1     Actor or Token (passing a Token preserves the involved token for FX)
 * @param {string} stat1   Stat key for input1 (e.g. "HULL", "AGI", "SYS", "ENG", "GRIT")
 * @param {any} input2     Actor or Token
 * @param {string} stat2   Stat key for input2
 * @param {Object} [options]
 * @param {string} [options.title="Contested Check"] Title shown on each roll
 * @param {boolean} [options.sendToOwner=false]      Route each roll to the actor's owning player
 * @returns {Promise<any>}
 */
export async function executeContestedCheck(input1, stat1, input2, stat2, options = {}) {
    const resolve = (input) => {
        if (!input)
            return { actor: null, token: null };
        if (input.actor)
            return { actor: input.actor, token: input.object ?? input };
        return { actor: input, token: null };
    };
    const { actor: actor1, token: token1 } = resolve(input1);
    const { actor: actor2, token: token2 } = resolve(input2);

    const { title = "Contested Check", sendToOwner = false } = options;
    const extra = { suppressStatFX: true, sendToOwner };
    const statLabel1 = stat1.toUpperCase();
    const statLabel2 = stat2.toUpperCase();
    const actorName1 = actor1?.name ?? "?";
    const actorName2 = actor2?.name ?? "?";
    const [rollResult1, rollResult2] = await Promise.all([
        executeStatRoll(actor1, stat1, `${statLabel1} vs ${actorName2} ${statLabel2}`, 0, { ...extra, cardTitle: title, cardDescription: `${actorName1} :: ${statLabel1}` }),
        executeStatRoll(actor2, stat2, `${statLabel2} vs ${actorName1} ${statLabel1}`, 0, { ...extra, cardTitle: title, cardDescription: `${actorName2} :: ${statLabel2}` })
    ]);

    if (!rollResult1?.completed || !rollResult2?.completed) {
        return {
            completed: false,
            winner: null,
            loser: null,
            tie: false,
            results: [
                { actor: actor1, stat: stat1, total: rollResult1?.total ?? null, roll: rollResult1?.roll ?? null },
                { actor: actor2, stat: stat2, total: rollResult2?.total ?? null, roll: rollResult2?.roll ?? null }
            ]
        };
    }

    const total1 = rollResult1.total ?? -Infinity;
    const total2 = rollResult2.total ?? -Infinity;
    const tie = total1 === total2;
    const oneWins = total1 > total2;
    const winner = tie ? null : (oneWins ? actor1 : actor2);
    const loser = tie ? null : (oneWins ? actor2 : actor1);
    const winnerToken = tie ? null : (oneWins ? token1 : token2);
    const loserToken = tie ? null : (oneWins ? token2 : token1);

    if (winner && loser)
        await playContestedOutcomeFX(winnerToken, loserToken).catch(e => console.error('lancer-automations | contested FX failed:', e));

    const row = (label, name, stat, total, isWin) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;${isWin ? 'background:rgba(58,158,110,0.18);border-left:3px solid #3a9e6e;' : isWin === false ? 'background:rgba(204,51,51,0.14);border-left:3px solid #c33;' : ''}">
            <span><b>${label}</b> ${name} <span style="opacity:0.6;">(${stat.toUpperCase()})</span></span>
            <span style="font-variant-numeric:tabular-nums;font-weight:700;">${total}</span>
        </div>`;
    const body = tie
        ? `<div style="text-align:center;padding:8px 0;font-style:italic;font-weight:700;">TIE - ${total1}</div>` +
          row('', actorName1, stat1, rollResult1.total, null) + row('', actorName2, stat2, rollResult2.total, null)
        : row('WIN', winner === actor1 ? actorName1 : actorName2, oneWins ? stat1 : stat2, oneWins ? rollResult1.total : rollResult2.total, true) +
          row('LOSS', loser === actor1 ? actorName1 : actorName2, oneWins ? stat2 : stat1, oneWins ? rollResult2.total : rollResult1.total, false);
    ChatMessage.create({
        content: `<div class="card clipped-bot" style="margin:0;">
            <div class="lancer-header lancer-primary">// CONTEST :: ${title} //</div>
            <div style="display:flex;flex-direction:column;gap:2px;padding:4px;">${body}</div>
        </div>`
    });

    return {
        completed: true,
        winner,
        loser,
        winnerToken,
        loserToken,
        tie,
        results: [
            { actor: actor1, stat: stat1, total: rollResult1.total, roll: rollResult1.roll },
            { actor: actor2, stat: stat2, total: rollResult2.total, roll: rollResult2.roll }
        ]
    };
}

/** @returns {Promise<{completed: boolean, flow?: object}>} */
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

/** @returns {Promise<{completed: boolean, flow?: object}>} */
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


/** @returns {Promise<{completed: boolean, flow?: object}>} */
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




/** @returns {Promise<{completed: boolean, flow?: object}>} */
export async function executeBasicAttack(actor, options = {}, extraData = {}) {
    const BasicAttackFlow = game.lancer.flows.get("BasicAttackFlow");
    if (!BasicAttackFlow) {
        return { completed: false };
    }
    const { tags, ...flowOptions } = options;
    const flow = new BasicAttackFlow(actor.uuid, flowOptions);
    if (Array.isArray(tags) && tags.length > 0) {
        flow.state.data = flow.state.data || {};
        const normalized = tags.map(t => ({
            id: t.id ?? t.lid ?? '',
            lid: t.lid ?? t.id ?? '',
            val: t.val !== undefined ? String(t.val) : '',
            name: t.name ?? (t.lid ? t.lid.replace(/^tg_/, '').toUpperCase() : ''),
            description: t.description ?? ''
        }));
        flow.state.data.tags = [...(flow.state.data.tags || []), ...normalized];
        flow.state.la_extraData = flow.state.la_extraData || {};
        flow.state.la_extraData.injectedTags = normalized;
    }
    if (extraData && typeof extraData === 'object') {
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
}

/** @returns {Promise<{completed: boolean, flow?: object}>} */
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

/** @returns {Promise<void>} */
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

    const sourceToken = /** @type {Token|null} */ (
        (/** @type {any} */ (tokenOrActor))?.actor
            ? tokenOrActor
            : actor.token?.object || actor.getActiveTokens()[0] || null
    );
    if (sourceToken) {
        playSelfDestructFX(sourceToken);
    }

    await executeSimpleActivation(actor, {
        title: "Reactor Meltdown",
        action: { name: "Reactor Meltdown", activation: "Quick" },
        detail: `Reactor meltdown initiated. Explosion will occur at the end of turn ${selectedTurns}. Your mech will be annihilated, dealing 4d6 Explosive Damage in a Burst 2 radius.`
    }, { selectedTurns });
}

/** @returns {Promise<void>} */
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
        .zIndex(1)
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

/** @returns {Promise<{completed: boolean, flow?: object}>} */
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

/**
 * Run an item activation flow, matching the dispatch rules of triggerData.startRelatedFlow.
 * @param {any} item      - LancerItem to activate.
 * @param {Object} [options] - { path?: string, flowName?: string } — `path` sets action_path; `flowName` forces a specific flow class.
 * @param {Object} [extraData] - Merged onto flow.state.la_extraData before begin().
 * @returns {Promise<{completed: boolean, flow?: any}>}
 */
export async function executeItemActivation(item, options = {}, extraData = {}) {
    if (!item) {
        ui.notifications.error("lancer-automations | executeActivation requires an item.");
        return { completed: false };
    }
    const flows = /** @type {any} */ (game.lancer)?.flows;
    if (!flows)
        return { completed: false };

    const { path = null, flowName = null } = options;
    let flow;
    if (flowName) {
        const FlowClass = flows.get(flowName);
        if (!FlowClass) {
            ui.notifications.error(`lancer-automations | flow "${flowName}" not found.`);
            return { completed: false };
        }
        flow = new FlowClass(item.uuid ?? item, path ? { action_path: path } : {});
    } else if (item.is_frame?.() && path === "system.core_system") {
        flow = new (flows.get("CoreActiveFlow"))(item.uuid ?? item, { action_path: path });
    } else if (path || item.system?.actions?.length > 0) {
        flow = new (flows.get("ActivationFlow"))(item.uuid ?? item, { action_path: path ?? "system.actions.0" });
    } else if (item.is_mech_system?.() || item.is_weapon_mod?.() || (item.is_npc_feature?.() && !item.is_weapon?.())) {
        flow = new (flows.get("SystemFlow"))(item.uuid ?? item, {});
    } else if (item.is_weapon?.()) {
        flow = new (flows.get("WeaponAttackFlow"))(item.uuid ?? item, {});
    } else {
        ui.notifications.error("lancer-automations | executeActivation: cannot determine flow for item.");
        return { completed: false };
    }
    if (extraData && typeof extraData === 'object') {
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    }
    const completed = await flow.begin();
    return { completed, flow };
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
export async function executeSkirmish(actorOrToken, bypassMount = null, preTarget = null, weaponFilter = null, opts = {}) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);

    if (!actor) {
        ui.notifications.error("lancer-automations | skirmish requires a token.");
        return;
    }

    const sourceToken = /** @type {Token|null} */ (
        (/** @type {any} */ (actorOrToken))?.actor
            ? actorOrToken
            : actor.token?.object || actor.getActiveTokens()[0] || null
    );
    if (sourceToken && !opts.noFX) {
        await playSkirmishFX(sourceToken);
    }

    let weapons;
    if (bypassMount) {
        weapons = (bypassMount.slots ?? [])
            .map(slot => slot.weapon?.value ?? (slot.weapon?.id ? actor.items.get(slot.weapon.id) : null))
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

        const chosenMount = choices[0];
        if (chosenMount.slots) {
            weapons = chosenMount.slots
                .map(slot => slot.weapon?.value)
                .filter(Boolean);
        } else {
            weapons = [chosenMount];
        }
    }

    await consumeAction(actor, 'quick');

    // Bonus damage: on X/Aux (any non-Aux + Aux), the non-Aux is primary, Aux loses bonus.
    // On Aux/Aux, the first fired is primary, others lose bonus.
    const isAuxSize = (w) => String(w.system?.size || "").toLowerCase() === 'auxiliary';
    const hasNonAux = weapons.some(w => !isAuxSize(w));
    let auxPrimaryUsed = false;

    const fireWeapon = async (weapon) => {
        if (preTarget)
            /** @type {any} */ (canvas.tokens).setTargets([preTarget.id]);
        let suppressBonus;
        if (hasNonAux) {
            suppressBonus = isAuxSize(weapon);
        } else {
            suppressBonus = auxPrimaryUsed;
            auxPrimaryUsed = true;
        }
        const extraData = suppressBonus ? { _csmNoBonusDmg: { enabled: true } } : {};
        await beginWeaponAttackFlow(weapon, {}, extraData);
    };

    if (weapons.length === 1) {
        await fireWeapon(weapons[0]);
    } else {
        const choices = weapons.map(weapon => ({
            text: weapon.name,
            icon: weapon.img,
            callback: async () => fireWeapon(weapon)
        }));

        await InteractiveAPI.startChoiceCard({
            title: "SKIRMISH WEAPON ORDER",
            description: hasNonAux
                ? "Aux weapons don't deal bonus damage."
                : "First weapon fired deals bonus damage; others don't.",
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
    const sourceToken = /** @type {Token|null} */ (
        (/** @type {any} */ (actorOrToken))?.actor
            ? actorOrToken
            : actor.token?.object || actor.getActiveTokens?.()?.[0] || null
    );
    if (sourceToken)
        playFightFX(sourceToken);

    let weapon = bypassWeapon;
    if (!weapon) {
        const choices = await choseMount(actor, 1, null, null, 'FIGHT');
        if (!choices?.length)
            return;
        const chosenMount = choices[0];
        weapon = chosenMount.slots
            ? chosenMount.slots.find(/** @type {any} */ slot => slot.weapon?.value)?.weapon?.value ?? null
            : chosenMount;
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

    const sourceToken = /** @type {Token|null} */ (
        (/** @type {any} */ (actorOrToken))?.actor
            ? actorOrToken
            : actor.token?.object || actor.getActiveTokens()[0] || null
    );
    if (sourceToken) {
        playBarrageFX(sourceToken);
    }

    // Helper to check if a mount or weapon contains a Superheavy weapon
    const hasSuperheavy = (selectedItem) => {
        if (selectedItem?.slots) {
            return selectedItem.slots.some(slot => {
                const weapon = slot.weapon?.value;
                if (!weapon) {
                    return false;
                }
                const size = weapon.system?.size || weapon.system?.type || "";
                return size.toLowerCase() === 'superheavy';
            });
        }
        const size = selectedItem?.system?.size || selectedItem?.system?.type || "";
        return size.toLowerCase() === 'superheavy';
    };

    const barrageValidator = (selected) => {
        if (selected.length === 0)
            return { valid: false, message: "Select 1 or 2 mounts.", level: "info" };

        if (selected.length === 1) {
            const isSH = hasSuperheavy(selected[0]);
            return {
                valid: true,
                message: isSH ? "Superheavy weapon selected." : "1 mount selected.",
                level: "success",
            };
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

    await consumeAction(actor, 'full');

    // Helper to fire all weapons on a single mount (AND card if multiple).
    // RAW: Aux weapons in a Barrage don't deal bonus damage; the Main/Heavy/SH does.
    const fireMountWeapons = async (mount) => {
        let weapons;
        if (mount.slots) {
            weapons = mount.slots
                .map(slot => slot.weapon?.value ?? (slot.weapon?.id ? actor.items.get(slot.weapon.id) : null))
                .filter(Boolean);
        } else {
            weapons = [mount];
        }

        const isAuxSize = (weapon) => String(weapon.system?.size || "").toLowerCase() === 'auxiliary';
        const hasNonAux = weapons.some(weapon => !isAuxSize(weapon));
        let auxPrimaryUsed = false;

        const fireWeapon = async (weapon) => {
            if (preTarget) {
                /** @type {any} */ (canvas.tokens).setTargets([preTarget.id]);
            }
            let suppressBonus;
            if (hasNonAux) {
                suppressBonus = isAuxSize(weapon);
            } else {
                suppressBonus = auxPrimaryUsed;
                auxPrimaryUsed = true;
            }
            const extraData = suppressBonus ? { _csmNoBonusDmg: { enabled: true } } : {};
            await beginWeaponAttackFlow(weapon, {}, extraData);
        };

        if (weapons.length === 1) {
            await fireWeapon(weapons[0]);
        } else if (weapons.length > 1) {
            const choices = weapons.map(weapon => ({
                text: weapon.name,
                icon: weapon.img,
                callback: async () => fireWeapon(weapon)
            }));
            await InteractiveAPI.startChoiceCard({
                title: "WEAPON ORDER",
                description: hasNonAux
                    ? `Firing weapons from ${mount.type || "Mount"}. Aux weapons don't deal bonus damage.`
                    : `Firing weapons from ${mount.type || "Mount"}. First weapon fired deals bonus damage; others don't.`,
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
        const mountChoices = choices.map((mount, index) => {
            const mountLabel = mount.name || mount.type || "Mount " + (index + 1);
            const weaponNames = (mount.slots ?? [])
                .map(slot => slot.weapon?.value?.name ?? (slot.weapon?.id ? actor.items.get(slot.weapon.id)?.name : null))
                .filter(Boolean);
            const text = weaponNames.length
                ? `Fire ${mountLabel} (${weaponNames.join(", ")})`
                : `Fire ${mountLabel}`;
            return {
                text,
                icon: mount.slots?.[0]?.weapon?.value?.img || "icons/svg/item-bag.svg",
                callback: async () => {
                    await fireMountWeapons(mount);
                }
            };
        });

        await InteractiveAPI.startChoiceCard({
            title: "BARRAGE MOUNT ORDER",
            description: "Select which mount to trigger. Aux weapons don't deal bonus damage.",
            mode: "and",
            choices: mountChoices
        });
    }
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
    executeContestedCheck,
    executeDamageRoll,
    executeBasicAttack,
    executeTechAttack,
    executeSimpleActivation,
    executeItemActivation,
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
