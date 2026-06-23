import { ReactionManager, stringToFunction, stringToAsyncFunction } from "./reaction-manager.js";
import { displayReactionPopup, activateReaction } from "./reactions-ui.js";
import { runInFlowBody } from "./flow-queue.js";
import { getTokenOwnerUserId, startWaitCard } from "../interactive/index.js";
import { consumeEffectCharge, runInOnInitTriggerContext } from "../bonuses/flagged-effects.js";
import { getTokenDistance } from "../combat/overwatch.js";
import { getItemLID, isItemAvailable, hasReactionAvailable, executeSimpleActivation } from "../tools/misc-tools.js";
import { awaitPendingAck } from "../socket.js";

let reactionDebounceTimer = null;
let reactionQueue = [];
const REACTION_DEBOUNCE_MS = 100;
let cachedFlatGeneralReactions = null;
/** @type {Map<string, Array>} triggerType → filtered non-action reactions; cleared with cachedFlatGeneralReactions */
const cachedNonActionReactionsByTrigger = new Map();
const COMBAT_INHERENT_TRIGGERS = new Set(['onEnterCombat', 'onExitCombat', 'onTurnStart', 'onTurnEnd', 'onRoundStart']);

Hooks.on('lancer-automations.clearCaches', () => {
    cachedFlatGeneralReactions = null;
    cachedNonActionReactionsByTrigger.clear();
});

Hooks.on('createItem', (item) => {
    if (!item.parent)
        return;
    const itemTypes = new Set(["frame", "mech_system", "mech_weapon", "npc_feature", "pilot_gear", "talent"]);
    if (!itemTypes.has(item.type))
        return;
    let tokens;
    if (item.parent.isToken) {
        const t = canvas.tokens?.placeables?.find(t => t.document === item.parent.token);
        tokens = t ? [t] : [];
    } else {
        tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === item.parent.id) ?? [];
    }
    for (const token of tokens)
        checkOnInitReactions(token, item);
});

function checkDispositionFilter(reactorToken, triggeringToken, dispositionFilter) {
    if (!dispositionFilter || dispositionFilter.length === 0)
        return true;
    if (!triggeringToken)
        return true;

    const tokenFactions = game.modules.get("token-factions")?.api;
    let disposition;

    if (tokenFactions && typeof tokenFactions.getDisposition === 'function') {
        disposition = tokenFactions.getDisposition(reactorToken, triggeringToken);
    } else {
        disposition = triggeringToken.document.disposition;
    }

    const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    const NEUTRAL = CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
    const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;

    if (disposition === FRIENDLY && dispositionFilter.includes('friendly'))
        return true;
    if (disposition === NEUTRAL && dispositionFilter.includes('neutral'))
        return true;
    if (disposition === HOSTILE && dispositionFilter.includes('hostile'))
        return true;
    if (disposition === SECRET && dispositionFilter.includes('secret'))
        return true;

    return false;
}

export function getReactionItems(token) {
    const actor = token.actor;
    if (!actor)
        return [];

    const itemTypes = new Set(["frame", "mech_system", "mech_weapon", "npc_feature", "pilot_gear", "talent"]);
    let items = actor.items.filter(item => itemTypes.has(item.type));

    if (actor.type === "mech") {
        let pilot = null;
        const pilotRef = actor.system.pilot;

        if (pilotRef) {
            if (typeof pilotRef === 'object' && pilotRef.id) {
                const idStr = pilotRef.id;
                pilot = idStr.startsWith('Actor.') ? fromUuidSync(idStr) : game.actors.get(idStr);
            } else if (typeof pilotRef === 'string') {
                pilot = pilotRef.startsWith('Actor.') ? fromUuidSync(pilotRef) : game.actors.get(pilotRef);
            }
        }

        if (pilot) {
            const pilotItems = pilot.items.filter(item => itemTypes.has(item.type));
            items = items.concat(pilotItems);
        }
    }

    // Deployables have no items: synthesize a surrogate keyed by the deployable's LID
    // so reactions registered against `dep_*` resolve.
    if (actor.type === "deployable" && actor.system?.lid) {
        items = items.concat([{
            name: actor.name,
            type: "deployable_surrogate",
            system: {
                lid: actor.system.lid,
                tags: [],
                destroyed: actor.system.destroyed === true,
                disabled: actor.system.disabled === true,
                actions: actor.system.actions || []
            },
            getFlag: () => null,
            _deployableSurrogate: true,
            _deployableActor: actor
        }]);
    }

    // Surrogate for actor-UUID-keyed reactions (e.g. "Actor.qe5wEevLrMN6ki44").
    if (actor.uuid) {
        items = items.concat([{
            name: actor.name,
            type: "actor_surrogate",
            system: {
                lid: actor.uuid,
                tags: [],
                destroyed: actor.system?.destroyed === true,
                disabled: actor.system?.disabled === true,
                actions: actor.system?.actions || []
            },
            getFlag: () => null,
            _actorSurrogate: true,
            _surrogateActor: actor
        }]);
    }

    return items;
}

function getCombatTokens() {
    if (!game.combat)
        return [];

    return canvas.tokens.placeables.filter(token => {
        if (!token.inCombat)
            return false;
        if (!token.actor)
            return false;
        return true;
    });
}

function getAllSceneTokens() {
    return canvas.tokens.placeables.filter(token => {
        if (!token.actor)
            return false;
        return true;
    });
}

export async function checkOnInitReactions(token, filterItem = null) {
    return runInOnInitTriggerContext(() => _checkOnInitReactionsBody(token, filterItem));
}

