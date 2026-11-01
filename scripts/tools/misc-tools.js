import { removeEffectsByNameFromTokens, applyEffectsToTokens, findEffectOnToken } from "../bonuses/flagged-effects.js";
import { checkGate, consumeGate, clearGate, consumeOncePerRound, consumeOncePerTurn } from "./gates.js";
import { MODULE_ID } from "./constants.js";
import { localize, localizeFormat } from "./string-utils.js";
import { cancelButton } from "./dialog-utils.js";
import { tfGetTeam, tfGetTeams } from "./token-factions-utils.js";
import { chooseInvade, getTokenOwnerUserId, startWaitCard, chooseToken } from "../interactive/index.js";
import { findItemByLid } from "../interactive/deployables.js";
import { playSelfDestructFX, playContestedOutcomeFX, playMineDetonationFX } from "../fx/actionFX.js";
import { awaitPendingAck } from "../socket.js";
import { afterFx } from "../activations/after-fx.js";
import { redirectNextLwfxSource } from "../activations/flow-steps-extra.js";
import { getMinGridDistance } from "../combat/grid-helpers.js";
import { handleTrigger } from "../activations/reactions-engine.js";
import { ReactionManager } from "../activations/reaction-manager.js";
import { executeStandingUp, executeTeleport, executeFall, boostMove } from "./movement-tools.js";
import { getItemStatus } from "../tah/item-helpers.js";
import { isActionLocked } from "../interactive/deployables.js";
import { deriveSaveDc, STAT_PATHS, isExecutorGM, hasExecutorGM, inDangerZone, getTier, tierValue, getWeaponType, weaponClass, getItemType } from "../utils/lancer-token.js";
export { deriveSaveDc, isExecutorGM, hasExecutorGM, inDangerZone, getTier, tierValue, getWeaponType, weaponClass, getItemType };
import { hasReactionAvailable, setReaction, modifyAction, consumeAction, gainAction } from "./action-economy.js";
import { executeSkirmish, executeBarrage } from "./attack-actions.js";

/**
 * Whether an item can be used right now, matching the TAH row state: not destroyed or
 * disabled, loaded, charged, uses and per-round/turn/scene limits left, not lock-blocked.
 * @param {Item} item
 * @returns {boolean}
 */
export function isItemUsable(item)
{
    if (!item?.system)
        return false;
    const status = getItemStatus(item);
    if (status.destroyed || status.unavailable)
        return false;
    return !isActionLocked(item, item.name);
}

import { openAddReserveDialog } from "./pilot-reserves.js";
import { openClocksDialog } from "./pilot-clocks.js";
import {
    getWeaponProfiles_WithBonus, getItemTags_WithBonus,
    getMaxWeaponRanges_WithBonus, getActorMaxThreat,
    getMaxWeaponReach_WithBonus, getMaxItemRanges_WithBonus,
    getSensorRange_WithBonus, shapeSpecFromRanges
} from "./weapon-bonus-utils.js";
export { executeStandingUp, executeTeleport, executeFall, boostMove } from "./movement-tools.js";
export { openAddReserveDialog } from "./pilot-reserves.js";
export { openClocksDialog } from "./pilot-clocks.js";
export { openItemBrowserDialog } from "./item-browser.js";
export {
    getWeaponProfiles_WithBonus, getItemTags_WithBonus,
    getMaxWeaponRanges_WithBonus, getActorMaxThreat,
    getMaxWeaponReach_WithBonus, getMaxItemRanges_WithBonus,
    getSensorRange_WithBonus, weaponPulseRange
} from "./weapon-bonus-utils.js";
export { checkGate, consumeGate, clearGate, consumeOncePerRound, consumeOncePerTurn } from "./gates.js";
export { hasReactionAvailable, reserveReaction, consumeReaction, setReaction, activationSpendKind, modifyAction, consumeAction, gainAction } from "./action-economy.js";
export { weaponSkirmishable, weaponBarrageable, executeSkirmish, executeFight, executeImprovisedAttack, executeBarrage } from "./attack-actions.js";
export { ACTIVATION_TAG_MAP, coreGrantedActions, coreActivationAction, getActorActionItems } from "./actor-actions.js";
export { attachEditorResizeObserver } from "./dom-utils.js";
export { getItemLID, isItemAvailable } from "../utils/lancer-token.js";

/** @returns {{color: string, label: string} | null} */
export function getTokenDispositionInfo(token)
{
    if (!token?.document)
        return null;
    const disposition = token.document.disposition;
    const dispositionMap = {
        [CONST.TOKEN_DISPOSITIONS.HOSTILE]:  { color: '#e53935', label: localize('LA.disposition.hostile') },
        [CONST.TOKEN_DISPOSITIONS.NEUTRAL]:  { color: '#f9a825', label: localize('LA.disposition.neutral') },
        [CONST.TOKEN_DISPOSITIONS.FRIENDLY]: { color: '#43a047', label: localize('LA.disposition.friendly') },
        [CONST.TOKEN_DISPOSITIONS.SECRET]:   { color: '#7e57c2', label: localize('LA.disposition.secret') },
    };
    const fallback = dispositionMap[disposition] ?? { color: '#888', label: localize('LA.disposition.unknown') };
    let color = fallback.color;
    let label = fallback.label;
    try
    {
        const tokenFactions = game.modules.get('token-factions');
        if (tokenFactions?.active)
        {
            let factionColor = /** @type {any} */ (tokenFactions).api?.getFactionColor?.(token.id)?.INT_S;
            if (!factionColor)
            {
                const helper = /** @type {any} */ (globalThis).__tokenFactionsHelpers?.colorBorderFaction;
                factionColor = helper?.(token)?.INT_S;
            }
            if (factionColor)
                color = factionColor;
            const teamId = tfGetTeam(token);
            if (teamId)
            {
                const team = tfGetTeams().find(/** @type {any} */ candidateTeam => candidateTeam.id === teamId);
                if (team)
                    label = team.name;
            }
        }
    }
    catch
    {
        // ignore
    }
    return { color, label };
}

/**
 * Sets a resource value on an item: uses, loaded, charged, talent counter, or frame core system counter.
 *
 * Detection order:
 *   1. Talent items               → system.ranks[N].counters[M].value (clamped to counter min/max)
 *   2. Frame items                → system.core_system.counters[counterIndex].value (clamped to counter min/max)
 *   3. Items with uses.max > 0    → system.uses.value (clamped 0..max)
 *   4. Recharge items             → system.charged (Boolean(value))
 *   5. Items with a loaded field  → system.loaded (Boolean(value))
 *   6. Items with a charged field → system.charged (Boolean(value))
 *
 * @param {Item} item
 * @param {number|boolean} value  Target value. For loaded/charged: truthy/falsy. For uses/counters: number.
 * @param {number} [counterIndex=0]  For talents: index across the unlocked ranks' counters. For frames: index into system.core_system.counters.
 * @returns {Promise<void>}
 */
export async function setItemResource(item, value, counterIndex = 0)
{
    if (!item)
        return;

    if (item.type === 'talent')
    {
        const ranks = item.system?.ranks ?? [];
        const unlocked = Math.min(ranks.length, item.system?.curr_rank ?? ranks.length);
        let remaining = counterIndex;
        for (let rankIdx = 0; rankIdx < unlocked; rankIdx++)
        {
            const counters = ranks[rankIdx]?.counters ?? [];
            if (remaining >= counters.length)
            {
                remaining -= counters.length;
                continue;
            }
            const counter = counters[remaining];
            const clamped = Math.max(counter.min ?? 0, Math.min(counter.max ?? Infinity, Math.round(Number(value))));
            await item.update({ [`system.ranks.${rankIdx}.counters.${remaining}.value`]: clamped });
            return;
        }
        return;
    }

    if (item.type === 'frame')
    {
        const counters = item.system?.core_system?.counters ?? [];
        const counter = counters[counterIndex];
        if (!counter)
            return;
        const clamped = Math.max(counter.min ?? 0, Math.min(counter.max ?? Infinity, Math.round(Number(value))));
        await item.update({ [`system.core_system.counters.${counterIndex}.value`]: clamped });
        return;
    }

    const uses = item.system?.uses;
    if (uses && uses.max > 0)
    {
        const clamped = Math.max(0, Math.min(uses.max, Math.round(Number(value))));
        await item.update({ "system.uses.value": clamped });
        return;
    }

    const isRecharge = (item.system?.tags ?? []).some(tag => tag.lid === 'tg_recharge');
    if (item.system?.charged !== undefined && isRecharge)
    {
        await item.update({ "system.charged": Boolean(value) });
        return;
    }

    if (item.system?.loaded !== undefined)
    {
        await item.update({ "system.loaded": Boolean(value) });
        return;
    }

    if (item.system?.charged !== undefined)
        await item.update({ "system.charged": Boolean(value) });
}