async function _checkOnInitReactionsBody(token, filterItem = null) {
    const api = game.modules.get('lancer-automations').api;
    const items = filterItem ? [filterItem] : getReactionItems(token);

    for (const item of items) {
        const lid = getItemLID(item);
        if (!lid)
            continue;

        const registryEntry = ReactionManager.getReactions(lid);
        if (!registryEntry)
            continue;

        for (const reaction of registryEntry.reactions) {
            if (reaction.enabled === false)
                continue;
            if (!reaction.onInit)
                continue;

            const reactionPath = reaction.reactionPath || "";
            if (!isItemAvailable(item, reactionPath))
                continue;

            try {
                if (typeof reaction.onInit === 'function') {
                    await reaction.onInit(token, item, api);
                } else if (typeof reaction.onInit === 'string' && reaction.onInit.trim() !== '') {
                    const onInitFunc = stringToFunction(reaction.onInit, ["token", "item", "api"]);
                    await onInitFunc(token, item, api);
                }
            } catch (error) {
                console.error(`lancer-automations | Error executing onInit for ${item.name}:`, error);
            }
        }
    }

    const generalReactions = ReactionManager.getGeneralReactions();
    for (const [name, reaction] of Object.entries(generalReactions)) {
        if (reaction.enabled === false)
            continue;
        if (!reaction.onInit)
            continue;

        try {
            if (typeof reaction.onInit === 'function') {
                await reaction.onInit(token, null, api);
            } else if (typeof reaction.onInit === 'string' && reaction.onInit.trim() !== '') {
                const onInitFunc = stringToFunction(reaction.onInit, ["token", "item", "api"]);
                await onInitFunc(token, null, api);
            }
        } catch (error) {
            console.error(`lancer-automations | Error executing onInit for General Activation ${name}:`, error);
        }
    }
}

export async function checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data) {
    const api = game.modules.get('lancer-automations').api;
    if (itemLid) {
        const items = getReactionItems(token);
        for (const item of items) {
            if (getItemLID(item) !== itemLid)
                continue;
            const registryEntry = ReactionManager.getReactions(itemLid);
            if (!registryEntry)
                continue;
            for (const reaction of registryEntry.reactions) {
                if (reaction.enabled === false)
                    continue;
                if ((reaction.reactionPath || "") !== (reactionPath || ""))
                    continue;
                if (!reaction.onMessage)
                    continue;
                try {
                    let result;
                    if (typeof reaction.onMessage === 'function') {
                        result = await reaction.onMessage(triggerType, data, token, item, activationName, api);
                    } else if (typeof reaction.onMessage === 'string' && reaction.onMessage.trim()) {
                        const fn = stringToAsyncFunction(reaction.onMessage, ["triggerType", "data", "reactorToken", "item", "activationName", "api"]);
                        result = await fn(triggerType, data, token, item, activationName, api);
                    }
                    return result;
                } catch (e) {
                    console.error(`lancer-automations | Error in onMessage for ${item.name}:`, e);
                }
            }
            break;
        }
    } else {
        const generalReactions = ReactionManager.getGeneralReactions();
        for (const [name, reaction] of Object.entries(generalReactions)) {
            if (reaction.enabled === false)
                continue;
            if (name !== activationName)
                continue;
            if (!reaction.onMessage)
                continue;
            try {
                if (typeof reaction.onMessage === 'function') {
                    await reaction.onMessage(triggerType, data, token, null, activationName, api);
                } else if (typeof reaction.onMessage === 'string' && reaction.onMessage.trim()) {
                    const fn = stringToAsyncFunction(reaction.onMessage, ["triggerType", "data", "reactorToken", "item", "activationName", "api"]);
                    await fn(triggerType, data, token, null, activationName, api);
                }
            } catch (e) {
                console.error(`lancer-automations | Error in onMessage for general reaction ${name}:`, e);
            }
        }
    }
}

Hooks.on('lancer-automations.runOnMessage', ({ token, itemLid, reactionPath, activationName, triggerType, data }) => {
    checkOnMessageReactions(token, itemLid ?? null, reactionPath ?? null, activationName ?? null, triggerType, data)
        .catch(e => console.error('lancer-automations | onMessage error:', e));
});

function evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat) {
    const cancelledBy = data._cancelledBy;
    if (cancelledBy?.length > 0) {
        const isCancelled = cancelledBy.some(c =>
            c.tokenId === token.id && c.reactionName === reactionName
        );
        if (isCancelled)
            return null;
    }
    const combatInherentTriggers = ['onEnterCombat', 'onExitCombat', 'onTurnStart', 'onTurnEnd', 'onRoundStart'];
    if (!isInCombat && !reaction.outOfCombat && !combatInherentTriggers.includes(triggerType)) {
        if ((token?.isOwner || game.user.isGM) && game.settings.get('lancer-automations', 'debugOutOfCombat'))
            ui.notifications.warn(`${reactionName} (${token?.name ?? '?'}): not triggered, out of combat.`);
        return null;
    }
    if (isSelf && !reaction.triggerSelf)
        return null;
    if (!isSelf && reaction.triggerOther === false)
        return null;
    if (reaction.checkReaction && !hasReactionAvailable(token))
        return null;
    if (!checkDispositionFilter(token, data.triggeringToken, reaction.dispositionFilter))
        return null;

    try {
        const api = game.modules.get('lancer-automations').api;
        const sourceToken = data.triggeringToken;
        const distanceToTrigger = (sourceToken && token) ? getTokenDistance(token, sourceToken) : null;
        const canTriggerReaction = api.canProvokeReaction(sourceToken, token);
        if (reaction.requireCanProvoke && !canTriggerReaction)
            return null;
        const enrichedData = { ...data, distanceToTrigger, canTriggerReaction };

        let shouldTrigger = false;
        if (typeof reaction.evaluate === 'function') {
            const result = reaction.evaluate(triggerType, enrichedData, token, null, reactionName, api);
            if (result instanceof Promise) {
                console.error(`lancer-automations | evaluate for "${reactionName}" is async. Evaluate functions must be synchronous.`);
                result.then(val => { /* fire-and-forget async evaluate */ });
                shouldTrigger = false;
            } else {
                shouldTrigger = result;
            }
        } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], reaction);
            const result = evalFunc(triggerType, enrichedData, token, null, reactionName, api);
            if (result instanceof Promise) {
                console.error(`lancer-automations | String evaluate for "${reactionName}" returned a Promise. Evaluate functions must be synchronous.`);
                shouldTrigger = false;
            } else {
                shouldTrigger = result;
            }
        } else {
            shouldTrigger = true;
        }

        return shouldTrigger ? enrichedData : null;
    } catch (error) {
        console.error(`lancer-automations | Error evaluating general reaction ${reactionName}:`, error);
        return null;
    }
}

// Generic flow launcher: injects extraData into flow.state.la_extraData before begin().
async function _beginFlow(flowName, target, options = {}, extraData = {}) {
    const FlowClass = game.lancer.flows.get(flowName);
    if (!FlowClass) {
        ui.notifications.warn(`lancer-automations | Flow "${flowName}" not found.`);
        return null;
    }
    const flow = new FlowClass(target, options);
    if (extraData && typeof extraData === 'object' && Object.keys(extraData).length > 0)
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    return flow.begin();
}

function _buildSendMessageToReactor(token, item, reactionPath, activationName, triggerType) {
    const itemLid = item ? getItemLID(item) : null;
    return async (data, userId = null, { wait = false, waitTitle = null, waitDescription = null, waitItem = null, waitOriginToken = null, waitRelatedToken = null } = {}) => {
        let targetUserId = userId;
        if (!targetUserId) {
            const ownerIds = getTokenOwnerUserId(token);
            if (ownerIds.includes(game.user.id)) {
                await checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data);
                return;
            }
            targetUserId = ownerIds.at(0) ?? null;
            console.warn(`lancer-automations | sendMessageToReactor: no userId provided, falling back to token owner "${targetUserId}" for ${token.name}.`);
        }
        if (!targetUserId || targetUserId === game.user.id) {
            return await checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data);
        }
        const requestId = wait ? `omsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        game.socket.emit('module.lancer-automations', {
            action: 'onMessage',
            payload: { userId: targetUserId, reactorTokenId: token.id, itemLid, reactionPath, activationName, triggerType, data, requestId }
        });
        if (wait && requestId) {
            const waitCard = (waitTitle || waitDescription)
                ? startWaitCard({
                    title: waitTitle ?? 'WAITING',
                    description: waitDescription ?? '',
                    waitMessage: `Waiting for ${game.users.get(targetUserId)?.name ?? 'remote user'}…`,
                    item: waitItem,
                    originToken: waitOriginToken ?? token,
                    relatedToken: waitRelatedToken
                })
                : null;
            try {
                return await awaitPendingAck(requestId);
            } finally {
                waitCard?.remove();
            }
        }
    };
}

export function _buildStartRelatedFlow(token, item, reaction, activationName, extraData = {}) {
    return async () => {
        if (item) {
            const reactionPath = reaction?.reactionPath;
            if (reactionPath) {
                const activationPath = reactionPath.startsWith("system.") ? reactionPath : `system.${reactionPath}`;
                return _beginFlow("ActivationFlow", item, { action_path: activationPath }, extraData);
            }
            if (item.is_weapon?.()) {
                return _beginFlow("WeaponAttackFlow", item, {}, extraData);
            }
            if (item.system?.actions?.length > 0) {
                const actionIndex = item.system.actions.findIndex(a => a.activation === 'Reaction');
                const path = actionIndex >= 0 ? `system.actions.${actionIndex}` : 'system.actions.0';
                return _beginFlow("ActivationFlow", item, { action_path: path }, extraData);
            }
            if (item.beginSystemFlow) {
                return _beginFlow("SystemFlow", item, {}, extraData);
            }
            return executeSimpleActivation(token.actor, { title: item.name, action: { name: item.name } }, { item, ...extraData });
        }

        const actor = token?.actor;
        if (!actor) {
            ui.notifications.warn('lancer-automations | startRelatedFlow: no actor found.');
            return;
        }
        const actionType = reaction?.actionType || 'Reaction';
        if (['Automatic', 'Other'].includes(actionType)) {
            ui.notifications.warn(`lancer-automations | startRelatedFlow: action type "${actionType}" will be launched but may not behave as expected.`);
        }
        const name = activationName || 'Unknown';
        return executeSimpleActivation(actor, {
            title: name,
            action: { name, activation: actionType },
            detail: reaction?.effectDescription || ''
        }, extraData);
    };
}

function _buildStartRelatedFlowToReactor(token, item, reaction, activationName) {
    const itemLid = item ? getItemLID(item) : null;
    const reactionPath = reaction?.reactionPath || "";
    const actionType = reaction?.actionType || 'Reaction';
    const effectDescription = reaction?.effectDescription || '';
    return async (userId = null, extraData = {}, { wait = false, waitTitle = null, waitDescription = null, waitItem = null, waitOriginToken = null, waitRelatedToken = null } = {}) => {
        let targetUserId = userId;
        if (!targetUserId) {
            const ownerIds = getTokenOwnerUserId(token);
            if (ownerIds.includes(game.user.id)) {
                return _buildStartRelatedFlow(token, item, reaction, activationName, extraData)();
            }
            targetUserId = ownerIds.at(0) ?? null;
        }
        if (!targetUserId || targetUserId === game.user.id) {
            return _buildStartRelatedFlow(token, item, reaction, activationName, extraData)();
        }
        const requestId = wait ? `srf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        game.socket.emit('module.lancer-automations', {
            action: 'startRelatedFlow',
            payload: { userId: targetUserId, reactorTokenId: token.id, itemLid, reactionPath, activationName, actionType, effectDescription, extraData: extraData ?? {}, requestId }
        });
        if (wait && requestId) {
            const waitCard = (waitTitle || waitDescription)
                ? startWaitCard({
                    title: waitTitle ?? 'WAITING',
                    description: waitDescription ?? '',
                    waitMessage: `Waiting for ${game.users.get(targetUserId)?.name ?? 'remote user'}…`,
                    item: waitItem ?? item,
                    originToken: waitOriginToken ?? token,
                    relatedToken: waitRelatedToken
                })
                : null;
            try {
                await awaitPendingAck(requestId);
            } finally {
                waitCard?.remove();
            }
        }
    };
}