/**
 * @param {Item} item - The item document to modify.
 * @param {Object} tagData - The tag object to add (e.g. { id: "tg_heat_self", val: "2" }).
 * @returns {Promise<Item>} The updated item.
 */
export async function addItemTag(item, tagData)
{
    const lid = tagData?.lid ?? tagData?.id;
    if (!item || !lid)
        return item;

    const tag = { ...tagData, lid };
    if (item.type === 'mech_weapon')
    {
        const profiles = globalThis.foundry.utils.deepClone(item._source.system.profiles ?? []);
        const profile = profiles[item.system?.selected_profile_index ?? 0];
        if (!profile)
            return item;
        profile.tags = _withTag(profile.tags, tag);
        return item.update(/** @type {any} */ ({ system: { profiles } }));
    }

    const currentTags = globalThis.foundry.utils.deepClone(item.system?.tags || []);
    return item.update(/** @type {any} */ ({ system: { tags: _withTag(currentTags, tag) } }));
}

function _withTag(tags, tag)
{
    const list = Array.isArray(tags) ? tags : [];
    const existingIndex = list.findIndex(existing => (existing.lid ?? existing.id) === tag.lid);
    if (existingIndex >= 0)
        list[existingIndex] = tag;
    else
        list.push(tag);
    return list;
}

/** @returns {Promise<any>} The updated item */
export async function removeItemTag(item, tagId)
{
    if (!item || !tagId)
        return item;

    if (item.type === 'mech_weapon')
    {
        const profiles = globalThis.foundry.utils.deepClone(item._source.system.profiles ?? []);
        const profile = profiles[item.system?.selected_profile_index ?? 0];
        const before = profile?.tags?.length ?? 0;
        if (!profile || !before)
            return item;
        profile.tags = profile.tags.filter(tag => (tag.lid ?? tag.id) !== tagId);
        if (profile.tags.length === before)
            return item;
        return item.update(/** @type {any} */ ({ system: { profiles } }));
    }

    const currentTags = item.system?.tags || [];
    const newTags = currentTags.filter(tag => (tag.lid ?? tag.id) !== tagId);

    if (newTags.length !== currentTags.length)
        return item.update(/** @type {any} */ ({ system: { tags: newTags } }));
    return item;
}

/**
 * Execute a Lancer stat roll (hull, agi, sys, eng, grit) via StatRollFlow.
 * `extraData.accuracy` / `extraData.difficulty` / `extraData.flatModifier` pre-fill the HASE HUD,
 * the same way a weapon's tags pre-fill an attack. The player can still change them.
 * `extraData.sourceItemUuid` / `extraData.sourceAction` attribute the roll, surfacing as
 * `item` / `actionName` on onInitCheck and onCheck.
 * @param {Actor} actor - The rolling actor.
 * @param {string} stat - Stat key: "hull", "agi", "sys", "eng", or "grit".
 * @param {string} title - Chat card title (defaults to "<STAT> Check" or "<STAT> Save").
 * @param {number|"token"|Token|TokenDocument} [target=10] - Difficulty value, "token" to let the user pick, or the token forcing the save (its SAVE is the DC).
 * @param {{ targetStat?: string, sourceItemUuid?: string, sourceAction?: string, [key: string]: any }} [extraData={}] - Extra state passed to the flow. `targetStat` reads that HASE stat off the target as the DC.
 * @returns {Promise<{ completed: boolean, [key: string]: any }>}
 */
export async function executeStatRoll(actor, stat, title, target = 10, extraData = {})
{
    const StatRollFlow = game.lancer.flows.get("StatRollFlow");
    if (!StatRollFlow)
    {
        console.error("lancer-automations | StatRollFlow not found");
        return { completed: false };
    }

    const { targetStat, sendToOwner, cardTitle, cardDescription, ...restExtraData } = (extraData && typeof extraData === 'object') ? extraData : {};
    if (!restExtraData.rollTypes && target && typeof target === 'object' && !targetStat)
        restExtraData.rollTypes = ['save'];

    // Send the roll to the token owner's client via socket so they roll it themselves.
    if (sendToOwner)
    {
        const ownerToken = actor.token?.object ?? actor.getActiveTokens()?.[0];
        if (ownerToken)
        {
            const ownerIds = getTokenOwnerUserId(ownerToken);
            const firstOwner = Array.isArray(ownerIds) ? ownerIds[0] : ownerIds;
            const isLocal = firstOwner === game.user.id;

            if (!isLocal && firstOwner)
            {
                const requestId = foundry.utils.randomID();
                const targetActor = (typeof target === 'object' && target) ? target.actor : null;
                const targetTokenId = targetActor ? (target.id ?? null) : null;
                let targetVal = (typeof target === 'number') ? target : 10;
                if (targetActor)
                    targetVal = deriveSaveDc(targetActor, targetStat);

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
                        extraData: {
                            ...(restExtraData ?? {}),
                            ...(targetTokenId ? { targetTokenId, forceTargeting: true } : {}),
                            ...(target === "token" ? { forceTargeting: true } : {})
                        }
                    }
                });

                const ownerName = game.users.get(firstOwner)?.name ?? 'player';
                const waitCard = startWaitCard({
                    title: cardTitle || title || 'STAT ROLL',
                    description: cardDescription || `<b>${actor.name ?? 'Actor'}</b> :: ${stat.toUpperCase()}`,
                    waitMessage: localizeFormat('LA.misc.waitingForRoll', { name: ownerName }),
                    relatedToken: ownerToken
                });

                try
                {
                    return await awaitPendingAck(requestId);
                }
                finally
                {
                    waitCard.remove();
                }
            }
            // If local owner, fall through to normal roll below.
        }
    }

    let targetVal = (typeof target === 'number') ? target : 10;
    let targetToken = null;
    let rollTitle = title;
    const upperStat = stat.toUpperCase();
    // "token" surfaces the HUD picker; an explicit token target is also shown + editable in the HUD.
    let forceTargeting = target === "token";

    if (typeof target === 'object' && target)
    {
        if (typeof TokenDocument !== 'undefined' && target instanceof TokenDocument)
            targetToken = target.object;
        else if (target.actor)
            targetToken = target;
        else
            console.error("lancer-automations | executeStatRoll | Invalid target type");
    }
    if (targetToken)
        forceTargeting = true;

    if (targetToken?.actor)
    {
        rollTitle = rollTitle || `${upperStat} Save`;
        targetVal = deriveSaveDc(targetToken.actor, targetStat);
    }

    rollTitle = rollTitle || `${upperStat} Check`;
    if (targetToken && typeof targetVal === 'number')
        rollTitle += ` (>= ${targetVal})`;

    const isNpcGrit = actor.type === "npc" && upperStat === "GRIT";
    const statPath = isNpcGrit ? "system.tier" : (STAT_PATHS[upperStat] || stat);

    const flowOptions = { path: statPath, title: rollTitle };
    const flow = new StatRollFlow(actor, flowOptions);
    flow.state.la_extraData = flow.state.la_extraData || {};

    if (targetToken)
        flow.state.la_extraData.targetTokenId = targetToken.id;
    flow.state.la_extraData.targetVal = targetVal;
    if (forceTargeting)
        flow.state.la_extraData.forceTargeting = true;

    if (restExtraData && typeof restExtraData === 'object')
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, restExtraData);

    const focusTokenId = flow.state.la_extraData.targetTokenId;
    if (focusTokenId)
        setFlowTargets(canvas.tokens?.get(focusTokenId));

    const completed = await flow.begin();
    if (!completed)
        return { completed: false };
    const total = flow.state.data?.result?.roll?.total ?? null;
    const finalTargetVal = flow.state.la_extraData?.targetVal ?? targetVal;
    return {
        completed: true,
        total,
        roll: flow.state.data?.result?.roll ?? null,
        passed: total !== null && typeof finalTargetVal === 'number' ? total >= finalTargetVal : false
    };
}

/**
 * Save-or-effect over a target list: each target rolls a stat save (owner-routed by default),
 * failures get the effects / onFail, passes get onPass. Rolls run in parallel.
 * @param {number|Function} [options.accuracy=0]     Accuracy pre-set in the HASE HUD, or (target) => number
 * @param {number|Function} [options.difficulty=0]   Difficulty pre-set in the HASE HUD, or (target) => number
 * @param {number|Function} [options.flatModifier=0] Flat modifier pre-set on the roll, or (target) => number
 * @param {Token|Token[]} targets
 * @param {Object} options
 * @param {string} options.stat                     "HULL" / "AGI" / "SYS" / "ENG" / "GRIT"
 * @param {string} options.title                    Roll title
 * @param {number|Token} [options.origin=10]        Difficulty value or token to derive it from
 * @param {any} [options.effects]                   Effect name(s)/descriptor(s) applied on fail
 * @param {Object} [options.duration]               Duration for the applied effects
 * @param {string} [options.note]                   Note for the applied effects (defaults to title)
 * @param {Object} [options.extraFlags]             Identity flags stamped on the applied effects
 * @param {string} [options.cardTitle]
 * @param {string|Function} [options.cardDescription]  String or (target) => string
 * @param {boolean} [options.sendToOwner=true]
 * @param {Function} [options.onFail]               (target, rollResult) per failed save
 * @param {Function} [options.onPass]               (target, rollResult) per passed save
 * @param {{ value: number|string, type?: string, title?: string }} [options.halfDamageOnSave]
 *        Roll this damage on ALL targets afterwards, half on the ones that saved
 * @returns {Promise<Array<{ target: Token, passed: boolean, result: any }>>}
 */
export async function executeSaveVsEffect(targets, options = /** @type {any} */ ({}))
{
    const {
        stat, title, origin = 10, effects = null, duration = { label: 'indefinite' }, note = null,
        extraFlags = {}, cardTitle = null, cardDescription = null, sendToOwner = true,
        onFail = null, onPass = null, halfDamageOnSave = null,
        accuracy = 0, difficulty = 0, flatModifier = 0
    } = /** @type {any} */ (options);
    const perTarget = (value, target) => Number(typeof value === 'function' ? value(target) : value) || 0;
    const list = (Array.isArray(targets) ? targets : [targets]).filter(target => target?.actor);
    const results = await Promise.all(list.map(async (target) =>
    {
        const description = typeof cardDescription === 'function' ? cardDescription(target) : cardDescription;
        const result = await executeStatRoll(target.actor, stat, title, origin, {
            sendToOwner,
            rollTypes: ['save'],
            accuracy: perTarget(accuracy, target),
            difficulty: perTarget(difficulty, target),
            flatModifier: perTarget(flatModifier, target),
            ...(cardTitle ? { cardTitle } : {}),
            ...(description ? { cardDescription: description } : {})
        });
        return { target, passed: !!(result?.completed && result?.passed), result };
    }));
    for (const entry of results)
    {
        if (!entry.result?.completed)
            continue;
        if (entry.passed)
        {
            if (onPass)
                await onPass(entry.target, entry.result);
            continue;
        }
        if (effects)
        {
            await applyEffectsToTokens(
                { tokens: [entry.target], effectNames: Array.isArray(effects) ? effects : [effects], note: note ?? title, duration },
                extraFlags);
        }
        if (onFail)
            await onFail(entry.target, entry.result);
    }
    if (halfDamageOnSave && list.length)
    {
        const { value, type = "Kinetic", title: damageTitle = title } = halfDamageOnSave;
        const flowBonuses = results.filter(entry => entry.passed).map(entry => ({
            id: `save-half-${entry.target.id}-${foundry.utils.randomID()}`,
            name: title,
            type: "target_modifier",
            subtype: "half_damage",
            applyTo: [entry.target.id]
        }));
        const originToken = (typeof origin === 'object' && origin) ? origin : null;
        if (!originToken)
        {
            ui.notifications.warn(localize('LA.notify.halfDamageNeedsToken'));
        }
        else
        {
            /** @type {any} */ (canvas.tokens).setTargets(list.map(target => target.id));
            await executeDamageRoll(originToken, list, value, type, damageTitle, {},
                flowBonuses.length ? { flow_bonus: flowBonuses } : {});
        }
    }
    return results;
}

/**
 * Contested stat check between two actors/tokens, higher total wins and FX stay off during the rolls.
 * The winner gets the success overlay, the loser the failure one. A tie plays no FX and gives `winner === null`.
 * `accuracy1`/`difficulty1`/`flatModifier1` (and the `2` variants) pre-fill each side's HASE HUD.
 *
 * @param {any} input1     Actor or Token (passing a Token preserves the involved token for FX)
 * @param {string} stat1   Stat key for input1 (e.g. "HULL", "AGI", "SYS", "ENG", "GRIT")
 * @param {any} input2     Actor or Token
 * @param {string} stat2   Stat key for input2
 * @param {Object} [options]
 * @param {string} [options.title="Contested Check"] Title shown on each roll
 * @param {boolean} [options.sendToOwner=false]      Route each roll to the actor's owning player
 * @param {any} [options.sourceItem]                 Item the check belongs to, surfaced as `item` on onCheck
 * @param {string} [options.sourceAction]            Action the check belongs to, surfaced as `actionName`
 * @param {Object} [options.extraData]               Extra keys merged into both rolls' la_extraData
 * @returns {Promise<any>}
 */