// Triggers where a reactor's cancel leads to a redo. autoActivate reactions
// fire sequentially and stop as soon as one cancels; the redo re-runs the rest
// with _cancelledBy populated, so no reactor is lost.
const CANCELLABLE_TRIGGERS = new Set([
    'onPreMove', 'onPreStructure', 'onPreStress',
    'onPreStatusApplied', 'onPreStatusRemoved',
    'onPreHpChange', 'onPreHeatChange',
]);

function debugAutomationOn() {
    try {
        return !!game.settings.get('lancer-automations', 'debugAutomation');
    } catch {
        return false;
    }
}

function dbgAuto(...args) {
    if (debugAutomationOn())
        console.log('[LA debug]', ...args);
}

const _laConfigWarnedSet = new Set();
function _warnReactionConfigOnce(key, message) {
    if (_laConfigWarnedSet.has(key))
        return;
    _laConfigWarnedSet.add(key);
    ui.notifications.warn(`lancer-automations | ${message}`);
    console.warn(`lancer-automations | ${message}`);
}

async function checkReactions(triggerType, data) {
    const allTokens = getAllSceneTokens();
    const reactionsPromises = [];
    const deferredFactories = [];
    const isCancellable = CANCELLABLE_TRIGGERS.has(triggerType);
    // Re-stamp reactor identity on shared cancel/change/reroll/modify fns right before
    // activation fires; the last eval-loop assignment would otherwise win.
    const applyReactorIdentity = (rtd, identity, context) => {
        for (const key of Object.keys(rtd)) {
            if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll') || key.startsWith('modify')) && typeof rtd[key] === 'function') {
                rtd[key]._reactorIdentity = identity;
                rtd[key]._defaultContext = context;
            }
        }
    };
    const api = game.modules.get('lancer-automations').api;

    // Flatten general reactions: entries with a "reactions" array expand into sub-reactions.
    if (!cachedFlatGeneralReactions) {
        const generalReactions = ReactionManager.getGeneralReactions();
        cachedFlatGeneralReactions = [];
        for (const [reactionName, entry] of Object.entries(generalReactions)) {
            if (Array.isArray(entry.reactions)) {
                for (const subReaction of entry.reactions) {
                    cachedFlatGeneralReactions.push([reactionName, { ...subReaction, enabled: subReaction.enabled ?? entry.enabled }]);
                }
            } else {
                cachedFlatGeneralReactions.push([reactionName, entry]);
            }
        }
    }
    const flatGeneralReactions = cachedFlatGeneralReactions;

    let actionBasedReaction = null;
    if (data.actionName) {
        const found = flatGeneralReactions.find(([name, r]) =>
            name === data.actionName && r.onlyOnSourceMatch && r.triggers?.includes(triggerType));
        if (found)
            actionBasedReaction = { name: found[0], reaction: found[1] };
    }

    if (!cachedNonActionReactionsByTrigger.has(triggerType)) {
        const filtered = [];
        for (const [reactionName, reaction] of flatGeneralReactions) {
            if (reaction.onlyOnSourceMatch)
                continue;
            if (!reaction.triggers?.includes(triggerType))
                continue;
            if (reaction.enabled === false)
                continue;
            filtered.push([reactionName, reaction]);
        }
        cachedNonActionReactionsByTrigger.set(triggerType, filtered);
    }
    const nonActionBasedReactions = cachedNonActionReactionsByTrigger.get(triggerType);

    const hasValidActionBasedReaction = actionBasedReaction &&
        actionBasedReaction.reaction.enabled !== false;

    const triggeringTokenHidden = !!data.triggeringToken?.document?.hidden;

    // Cancellable triggers: process the mover (self-reactions) first so reroute-style
    // reactions (Engagement) run before reactors on the original path (Overwatch).
    const orderedTokens = isCancellable && data.triggeringToken
        ? [...allTokens].sort((a, b) => {
            const aSelf = a.id === data.triggeringToken.id ? 1 : 0;
            const bSelf = b.id === data.triggeringToken.id ? 1 : 0;
            return bSelf - aSelf;
        })
        : allTokens;

    for (const token of orderedTokens) {
        const isSelf = data.triggeringToken?.id === token.id;
        // Hidden triggering tokens: only self-reactions fire.
        if (triggeringTokenHidden && !isSelf)
            continue;
        const isInCombat = token.inCombat;

        const sourceToken = data.triggeringToken;
        const distanceToTrigger = sourceToken ? getTokenDistance(token, sourceToken) : null;
        const canTriggerReaction = api.canProvokeReaction(sourceToken, token);
        const enrichedData = { ...data, distanceToTrigger, canTriggerReaction };

        const items = getReactionItems(token);
        for (const item of items) {
            const lid = getItemLID(item);
            if (!lid)
                continue;

            const registryEntry = ReactionManager.getReactions(lid);
            if (!registryEntry)
                continue;

            for (const reaction of registryEntry.reactions) {
                if (!reaction.triggers?.includes(triggerType))
                    continue;
                if (reaction.enabled === false) {
                    dbgAuto('skip:', token.name, item.name, lid, 'reaction disabled');
                    continue;
                }

                dbgAuto('match:', token.name, item.name, lid, { triggers: reaction.triggers });

                if (reaction.onlyOnSourceMatch) {
                    const triggeringItem = data.weapon || data.techItem || data.item;
                    const triggeringItemLid = triggeringItem?.system?.lid ?? null;
                    const triggeringDepLid = data.deployable?.lid ?? null;
                    const triggeringActorUuid = data.triggeringToken?.actor?.uuid ?? null;
                    if (triggeringItemLid !== lid && triggeringDepLid !== lid && triggeringActorUuid !== lid) {
                        dbgAuto('skip:', token.name, item.name, 'onlyOnSourceMatch failed', { triggeringItemLid, triggeringDepLid, triggeringActorUuid, lid });
                        continue;
                    }
                    // Same-LID dedupe: when reactor owns multiple items sharing this LID, only the exact triggering doc fires.
                    if (triggeringItem && triggeringItemLid === lid && triggeringItem.id !== item.id) {
                        dbgAuto('skip:', token.name, item.name, 'onlyOnSourceMatch: not the triggering doc');
                        continue;
                    }
                }

                if (!isInCombat && !reaction.outOfCombat && !COMBAT_INHERENT_TRIGGERS.has(triggerType)) {
                    if ((token.isOwner || game.user.isGM) && game.settings.get('lancer-automations', 'debugOutOfCombat'))
                        ui.notifications.warn(`${item.name} (${token.name}): not triggered, out of combat.`);
                    if (triggerType === 'onActivation' && (token.isOwner || game.user.isGM))
                        _warnReactionConfigOnce(`ooc|${lid}|${reaction.reactionPath || ''}`, `"${item.name}" only triggers in combat. Enable "Out of Combat" to allow it outside.`);
                    dbgAuto('skip:', token.name, item.name, 'out of combat');
                    continue;
                }

                if (isSelf) {
                    if (!reaction.triggerSelf) {
                        dbgAuto('skip:', token.name, item.name, 'isSelf and !triggerSelf');
                        continue;
                    }
                } else {
                    if (reaction.triggerOther === false) {
                        dbgAuto('skip:', token.name, item.name, '!isSelf and triggerOther=false');
                        continue;
                    }
                }

                if (reaction.checkReaction && !hasReactionAvailable(token)) {
                    dbgAuto('skip:', token.name, item.name, 'no reaction available');
                    continue;
                }

                if (reaction.requireCanProvoke && !canTriggerReaction) {
                    dbgAuto('skip:', token.name, item.name, 'cannot provoke');
                    continue;
                }

                const reactionPath = reaction.reactionPath || "";
                if (!isItemAvailable(item, reactionPath)) {
                    dbgAuto('skip:', token.name, item.name, 'item not available (destroyed/disabled/rank)');
                    continue;
                }

                if (reaction.checkUsage) {
                    const sys = item.system;
                    const tags = sys?.tags ?? [];
                    const hasTag = lid => tags.some(t => t?.lid === lid);
                    const tagVal = lid => Number(tags.find(t => t?.lid === lid)?.val ?? 0);
                    const hasLoading = hasTag('tg_loading');
                    const hasRecharge = hasTag('tg_recharge');
                    const hasUses = sys?.uses?.max > 0;
                    const perRoundLimit = game.combat?.started && game.settings.get('lancer-automations', 'enablePerRoundTurnTags') ? tagVal('tg_round') : 0;
                    const perTurnLimit = game.combat?.started && game.settings.get('lancer-automations', 'enablePerRoundTurnTags') ? tagVal('tg_turn') : 0;
                    if (!hasLoading && !hasRecharge && !hasUses && !perRoundLimit && !perTurnLimit && (token.isOwner || game.user.isGM))
                        _warnReactionConfigOnce(`usage|${lid}|${reaction.reactionPath || ''}`, `"${item.name}" has Check Usage enabled but no loading, recharge, limited uses, or per-round/turn tag. The check has no effect.`);
                    if (hasLoading && sys?.loaded === false) {
                        dbgAuto('skip:', token.name, item.name, 'not loaded');
                        continue;
                    }
                    if (hasUses && sys.uses.value <= 0) {
                        dbgAuto('skip:', token.name, item.name, 'no uses left');
                        continue;
                    }
                    if (hasRecharge && sys?.charged === false) {
                        dbgAuto('skip:', token.name, item.name, 'not charged');
                        continue;
                    }
                    if (perRoundLimit > 0 && Number(sys?.uses_per_round?.value ?? 0) >= perRoundLimit) {
                        dbgAuto('skip:', token.name, item.name, 'per-round limit reached');
                        continue;
                    }
                    if (perTurnLimit > 0 && Number(sys?.uses_per_turn?.value ?? 0) >= perTurnLimit) {
                        dbgAuto('skip:', token.name, item.name, 'per-turn limit reached');
                        continue;
                    }
                }

                if (!checkDispositionFilter(token, data.triggeringToken, reaction.dispositionFilter)) {
                    dbgAuto('skip:', token.name, item.name, 'disposition filter failed');
                    continue;
                }

                try {
                    let activationName = item.name;
                    const reactionPath = reaction.reactionPath || "";

                    if (reactionPath && reactionPath !== "" && reactionPath !== "system" && reactionPath !== "system.trigger") {
                        let actionData = null;

                        if (reactionPath.startsWith("extraActions.")) {
                            const actionName = reactionPath.slice("extraActions.".length);
                            const extraActions = item.getFlag?.('lancer-automations', 'extraActions') || [];
                            actionData = extraActions.find(a => a.name === actionName) ?? null;
                        } else if (reactionPath.startsWith("actions.")) {
                            // Lookup-by-name for deployables whose action LIDs are empty strings (name is the only key).
                            const actionName = reactionPath.slice("actions.".length);
                            const list = item.system?.actions ?? [];
                            actionData = list.find(a => a.name === actionName) ?? null;
                        } else {
                            const pathParts = reactionPath.split(/\.|\[|\]/).filter(p => p !== "");
                            actionData = item.system;
                            for (const part of pathParts) {
                                if (actionData && (typeof actionData === 'object' || Array.isArray(actionData))) {
                                    actionData = actionData[part];
                                } else {
                                    actionData = null;
                                    break;
                                }
                            }
                            // Frame core_system: `name` is the system title, `active_name` is the activation that fires.
                            if (actionData && reactionPath === 'core_system' && actionData.active_name)
                                actionData = { ...actionData, name: actionData.active_name };
                        }

                        if (actionData?.name) {
                            activationName = actionData.name;
                            if (data.actionName && data.actionName !== activationName)
                                continue;
                        }
                    } else if (reaction.onlyOnSourceMatch && data.actionName && data.actionName !== item.name) {
                        // No reactionPath: skip when a specific sub-action was triggered (not the base item)
                        continue;
                    }

                    // Skip if this reaction already triggered a cancel on a previous pass
                    const cancelledBy = enrichedData._cancelledBy;
                    if (cancelledBy?.length > 0) {
                        const isCancelled = cancelledBy.some(c =>
                            c.tokenId === token.id && c.lid === lid && c.reactionPath === (reaction.reactionPath || "")
                        );
                        if (isCancelled)
                            continue;
                    }

                    let shouldTrigger = false;

                    if (typeof reaction.evaluate === 'function') {
                        const result = reaction.evaluate(triggerType, enrichedData, token, item, activationName, api);
                        if (result instanceof Promise) {
                            console.error(`lancer-automations | evaluate for "${item.name}" is async. Evaluate functions must be synchronous.`);
                            result.then(val => { /* fire-and-forget */ });
                            shouldTrigger = false;
                        } else {
                            shouldTrigger = result;
                        }
                        dbgAuto('evaluate(fn):', token.name, item.name, '→', shouldTrigger);
                    } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
                        try {
                            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], reaction);
                            const result = evalFunc(triggerType, enrichedData, token, item, activationName, api);
                            if (result instanceof Promise) {
                                console.error(`lancer-automations | String evaluate for "${item.name}" returned a Promise. Evaluate functions must be synchronous.`);
                                shouldTrigger = false;
                            } else {
                                shouldTrigger = result;
                            }
                        } catch (e) {
                            console.error(`lancer-automations | Error parsing custom evaluate for ${item.name}:`, e);
                        }
                    } else {
                        shouldTrigger = true;
                        dbgAuto('evaluate(none):', token.name, item.name, '→ default true');
                    }

                    if (shouldTrigger) {
                        dbgAuto('fire:', token.name, item.name, 'autoActivate:', !!reaction.autoActivate);
                        const reactionTriggerData = { ...enrichedData,
                            startRelatedFlow: _buildStartRelatedFlow(token, item, reaction, activationName),
                            startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, item, reaction, activationName),
                            sendMessageToReactor: _buildSendMessageToReactor(token, item, reactionPath, activationName, triggerType)
                        };
                        const reactorIdentity = { tokenId: token.id, lid, reactionPath: reaction.reactionPath || "" };
                        const defaultCancelContext = { item, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };

                        for (const key of Object.keys(reactionTriggerData)) {
                            if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll') || key.startsWith('modify')) && typeof reactionTriggerData[key] === 'function') {
                                reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                                reactionTriggerData[key]._defaultContext = defaultCancelContext;
                            }
                        }

                        if (reaction.autoActivate) {
                            if (isCancellable) {
                                deferredFactories.push(() => {
                                    applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                                    return activateReaction(triggerType, reactionTriggerData, token, item, activationName, reaction, false);
                                });
                            } else {
                                try {
                                    const p = activateReaction(triggerType, reactionTriggerData, token, item, activationName, reaction, false);
                                    if (p instanceof Promise) {
                                        p.catch(error => console.error(`lancer-automations | Error auto-activating reaction:`, error));
                                        if (reaction.awaitActivationCompletion !== false) {
                                            reactionsPromises.push(p);
                                        }
                                    }
                                } catch (error) {
                                    console.error(`lancer-automations | Error auto-activating reaction:`, error);
                                }
                            }
                        } else {
                            reactionQueue.push({
                                triggerType,
                                token,
                                item,
                                reaction,
                                itemName: item.name,
                                reactionName: activationName,
                                triggerData: reactionTriggerData
                            });
                        }
                    }
                } catch (error) {
                    console.error(`lancer-automations | Error evaluating reaction ${item.name}:`, error);
                }
            }
        }

        if (hasValidActionBasedReaction) {
            const reactionName = actionBasedReaction.name;
            const reaction = actionBasedReaction.reaction;
            const enrichedData = evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat);
            if (enrichedData) {
                const reactionTriggerData = { ...enrichedData,
                    startRelatedFlow: _buildStartRelatedFlow(token, null, reaction, reactionName),
                    startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, reaction, reactionName),
                    sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType)
                };

                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };
                for (const key of Object.keys(reactionTriggerData)) {
                    if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll')) && typeof reactionTriggerData[key] === 'function') {
                        reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                        reactionTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }

                if (reaction.autoActivate) {
                    if (isCancellable) {
                        deferredFactories.push(() => {
                            applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                            return activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                        });
                    } else {
                        try {
                            const p = activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                            if (p instanceof Promise) {
                                p.catch(error => console.error(`lancer-automations | Error auto-activating general reaction:`, error));
                                if (reaction.awaitActivationCompletion !== false) {
                                    reactionsPromises.push(p);
                                }
                            }
                        } catch (error) {
                            console.error(`lancer-automations | Error auto-activating general reaction:`, error);
                        }
                    }
                } else {
                    reactionQueue.push({
                        triggerType,
                        token,
                        item: null,
                        reaction,
                        itemName: reactionName,
                        reactionName,
                        isGeneral: true,
                        triggerData: reactionTriggerData
                    });
                }
            }
        }

        for (const [reactionName, reaction] of nonActionBasedReactions) {
            const enrichedData = evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat);
            if (enrichedData) {
                const reactionTriggerData = { ...enrichedData,
                    startRelatedFlow: _buildStartRelatedFlow(token, null, reaction, reactionName),
                    startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, reaction, reactionName),
                    sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType)
                };

                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };
                for (const key of Object.keys(reactionTriggerData)) {
                    if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll')) && typeof reactionTriggerData[key] === 'function') {
                        reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                        reactionTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }

                if (reaction.autoActivate) {
                    if (isCancellable) {
                        deferredFactories.push(() => {
                            applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                            return activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                        });
                    } else {
                        try {
                            const p = activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                            if (p instanceof Promise) {
                                p.catch(error => console.error(`lancer-automations | Error auto-activating general reaction:`, error));
                                if (reaction.awaitActivationCompletion !== false) {
                                    reactionsPromises.push(p);
                                }
                            }
                        } catch (error) {
                            console.error(`lancer-automations | Error auto-activating general reaction:`, error);
                        }
                    }
                } else {
                    reactionQueue.push({
                        triggerType,
                        token,
                        item: null,
                        reaction,
                        itemName: reactionName,
                        reactionName,
                        isGeneral: true,
                        triggerData: reactionTriggerData
                    });
                }
            }
        }
    }

    // Cancellable triggers must run BEFORE awaiting other reactionsPromises so the first
    // factory's synchronous setFlag() fires in the same tick as the caller (e.g.
    // preUpdateToken's `if (cancelUpdate) return false`).
    if (isCancellable && deferredFactories.length > 0) {
        const startLen = data._cancelledBy?.length ?? 0;
        const cancelRaised = () => (data._cancelledBy?.length ?? 0) > startLen;
        for (const factory of deferredFactories) {
            try {
                const p = factory();
                if (p instanceof Promise)
                    p.catch(e => console.error('lancer-automations | async reaction error:', e));
                if (cancelRaised())
                    break;
            } catch (e) {
                console.error('lancer-automations | reaction error:', e);
            }
        }
    }

    if (reactionsPromises.length > 0) {
        await Promise.all(reactionsPromises);
    }

    if (reactionDebounceTimer) {
        clearTimeout(reactionDebounceTimer);
    }

    reactionDebounceTimer = setTimeout(async () => {
        if (reactionQueue.length > 0) {
            const manualReactions = [...reactionQueue];
            reactionQueue.length = 0;

            if (manualReactions.length > 0) {
                const mode = game.settings.get('lancer-automations', 'reactionNotificationMode');
                const distribution = new Map();

                const allGMs = game.users.filter(u => u.active && u.isGM);

                for (const r of manualReactions) {
                    const recipients = new Set();

                    if (mode === 'owner' || mode === 'both') {
                        const owners = game.users.filter(u => u.active && !u.isGM && r.token.document.testUserPermission(u, "OWNER"));
                        owners.forEach(u => recipients.add(u));
                    }

                    if (mode === 'gm' || mode === 'both') {
                        allGMs.forEach(u => recipients.add(u));
                    }

                    for (const user of recipients) {
                        if (!distribution.has(user.id))
                            distribution.set(user.id, []);
                        distribution.get(user.id).push(r);
                    }
                }

                const mainTrigger = manualReactions[0].triggerType;

                for (const [userId, reactions] of distribution) {
                    if (userId === game.userId) {
                        displayReactionPopup(mainTrigger, reactions);
                    } else {
                        const payload = {
                            targetUserId: userId,
                            triggerType: mainTrigger,
                            reactions: reactions.map(r => ({
                                tokenId: r.token.id,
                                itemId: r.item?.id,
                                reactionName: r.reactionName,
                                itemName: r.itemName,
                                isGeneral: r.isGeneral,
                                triggerData: serializeTriggerData(r.triggerData)
                            }))
                        };
                        game.socket.emit('module.lancer-automations', {
                            action: 'showReactionPopup',
                            payload: payload
                        });
                    }
                }
            }

            reactionQueue = [];
            reactionDebounceTimer = null;
        }
    }, REACTION_DEBOUNCE_MS);
}