export async function executeContestedCheck(input1, stat1, input2, stat2, options = {})
{
    const toActorToken = (input) =>
    {
        if (!input)
            return { actor: null, token: null };
        if (input.actor)
            return { actor: input.actor, token: input.object ?? input };
        return { actor: input, token: null };
    };
    const { actor: actor1, token: token1 } = toActorToken(input1);
    const { actor: actor2, token: token2 } = toActorToken(input2);

    const {
        title = "Contested Check", sendToOwner = true,
        accuracy1 = 0, difficulty1 = 0, flatModifier1 = 0,
        accuracy2 = 0, difficulty2 = 0, flatModifier2 = 0,
        sourceItem = null, sourceAction = null, extraData = null
    } = /** @type {any} */ (options);
    const attribution = {
        ...(extraData ?? {}),
        ...(sourceItem ? { sourceItemUuid: sourceItem.uuid ?? sourceItem } : {}),
        ...(sourceAction ? { sourceAction } : {})
    };
    const suppressedRollOpts = { suppressStatFX: true, sendToOwner, ...attribution };
    const statLabel1 = stat1.toUpperCase();
    const statLabel2 = stat2.toUpperCase();
    const actorName1 = actor1?.name ?? "?";
    const actorName2 = actor2?.name ?? "?";
    const [rollResult1, rollResult2] = await Promise.all([
        executeStatRoll(actor1, stat1, `${statLabel1} vs ${actorName2} ${statLabel2}`, 0, { ...suppressedRollOpts, cardTitle: title, cardDescription: `${actorName1} :: ${statLabel1}`, accuracy: accuracy1, difficulty: difficulty1, flatModifier: flatModifier1, contest: { actorUuid: actor2?.uuid ?? null, stat: stat2 } }),
        executeStatRoll(actor2, stat2, `${statLabel2} vs ${actorName1} ${statLabel1}`, 0, { ...suppressedRollOpts, cardTitle: title, cardDescription: `${actorName2} :: ${statLabel2}`, accuracy: accuracy2, difficulty: difficulty2, flatModifier: flatModifier2, contest: { actorUuid: actor1?.uuid ?? null, stat: stat1 } })
    ]);

    if (!rollResult1?.completed || !rollResult2?.completed)
    {
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
        playContestedOutcomeFX(winnerToken, loserToken).catch(e => console.error('lancer-automations | contested FX failed:', e));

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

/**
 * Force one or more tokens to roll a HASE check/save, each routed to its own owner.
 * With `saveVs`, the DC comes from that token/actor (its save, or matching HASE stat for a mech)
 * and it is pre-selected in each roller's HASE HUD; without it, a plain check vs 10.
 *
 * @param {string} skill              HASE stat key: "HULL" | "AGI" | "SYS" | "ENG"
 * @param {any[]} [targets]           Roller Tokens; defaults to the current user's targets
 * @param {Object} [options]
 * @param {any} [options.saveVs=null]          Token/Actor whose save is the DC (omit for a plain check)
 * @param {boolean} [options.sendToOwner=true] Route each roll to the token's owner
 * @param {string} [options.title]             Roll title (auto-named per stat when omitted)
 * @returns {Promise<{completed: boolean, results: any[]}>}
 */
export async function executeForceCheck(skill, targets = null, options = {})
{
    const { saveVs = null, sendToOwner = true, title = '', accuracy = 0, difficulty = 0, flatModifier = 0 } = options ?? {};
    const perRoller = (value, token) => Number(typeof value === 'function' ? value(token) : value) || 0;
    const rollers = (Array.isArray(targets) && targets.length) ? targets : [...(game.user.targets ?? [])];
    if (!rollers.length)
    {
        ui.notifications.warn(localize('LA.notify.forceCheckNoTargetsSelected'));
        return { completed: false, results: [] };
    }

    const saveVsToken = saveVs
        ? (saveVs.getActiveTokens ? (saveVs.getActiveTokens()[0] ?? null) : (saveVs.object ?? saveVs))
        : null;
    const saveDc = saveVsToken ? deriveSaveDc(saveVsToken.actor) : 10;
    const upperSkill = String(skill).toUpperCase();
    const saveVsName = saveVsToken?.actor?.name ?? saveVsToken?.name ?? null;
    const cardTitle = saveVsName ? `FORCE CHECK :: ${upperSkill} SAVE` : `FORCE CHECK :: ${upperSkill}`;
    const rollTitle = title || (saveVsName ? `${upperSkill} Save (>= ${saveDc})` : `${upperSkill} Check`);

    const results = await Promise.all(rollers.map(async (rollerToken) =>
    {
        const rollerActor = rollerToken?.actor ?? rollerToken;
        if (!rollerActor)
            return { token: rollerToken, actor: null, completed: false, total: null, passed: false };
        const rollExtra = {
            sendToOwner,
            cardTitle,
            accuracy: perRoller(accuracy, rollerToken),
            difficulty: perRoller(difficulty, rollerToken),
            flatModifier: perRoller(flatModifier, rollerToken),
            cardDescription: saveVsName
                ? `<b>${rollerActor.name}</b> must roll a ${upperSkill} save vs <b>${saveVsName}</b> (>= ${saveDc}).`
                : `<b>${rollerActor.name}</b> must roll a ${upperSkill} check.`
        };
        if (saveVsToken)
        {
            rollExtra.targetTokenId = saveVsToken.id;
            rollExtra.forceTargeting = true;
            rollExtra.rollTypes = ['save'];
        }
        const rollResult = await executeStatRoll(rollerActor, skill, rollTitle, saveDc, rollExtra);
        return {
            token: rollerToken,
            actor: rollerActor,
            completed: !!rollResult?.completed,
            total: rollResult?.total ?? null,
            passed: !!rollResult?.passed
        };
    }));

    const rowHtml = (result) =>
    {
        const name = result.actor?.name ?? '?';
        if (!result.completed)
            return `<div style="display:flex;justify-content:space-between;padding:4px 6px;opacity:0.6;font-style:italic;"><span>${name} <span style="opacity:0.7;">(${upperSkill})</span></span><span>declined</span></div>`;
        const ok = result.passed;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;${ok ? 'background:rgba(58,158,110,0.18);border-left:3px solid #3a9e6e;' : 'background:rgba(204,51,51,0.14);border-left:3px solid #c33;'}">
            <span>${name} <span style="opacity:0.6;">(${upperSkill})</span></span>
            <span style="font-variant-numeric:tabular-nums;font-weight:700;">${result.total} ${ok ? 'PASS' : 'FAIL'}</span>
        </div>`;
    };

    const header = `// FORCE CHECK :: ${upperSkill}${saveVsName ? ` SAVE vs ${saveVsName}` : ''} //`;
    ChatMessage.create({
        content: `<div class="card clipped-bot" style="margin:0;">
            <div class="lancer-header lancer-primary">${header}</div>
            <div style="display:flex;flex-direction:column;gap:2px;padding:4px;">${results.map(rowHtml).join('')}</div>
        </div>`
    });

    return { completed: results.some(result => result.completed), results };
}

/** @returns {Promise<{completed: boolean, flow?: object}>} */
export async function executeDamageRoll(attacker, targets, damageValue = null, damageType = null, title = "Damage Roll", options = {}, extraData = {})
{
    const DamageRollFlow = game.lancer.flows.get("DamageRollFlow");
    if (!DamageRollFlow)
        return { completed: false };

    // options.targeting {range, pattern, size}: the damage HUD opens with targeting engaged on that shape.
    const targeting = options.targeting ?? null;
    if (targeting)
    {
        options = { ...options };
        delete options.targeting;
    }

    const actor = attacker?.actor || attacker;
    if (!actor)
        return { completed: false };

    setFlowTargets(targets);

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
    if (extraData && typeof extraData === 'object')
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    if (targeting)
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, { laTargeting: targeting });
    const completed = await flow.begin();
    return { completed, flow };
}

/** @returns {Promise<{completed: boolean, flow?: object}>} */
async function beginWeaponThrowFlow(weapon, options, extraData = {})
{
    const WeaponAttackFlow = game.lancer.flows.get("WeaponAttackFlow");
    if (!WeaponAttackFlow)
        return { completed: false };
    const flow = new WeaponAttackFlow(weapon, options);
    if (extraData && typeof extraData === 'object')
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    flow.state.la_extraData = flow.state.la_extraData || {};
    flow.state.la_extraData.is_throw = true;
    const completed = await flow.begin();
    return { completed, flow };
}


/**
 * Point the user's targets at the given tokens. Attack flows read `game.user.targets`,
 * so this is what `options.targets` does for every attack entry point.
 * @param {any} targets Token or Token[]
 */
function setFlowTargets(targets)
{
    if (!targets)
        return;
    const list = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
    /** @type {any} */ (canvas.tokens).setTargets(list.map(target => target.id ?? target.object?.id));
}

/**
 * Start a weapon attack flow. `options.targets` sets who is attacked, so callers never
 * have to touch setTarget themselves.
 * @param {Item} weapon
 * @param {Object} [options]  Flow options, plus `targets: Token|Token[]`
 * @param {Object} [extraData]
 * @returns {Promise<{completed: boolean, flow?: object}>}
 */
export async function beginWeaponAttackFlow(weapon, options = {}, extraData = {})
{
    const WeaponAttackFlow = game.lancer.flows.get("WeaponAttackFlow");
    if (!WeaponAttackFlow)
        return { completed: false };
    const { targets = null, ...flowOptions } = /** @type {any} */ (options ?? {});
    setFlowTargets(targets);
    const flow = new WeaponAttackFlow(weapon, flowOptions);
    if (extraData && typeof extraData === 'object')
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    const completed = await flow.begin();
    return { completed, flow };
}

/**
 * Target the given tokens and start the weapon's attack flow.
 * @param {Item} weapon
 * @param {Token|Token[]|null} [targets]
 * @param {Object} [options]  Flow options; `reloadIfEmpty: true` reloads instead when the weapon is unloaded
 * @returns {Promise<{completed: boolean, flow?: object, reloaded?: boolean}>}
 */
export async function attackWith(weapon, targets = null, options = {})
{
    const { reloadIfEmpty = false, fxSourceToken = null, ...flowOptions } = /** @type {any} */ (options);
    if (reloadIfEmpty && weapon?.system?.loaded === false)
    {
        const holder = weapon.parent?.getActiveTokens?.()?.[0] ?? null;
        if (holder)
            await game.modules.get(MODULE_ID)?.api?.reloadOneWeapon?.(holder);
        return { completed: false, reloaded: true };
    }
    if (fxSourceToken)
        redirectNextLwfxSource(weapon?.parent, fxSourceToken);
    return beginWeaponAttackFlow(weapon, { ...flowOptions, targets });
}

/**
 * Backs triggerData.isRangedAttack(). Item-less basic attacks always report Melee;
 * past 1 hex from every target they count as ranged.
 * @param {Object} triggerData - Attack/hit/damage trigger data
 * @returns {boolean}
 */
export function isRangedAttack(triggerData)
{
    const weaponType = getWeaponType(triggerData.weapon);
    if (weaponType)
        return !weaponType.includes('Melee');
    const attackType = triggerData.flowState?.data?.attack_type || 'Ranged';
    if (!attackType.includes('Melee'))
        return true;
    const attacker = triggerData.triggeringToken;
    const targets = triggerData.hitTokens ?? [];
    if (!attacker || !targets.length)
        return false;
    return targets.every(target => getMinGridDistance(attacker, target) > 1);
}

function _buildWeaponDamageFlow(weapon, targets, options)
{
    const DamageRollFlow = game.lancer.flows.get("DamageRollFlow");
    if (!DamageRollFlow || !weapon)
        return null;
    setFlowTargets(targets);
    const stats = weaponRollStats(weapon);
    const flowData = {
        title: weapon.name,
        damage: stats.damage,
        tags: stats.tags,
        has_normal_hit: true,
        ...options
    };
    return new DamageRollFlow(weapon.uuid, flowData);
}

/**
 * Successful weapon hit: fires `onHit` from the weapon's owner against `targets`
 * (with the upcoming damage flow as flowState), then rolls the weapon's damage.
 * The hit and damage stages of `attackWith`, without the attack roll.
 * @param {Item} weapon
 * @param {Token|Token[]} targets
 * @param {Object} [options]  Damage flow overrides
 * @returns {Promise<{completed: boolean, flow?: any}>}
 */
export async function hitWith(weapon, targets, options = {})
{
    const owner = weapon?.parent?.getActiveTokens?.()?.[0] ?? null;
    const list = (Array.isArray(targets) ? targets : [targets]).filter(Boolean);
    if (!owner || !list.length)
        return { completed: false };
    const flow = _buildWeaponDamageFlow(weapon, list, options);
    if (!flow)
        return { completed: false };
    await handleTrigger('onHit', {
        triggeringToken: owner,
        weapon,
        targets: list.map(target => ({ target })),
        flowState: flow.state
    });
    const completed = await flow.begin();
    return { completed, flow };
}

/**
 * Roll the weapon's damage against targets as the weapon's own damage flow, so damage
 * triggers carry the weapon. Damage defaults to the weapon's (tier-resolved), `options`
 * override the flow data. The damage stage alone.
 * @param {Item} weapon
 * @param {Token|Token[]|null} [targets]
 * @param {Object} [options]
 * @returns {Promise<{completed: boolean, flow?: any}>}
 */
export async function damageWith(weapon, targets = null, options = {})
{
    const flow = _buildWeaponDamageFlow(weapon, targets, options);
    if (!flow)
        return { completed: false };
    const completed = await flow.begin();
    return { completed, flow };
}

function _tierTagVal(val, tierIndex)
{
    const match = /^\{(.+)\}$/.exec(String(val ?? ''));
    if (!match)
        return val;
    const parts = match[1].split('/');
    return parts[Math.min(tierIndex, parts.length - 1)];
}

// Roll stats for any weapon item: npc_feature tier arrays, mech profiles, pilot flat fields.
function weaponRollStats(weapon)
{
    const system = weapon.system ?? {};
    const plainDamage = (/** @type {any[]} */ list) => (list ?? []).map(entry => ({ type: entry.type, val: String(entry.val ?? '') }));
    if (weapon.type === 'npc_feature')
    {
        const tierIndex = (Number(system.tier_override) || getTier(weapon.parent)) - 1;
        const pick = (/** @type {any} */ arr) => Array.isArray(arr) ? arr[Math.min(tierIndex, arr.length - 1)] : arr;
        return {
            grit: 0,
            attack_bonus: Number(pick(system.attack_bonus) ?? 0),
            accuracy: Number(pick(system.accuracy) ?? 0),
            damage: plainDamage(pick(system.damage)),
            tags: (system.tags ?? []).map((/** @type {any} */ tag) => ({ lid: tag.lid, val: _tierTagVal(tag.val, tierIndex), name: tag.name, description: tag.description }))
        };
    }
    const profile = system.profiles?.[system.selected_profile_index ?? 0];
    return {
        attack_bonus: 0,
        accuracy: 0,
        damage: plainDamage(profile?.damage ?? system.damage),
        tags: [...(profile?.tags ?? []), ...(system.tags ?? [])]
    };
}

/**
 * Repeat a weapon's attack roll as a basic attack: tier-resolved stats, tags and damage
 * carried, none of the weapon-fire mechanics (loading, self-heat, item updates).
 * @param {Item} weapon
 * @param {Token|Token[]|null} [targets]
 * @param {Object} [options]  `fxSourceToken` plays the weapon's FX from that token; `title` overrides the card title
 * @returns {Promise<{completed: boolean, flow?: any}>}
 */
export async function attackRollWith(weapon, targets = null, options = {})
{
    const actor = weapon?.parent;
    if (!actor)
        return { completed: false };
    const { fxSourceToken = null, title = null } = /** @type {any} */ (options);
    return executeExtraActionCombat(actor, {
        name: title ?? weapon.name,
        attack_type: weaponClass(weapon) === 'melee' ? 'Melee' : 'Ranged',
        ...weaponRollStats(weapon)
    }, weapon, { targets, fxSourceToken, fxItem: weapon });
}

/**
 * Read a la_extraData flag off the trigger's flow state.
 * @returns {any} The stored value, or undefined when there is no flow state
 */
export function getFlowFlag(triggerData, key)
{
    return triggerData?.flowState?.la_extraData?.[key];
}

/**
 * Stamp a la_extraData flag on the trigger's flow state (once-per-flow gates).
 * @returns {boolean} false when the trigger has no flow state to stamp
 */
export function setFlowFlag(triggerData, key, value = true)
{
    const state = triggerData?.flowState;
    if (!state)
        return false;
    state.la_extraData = state.la_extraData || {};
    state.la_extraData[key] = value;
    return true;
}

/**
 * Run a callback once the trigger's flow completes or aborts, after its card printed.
 * One-shot, matched to that exact flow.
 * @param {Object} triggerData - Trigger data carrying a flowState
 * @param {(flow: any, success: boolean) => any} callback
 * @returns {boolean} false when the trigger has no flow state to watch
 */
export function afterFlow(triggerData, callback)
{
    const flowState = triggerData?.flowState;
    if (!flowState?.name)
    {
        console.error('lancer-automations | afterFlow: triggerData has no flow state; only flow-based triggers can use it.');
        return false;
    }
    const hookName = `lancer.postFlow.${flowState.name}`;
    const hookId = Hooks.on(hookName, (flow, success) =>
    {
        if (flow?.state !== flowState)
            return;
        Hooks.off(hookName, hookId);
        Promise.resolve(callback(flow, success)).catch(err => console.error('lancer-automations | afterFlow callback failed:', err));
    });
    return true;
}

/** @returns {Promise<{completed: boolean, flow?: object}>} */
export async function executeBasicAttack(actor, options = {}, extraData = {})
{
    const BasicAttackFlow = game.lancer.flows.get("BasicAttackFlow");
    if (!BasicAttackFlow)
        return { completed: false };
    const { tags, damage, targets = null, fxSourceToken = null, fxItem = null, item = null, ...flowOptions } = /** @type {any} */ (options);
    setFlowTargets(targets);
    if (fxSourceToken)
        redirectNextLwfxSource(actor, fxSourceToken);
    // with `item`, the flow uses the item's stats and every trigger carries it as `weapon`;
    // a basic attack is never tech, so opt out of the system's non-weapon tech classification
    const flow = new BasicAttackFlow(item?.uuid ?? actor.uuid, flowOptions);
    if (item)
    {
        flow.state.la_extraData = flow.state.la_extraData || {};
        flow.state.la_extraData.forceNonTech = true;
    }
    if (fxItem?.uuid)
    {
        flow.state.la_extraData = flow.state.la_extraData || {};
        flow.state.la_extraData.fxItemUuid = fxItem.uuid;
    }
    if (Array.isArray(tags) && tags.length > 0)
    {
        flow.state.data = flow.state.data || {};
        const normalized = tags.map(tag => ({
            id: tag.id ?? tag.lid ?? '',
            lid: tag.lid ?? tag.id ?? '',
            val: tag.val !== undefined ? String(tag.val) : '',
            name: tag.name ?? (tag.lid ? tag.lid.replace(/^tg_/, '').toUpperCase() : ''),
            description: tag.description ?? ''
        }));
        flow.state.data.tags = [...(flow.state.data.tags || []), ...normalized];
        flow.state.la_extraData = flow.state.la_extraData || {};
        flow.state.la_extraData.injectedTags = normalized;
    }
    // Carried on the attack card; its damage button pre-fills the damage flow with these.
    if (Array.isArray(damage) && damage.length > 0)
    {
        flow.state.la_extraData = flow.state.la_extraData || {};
        flow.state.la_extraData.injectedDamage = damage;
    }
    if (extraData && typeof extraData === 'object')
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    const completed = await flow.begin();
    return { completed, flow };
}

/** @returns {Promise<{completed: boolean, flow?: object}>} */
export async function executeTechAttack(target, options = {}, extraData = {})
{
    const TechAttackFlow = game.lancer?.flows?.get("TechAttackFlow");
    if (!TechAttackFlow)
        return { completed: false };
    if (!target)
    {
        ui.notifications.error(localize('LA.notify.executeTechAttackNeedsTarget'));
        return { completed: false };
    }
    const { damage, targets = null, ...flowOptions } = /** @type {any} */ (options);
    setFlowTargets(targets);
    const flow = new TechAttackFlow(target, flowOptions);
    // Carried on the tech attack card; its damage button pre-fills the damage flow with these.
    if (Array.isArray(flowOptions.tags) && flowOptions.tags.length > 0)
    {
        flow.state.la_extraData = flow.state.la_extraData || {};
        flow.state.la_extraData.injectedTags = flowOptions.tags;
    }
    if (Array.isArray(damage) && damage.length > 0)
    {
        flow.state.la_extraData = flow.state.la_extraData || {};
        flow.state.la_extraData.injectedDamage = damage;
    }
    if (extraData && typeof extraData === 'object')
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    const completed = await flow.begin();
    return { completed, flow };
}

const EXTRA_WEAPON_TAG_LIDS = new Set(['tg_smart', 'tg_seeking', 'tg_ap', 'tg_reliable', 'tg_overkill', 'tg_knockback', 'tg_accurate', 'tg_inaccurate']);
const EXTRA_TECH_ACTIVATIONS = new Set(['Invade', 'Quick Tech', 'Full Tech']);
const EXTRA_TAG_NAMES = { tg_smart: 'Smart', tg_seeking: 'Seeking', tg_ap: 'Armor Piercing', tg_reliable: 'Reliable', tg_overkill: 'Overkill', tg_knockback: 'Knockback', tg_accurate: 'Accurate', tg_inaccurate: 'Inaccurate' };

// Lancer's tag renderer needs a name + description on each tag.
function extraDisplayTags(tags)
{
    return (tags ?? []).map(/** @type {any} */ (tag) => ({
        lid: tag.lid,
        val: tag.val !== undefined ? String(tag.val) : '',
        name: tag.name ?? EXTRA_TAG_NAMES[tag.lid] ?? tag.lid,
        description: tag.description ?? '',
        hidden: false
    }));
}

/** @returns {Promise<{completed: boolean, flow?: any}>} */
export async function executeExtraActionCombat(actorOrToken, action, sourceItem = null, options = {})
{
    const actor = /** @type {any} */ (actorOrToken)?.actor ?? actorOrToken;
    if (!actor || !action)
        return { completed: false };
    const { targets: targetsOverride = null, fxSourceToken = null, fxItem = null } = /** @type {any} */ (options);
    const weaponTags = (action.tags ?? []).filter(/** @type {any} */ (tag) => EXTRA_WEAPON_TAG_LIDS.has(tag.lid));
    const hasTag = (/** @type {string} */ lid) => weaponTags.some(/** @type {any} */ (tag) => tag.lid === lid);

    if (action.laCombat === 'damage')
    {
        const targets = targetsOverride ?? [...(game.user?.targets ?? [])];
        return executeDamageRoll(actor, targets, null, null, action.name, { damage: action.damage ?? [], tags: extraDisplayTags(weaponTags) });
    }

    if (EXTRA_TECH_ACTIVATIONS.has(action.activation))
    {
        return executeTechAttack(sourceItem ?? actor, {
            title: action.name,
            effect: action.detail ?? '',
            invade: action.activation === 'Invade',
            targets: targetsOverride,
            tags: extraDisplayTags(weaponTags),
            damage: action.damage ?? []
        }, { tapeRecorded: true });
    }

    const targets = targetsOverride ?? Array.from(game.user?.targets ?? []);
    const grit = action.grit ?? actor.system?.grit ?? actor.system?.tier ?? 0;
    const accDiffPatch = {
        weapon: { accurate: hasTag('tg_accurate'), inaccurate: hasTag('tg_inaccurate'), seeking: hasTag('tg_seeking'), smart: hasTag('tg_smart'), melee: action.attack_type === 'Melee' },
        grit,
        flatBonus: Number(action.attack_bonus ?? 0),
        accuracy: Number(action.accuracy ?? 0),
        difficulty: Number(action.difficulty ?? 0)
    };
    const laTargeting = shapeSpecFromRanges(action.range);
    return executeBasicAttack(actor, {
        type: 'attack',
        title: action.name,
        targets,
        fxSourceToken,
        fxItem,
        action: null,
        is_smart: hasTag('tg_smart'),
        tags: extraDisplayTags(weaponTags),
        damage: action.damage ?? [],
        attack_rolls: { roll: '', targeted: [] },
        attack_results: [],
        hit_results: [],
        reroll_data: ''
    }, { tapeRecorded: true, accDiffPatch, ...(laTargeting ? { laTargeting } : {}) });
}

/** @returns {Promise<void>} */
export async function executeReactorMeltdown(tokenOrActor, turns = null)
{
    if (!tokenOrActor)
    {
        ui.notifications.error(localize('LA.notify.reactorMeltdownNeedsTarget'));
        return;
    }
    const actor = tokenOrActor.actor ?? tokenOrActor;

    let selectedTurns = turns;

    if (selectedTurns === null)
    {
        selectedTurns = await new Promise((resolve) =>
        {
            const dialog = new Dialog({
                title: localize('LA.dialogTitle.reactorMeltdown'),
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
                    cancel: cancelButton(() => resolve(null))
                },
                default: "cancel",
                close: () => resolve(null),
                render: (html) =>
                {
                    html.find('.lancer-item-card').click(function ()
                    {
                        const turnValue = Number.parseInt($(this).data('turn'));
                        if (turnValue)
                        {
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

    if (selectedTurns === null)
    {
        ui.notifications.info(localize('LA.notify.reactorMeltdownCancelled'));
        return;
    }

    const sourceToken = /** @type {Token|null} */ (
        (/** @type {any} */ (tokenOrActor))?.actor
            ? tokenOrActor
            : actor.token?.object || actor.getActiveTokens()[0] || null
    );
    if (sourceToken)
        playSelfDestructFX(sourceToken);

    await executeSimpleActivation(actor, {
        title: "Reactor Meltdown",
        action: { name: "Reactor Meltdown", activation: "Quick" },
        detail: localizeFormat('LA.misc.meltdownDetail', { turn: selectedTurns })
    }, { selectedTurns });
}

/** @returns {Promise<void>} */
export async function executeReactorExplosion(token)
{
    if (!token)
    {
        ui.notifications.error(localize('LA.notify.reactorExplosionNeedsToken'));
        return;
    }

    const actor = token.actor;

    await canvas.animatePan({
        x: token.center.x,
        y: token.center.y,
        scale: 1.25,
        duration: 750
    });

    const caught = await chooseToken(token, {
        pattern: "burst",
        areaRange: 2,
        includeSelf: true,
        allowEmptyConfirm: true,
        title: localize('LA.dialogTitle.reactorExplosionCaps'),
        description: localize('LA.misc.confirmTheTokensCaughtInThe'),
        icon: "fas fa-radiation",
    });
    if (!caught)
        return;

    token.control({ releaseOthers: true });

    if (caught.length)
    {
        const { completed } = await executeDamageRoll(token, caught, "4d6", "Explosive", "REACTOR EXPLOSION");
        if (!completed)
            return;
    }

    const BASE_SCALE = 0.2;
    const systemSize = Math.floor(actor?.system?.size || 1);
    const scaleFactor = (systemSize + 2) * BASE_SCALE;
    const tokenDocW = Math.max(1, token.document.width);
    const tokenDocH = Math.max(1, token.document.height);
    const tokenCenterX = token.document.x + (tokenDocW * canvas.grid.size) / 2;
    const tokenCenterY = token.document.y + (tokenDocH * canvas.grid.size) / 2;
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
        .preset("la_scaleToBurst", 2, token)
        .zIndex(100)
        .thenDo(async () =>
        {
            await token.document.delete({ laCause: 'reactor' });
        })
        .effect("jb2a.ground_cracks.01.orange")
        .persist()
        .belowTokens()
        .zIndex(1)
        .randomRotation()
        .atLocation({ x: tokenCenterX, y: tokenCenterY })
        .preset("la_scaleToBurst", 2, token)
        .thenDo(async () =>
        {
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
        .preset("la_scaleToBurst", 2, token)
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
export async function executeSimpleActivation(actorOrToken, options = {}, extraData = {})
{
    const SimpleActivationFlow = game.lancer.flows.get("SimpleActivationFlow");
    if (!SimpleActivationFlow)
        return { completed: false };
    const actor = /** @type {any} */ (actorOrToken)?.actor ?? actorOrToken;
    const item = extraData?.item;
    const uuid = item?.uuid || actor.uuid;
    const flow = new SimpleActivationFlow(uuid, options);

    if (extraData && typeof extraData === 'object')
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    const completed = await flow.begin();
    return { completed, flow };
}

/** Switch a weapon profile and run its activation (card, triggers, FX). */
export async function executeProfileSwitch(weapon, profileIndex)
{
    const profile = weapon.system?.profiles?.[profileIndex];
    if (!profile)
        return { completed: false };
    await weapon.update({ 'system.selected_profile_index': profileIndex });
    const profileName = profile.name || `Profile ${profileIndex + 1}`;
    return executeSimpleActivation(weapon.actor, {
        title: profileName,
        action: { name: profileName, activation: 'Profile' },
        detail: profile.effect ?? ''
    }, { item: weapon });
}

/**
 * Trigger a general action (Brace, Boost, ...) from its registry definition.
 * @param {any} actorOrToken
 * @param {string} name
 * @returns {Promise<{completed: boolean, flow?: object}>}
 */
export async function activateGeneralAction(actorOrToken, name)
{
    const actor = actorOrToken?.actor ?? actorOrToken;
    // general entries are either groups ({ reactions: [...] }) or flat single reactions
    const entry = ReactionManager.getGeneralReaction(name);
    const reaction = Array.isArray(entry?.reactions) ? entry.reactions[0] : (entry?.triggers ? entry : null);
    if (!actor || !reaction)
    {
        ui.notifications.error(localizeFormat('LA.notify.generalActionMissing', { name }));
        return { completed: false };
    }
    return executeSimpleActivation(actor, {
        title: name,
        action: {
            name,
            activation: String(reaction.actionType ?? 'Quick').replace(' Action', ''),
        },
        detail: reaction.effectDescription ?? ''
    });
}

/** `ranks[0].actions.1` / `system.ranks.0.actions.1` -> `ranks.0.actions.1`, so reactionPath and dotpath forms both work. */
function _subPath(path)
{
    return String(path ?? '').replace(/^system\./, '').replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
}

/**
 * Run an item activation flow, matching the dispatch rules of triggerData.startRelatedFlow.
 * @param {any} item      - LancerItem to activate.
 * @param {Object} [options] - { path?: string, flowName?: string }: `path` sets action_path, and also takes `ranks.N` or `ranks.N.actions.M` on a talent and `powers.N` on a bond. `flowName` forces a specific flow class.
 * @param {Object} [extraData] - Merged onto flow.state.la_extraData before begin().
 * @returns {Promise<{completed: boolean, flow?: any}>}
 */
export async function executeItemActivation(item, options = {}, extraData = {})
{
    if (!item)
    {
        ui.notifications.error(localize('LA.notify.executeActivationNeedsItem'));
        return { completed: false };
    }
    const flows = /** @type {any} */ (game.lancer)?.flows;
    if (!flows)
        return { completed: false };

    const { path = null, flowName = null } = options;
    let flow;
    if (flowName)
    {
        const FlowClass = flows.get(flowName);
        if (!FlowClass)
        {
            ui.notifications.error(localizeFormat('LA.notify.flowNotFoundPrefixed', { name: flowName }));
            return { completed: false };
        }
        flow = new FlowClass(item.uuid ?? item, path ? { action_path: path } : {});
    }
    else if (item.is_frame?.() && path === "system.core_system")
        flow = new (flows.get("CoreActiveFlow"))(item.uuid ?? item, { action_path: path });
    else if (item.is_talent?.())
    {
        // Talent actions live under ranks.N.actions, never system.actions, so the generic branches never match.
        const match = _subPath(path).match(/^ranks\.(\d+)(?:\.actions\.(\d+))?$/);
        const rankIdx = match ? Number(match[1]) : 0;
        const rank = item.system?.ranks?.[rankIdx];
        if (!rank)
        {
            ui.notifications.error(localizeFormat('LA.notify.itemActivationNoRank', { name: item.name, rank: rankIdx + 1 }));
            return { completed: false };
        }
        if (match?.[2] !== undefined)
            flow = new (flows.get("ActivationFlow"))(item.uuid ?? item, { action_path: `system.ranks.${rankIdx}.actions.${match[2]}` });
        else
            flow = new (flows.get("TalentFlow"))(item.uuid ?? item, { title: item.name, rank, lvl: rankIdx });
    }
    else if (item.is_bond?.())
    {
        const powerIdx = Number(_subPath(path).match(/^powers\.(\d+)$/)?.[1] ?? 0);
        if (!item.system?.powers?.[powerIdx])
        {
            ui.notifications.error(localizeFormat('LA.notify.itemActivationNoPower', { name: item.name, power: powerIdx }));
            return { completed: false };
        }
        flow = new (flows.get("BondPowerFlow"))(item.uuid ?? item, { powerIndex: powerIdx });
    }
    else if (path || item.system?.actions?.length > 0)
        flow = new (flows.get("ActivationFlow"))(item.uuid ?? item, { action_path: path ?? "system.actions.0" });
    else if (item.is_mech_system?.() || item.is_weapon_mod?.() || (item.is_npc_feature?.() && !item.is_weapon?.()))
        flow = new (flows.get("SystemFlow"))(item.uuid ?? item, {});
    else if (item.is_weapon?.())
        flow = new (flows.get("WeaponAttackFlow"))(item.uuid ?? item, {});
    else
    {
        ui.notifications.error(localize('LA.notify.executeActivationNoFlow'));
        return { completed: false };
    }
    if (extraData && typeof extraData === 'object')
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    const completed = await flow.begin();
    return { completed, flow };
}


/**
 * Update actor system data on a token, routing through the GM via socket if the current user is not the owner.
 * @param {Token} token
 * @param {object} data - Update data, e.g. { 'system.burn': 0 }
 * @returns {Promise<void>}
 */
export async function updateTokenSystem(token, data)
{
    if (!token?.actor)
        return;
    if (token.actor.isOwner)
        await token.actor.update(data);
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: 'updateActorSystem',
            payload: { actorId: token.actor.id, tokenUuid: token.document?.uuid ?? null, data }
        });
    }
}

/**
 * Token position as a plain point.
 * @param {any} tokenLike - Token or TokenDocument
 * @returns {{x: number, y: number, elevation: number}}
 */
export function getTokenPosition(tokenLike)
{
    const doc = tokenLike?.document ?? tokenLike;
    return { x: doc?.x ?? 0, y: doc?.y ?? 0, elevation: doc?.elevation ?? 0 };
}

export function getToken(idOrUuid)
{
    if (typeof idOrUuid !== 'string' || !idOrUuid)
        return null;
    const token = canvas.tokens?.get(idOrUuid);
    if (token)
        return token;
    if (!idOrUuid.includes('.'))
        return null;
    const doc = fromUuidSync(idOrUuid);
    return doc?.documentName === 'Token' ? doc.object ?? null : null;
}

/**
 * Same x / y / elevation.
 * @param {{x: number, y: number, elevation?: number}} pos1
 * @param {{x: number, y: number, elevation?: number}} pos2
 * @returns {boolean}
 */
export function samePosition(pos1, pos2)
{
    return !!pos1 && !!pos2 && pos1.x === pos2.x && pos1.y === pos2.y && (pos1.elevation ?? 0) === (pos2.elevation ?? 0);
}

/**
 * Prompts the user to choose an invade then runs the tech attack.
 * @param {Actor|Token} actorOrToken
 * @param {Object|null} [bypassChoice=null] - Preselected invade option, skips the prompt
 * @returns {Promise<void>}
 */
export async function executeInvade(actorOrToken, bypassChoice = null)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor)
    {
        ui.notifications.error(localize('LA.notify.executeInvadeNeedsTarget'));
        return;
    }

    const selected = bypassChoice ?? await chooseInvade(actor);
    if (!selected)
        return;

    if (selected.isFragmentSignal)
    {
        await executeTechAttack(actor, {
            title: selected.name,
            invade: true,
            effect: selected.detail,
            grit: actor.system.tech_attack,
            attack_type: "Tech"
        });
    }
    else
    {
        // TechAttackFlow only accepts actors and system/npc_feature items; weapons are invalid
        const isWeapon = /** @type {any} */ (selected.item)?.type?.includes('weapon');
        await executeTechAttack(!isWeapon && selected.item ? selected.item : actor, {
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
export function getActivationIcon(actionOrActivation)
{
    if (typeof actionOrActivation === 'object' && /grenade/i.test(actionOrActivation?.name ?? ''))
        return 'systems/lancer/assets/icons/white/grenade.svg';
    const isTech = actionOrActivation?.tech_attack === true;
    const activation = typeof actionOrActivation === 'string' ? actionOrActivation : (actionOrActivation?.activation || '');
    const activationLower = activation.toLowerCase();
    if (isTech || activationLower.includes('tech'))
    {
        if (activationLower.includes('full'))
            return 'systems/lancer/assets/icons/tech_full.svg';
        return 'systems/lancer/assets/icons/tech_quick.svg';
    }
    if (activationLower.includes('full'))
        return 'mdi mdi-hexagon-slice-6';
    if (activationLower.includes('protocol'))
        return 'systems/lancer/assets/icons/protocol.svg';
    if (activationLower.includes('free'))
        return 'systems/lancer/assets/icons/free_action.svg';
    if (activationLower.includes('reaction'))
        return 'systems/lancer/assets/icons/reaction.svg';
    if (activationLower.includes('quick'))
        return 'mdi mdi-hexagon-slice-3';
    if (activationLower.includes('invade'))
        return 'modules/lancer-automations/icons/cpu-shot.svg';
    return null;
}

// True if the item has the tag. Bonus-aware; accepts 'tg_smart' or 'smart'.
/** @returns {Promise<boolean>} */
export async function hasTag(item, tagLid, actor)
{
    if (!item || !tagLid)
        return false;
    const tags = await getItemTags_WithBonus(item, actor ?? item.parent ?? null);
    return tags.some(tag => tag.lid === tagLid || tag.lid === `tg_${tagLid}`);
}

// Dumps the trigger/activation params for a reaction author to the console; returns a summary object.
/** @returns {any} Summary object of everything logged */
export function debugActivation(triggerType, triggerData, token, item, activationName, label)
{
    const helpers = [];
    const fields = {};
    for (const key of Object.keys(triggerData ?? {}))
    {
        if (typeof triggerData[key] === "function")
            helpers.push(key);
        else
            fields[key] = triggerData[key];
    }
    const summary = {
        label: label ?? null,
        triggerType: triggerType ?? null,
        activationName: activationName ?? null,
        reactionPath: triggerData?.reactionPath ?? null,
        reactorToken: token ? { id: token.id, name: token.name, actorUuid: token.actor?.uuid } : null,
        item: item ? { name: item.name, type: item.type, lid: item.system?.lid, uuid: item.uuid } : null,
        helpers,
        fieldKeys: Object.keys(fields)
    };
    console.group(`lancer-automations | debugActivation | ${label ?? activationName ?? triggerType ?? "activation"}`);
    console.log("lancer-automations | triggerType:", triggerType);
    console.log("lancer-automations | activationName:", activationName);
    console.log("lancer-automations | reactorToken:", token);
    console.log("lancer-automations | item:", item);
    console.log("lancer-automations | triggerData:", triggerData);
    console.log("lancer-automations | helpers (functions on triggerData):", helpers);
    console.log("lancer-automations | fields:", fields);
    console.log("lancer-automations | summary:", summary);
    console.groupEnd();
    return summary;
}

export const MiscAPI = {
    playMineDetonationFX,
    afterFx,
    inDangerZone,
    executeStatRoll,
    executeSaveVsEffect,
    executeContestedCheck,
    attackWith,
    attackRollWith,
    hitWith,
    damageWith,
    getTokenPosition,
    getToken,
    samePosition,
    getTier,
    tierValue,
    getFlowFlag,
    setFlowFlag,
    afterFlow,
    consumeOncePerRound,
    consumeOncePerTurn,
    consumeGate,
    checkGate,
    clearGate,
    executeForceCheck,
    executeDamageRoll,
    executeBasicAttack,
    executeTechAttack,
    executeExtraActionCombat,
    executeSimpleActivation,
    executeItemActivation,
    activateGeneralAction,
    hasReactionAvailable,
    isItemUsable,
    executeReactorMeltdown,
    executeReactorExplosion,
    setReaction,
    consumeAction,
    gainAction,
    modifyAction,
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
    getSensorRange_WithBonus,
    hasTag,
    debugActivation,
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
    boostMove,
    openAddReserveDialog,
    openClocksDialog,
};

export { escapeHtml as escapeAttr } from './string-utils.js';