// Origin can appear as triggering token, single target, or in targets array.
function isOriginInvolved(originId, triggerType, data) {
    if (data.triggeringToken?.id === originId)
        return true;
    if (data.target?.id === originId)
        return true;
    if (data.targets && Array.isArray(data.targets)) {
        if (data.targets.some(t => t.id === originId))
            return true;
    }
    return false;
}

// Returns true if all set filters in consumption pass against trigger data.
function passesBuiltInFilters(consumption, triggerType, data) {
    if (consumption.itemLid) {
        const triggeringItem = data.weapon || data.techItem || data.item;
        const currentLid = triggeringItem?.system?.lid;
        if (!currentLid)
            return false;

        const validLids = consumption.itemLid.split(',').map(s => s.trim()).filter(Boolean);
        if (!validLids.includes(currentLid))
            return false;
    }
    if (consumption.itemId) {
        const triggeringItem = data.weapon || data.techItem || data.item;
        if (!triggeringItem)
            return false;
        const id = triggeringItem.id || triggeringItem._id;
        if (id !== consumption.itemId)
            return false;
    }
    if (consumption.actionName) {
        if (data.actionName !== consumption.actionName)
            return false;
    }
    if (consumption.isBoost !== undefined && consumption.isBoost !== null) {
        if (data.moveInfo?.isBoost !== consumption.isBoost)
            return false;
    }
    if (consumption.minDistance !== undefined && consumption.minDistance !== null) {
        if ((data.distanceMoved || 0) < consumption.minDistance)
            return false;
    }
    if (consumption.checkType) {
        if (data.statName !== consumption.checkType)
            return false;
    }
    if (consumption.checkAbove !== undefined && consumption.checkAbove !== null) {
        if ((data.total || 0) < consumption.checkAbove)
            return false;
    }
    if (consumption.checkBelow !== undefined && consumption.checkBelow !== null) {
        if ((data.total || 0) > consumption.checkBelow)
            return false;
    }
    if (consumption.statusId) {
        const triggerStatusId = data.statusId || data.effect?.statuses?.first() || data.effect?.name;
        const allowedIds = consumption.statusId.split(',').map(s => s.trim()).filter(Boolean);
        if (!allowedIds.includes(triggerStatusId))
            return false;
    }
    return true;
}

// Scans scene tokens for effects with matching consumption triggers, checks
// origin involvement and filters, then decrements charges.
export async function processEffectConsumption(triggerType, data) {
    const allTokens = getAllSceneTokens();

    const consumptionPromises = [];

    for (const token of allTokens) {
        const actor = token.actor;
        if (!actor)
            continue;

        const consumableEffects = actor.effects.filter(e => {
            const consumption = e.flags?.['lancer-automations']?.consumption;
            const t = consumption?.trigger;
            if (!t)
                return false;
            return Array.isArray(t) ? t.includes(triggerType) : t === triggerType;
        });

        if (consumableEffects.length === 0)
            continue;

        const consumedGroups = new Set();

        for (const effect of consumableEffects) {
            const consumption = effect.getFlag('lancer-automations', 'consumption');
            if (!consumption)
                continue;

            if (consumption.groupId && consumedGroups.has(consumption.groupId))
                continue;

            const originId = consumption.originId || token.id;
            if (!isOriginInvolved(originId, triggerType, data))
                continue;

            if (!passesBuiltInFilters(consumption, triggerType, data))
                continue;

            const processConsumption = async () => {
                if (consumption.evaluate) {
                    try {
                        let shouldConsume = false;
                        if (typeof consumption.evaluate === 'function') {
                            shouldConsume = await consumption.evaluate(triggerType, data, token, effect);
                        } else if (typeof consumption.evaluate === 'string' && consumption.evaluate.trim() !== '') {
                            const evalFunc = stringToFunction(consumption.evaluate, ["triggerType", "triggerData", "effectBearerToken", "effect"]);
                            shouldConsume = await evalFunc(triggerType, data, token, effect);
                        }
                        if (!shouldConsume)
                            return;
                    } catch (e) {
                        console.error(`lancer-automations | Error evaluating consumption for ${effect.name}:`, e);
                        return;
                    }
                }

                console.log(`lancer-automations | Consuming charge on ${effect.name} (trigger: ${triggerType})`);
                if (consumption.groupId)
                    consumedGroups.add(consumption.groupId);
                await consumeEffectCharge(effect);
            };

            consumptionPromises.push(processConsumption());
        }
    }
    await Promise.all(consumptionPromises);
}

export async function handleTrigger(triggerType, data) {
    dbgAuto('handleTrigger', triggerType, {
        triggeringToken: data?.triggeringToken?.name,
        statusId: data?.statusId,
        effectName: data?.effect?.name,
        actionName: data?.actionName,
        itemName: (data?.item ?? data?.weapon ?? data?.techItem)?.name,
    });
    // onInit* triggers fire from system events (token creation, etc.) and shouldn't leak hidden state in chat.
    if (triggerType?.startsWith('onInit'))
        return runInOnInitTriggerContext(() => _handleTriggerBody(triggerType, data));
    return _handleTriggerBody(triggerType, data);
}

async function _handleTriggerBody(triggerType, data) {
    // runInFlowBody: child flow.begin() from reactions routes to innerChain, avoids parent-await deadlock.
    return runInFlowBody(async () => {
        data.startRelatedFlow = async () => {
            const item = data.item ?? data.weapon ?? data.techItem;
            const actor = data.triggeringToken?.actor;
            const actionData = data.actionData;

            if (item) {
                const actionPath = actionData?.flowState?.data?.action_path ?? null;
                return item.beginActivationFlow(actionPath);
            }

            if (actionData) {
                const actionType = actionData.action?.activation ?? actionData.type;
                if (!actionType || ['Automatic', 'Other'].includes(actionType)) {
                    ui.notifications.warn(`lancer-automations | startRelatedFlow: action type "${actionType}" cannot be re-launched as a flow.`);
                    return;
                }
                if (!actor) {
                    ui.notifications.warn('lancer-automations | startRelatedFlow: no actor found.');
                    return;
                }
                return executeSimpleActivation(actor, {
                    title: actionData.title,
                    action: actionData.action,
                    detail: actionData.detail,
                    tags: actionData.tags
                });
            }

            ui.notifications.warn('lancer-automations | startRelatedFlow: no item or action data available for this trigger.');
        };

        const reactionsPromise = checkReactions(triggerType, data);
        const consumptionPromise = processEffectConsumption(triggerType, data);
        await reactionsPromise;
        await consumptionPromise;
    });
}

function serializeTriggerData(data, depth = 0) {
    if (!data || depth > 8)
        return null;
    const serialize = (value, d) => {
        if (d > 8 || value === null || value === undefined)
            return value;
        if (typeof value === 'function')
            return undefined;
        if (value?.document?.documentName === 'Token')
            return { __type: 'token', id: value.id };
        if (value?.documentName === 'Token')
            return { __type: 'tokenDoc', id: value.id };
        if (value?.documentName === 'Actor')
            return { __type: 'actor', id: value.id };
        if (Array.isArray(value))
            return value.map(v => serialize(v, d + 1)).filter(v => v !== undefined);
        if (typeof value === 'object') {
            try {
                const result = {};
                for (const [k, v] of Object.entries(value)) {
                    const s = serialize(v, d + 1);
                    if (s !== undefined)
                        result[k] = s;
                }
                return result;
            } catch (e) {
                return undefined;
            }
        }
        return value;
    };
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        const s = serialize(value, depth + 1);
        if (s !== undefined)
            result[key] = s;
    }
    return result;
}

export function deserializeTriggerData(data) {
    if (!data)
        return null;
    const deserialize = (value) => {
        if (value === null || value === undefined)
            return value;
        if (typeof value === 'object' && value.__type === 'token')
            return canvas.tokens.get(value.id) ?? null;
        if (typeof value === 'object' && value.__type === 'tokenDoc')
            return canvas.tokens.get(value.id)?.document ?? null;
        if (typeof value === 'object' && value.__type === 'actor')
            return game.actors.get(value.id) ?? null;
        if (Array.isArray(value))
            return value.map(deserialize);
        if (typeof value === 'object') {
            const result = {};
            for (const [k, v] of Object.entries(value))
                result[k] = deserialize(v);
            return result;
        }
        return value;
    };
    return deserialize(data);
}
