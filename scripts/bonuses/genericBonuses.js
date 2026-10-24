import { applyEffectsToTokens, consumeEffectCharge } from "./flagged-effects.js";
import { normalizeDuration } from "./duration-clock.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { getLAFlag, setLAFlag, getLAFlags } from "../tools/flag-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import { executeEffectManager } from "./effectManager.js";
import { stringToAsyncFunction } from "../activations/reaction-manager.js";
import { weaponClass, checkGate, consumeGate, isItemAvailable, isExecutorGM } from "../tools/misc-tools.js";
import { v3DefenseBonuses, v3BonusDurationOptions } from "../tools/v3-data.js";
import { v3ConditionMet } from "../tools/v3-condition.js";
import { isItemCascading } from "../setup/lancer-modif.js";
import { playBonusAddedFX } from "../fx/actionFX.js";
import { accDiffTargetToken } from "../combat/grid-helpers.js";
import { linkTierGate } from "../interactive/deployables.js";
import { broadcastFloatTokenText } from "../tools/float-text.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { laSigned, laValueTag, laRowHtml, laGroupHtml, laCardSlot, laSyncInvisibility, laDamageChips, laInfoRowHtml, laSplitGroupHtml } from "./roll-card-rows.js";

// Re-inject our row when Svelte re-renders a roll HUD. formWasSeen stops it disconnecting on mutations that land before the HUD exists.
function observeHudReinject(formSelector, rowSelector, doInject, onStillPresent = null)
{
    let reinjectPending = false;
    let formWasSeen = false;
    const observer = new MutationObserver(() =>
    {
        const $form = $(formSelector);
        if ($form.length === 0)
        {
            if (formWasSeen)
                observer.disconnect();
            return;
        }
        formWasSeen = true;
        if ($form.find(rowSelector).length === 0 && !reinjectPending)
        {
            reinjectPending = true;
            setTimeout(() =>
            {
                doInject();
                reinjectPending = false;
            }, 50);
        }
        else
            onStillPresent?.($form);
    });

    const $hudzone = $('#hudzone');
    observer.observe($hudzone.length > 0 ? $hudzone[0] : document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 600000);
    return observer;
}

// Caches compiled @@fn: lambda sources to avoid recompiling on every evaluation.
const serializedConditionCache = new Map();

// Per-target gate cache for applyToCondition lambdas; same @@fn: pattern, must be synchronous.
const applyToConditionCache = new Map();

/**
 * Compile a `@@fn:` lambda source into a cached Function. Shared by `condition` and `applyToCondition`.
 * @param {string} src  the body after the `@@fn:` prefix
 * @param {Map<string, Function>} cache
 * @param {string[]} argNames
 * @param {string} preamble  JS source inserted before the return; typically defines `api` / `reactorToken`
 * @returns {Function}
 */
function compileCachedLambda(src, cache, argNames, preamble)
{
    let fn = cache.get(src);
    if (!fn)
    {
        fn = new Function(...argNames, `${preamble}return(${src})(${argNames.join(',')});`);
        cache.set(src, fn);
    }
    return fn;
}

/**
 * Serialize function-valued `condition` / `applyToCondition` into `@@fn:` source strings, including
 * on `multi` sub-bonuses. Bonus data is persisted in document flags as JSON, which drops functions.
 * Must be called by every entry point that writes bonusData to a flag.
 * @param {any} bonusData
 * @returns {any} the original object, or a copy with the lambdas serialized
 */
function serializeBonusLambdas(bonusData)
{
    if (!bonusData)
        return bonusData;
    const serializeOne = (bonus) =>
    {
        let out = bonus;
        if (typeof out?.condition === 'function')
            out = { ...out, condition: '@@fn:' + out.condition.toString() };
        if (typeof out?.applyToCondition === 'function')
            out = { ...out, applyToCondition: '@@fn:' + out.applyToCondition.toString() };
        return out;
    };
    let serialized = serializeOne(bonusData);
    if (serialized.type === 'multi' && Array.isArray(serialized.bonuses))
        serialized = { ...serialized, bonuses: serialized.bonuses.map(serializeOne) };
    return serialized;
}

// The card label's `for` is the token uuid on Lancer 3.x, a bare id before
function accDiffCardTokenId($card)
{
    return ($card.find('label.target-name').attr('for') || '').split('.').pop();
}

// Prefers bonus.context.ownerTokenId, falls back to state.actor's first token; provides reactorToken for condition lambdas.
function resolveReactorToken(bonus, state)
{
    const ownerTokenId = bonus?.context?.ownerTokenId;
    if (ownerTokenId)
        return canvas.tokens.get(ownerTokenId) ?? null;
    return state?.actor?.getActiveTokens?.()?.[0] ?? null;
}

/**
 * Evaluate `mod.applyToCondition` against one HUD target entry. Returns true if no condition is set.
 * Lambda gets (targetToken, state, reactorToken, entry), must be synchronous and return a boolean.
 */
function evaluateApplyToCondition(mod, targetEntry, state, reactorToken)
{
    return runApplyToCondition(mod, accDiffTargetToken(targetEntry), state, reactorToken, targetEntry);
}

/** Same gate against an already-resolved token, for callers with no accdiff entry. */
function runApplyToCondition(mod, targetToken, state, reactorToken, entry = null)
{
    if (!mod.applyToCondition)
        return true;
    try
    {
        let fn;
        if (typeof mod.applyToCondition === 'function')
            fn = mod.applyToCondition;
        else if (typeof mod.applyToCondition === 'string' && mod.applyToCondition.startsWith('@@fn:'))
        {
            fn = compileCachedLambda(
                mod.applyToCondition.slice('@@fn:'.length),
                applyToConditionCache,
                ['target', 'state', 'reactorToken', 'entry'],
                `const api=game.modules.get('${MODULE_ID}')?.api;`
            );
        }
        else
            return true;
        const result = fn(targetToken, state, reactorToken, entry);
        if (result instanceof Promise)
        {
            console.error(`lancer-automations | applyToCondition for "${mod.name || mod.id}" is async. Must be synchronous.`);
            return false;
        }
        return !!result;
    }
    catch (e)
    {
        console.warn("lancer-automations | applyToCondition evaluation failed:", e);
        return false;
    }
}

// These use direct actor.update(), not AE changes (AE re-applies each refresh, breaking consumables like overshield).
const CURRENT_RESOURCE_STATS = new Set([
    'system.hp.value', 'system.heat.value', 'system.overshield.value',
    'system.burn', 'system.repairs.value'
]);

export function flattenBonuses(bonuses)
{
    if (!bonuses)
        return [];
    const bonusArray = Array.isArray(bonuses) ? bonuses : [bonuses];
    const flattened = [];
    for (const bonus of bonusArray)
    {
        if (bonus.type === 'multi' && Array.isArray(bonus.bonuses))
        {
            bonus.bonuses.forEach((sub, idx) =>
            {
                const flatSub = { ...normalizeBonusShape(sub) };
                if (!flatSub.id)
                    flatSub.id = `${bonus.id || 'multi'}_sub_${idx}`;
                if (bonus.applyTo && !flatSub.applyTo)
                    flatSub.applyTo = bonus.applyTo;
                if (bonus.applyToCondition && !flatSub.applyToCondition)
                    flatSub.applyToCondition = bonus.applyToCondition;
                if (!flatSub.source && bonus.source)
                    flatSub.source = bonus.source;
                if (!flatSub.name && bonus.name)
                    flatSub.name = bonus.name;
                if (bonus.context && !flatSub.context)
                    flatSub.context = bonus.context;
                if (!flatSub.context && bonus.context)
                    flatSub.context = bonus.context;
                if (flatSub.consumeOnUsage === undefined && bonus.consumeOnUsage !== undefined)
                    flatSub.consumeOnUsage = bonus.consumeOnUsage;
                if (bonus.frequency && !flatSub.frequency)
                    Object.assign(flatSub, { frequency: bonus.frequency, frequencyCount: bonus.frequencyCount, frequencyKey: bonus.frequencyKey ?? bonus.id });
                flattened.push(flatSub);
            });
        }
        else
            flattened.push(normalizeBonusShape(bonus));
    }
    return flattened;
}

async function delegateSetActorFlag(actor, ns, key, value)
{
    if (game.user.isGM || actor.isOwner)
        await actor.setFlag(ns, key, value);
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: "setActorFlag",
            payload: { actorId: actor.id, ns, key, value }
        });
    }
}


/**
 * Mutates state.data.tags based on a tag bonus payload.
 */
export function applyTagBonus(state, bonus)
{
    if (!state.data)
        state.data = {};
    if (!state.data.tags)
        state.data.tags = [];

    const tagName = bonus.tagName || bonus.name; // In effect manager, we'll store tag id/name
    const tagId = bonus.tagId;
    const isRemove = !!bonus.removeTag;

    if (isRemove)
    {
        state.data.tags = state.data.tags.filter(t => t.id !== tagId && t.lid !== tagId);
        return;
    }

    // Adding or Overriding
    const existingIdx = state.data.tags.findIndex(t => t.id === tagId || t.lid === tagId);
    if (existingIdx !== -1)
    {
        const tag = { ...state.data.tags[existingIdx] }; // Clone so we don't mutate the base definition
        const isOverride = bonus.tagMode === 'override';
        const val = Number.parseInt(bonus.val) || 0;

        if (isOverride)
            tag.val = String(val);
        else
        {
            const currentVal = Number.parseInt(tag.val) || Number.parseInt(tag.num_val) || 0;
            tag.val = String(currentVal + val);
        }
        state.data.tags[existingIdx] = tag;
    }
    else
    {
        // Tag does not exist. Push a stub.
        state.data.tags.push({
            id: tagId,
            lid: tagId,
            val: String(Number.parseInt(bonus.val) || 0),
            name: tagName,
            description: localizeFormat('LA.bonus.grantedBy', { name: bonus.name })
        });
    }
}

/**
 * Mutates state.data.range based on a range bonus payload.
 * Only used by getWeaponProfiles_WithBonus in misc-tools.js for offline range computation.
 * Range display in flows is handled by the libWrapper on currentProfile() / rangesFor().
 */
export function mutateRangeWithBonus(state, bonus)
{
    if (!state.data)
        state.data = {};
    if (!state.data.range)
        state.data.range = [];

    const rangeType = bonus.rangeType;
    const rangeMode = bonus.rangeMode || 'add';
    const isOverride = rangeMode === 'override';
    const isChange = rangeMode === 'change';
    const val = Number.parseInt(bonus.val) || 0;

    if (isChange)
    {
        const RangeClass = state.data.range[0]?.constructor;
        state.data.range.length = 0;
        if (RangeClass && RangeClass !== Object)
            state.data.range.push(new RangeClass({ type: rangeType, val }));
        else
            state.data.range.push({ type: rangeType, val, icon: `cci-${rangeType.toLowerCase()}`, formatted: `${rangeType} ${val}` });
    }
    else
    {
        const existingIdx = state.data.range.findIndex(r => r.type === rangeType);
        if (existingIdx !== -1)
        {
            // Mutate in-place to preserve _Range prototype methods (icon getter, etc.)
            const entry = state.data.range[existingIdx];
            if (isOverride)
                entry.val = val;
            else
                entry.val = (Number.parseInt(entry.val) || 0) + val;
        }
        else
        {
            // Try to reuse the constructor from an existing range to preserve prototype methods
            const RangeClass = state.data.range[0]?.constructor;
            if (RangeClass && RangeClass !== Object)
                state.data.range.push(new RangeClass({ type: rangeType, val }));
            else
            {
                // Fallback: plain object with computed icon
                state.data.range.push({ type: rangeType, val, icon: `cci-${rangeType.toLowerCase()}`, formatted: `${rangeType} ${val}` });
            }
        }
    }

}

/**
 * Where a change_type bonus applies: 'base' (weapon damage, the default), 'bonus' (only the
 * bonus damage rows, global and per-target) or 'all'. Other modes always mean 'base'.
 * @param {any} bonus
 * @returns {'base' | 'bonus' | 'all'}
 */
export function damageBonusScope(bonus)
{
    return (bonus?.damageMode === 'change_type' && bonus.damageScope) ? bonus.damageScope : 'base';
}

/**
 * Whether a damage bonus rewrites the weapon's own damage before the HUD opens.
 * @param {any} bonus
 * @returns {boolean}
 */
export function mutatesBaseDamage(bonus)
{
    const mode = bonus?.damageMode || 'add';
    if (mode !== 'replace' && mode !== 'change_type' && mode !== 'add_base')
        return false;
    return damageBonusScope(bonus) !== 'bonus';
}

/**
 * Whether a damage bonus rewrites the bonus damage rows after the HUD closes.
 * @param {any} bonus
 * @returns {boolean}
 */
export function mutatesBonusDamage(bonus)
{
    if (bonus?.damageMode !== 'change_type')
        return false;
    const scope = damageBonusScope(bonus);
    return scope === 'bonus' || scope === 'all';
}

// 'add' goes through DOM injection in showDamageBonusNotification; only replace/add_base/change_type mutate here.
export function mutateDamageWithBonus(state, bonus)
{
    if (!state.data)
        state.data = {};
    if (!Array.isArray(state.data.damage))
        state.data.damage = [];

    const mode = bonus.damageMode || 'add';
    if (mode === 'add')
        return;

    const entries = bonus.damage || [];
    if (entries.length === 0)
        return;

    const DamageClass = state.data.damage[0]?.constructor;
    const makeDamage = (val, type) =>
    {
        if (DamageClass && DamageClass !== Object)
        {
            try
            {
                return new DamageClass({ type, val: String(val) });
            }
            catch (e)
            { /* fall through to plain object */ }
        }
        return { type, val: String(val) };
    };

    if (mode === 'replace')
    {
        state.data.damage.length = 0;
        for (const e of entries)
            state.data.damage.push(makeDamage(e.val ?? '1d6', e.type ?? 'Kinetic'));
        return;
    }

    if (mode === 'add_base')
    {
        for (const e of entries)
            state.data.damage.push(makeDamage(e.val ?? '1d6', e.type ?? 'Kinetic'));
        return;
    }

    if (mode === 'change_type')
    {
        // specific from-type wins over the 'all' fallback
        const specific = new Map();
        let allTarget = null;
        for (const e of entries)
        {
            const from = e.from || 'all';
            const to = e.to || e.type;
            if (!to)
                continue;
            if (from === 'all')
            {
                if (!allTarget)
                    allTarget = to;
            }
            else
                specific.set(from, to);
        }
        for (const dmg of state.data.damage)
        {
            const target = specific.get(dmg.type) || allTarget;
            if (target && target !== dmg.type)
                dmg.type = target;
        }
    }
}

// One live session per HUD kind; re-scans targeter bonuses while the roll HUD is open.
const liveBonusSessions = new Map();
let liveBonusRefreshTimer = null;

Hooks.on('updateActor', (actor, change) =>
{
    if (liveBonusSessions.size === 0)
        return;
    const laFlags = getLAFlags(change);
    if (!laFlags || (laFlags.constant_bonuses === undefined && laFlags.global_bonuses === undefined))
        return;
    clearTimeout(liveBonusRefreshTimer);
    liveBonusRefreshTimer = setTimeout(() =>
    {
        for (const [kind, session] of [...liveBonusSessions])
        {
            const age = Date.now() - session.created;
            if (age > 600000 || (!session.isLive() && age > 10000))
            {
                liveBonusSessions.delete(kind);
                continue;
            }
            session.refresh().catch(err => console.warn('lancer-automations | live bonus refresh:', err));
        }
    }, 150);
});

/**
 * @param {string} flowType - The flow type identifier (e.g., "attack", "tech_attack", "hull", "damage")
 * @returns {Function} The flow step function
 */
function createGenericBonusStep(flowType)
{
    return async function genericAccuracyStepImpl(state)
    {
        try
        {
            const actor = state.actor;
            if (!actor)
                return true;

            const tags = getFlowTags(flowType, state);
            const collected = {
                netBonus: (getLAFlag(actor,"generic_accuracy") || 0) -
                           (getLAFlag(actor,"generic_difficulty") || 0) +
                           (actor.getFlag("world", "generic_accuracy") || 0) -
                           (actor.getFlag("world", "generic_difficulty") || 0),
                activeBonuses: [],
                rangeBonuses: [],
                damageBonuses: [],
                allTargetedBonuses: [],
                targetedDamageBonuses: [],
                targetModifiers: [],
                disabledByUser: new Set(),
                limitReached: new Set()
            };

            await processBonusBatch(flattenBonuses(getGlobalBonuses(actor)), flowType, tags, state, collected);
            await processBonusBatch(getConstantBonuses(actor), flowType, tags, state, collected);
            await processEphemeralBonuses(actor, flowType, tags, state, collected);

            const attackerId = actor.token?.id ?? canvas.tokens.placeables.find(tok => tok.actor?.id === actor.id)?.id;
            await collectTargeterBonuses(attackerId, flowType, tags, state, collected);

            if (!state.data)
                state.data = {};
            if (!state.data.acc_diff)
                state.data.acc_diff = {};
            if (!state.data.acc_diff.base)
                state.data.acc_diff.base = {};

            const base = state.data.acc_diff.base;
            if (typeof base.accuracy !== 'number')
                base.accuracy = 0;
            if (typeof base.difficulty !== 'number')
                base.difficulty = 0;

            if (collected.netBonus)
                base.accuracy += collected.netBonus;

            const enabledById = new Map();
            const appliedMode = new Map();
            // Ids matched last pass, the gate can change
            const appliedTargetIds = new Map();
            const matchesTarget = (bonus, targetEntry) =>
            {
                const tokenId = accDiffTargetToken(targetEntry)?.id;
                if (!tokenId)
                    return false;
                if (Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0 && !bonus.applyTo.includes(tokenId))
                    return false;
                return evaluateApplyToCondition(bonus, targetEntry, state, resolveReactorToken(bonus, state));
            };
            const applyTargetedBonuses = (accDiff) =>
            {
                const count = accDiff.targets?.length || 0;
                const accDiffBase = accDiff.base;
                for (const bonus of collected.allTargetedBonuses)
                {
                    const val = Number.parseInt(bonus.val) || 0;
                    if (!val)
                        continue;
                    const baseVal = bonus.type === 'difficulty' ? -val : val;

                    const prevMode = appliedMode.get(bonus.id);
                    if (prevMode === 'base')
                    {
                        if (enabledById.get(bonus.id) !== false)
                            accDiffBase.accuracy -= baseVal;
                    }
                    else if (prevMode === 'target')
                    {
                        const prevIds = appliedTargetIds.get(bonus.id) ?? [];
                        accDiff.targets.forEach(targetEntry =>
                        {
                            const tokenId = accDiffTargetToken(targetEntry)?.id;
                            if (prevIds.includes(tokenId) && !collected.disabledByUser.has(`${bonus.id}:${tokenId}`))
                            {
                                if (bonus.type === 'difficulty')
                                    targetEntry.difficulty -= val;
                                else
                                    targetEntry.accuracy -= val;
                            }
                        });
                    }

                    const matching = accDiff.targets?.filter(targetEntry => matchesTarget(bonus, targetEntry)) ?? [];
                    const matchedIds = matching.map(targetEntry => accDiffTargetToken(targetEntry)?.id);
                    appliedTargetIds.set(bonus.id, matchedIds);
                    bonus._matchedIds = matchedIds;
                    if (!matching.length)
                    {
                        appliedMode.set(bonus.id, null);
                        continue;
                    }

                    if (count <= 1)
                    {
                        if (enabledById.get(bonus.id) !== false)
                            accDiffBase.accuracy += baseVal;
                        appliedMode.set(bonus.id, 'base');
                    }
                    else
                    {
                        matching.forEach(targetEntry =>
                        {
                            if (!collected.disabledByUser.has(`${bonus.id}:${accDiffTargetToken(targetEntry)?.id}`))
                            {
                                if (bonus.type === 'difficulty')
                                    targetEntry.difficulty += val;
                                else
                                    targetEntry.accuracy += val;
                            }
                        });
                        appliedMode.set(bonus.id, 'target');
                    }
                }
            };

            const getEffectiveActiveBonuses = () => [...collected.activeBonuses, ...collected.allTargetedBonuses.filter(bonus => appliedMode.get(bonus.id) === 'base')];
            const getEffectiveTargetedBonuses = () => collected.allTargetedBonuses.filter(bonus => appliedMode.get(bonus.id) === 'target');

            if (collected.allTargetedBonuses.length > 0)
                applyTargetedBonuses(state.data.acc_diff);

            const applyOneModifier = (t, mod) =>
            {
                if (mod.subtype === 'invisible' && t.plugins?.invisibility)
                    t.plugins.invisibility.data = 1;
                else if (mod.subtype === 'no_invisible' && t.plugins?.invisibility)
                    t.plugins.invisibility.data = -1;
                else if (mod.subtype === 'no_cover')
                    t.cover = 0;
                else if (mod.subtype === 'soft_cover')
                    t.cover = Math.max(t.cover || 0, 1);
                else if (mod.subtype === 'hard_cover')
                    t.cover = 2;
            };

            const ATTACK_MOD_FIELD = { invisible: 'invis', no_invisible: 'invis', no_cover: 'cover', soft_cover: 'cover', hard_cover: 'cover' };
            const modOriginals = new Map();
            const modDisabled = new Set();
            const modEnabled = new Map();
            const modKeyOf = (mod) => mod.id || mod.subtype;
            const modReaches = (mod, targetEntry) =>
            {
                if (Array.isArray(mod.applyTo) && mod.applyTo.length > 0 && !mod.applyTo.includes(accDiffTargetToken(targetEntry)?.id))
                    return false;
                return evaluateApplyToCondition(mod, targetEntry, state, resolveReactorToken(mod, state));
            };
            const readModField = (targetEntry, field) => (field === 'invis' ? targetEntry.plugins?.invisibility?.data : targetEntry.cover);
            const writeModField = (targetEntry, field, value) =>
            {
                if (field === 'cover')
                    targetEntry.cover = value;
                else if (targetEntry.plugins?.invisibility)
                    targetEntry.plugins.invisibility.data = value;
            };

            const applyTargetModifiers = (hudData) =>
            {
                if (collected.targetModifiers.length === 0)
                    return;
                for (const targetEntry of (hudData.targets || []))
                {
                    const tokenId = accDiffTargetToken(targetEntry)?.id;
                    for (const field of ['invis', 'cover'])
                    {
                        const originalKey = `${tokenId}::${field}`;
                        if (!modOriginals.has(originalKey))
                            continue;
                        writeModField(targetEntry, field, modOriginals.get(originalKey));
                        modOriginals.delete(originalKey);
                    }
                    for (const modifier of collected.targetModifiers)
                    {
                        if (!modReaches(modifier, targetEntry))
                            continue;
                        const field = ATTACK_MOD_FIELD[modifier.subtype];
                        if (field)
                        {
                            if (!tokenId || modDisabled.has(`${modKeyOf(modifier)}:${tokenId}`) || (field === 'invis' && !targetEntry.plugins?.invisibility))
                                continue;
                            const originalKey = `${tokenId}::${field}`;
                            if (!modOriginals.has(originalKey))
                                modOriginals.set(originalKey, readModField(targetEntry, field));
                            applyOneModifier(targetEntry, modifier);
                        }
                        // Damage card modifiers (damage_hud_data targets)
                        else if (modifier.subtype === 'ap' && targetEntry.ap !== undefined)
                            targetEntry.ap = true;
                        else if (modifier.subtype === 'half_damage' && targetEntry.halfDamage !== undefined)
                            targetEntry.halfDamage = true;
                        else if (modifier.subtype === 'paracausal' && targetEntry.paracausal !== undefined)
                            targetEntry.paracausal = true;
                        else if (modifier.subtype === 'crit' && targetEntry.quality !== undefined)
                            targetEntry.quality = 2;
                        else if (modifier.subtype === 'hit' && targetEntry.quality !== undefined)
                            targetEntry.quality = Math.max(targetEntry.quality, 1);
                        else if (modifier.subtype === 'miss' && targetEntry.quality !== undefined)
                            targetEntry.quality = 0;
                    }
                }
            };
            applyTargetModifiers(state.data.acc_diff);

            state.la_extraData = state.la_extraData || {};
            const bonusUsage = {
                flowType,
                candidates: {},
                enabledById,
                disabledByUser: collected.disabledByUser,
                dmgEnabled: new Map(),
                modEnabled,
                appliedMode,
                appliedTargetIds,
                burned: new Set()
            };
            const addUsageCandidates = (list, bucket) =>
            {
                for (const bonus of list)
                {
                    if (!bonus?.id)
                        continue;
                    bonusUsage.candidates[bonus.id] = usageCandidateOf(bonus, bucket);
                }
            };
            for (const bonusId of collected.limitReached)
            {
                bonusUsage.enabledById.set(bonusId, false);
                bonusUsage.dmgEnabled.set(bonusId, false);
            }
            addUsageCandidates(collected.activeBonuses, 'acc');
            addUsageCandidates(collected.allTargetedBonuses, 'targeted');
            addUsageCandidates(collected.targetModifiers, 'tmod');
            addUsageCandidates(collected.damageBonuses, 'damage');
            addUsageCandidates(collected.targetedDamageBonuses, 'targetedDamage');
            state.la_extraData.bonusUsage = bonusUsage;

            // Pre-set target_modifier subtypes in state.data so showDamageHUD sees them; hooks replaceTargets.
            let renderDamageRows = null;
            let dmgLive = null;
            if (flowType === 'damage')
            {
                const dmgMods = collected.targetModifiers.filter(mod => ['ap', 'half_damage', 'paracausal', 'crit', 'hit', 'miss'].includes(mod.subtype));
                // Set global state.data flags for global mods, or per-target mods when single target AND target matches
                const currentTargets = Array.from(game.user?.targets || []);
                const targetCount = currentTargets.length;
                for (const mod of dmgMods)
                {
                    const isPerTarget = Array.isArray(mod.applyTo) && mod.applyTo.length > 0;
                    if (isPerTarget)
                    {
                        // Only set global for a single target that matches applyTo; 0 or 2+ targets rely on the per-target machinery
                        if (targetCount !== 1 || !mod.applyTo.includes(currentTargets[0]?.id))
                            continue;
                    }
                    if (mod.subtype === 'ap')
                        state.data.ap = true;
                    else if (mod.subtype === 'half_damage')
                        state.data.half_damage = true;
                    else if (mod.subtype === 'paracausal')
                        state.data.paracausal = true;
                }
                // Hook replaceTargets once damage_hud_data exists + apply per-target mods to initial targets
                const applyDmgModsToTargets = (targets) =>
                {
                    for (const targetEntry of targets)
                    {
                        for (const modifier of dmgMods)
                        {
                            if (Array.isArray(modifier.applyTo) && modifier.applyTo.length > 0 && !modifier.applyTo.includes(accDiffTargetToken(targetEntry)?.id))
                                continue;
                            if (!evaluateApplyToCondition(modifier, targetEntry, state, resolveReactorToken(modifier, state)))
                                continue;
                            if (modifier.subtype === 'ap')
                                targetEntry.ap = true;
                            else if (modifier.subtype === 'half_damage')
                                targetEntry.halfDamage = true;
                            else if (modifier.subtype === 'paracausal')
                                targetEntry.paracausal = true;
                            else if (modifier.subtype === 'crit')
                                targetEntry.quality = 2;
                            else if (modifier.subtype === 'hit')
                                targetEntry.quality = Math.max(targetEntry.quality, 1);
                            else if (modifier.subtype === 'miss')
                                targetEntry.quality = 0;
                        }
                    }
                };
                // Single-target damage HUDs render no target card; the visible toggles are the global config boxes
                const toggleGlobalDmgBox = (subtype, desired) =>
                {
                    const areas = { half_damage: 'halfdamage', ap: 'grid-area: ap', paracausal: 'grid-area: paracausal' };
                    const area = areas[subtype];
                    if (!area)
                        return;
                    const $box = $('#damage-hud').find(`.damage-hud-options-grid > [style*="${area}"]`).find('input[type="checkbox"]').first();
                    if ($box.length && !!$box.prop('checked') !== desired)
                        $box[0].click();
                };
                const syncGlobalDmgBoxes = () =>
                {
                    const hudTargets = state.data.damage_hud_data?.targets ?? [];
                    if (hudTargets.length !== 1)
                        return;
                    const targetId = accDiffTargetToken(hudTargets[0])?.id;
                    for (const subtype of ['half_damage', 'ap', 'paracausal'])
                    {
                        const managed = dmgMods.filter(mod => mod.subtype === subtype);
                        if (managed.length === 0)
                            continue;
                        const desired = managed.some(mod => !Array.isArray(mod.applyTo) || mod.applyTo.length === 0 || mod.applyTo.includes(targetId));
                        toggleGlobalDmgBox(subtype, desired);
                    }
                };
                // Re-render showDamageBonusNotification's rows for live changes
                const syncDmgModRows = () =>
                {
                    if (renderDamageRows)
                        renderDamageRows();
                    else if (dmgMods.length > 0)
                        renderDamageRows = showDamageBonusNotification(collected.damageBonuses, state, collected.targetedDamageBonuses, dmgMods, bonusUsage.dmgEnabled);
                };
                const hookDamageReplaceTargets = () =>
                {
                    if (!state.data.damage_hud_data?.replaceTargets)
                        return;
                    // Apply per-target mods to initial targets
                    applyDmgModsToTargets(state.data.damage_hud_data.targets || []);
                    const origReplace = state.data.damage_hud_data.replaceTargets.bind(state.data.damage_hud_data);
                    state.data.damage_hud_data.replaceTargets = function(ts)
                    {
                        origReplace(ts);
                        applyDmgModsToTargets(this.targets);
                        setTimeout(syncGlobalDmgBoxes, 50);
                        return this;
                    };
                };
                // Click per-target checkboxes in the damage HUD to trigger Svelte reactivity
                const setDmgCheckbox = (modifier, tokenIds, desired) =>
                {
                    const $form = $('#damage-hud');
                    if ($form.length === 0)
                        return;
                    const $allCards = $form.find('.damage-hud-target-card');
                    const hudTargets = state.data.damage_hud_data?.targets || [];
                    $allCards.each(function (cardIndex)
                    {
                        const hudTarget = hudTargets[cardIndex];
                        if (!hudTarget || !tokenIds.includes(accDiffTargetToken(hudTarget)?.id))
                            return;
                        // The per-target config row holds AP, paracausal and half, in that order
                        const position = { ap: 0, paracausal: 1, half_damage: 2 }[modifier.subtype];
                        if (position === undefined)
                            return;
                        const checkbox = $(this).find('.damage-target-config input[type="checkbox"]').get(position);
                        if (checkbox && $(checkbox).prop('checked') !== desired)
                        {
                            $(checkbox).prop('checked', desired);
                            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                };
                const clickDmgPerTargetButtons = () =>
                {
                    for (const modifier of dmgMods)
                    {
                        if (Array.isArray(modifier.applyTo) && modifier.applyTo.length > 0)
                            setDmgCheckbox(modifier, modifier.applyTo, true);
                    }
                };
                const poll = setInterval(() =>
                {
                    if (state.data.damage_hud_data)
                    {
                        clearInterval(poll);
                        hookDamageReplaceTargets();
                        // Wait for HUD to render, then click per-target buttons
                        setTimeout(() =>
                        {
                            clickDmgPerTargetButtons();
                            syncGlobalDmgBoxes();
                        }, 300);
                    }
                }, 50);
                setTimeout(() => clearInterval(poll), 5000);
                dmgLive = { dmgMods, applyDmgModsToTargets, setDmgCheckbox, clickDmgPerTargetButtons, toggleGlobalDmgBox, syncGlobalDmgBoxes, syncDmgModRows };
            }

            let reinjectCallback = null;
            if (typeof state.data.acc_diff.replaceTargets === 'function')
            {
                const origReplace = state.data.acc_diff.replaceTargets.bind(state.data.acc_diff);
                state.data.acc_diff.replaceTargets = function(newTargets)
                {
                    origReplace(newTargets);
                    if (collected.allTargetedBonuses.length > 0)
                        applyTargetedBonuses(this);
                    const liveIds = new Set((this.targets || []).map(entry => accDiffTargetToken(entry)?.id));
                    for (const originalKey of [...modOriginals.keys()])
                    {
                        if (!liveIds.has(originalKey.split('::')[0]))
                            modOriginals.delete(originalKey);
                    }
                    applyTargetModifiers(this);
                    if (reinjectCallback)
                        setTimeout(reinjectCallback, 50);
                    return this;
                };
            }

            if (collected.activeBonuses.length > 0 || collected.allTargetedBonuses.length > 0 || collected.targetModifiers.length > 0)
                reinjectCallback = showBonusNotification(getEffectiveActiveBonuses, state, getEffectiveTargetedBonuses, collected.disabledByUser, bonusUsage.enabledById);

            // Inject target modifier toggles into the attack HUD
            const attackModSubtypes = new Set(['invisible', 'no_invisible', 'no_cover', 'soft_cover', 'hard_cover']);
            const attackMods = collected.targetModifiers.filter(m => attackModSubtypes.has(m.subtype));
            if (attackMods.length > 0 && flowType !== 'damage')
            {
                const modLabels = { invisible: 'Invisible (*)', no_invisible: 'Not Invisible', no_cover: 'No Cover', soft_cover: 'Soft Cover (-1)', hard_cover: 'Hard Cover (-2)' };
                const modTags = { invisible: 'Invisible', no_invisible: 'Not Invis.', no_cover: 'No Cover', soft_cover: 'Soft Cover', hard_cover: 'Hard Cover' };
                const coverNames = ['No Cover', 'Soft Cover', 'Hard Cover'];
                for (const mod of attackMods)
                    modEnabled.set(modKeyOf(mod), true);

                const ignoresCover = () =>
                {
                    const weapon = state.data.acc_diff?.weapon;
                    return !!(weapon?.tech || (weapon?.melee && !weapon?.thrown));
                };
                const overrideNote = (mod, targetEntry) =>
                {
                    if (!targetEntry)
                        return null;
                    if (mod.subtype === 'no_invisible')
                        return targetEntry.plugins?.invisibility?.tokenInvisible ? 'overrides Invisible' : null;
                    if (ATTACK_MOD_FIELD[mod.subtype] !== 'cover')
                        return null;
                    const originalKey = `${accDiffTargetToken(targetEntry)?.id}::cover`;
                    const natural = Number(modOriginals.has(originalKey) ? modOriginals.get(originalKey) : targetEntry.cover) || 0;
                    let forced = Math.max(natural, 1);
                    if (mod.subtype === 'no_cover')
                        forced = 0;
                    else if (mod.subtype === 'hard_cover')
                        forced = 2;
                    return natural && natural !== forced ? `overrides ${coverNames[natural]}` : null;
                };

                let lastIgnoresCover = null;
                const injectModToggles = () =>
                {
                    const $form = $('form[id^="accdiff"]');
                    if ($form.length === 0)
                        return;
                    $form.find('.la-target-modifier-section, .la-tmod-row').remove();

                    const targets = state.data.acc_diff?.targets || [];
                    const scope = _detectSvelteScope($form, 'label.container');
                    const gridScope = _detectSvelteScope($form, '.accdiff-grid, .accdiff-other-grid');
                    lastIgnoresCover = ignoresCover();
                    const tokenIdOf = (entry) => accDiffTargetToken(entry)?.id;

                    // render a mod only when a card target matches its applyTo and passes its applyToCondition
                    const liveMods = collected.targetModifiers.filter(mod => attackModSubtypes.has(mod.subtype) && !(lastIgnoresCover && ATTACK_MOD_FIELD[mod.subtype] === 'cover'));
                    const reach = new Map(liveMods.map(mod => [mod, targets.filter(entry => modReaches(mod, entry))]));
                    const shownMods = liveMods.filter(mod => reach.get(mod).length > 0);

                    // Split: shared mods hit every target, the rest go on the cards they hit
                    const sharedMods = shownMods.filter(mod => targets.length <= 1 || reach.get(mod).length === targets.length);
                    const perTargetMods = shownMods.filter(mod => !sharedMods.includes(mod));

                    const isOnFor = (mod, entry) => !modDisabled.has(`${modKeyOf(mod)}:${tokenIdOf(entry)}`);
                    const onToggle = (mod, entries, isOn) =>
                    {
                        for (const entry of entries)
                        {
                            const pairKey = `${modKeyOf(mod)}:${tokenIdOf(entry)}`;
                            if (isOn)
                                modDisabled.delete(pairKey);
                            else
                                modDisabled.add(pairKey);
                        }
                        modEnabled.set(modKeyOf(mod), reach.get(mod).some(entry => isOnFor(mod, entry)));
                        applyTargetModifiers(state.data.acc_diff);
                        laSyncInvisibility(state);
                    };
                    const modRowHtml = (mod, entries, noteTarget, cls) => laRowHtml({
                        name: mod.name || modLabels[mod.subtype],
                        tag: laValueTag(modTags[mod.subtype], 'mod'),
                        note: overrideNote(mod, noteTarget),
                        on: entries.every(entry => isOnFor(mod, entry)),
                        scope,
                        cls
                    });

                    if (sharedMods.length > 0)
                    {
                        const single = targets.length === 1 ? targets[0] : null;
                        const rowsHtml = sharedMods.map(mod => modRowHtml(mod, reach.get(mod), single, 'la-tmod-row la2-modrow')).join('');
                        const $modSection = $(`<div class="accdiff-grid accdiff-grid__section ${gridScope} la-target-modifier-section la2-modsec"><div class="accdiff-grid__column ${gridScope}">${laGroupHtml(rowsHtml)}</div></div>`);
                        const $anchor = $form.find('label[for="accdiff-manual-adjust"]').closest('.accdiff-grid.flexcol');
                        if ($anchor.length)
                            $anchor.before($modSection);
                        else
                            $form.find('.accdiff-footer').first().before($modSection);
                        $modSection.find('.la-tmod-row').each(function (index)
                        {
                            const mod = sharedMods[index];
                            $(this).children('input').on('change', function ()
                            {
                                onToggle(mod, reach.get(mod), $(this).is(':checked'));
                            });
                        });
                    }

                    // Inject per-target mods into matching target cards
                    $form.find('.accdiff-target').each(function ()
                    {
                        const $card = $(this);
                        const entry = targets.find(candidate => tokenIdOf(candidate) === accDiffCardTokenId($card));
                        const $body = $card.find('.accdiff-target-body').first();
                        if (!entry || $body.length === 0)
                            return;
                        for (const mod of perTargetMods)
                        {
                            if (!reach.get(mod).includes(entry))
                                continue;
                            const $row = $(modRowHtml(mod, [entry], entry, `la-tmod-row la2-modrow la2-card la-tmod-${modKeyOf(mod)}-${tokenIdOf(entry)}`));
                            laCardSlot($body, 'mod').append($row);
                            $row.children('input').on('change', function ()
                            {
                                onToggle(mod, [entry], $(this).is(':checked'));
                            });
                        }
                    });

                    $form.off('change.laTmodCover').on('change.laTmodCover', () =>
                    {
                        if (ignoresCover() !== lastIgnoresCover)
                            setTimeout(injectModToggles, 0);
                    });
                    laSyncInvisibility(state);
                };
                setTimeout(injectModToggles, 100);
                const _prevReinject = reinjectCallback;
                reinjectCallback = () =>
                {
                    if (_prevReinject)
                        _prevReinject(); injectModToggles();
                };
            }

            if (flowType === 'damage')
            {
                const dmgModifiers = collected.targetModifiers.filter(m => ['ap', 'half_damage', 'paracausal', 'crit', 'hit', 'miss'].includes(m.subtype));
                if (collected.damageBonuses.length > 0 || collected.targetedDamageBonuses.length > 0 || dmgModifiers.length > 0)
                    renderDamageRows = showDamageBonusNotification(collected.damageBonuses, state, collected.targetedDamageBonuses, dmgLive?.dmgMods ?? dmgModifiers, bonusUsage.dmgEnabled);
            }

            const liveSession = {
                created: Date.now(),
                isLive: () => !!document.querySelector(flowType === 'damage' ? '#damage-hud' : 'form[id^="accdiff"]'),
                refresh: async () =>
                {
                    const fresh = { netBonus: 0, activeBonuses: [], rangeBonuses: [], damageBonuses: [], allTargetedBonuses: [], targetedDamageBonuses: [], targetModifiers: [] };
                    // Shallow-clone state so tag targeter bonuses re-collected here can't mutate the real flow
                    const scanState = { ...state, data: { ...state.data, tags: Array.isArray(state.data?.tags) ? [...state.data.tags] : state.data?.tags } };
                    await collectTargeterBonuses(attackerId, flowType, tags, scanState, fresh);
                    const keyOf = (bonus) => `${bonus.applyTo?.[0] ?? ''}:${bonus.id ?? bonus.name ?? ''}`;
                    let changed = false;

                    for (const { list, bucket } of [{ list: 'allTargetedBonuses', bucket: 'targeted' }, { list: 'targetModifiers', bucket: 'tmod' }])
                    {
                        const freshKeys = new Set(fresh[list].map(keyOf));
                        const currentTargeter = collected[list].filter(bonus => bonus._targeter);
                        const currentKeys = new Set(currentTargeter.map(keyOf));

                        for (const bonus of currentTargeter)
                        {
                            if (freshKeys.has(keyOf(bonus)))
                                continue;
                            changed = true;
                            if (list === 'allTargetedBonuses')
                            {
                                const val = Number.parseInt(bonus.val) || 0;
                                const prevMode = appliedMode.get(bonus.id);
                                const accDiff = state.data.acc_diff;
                                if (val && prevMode === 'base' && accDiff?.base)
                                {
                                    if (enabledById.get(bonus.id) !== false)
                                        accDiff.base.accuracy -= bonus.type === 'difficulty' ? -val : val;
                                }
                                else if (val && prevMode === 'target')
                                {
                                    const prevIds = appliedTargetIds.get(bonus.id) ?? [];
                                    for (const targetEntry of (accDiff?.targets ?? []))
                                    {
                                        const tokenId = accDiffTargetToken(targetEntry)?.id;
                                        if (prevIds.includes(tokenId) && !collected.disabledByUser.has(`${bonus.id}:${tokenId}`))
                                        {
                                            if (bonus.type === 'difficulty')
                                                targetEntry.difficulty -= val;
                                            else
                                                targetEntry.accuracy -= val;
                                        }
                                    }
                                }
                                appliedMode.delete(bonus.id);
                                appliedTargetIds.delete(bonus.id);
                            }
                            else if (flowType === 'damage' && dmgLive)
                            {
                                const hudTargets = state.data.damage_hud_data?.targets ?? [];
                                for (const targetEntry of hudTargets)
                                {
                                    if (Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0 && !bonus.applyTo.includes(accDiffTargetToken(targetEntry)?.id))
                                        continue;
                                    if (bonus.subtype === 'ap')
                                        targetEntry.ap = false;
                                    else if (bonus.subtype === 'half_damage')
                                        targetEntry.halfDamage = false;
                                    else if (bonus.subtype === 'paracausal')
                                        targetEntry.paracausal = false;
                                }
                                if (Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0)
                                    dmgLive.setDmgCheckbox(bonus, bonus.applyTo, false);
                                if (hudTargets.length === 1)
                                {
                                    const singleId = accDiffTargetToken(hudTargets[0])?.id;
                                    if (!Array.isArray(bonus.applyTo) || bonus.applyTo.length === 0 || bonus.applyTo.includes(singleId))
                                        dmgLive.toggleGlobalDmgBox(bonus.subtype, false);
                                }
                            }
                            const staleIndex = collected[list].indexOf(bonus);
                            if (staleIndex >= 0)
                                collected[list].splice(staleIndex, 1);
                            if (bonus.id)
                                delete bonusUsage.candidates[bonus.id];
                        }

                        for (const bonus of fresh[list])
                        {
                            if (currentKeys.has(keyOf(bonus)))
                                continue;
                            changed = true;
                            collected[list].push(bonus);
                            if (bonus.id)
                                bonusUsage.candidates[bonus.id] = usageCandidateOf(bonus, bucket);
                        }
                    }

                    if (!changed)
                        return;

                    if (flowType === 'damage')
                    {
                        if (dmgLive)
                        {
                            dmgLive.dmgMods.length = 0;
                            dmgLive.dmgMods.push(...collected.targetModifiers.filter(mod => ['ap', 'half_damage', 'paracausal', 'crit', 'hit', 'miss'].includes(mod.subtype)));
                            dmgLive.applyDmgModsToTargets(state.data.damage_hud_data?.targets ?? []);
                            dmgLive.clickDmgPerTargetButtons();
                            dmgLive.syncGlobalDmgBoxes();
                            dmgLive.syncDmgModRows();
                        }
                    }
                    else
                    {
                        if (state.data.acc_diff)
                        {
                            applyTargetedBonuses(state.data.acc_diff);
                            applyTargetModifiers(state.data.acc_diff);
                        }
                        if (reinjectCallback)
                            setTimeout(reinjectCallback, 50);
                        else if (collected.activeBonuses.length > 0 || collected.allTargetedBonuses.length > 0 || collected.targetModifiers.length > 0)
                            reinjectCallback = showBonusNotification(getEffectiveActiveBonuses, state, getEffectiveTargetedBonuses, collected.disabledByUser, bonusUsage.enabledById);
                    }
                }
            };
            liveBonusSessions.set(flowType === 'damage' ? 'damage' : 'accdiff', liveSession);
        }
        catch (e)
        {
            console.error("lancer-automations | Error in genericAccuracyStep:", e);
        }

        return true;
    };
}

/**
 * Internal helper to process a list of bonuses and sort them into results buckets.
 */
async function processBonusBatch(bonuses, flowType, tags, state, results)
{
    if (!Array.isArray(bonuses))
        return;
    const targets = Array.from(game.user?.targets || []);

    for (const bonus of bonuses)
    {
        if (bonus.applyToTargetter || !(await isBonusApplicable(bonus, tags, state, { ignoreFrequency: true })) || bonus.type === 'stat' || bonus.type === 'range')
            continue;
        const limitReached = !bonusFrequencyFree(bonus, state);
        const isPlainAccuracy = (bonus.type === 'accuracy' || bonus.type === 'difficulty') && !bonus.applyToCondition && !(Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0);
        const isAddDamage = bonus.type === 'damage' && flowType === 'damage' && (bonus.damageMode || 'add') === 'add' && !(Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0);
        if (limitReached)
        {
            if (!bonus.id || !(isPlainAccuracy || isAddDamage))
                continue;
            results.limitReached?.add(bonus.id);
            if (isPlainAccuracy)
            {
                results.activeBonuses.push({ ...bonus, _limitReached: true });
                continue;
            }
        }

        if (bonus.type === 'target_modifier')
        {
            results.targetModifiers.push(bonus);
            results.activeBonuses.push(bonus);
        }
        else if (bonus.type === 'tag')
        {
            applyTagBonus(state, bonus);
            results.activeBonuses.push(bonus);
        }
        else if (bonus.type === 'damage' && flowType === 'damage')
        {
            const damageMode = bonus.damageMode || 'add';
            if (damageMode !== 'add')
            {
                // Non-add modes mutate the weapon in wrapShowDamageHUD; just record it as active.
                results.activeBonuses.push(bonus);
                continue;
            }
            const hasTarget = Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0;
            const routed = limitReached ? { ...bonus, _limitReached: true } : bonus;
            if (hasTarget)
            {
                if (targets.some(target => bonus.applyTo.includes(target.id)))
                    results.targetedDamageBonuses.push(routed);
            }
            else
                results.damageBonuses.push(routed);
        }
        else if (bonus.type !== 'damage')
        {
            const gated = (bonus.type === 'accuracy' || bonus.type === 'difficulty') && !!bonus.applyToCondition;
            const hasTarget = (Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0) || gated;
            if (hasTarget)
            {
                const injectedBonus = { ...bonus, id: bonus.id || foundry.utils.randomID() };
                results.allTargetedBonuses.push(injectedBonus);
            }
            else
            {
                let val = Number.parseInt(bonus.val) || 0;
                if (bonus.type === 'difficulty')
                    val = -val;
                results.netBonus += val;
                results.activeBonuses.push(bonus);
            }
        }
    }
}

const ATTACK_TARGET_MOD_SUBTYPES = new Set(['invisible', 'no_invisible', 'no_cover', 'soft_cover', 'hard_cover']);
const DAMAGE_TARGET_MOD_SUBTYPES = new Set(['ap', 'half_damage', 'paracausal', 'crit', 'hit', 'miss']);
function targetModSubtypeMatchesFlow(subtype, flowType)
{
    if (flowType === 'damage')
        return DAMAGE_TARGET_MOD_SUBTYPES.has(subtype);
    return ATTACK_TARGET_MOD_SUBTYPES.has(subtype);
}

async function processEphemeralBonuses(actor, flowType, tags, state, results)
{
    const bonuses = state?.la_extraData?.flow_bonus || [];
    if (!bonuses.length)
        return;
    const remaining = [];
    let changed = false;

    for (const b of bonuses)
    {
        if (!linkTierGate(b, actor))
        {
            remaining.push(b);
            continue;
        }
        if (await isBonusApplicable(b, tags, state))
        {
            // Defer target_modifier bonuses for the wrong flow (e.g. half_damage during attack) so they survive to damage flow.
            if (b.type === 'target_modifier' && !targetModSubtypeMatchesFlow(b.subtype, flowType))
            {
                remaining.push(b);
                continue;
            }
            const batchResults = { netBonus: 0, activeBonuses: [], rangeBonuses: [], damageBonuses: [], allTargetedBonuses: [], targetedDamageBonuses: [], targetModifiers: [] };
            await processBonusBatch([b], flowType, tags, state, batchResults);

            // If it was actually applicable and used in the current context, consume it
            const consumed = (batchResults.activeBonuses.length > 0) || (batchResults.rangeBonuses.length > 0) ||
                             (batchResults.damageBonuses.length > 0) || (batchResults.allTargetedBonuses.length > 0) ||
                             (batchResults.targetedDamageBonuses.length > 0) || (batchResults.targetModifiers.length > 0) ||
                             (batchResults.netBonus !== 0);

            if (consumed)
            {
                results.netBonus += batchResults.netBonus;
                results.activeBonuses.push(...batchResults.activeBonuses);
                results.rangeBonuses.push(...batchResults.rangeBonuses);
                results.damageBonuses.push(...batchResults.damageBonuses);
                results.allTargetedBonuses.push(...batchResults.allTargetedBonuses);
                results.targetedDamageBonuses.push(...batchResults.targetedDamageBonuses);
                if (results.targetModifiers)
                    results.targetModifiers.push(...batchResults.targetModifiers);
                changed = true;
            }
            else
                remaining.push(b);
        }
        else
            remaining.push(b);
    }
    if (changed && state?.la_extraData)
        state.la_extraData.flow_bonus = remaining;
}

/**
 * Scans for bonuses from other tokens on the current scene (applyToTargetter).
 */
async function collectTargeterBonuses(attackerTokenId, flowType, tags, state, results)
{
    const targets = Array.from(game.user?.targets || []);
    for (const token of (canvas.scene?.tokens ?? []))
    {
        if (!token.actor || token.id === attackerTokenId)
            continue;
        const sourceActor = token.actor;
        const isTargeted = targets.some(target => target.id === token.id);
        const isApplicableTargeterBonus = async (bonus) =>
        {
            return bonus.applyToTargetter && (!bonus.applyTo?.length || bonus.applyTo.includes(attackerTokenId)) &&
                                   await isBonusApplicable(bonus, tags, state) && bonus.type !== 'stat';
        };
        const routeToResults = (bonus) =>
        {
            const injected = { ...bonus, applyTo: [token.id], id: bonus.id || foundry.utils.randomID(), _targeter: true };
            if (bonus.type === 'damage')
            {
                if (flowType === 'damage' && isTargeted)
                    results.targetedDamageBonuses.push(injected);
            }
            else if (bonus.type === 'target_modifier')
                results.targetModifiers.push(injected);
            else if (bonus.type === 'tag')
            {
                applyTagBonus(state, bonus);
                results.activeBonuses.push(injected);
            }
            else
                results.allTargetedBonuses.push(injected);
        };

        for (const bonus of flattenBonuses(getGlobalBonuses(sourceActor)))
        {
            if (await isApplicableTargeterBonus(bonus))
                routeToResults(bonus);
        }
        for (const bonus of getConstantBonuses(sourceActor))
        {
            if (await isApplicableTargeterBonus(bonus))
                routeToResults(bonus);
        }
    }
}

/**
 * One-line display string for an LA bonus struct (Effect Manager, status panel).
 * Multi bonuses are the caller's job; this formats a single entry.
 * @param {any} bonus
 * @returns {string}
 */
export const STAT_BONUS_GROUPS = [
    { label: 'Resources (Max)', stats: { 'system.hp.max': 'HP (Max)', 'system.heat.max': 'Heat Cap (Max)', 'system.repairs.max': 'Repair Cap (Max)', 'system.structure.max': 'Structure (Max)', 'system.stress.max': 'Stress (Max)' } },
    { label: 'Resources (Current)', stats: { 'system.hp.value': 'HP (Current)', 'system.heat.value': 'Heat (Current)', 'system.overshield.value': 'Overshield', 'system.burn': 'Burn', 'system.repairs.value': 'Repairs (Current)' } },
    { label: 'Stats', stats: { 'system.speed': 'Speed', 'system.evasion': 'Evasion', 'system.edef': 'E-Defense', 'system.save': 'Save Target', 'system.sensor_range': 'Sensor Range', 'system.tech_attack': 'Tech Attack', 'system.armor': 'Armor', 'system.size': 'Size' } }
];

function statBonusLabel(stat)
{
    for (const group of STAT_BONUS_GROUPS)
    {
        if (stat in group.stats)
            return group.stats[stat];
    }
    return stat?.split('.').pop() || stat;
}

export function getBonusDetailString(bonus)
{
    if (bonus.type === 'accuracy')
        return `Accuracy +${bonus.val}`;
    if (bonus.type === 'difficulty')
        return `Difficulty +${bonus.val}`;
    if (bonus.type === 'stat')
    {
        const name = statBonusLabel(bonus.stat);
        if ((bonus.statMode || 'add') === 'replace')
            return `${name} = ${bonus.val}`;
        return `${name} ${Number.parseInt(bonus.val) >= 0 ? '+' : ''}${bonus.val}`;
    }
    if (bonus.type === 'damage')
    {
        const mode = bonus.damageMode || 'add';
        const entries = bonus.damage || [];
        if (mode === 'change_type')
        {
            const parts = entries.map(dmg =>
            {
                const from = (dmg.from && dmg.from !== 'all') ? dmg.from : 'All';
                return `${from} → ${dmg.to}`;
            });
            const scope = damageBonusScope(bonus);
            const scopeLabel = scope === 'base' ? '' : ` (${scope})`;
            return `Change Type${scopeLabel}: ${parts.join(', ')}`;
        }
        const body = entries.map(dmg => `${dmg.val} ${dmg.type}`).join(' + ');
        if (mode === 'replace')
            return `Replace: ${body}`;
        if (mode === 'add_base')
            return `Add: ${body}`;
        return body;
    }
    if (bonus.type === 'tag')
    {
        if (bonus.removeTag)
            return `Remove Tag: ${bonus.tagName}`;
        const action = bonus.tagMode === 'override' ? 'Set' : 'Add';
        return `${action} ${bonus.tagName} ${bonus.val}`;
    }
    if (bonus.type === 'range')
    {
        const rangeLabel = bonus.rangeMode === 'override' ? 'Set' : bonus.rangeMode === 'change' ? 'Change All →' : 'Add';
        return `${rangeLabel} ${bonus.rangeType} ${bonus.val}`;
    }
    const defense = normalizeBonusShape(bonus);
    if (defense.type === 'resistance' || defense.type === 'vulnerability')
        return `${defense.type === 'resistance' ? 'Resistance' : 'Vulnerability'}: ${(defense.damageTypes || []).join(', ')}`;
    if (bonus.type === 'immunity')
    {
        if (bonus.subtype === 'effect' && bonus.effects)
            return `Immunity: ${bonus.effects.join(', ')}`;
        if (bonus.subtype === 'damage' && bonus.damageTypes)
            return `${bonus.subtype}: ${bonus.damageTypes.join(', ')}`;
        if (bonus.subtype === 'crit')
            return 'Immunity: Critical Hit';
        if (bonus.subtype === 'hit')
            return 'Immunity: Hit';
        if (bonus.subtype === 'miss')
            return 'Immunity: Miss';
        if (bonus.subtype === 'elevation')
            return 'Immunity: Elevation';
        if (bonus.subtype === 'terrain')
            return 'Immunity: Terrain';
        if (bonus.subtype === 'obstacle')
            return 'Immunity: Obstacle (Phasing)';
        if (bonus.subtype === 'provoke')
            return 'Immunity: Provoke (Engagement & Reactions)';
        return bonus.subtype;
    }
    if (bonus.type === 'target_modifier')
    {
        const labels = {
            invisible: 'Invisible (50% miss)',
            no_invisible: 'Not Invisible',
            no_cover: 'No Cover',
            soft_cover: 'Soft Cover',
            hard_cover: 'Hard Cover',
            ap: 'Armor Piercing',
            half_damage: 'Half Damage',
            paracausal: 'Cannot be Reduced',
            crit: 'Force Crit',
            hit: 'Force Hit',
            miss: 'Force Miss'
        };
        return `Target: ${labels[bonus.subtype] || bonus.subtype}`;
    }
    if (bonus.type === 'reroll')
    {
        const rerollTypes = Array.isArray(bonus.rollTypes) && bonus.rollTypes.length > 0 ? bonus.rollTypes.join(', ') : 'any';
        const subtype = String(bonus.subtype ?? 'retry');
        return `Reroll [${subtype}]: ${rerollTypes}`;
    }
    return bonus.type || 'Unknown';
}

/**
 * Uses left on a bonus, read from its linked effect's counter.
 * @param {Actor|null} actor
 * @param {object} bonus
 * @returns {{ label: string, onUse: boolean } | null} null when the bonus has no use count
 */
export function getBonusUsesInfo(actor, bonus)
{
    if (bonus?.uses === undefined)
        return null;
    const linkedEffect = actor?.effects?.find(effect => getLAFlag(effect, 'linkedBonusId') === bonus.id);
    const remaining = linkedEffect ? (linkedEffect.flags?.statuscounter?.value ?? null) : null;
    const label = remaining === null ? `uses: ${bonus.uses}` : `${remaining}/${bonus.uses}`;
    const onUse = DEFENSE_TYPES.has(bonus.type) ? bonus.consumeOnUsage === true : bonus.consumeOnUsage !== false;
    return { label, onUse: supportsConsumeOnUsage(bonus.type, bonus.subtype ?? null) && onUse };
}

/**
 * Determines the appropriate icon for a bonus based on its type and value.
 * @param {object} bonus
 * @returns {string} The path to the SVG icon
 */
// Same movement glyph the combat bar, stats bar and stat hint use. It is an mdi font class,
// so anything needing a real image goes through getBonusIconImage.
const MOVEMENT_ICON = "mdi mdi-arrow-right-bold-hexagon-outline";
const MOVEMENT_IMG = "modules/lancer-automations/icons/move-hexagon.svg";

/** Icon for an ActiveEffect img, which cannot be a font class. */
export function getBonusIconImage(bonus, override = null)
{
    const icon = override || getBonusIcon(bonus);
    if (typeof icon === 'string' && icon.includes('/'))
        return icon;
    return bonus?.type === 'movement_extra' ? MOVEMENT_IMG : "modules/lancer-automations/icons/pill.svg";
}

export function getBonusIcon(bonus)
{
    const ACC = "systems/lancer/assets/icons/white/accuracy.svg";
    const DIFF = "systems/lancer/assets/icons/white/difficulty.svg";
    const RANGE = "systems/lancer/assets/icons/white/range.svg";
    const MELEE = "systems/lancer/assets/icons/white/melee.svg";
    const GENERIC = "modules/lancer-automations/icons/pill.svg";
    const IMMUNITY = "modules/lancer-automations/icons/dice-shield.svg";
    const VULNERABILITY = "modules/lancer-automations/icons/achilles-heel.svg";

    if (bonus.type === 'movement_extra')
        return MOVEMENT_ICON;
    if (bonus.type === 'difficulty')
        return DIFF;
    if (bonus.type === 'range')
        return RANGE;
    if (bonus.type === 'damage')
        return MELEE;
    if (bonus.type === 'stat')
        return GENERIC;
    if (normalizeBonusShape(bonus).type === 'vulnerability')
        return VULNERABILITY;
    if (bonus.type === 'immunity' || bonus.type === 'resistance')
        return IMMUNITY;

    if (bonus.type === 'multi' && Array.isArray(bonus.bonuses))
    {
        const counts = {};
        let maxCount = 0, maxType = null;
        for (const sub of bonus.bonuses)
        {
            counts[sub.type] = (counts[sub.type] || 0) + 1;
            if (counts[sub.type] > maxCount)
            {
                maxCount = counts[sub.type];
                maxType = sub.type;
            }
        }
        return getBonusIcon({ type: maxType });
    }

    const val = Number.parseInt(bonus.val) || 0;
    return val >= 0 ? ACC : DIFF;
}

function getFlowTags(flowType, state)
{
    const tags = new Set(["all"]);
    const itemType = state.item?.system?.type?.toLowerCase();

    const addWeaponClassTags = () =>
    {
        const weaponClassTag = weaponClass(state.item);
        if (weaponClassTag)
            tags.add(weaponClassTag);
        if (state.item?.system?.type === "Tech")
            tags.add("tech");
    };

    if (["attack", "basic_attack", "weapon_attack"].includes(flowType))
    {
        tags.add("attack");
        if (itemType)
            tags.add(itemType);
        addWeaponClassTags();
    }
    else if (flowType === "tech_attack")
    {
        tags.add("attack");
        tags.add("tech_attack");
        tags.add("tech");
    }
    else if (flowType === "stat_roll")
    {
        tags.add("check");
        const path = state.data?.path?.toLowerCase() || "";
        ["hull", "agility", "systems", "engineering", "grit"].forEach(statName =>
        {
            if (path.includes(statName) || path.includes(statName.slice(0, 3)))
                tags.add(statName);
        });
        if (state.actor?.is_npc && path.includes("tier"))
            tags.add("tier");
    }
    else if (["structure", "overheat", "damage"].includes(flowType))
    {
        tags.add(flowType);
        if (flowType === "damage")
        {
            if (itemType)
                tags.add(itemType);
            addWeaponClassTags();
        }
    }
    return tags;
}

export function isBonusApplicable(bonus, flowTags, state, { ignoreFrequency = false } = {})
{
    if (bonus.rollTypes && Array.isArray(bonus.rollTypes) && bonus.rollTypes.length > 0)
    {
        const hasMatch = bonus.rollTypes.some(rollType => flowTags.has(rollType.toLowerCase()));
        if (!hasMatch)
            return false;
    }

    if (!ignoreFrequency && !bonusFrequencyFree(bonus, state))
        return false;

    if (bonus.condition)
    {
        try
        {
            const context = bonus.context || {};
            let result;
            if (typeof bonus.condition === 'function')
                result = bonus.condition(state, state.actor, state.data, context);
            else if (typeof bonus.condition === 'string' && bonus.condition.trim() !== '')
            {
                if (bonus.condition.startsWith('@@fn:'))
                {
                    const fn = compileCachedLambda(
                        bonus.condition.slice('@@fn:'.length),
                        serializedConditionCache,
                        ['state', 'actor', 'data', 'context'],
                        `const api=game.modules.get('${MODULE_ID}')?.api;` +
                        `const ownerTokenId=context?.ownerTokenId;` +
                        `const reactorToken=ownerTokenId?canvas.tokens.get(ownerTokenId)??null:null;`
                    );
                    result = fn(state, state.actor, state.data, context);
                }
                else
                {
                    const fn = stringToAsyncFunction(bonus.condition, ['state', 'actor', 'data', 'context']);
                    result = fn(state, state.actor, state.data, context);
                }
            }
            if (result instanceof Promise)
            {
                console.error(`lancer-automations | evaluate for "${bonus.name}" is async. Bonus condition must be synchronous.`);
                return false;
            }
            if (!result)
                return false;
        }
        catch (e)
        {
            console.warn("lancer-automations | Condition evaluation failed:", e);
            return false;
        }
    }

    if (bonus.itemLids && Array.isArray(bonus.itemLids) && bonus.itemLids.length > 0)
    {
        if (!state.item)
            return false;
        const itemLid = state.item.system?.lid;
        if (!itemLid || !bonus.itemLids.includes(itemLid))
            return false;
    }

    if (bonus.itemId)
    {
        if (!state.item)
            return false;
        if (state.item.id !== bonus.itemId && state.item._id !== bonus.itemId)
            return false;
    }

    return true;
}

/**
 * Inject global accuracy/difficulty bonus checkboxes into the accdiff dialog,
 * and also inject per-target bonus checkboxes into each matching target card.
 *
 * @param {Function} getBonuses         - Getter returning current global bonuses (re-called at each injection)
 * @param {object} state
 * @param {Function} getTargetedBonuses - Getter returning current targeted bonuses
 * @param {Set} disabledByUser          - Shared set of "${bonusId}:${tokenId}" keys for user-disabled bonuses
 */
function showBonusNotification(getBonuses, state, getTargetedBonuses, disabledByUser = new Set(), enabledById = new Map())
{

    const getCurrentBonusStates = () =>
    {
        const currentBonuses = typeof getBonuses === 'function' ? getBonuses() : (getBonuses || []);
        return currentBonuses.map((bonus, index) => ({
            ...bonus,
            index,
            enabled: enabledById.has(bonus.id) ? enabledById.get(bonus.id) : true
        }));
    };

    const updateFlowAccuracy = (bonus, wasEnabled) =>
    {
        if (bonus.type !== 'accuracy' && bonus.type !== 'difficulty')
            return;
        let val = Number.parseInt(bonus.val) || 0;
        if (bonus.type === 'difficulty')
            val = -val;
        const base = state.data?.acc_diff?.base;
        if (base)
            base.accuracy += wasEnabled ? -val : val;
    };

    const renderBonusRow = (bonus, index, scope) =>
    {
        const isDifficulty = bonus.type === 'difficulty';
        const rawVal = Number.parseInt(bonus.val) || 0;
        const effectiveVal = isDifficulty ? -Math.abs(rawVal) : rawVal;
        const valText = laSigned(effectiveVal);
        return laRowHtml({
            name: bonus.name,
            tag: laValueTag(valText, effectiveVal < 0 ? 'diff' : 'acc'),
            parts: bonusUsageParts(bonus, state, !!bonus._limitReached),
            limit: !!bonus._limitReached,
            on: bonus.enabled,
            scope,
            cls: 'csm-bonus-row csm-global-bonus-row',
            inputCls: 'csm-bonus-checkbox',
            attrs: { 'data-index': index, 'data-bonus-id': bonus.id || '' }
        });
    };

    const bindRow = ($row) =>
    {
        $row.find('.csm-bonus-checkbox').on('change', function()
        {
            const bonusIndex = Number.parseInt($row.attr('data-index'));
            const bonusId = $row.attr('data-bonus-id');
            const isChecked = $(this).is(':checked');
            const bonus = getCurrentBonusStates()[bonusIndex];
            if (!bonus)
                return;
            const wasEnabled = enabledById.has(bonusId) ? enabledById.get(bonusId) : true;
            if (wasEnabled === isChecked)
                return;
            enabledById.set(bonusId, isChecked);
            updateFlowAccuracy(bonus, wasEnabled);
        });
    };

    const injectIntoCard = () =>
    {
        const $form = $('form[id^="accdiff"]');
        if ($form.length === 0)
            return false;

        const $accContainer = $form.find('label:contains("Accurate")').first().closest('div');
        const $diffContainer = $form.find('label:contains("Inaccurate")').first().closest('div');
        if (!$accContainer.length || !$diffContainer.length)
            return false;

        // Only remove global rows; leave per-target rows untouched
        $form.find('.la-global-group').remove();

        const scope = _detectSvelteScope($form, 'label.container');
        const columns = { acc: [], diff: [] };
        getCurrentBonusStates().forEach((bonus, index) =>
        {
            const val = Number.parseInt(bonus.val) || 0;
            if (val === 0)
                return;
            const isDifficulty = bonus.type === 'difficulty' || val < 0;
            columns[isDifficulty ? 'diff' : 'acc'].push(renderBonusRow(bonus, index, scope));
        });

        const appendGroup = ($column, rows) =>
        {
            const groupHtml = laGroupHtml(rows.join(''), 'la-global-group');
            if (!groupHtml)
                return;
            const $group = $(groupHtml);
            $column.append($group);
            $group.children('.csm-global-bonus-row').each(function()
            {
                bindRow($(this));
            });
        };
        appendGroup($accContainer, columns.acc);
        appendGroup($diffContainer, columns.diff);
        return true;
    };

    injectIntoCard();

    observeHudReinject('form[id^="accdiff"]', '.csm-global-bonus-row', injectIntoCard);

    // Always set up per-target injection with the same getter so it re-evaluates on each re-injection
    const reinjectTargeted = injectTargetedAccuracyBonuses(getTargetedBonuses, state, disabledByUser);

    // Called by the replaceTargets patch on target change
    return () =>
    {
        injectIntoCard();
        reinjectTargeted();
    };
}

// Injects per-target acc/diff checkboxes; MutationObserver handles mid-dialog target additions.
// State is pre-set, so only a user toggle writes the target's count.
function injectTargetedAccuracyBonuses(getTargetedBonuses, state, disabledByUser)
{
    const targetEntryFor = (tokenId) => (state.data?.acc_diff?.targets || []).find(entry => accDiffTargetToken(entry)?.id === tokenId) ?? null;

    const tryInjectTargeted = () =>
    {
        const $form = $('form[id^="accdiff"]');
        if ($form.length === 0)
            return false;

        const $allCards = $form.find('.accdiff-target');
        if ($allCards.length === 0)
            return false;

        // Re-evaluate current targeted bonuses each time (reflects mode switches)
        const targetedBonuses = typeof getTargetedBonuses === 'function' ? getTargetedBonuses() : (getTargetedBonuses || []);
        const scope = _detectSvelteScope($form, 'label.container');

        let injectedAny = false;

        for (const bonus of targetedBonuses)
        {
            const val = Number.parseInt(bonus.val) || 0;
            if (val === 0)
                continue;

            const isDiff = bonus.type === 'difficulty';
            const effectiveVal = isDiff ? -Math.abs(val) : val;
            const valText = laSigned(effectiveVal);
            const targetName = bonus._targetName || null;

            const matchingCards = [];
            const nonMatchingCards = [];
            $allCards.each(function()
            {
                const $card = $(this);
                let matchedTokenId = null;
                for (const tokenId of (bonus._matchedIds ?? bonus.applyTo ?? []))
                {
                    if (accDiffCardTokenId($card) === tokenId)
                    {
                        matchedTokenId = tokenId;
                        break;
                    }
                    if (targetName)
                    {
                        const hasName = $card.find('label.target-name').filter(function()
                        {
                            return $(this).find('span').first().text().trim() === targetName;
                        }).length > 0;
                        if (hasName)
                        {
                            matchedTokenId = tokenId;
                            break;
                        }
                    }
                }
                if (matchedTokenId !== null)
                    matchingCards.push({ $card, matchedTokenId });
                else
                    nonMatchingCards.push($card);
            });

            // Drop stale rows first, the gate can change
            for (const $card of nonMatchingCards)
                $card.find(`[class*="csm-tgt-bonus-${bonus.id}-"]`).remove();

            if (matchingCards.length === 0)
                continue;

            for (const { $card, matchedTokenId } of matchingCards)
            {
                const $body = $card.find('.accdiff-target-body').first();
                if ($body.length === 0)
                    continue;

                const guardClass = `csm-tgt-bonus-${bonus.id}-${matchedTokenId}`;
                if ($body.find(`.${guardClass}`).length > 0)
                    continue; // already injected

                const isDisabled = disabledByUser.has(`${bonus.id}:${matchedTokenId}`);
                const $row = $(laRowHtml({
                    name: bonus.name,
                    tag: laValueTag(valText, effectiveVal < 0 ? 'diff' : 'acc'),
                    parts: bonusUsageParts(bonus, state),
                    on: !isDisabled,
                    scope,
                    cls: `csm-bonus-row la2-card ${guardClass}`,
                    inputCls: 'csm-tgt-bonus-checkbox'
                }));
                laCardSlot($body, 'bonus').append($row);
                injectedAny = true;

                const capturedTokenId = matchedTokenId;
                $row.find('.csm-tgt-bonus-checkbox').on('change', function()
                {
                    const checked = $(this).is(':checked');
                    const key = `${bonus.id}:${capturedTokenId}`;
                    if (checked !== disabledByUser.has(key))
                        return;
                    if (checked)
                        disabledByUser.delete(key);
                    else
                        disabledByUser.add(key);
                    const entry = targetEntryFor(capturedTokenId);
                    if (!entry)
                        return;
                    const delta = checked ? val : -val;
                    if (isDiff)
                        entry.difficulty += delta;
                    else
                        entry.accuracy += delta;
                });
            }
        }

        return injectedAny;
    };

    // Try immediately (form may already be open)
    tryInjectTargeted();

    const $form = $('form[id^="accdiff"]');
    const observeTarget = $form.length > 0 ? $form[0] : document.body;
    const observer = new MutationObserver(() =>
    {
        if ($('form[id^="accdiff"]').length === 0)
        {
            observer.disconnect();
            return;
        }
        tryInjectTargeted();
    });
    observer.observe(observeTarget, { childList: true, subtree: true });
    // Safety disconnect after 10 minutes
    setTimeout(() => observer.disconnect(), 600000);

    return tryInjectTargeted;
}

/**
 * Inject global damage bonus checkboxes into the damage HUD,
 * and also inject per-target damage bonus checkboxes into each matching target card.
 */
function showDamageBonusNotification(bonuses, state, targetedBonuses = [], targetModifiers = [], usageDmgEnabled = null)
{
    const bonusStates = bonuses.map((b, index) => ({
        ...b,
        index,
        enabled: !b._limitReached
    }));

    const renderBonusRow = (bonus, index, scope) => laRowHtml({
        name: bonus.name,
        tag: laDamageChips(bonus.damage || []),
        parts: bonusUsageParts(bonus, state, !!bonus._limitReached),
        limit: !!bonus._limitReached,
        on: bonus.enabled,
        scope,
        cls: 'csm-bonus-config-row la2-dmgrow',
        inputCls: 'csm-bonus-checkbox',
        attrs: { 'data-index': index }
    });

    const modLabels = { ap: 'Armor Piercing', half_damage: 'Half Damage', paracausal: 'Cannot be Reduced', crit: 'Force Crit', hit: 'Force Hit', miss: 'Force Miss' };
    const modTags = { ap: 'AP', half_damage: '1/2 Dmg', paracausal: 'No Reduce', crit: 'Crit', hit: 'Hit', miss: 'Miss' };
    const qualityNames = ['Miss', 'Hit', 'Crit'];
    const modReaches = (mod, targetEntry) =>
    {
        if (Array.isArray(mod.applyTo) && mod.applyTo.length > 0 && !mod.applyTo.includes(accDiffTargetToken(targetEntry)?.id))
            return false;
        return evaluateApplyToCondition(mod, targetEntry, state, resolveReactorToken(mod, state));
    };
    const modNote = (mod, targetEntry) =>
    {
        const hud = state.data?.damage_hud_data;
        const token = targetEntry ? accDiffTargetToken(targetEntry) : null;
        if (!token || !['crit', 'hit', 'miss'].includes(mod.subtype) || typeof hud?.getHitQuality !== 'function')
            return null;
        const natural = Number(hud.getHitQuality(token)) || 0;
        let forced = Math.max(natural, 1);
        if (mod.subtype === 'crit')
            forced = 2;
        else if (mod.subtype === 'miss')
            forced = 0;
        return natural !== forced ? `overrides ${qualityNames[natural]}` : null;
    };
    const modRowHtml = (mod, targetEntry, cls) =>
    {
        const label = modLabels[mod.subtype] || mod.subtype;
        return laInfoRowHtml({
            name: mod.name || label,
            tag: laValueTag(modTags[mod.subtype] || label, 'mod'),
            note: modNote(mod, targetEntry),
            cls,
            attrs: { 'data-sub': mod.subtype }
        });
    };

    const syncBonusToForm = async (bonusState, $bonusSection, $addBtn) =>
    {
        const bonusIdClass = `csm-bonus-controlled-${bonusState.index}`;
        const $existingRows = $bonusSection.find(`.${bonusIdClass}`);

        if (bonusState.enabled)
        {
            if ($existingRows.length === 0)
            {
                const damages = bonusState.damage || [];
                for (const damageEntry of damages)
                {
                    $addBtn.click();
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const $valInputs = $bonusSection.find('input[type="text"][placeholder="0"], input[type="number"]');
                    const $lastValInput = $valInputs.last();

                    const $rowContainer = $lastValInput.closest('.flexrow, .damage-grid-item, div');

                    if ($rowContainer.length > 0 && !$rowContainer.hasClass(bonusIdClass))
                    {
                        $rowContainer.addClass(bonusIdClass);
                        $rowContainer.addClass('csm-hidden-bonus-row');
                        $rowContainer.css('display', 'none');

                        $lastValInput.val(damageEntry.val);
                        $lastValInput[0].dispatchEvent(new Event('input', { bubbles: true }));
                        $lastValInput[0].dispatchEvent(new Event('change', { bubbles: true }));

                        const $select = $rowContainer.find('select');
                        if ($select.length > 0)
                        {
                            $select.find('option').each(function()
                            {
                                if ($(this).text().toLowerCase() === damageEntry.type.toLowerCase() ||
                                         $(this).val().toLowerCase() === damageEntry.type.toLowerCase())
                                {
                                    $select.val($(this).val());
                                    return false;
                                }
                            });
                            $select[0].dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }
            }
        }
        else
        {
            $existingRows.each(function()
            {
                const $deleteBtn = $(this).find('button.delete, i.fa-trash, i.mdi-delete, button i.mdi-delete').closest('button');
                if ($deleteBtn.length > 0)
                    $deleteBtn.click();
                else
                    $(this).remove(); // Fallback
            });
        }
    };

    const doInject = ($form, resolvedTargeted, targetCount) =>
    {
        const $configGrid = $form.find('.damage-hud-options-grid');
        if ($configGrid.length === 0)
            return false;

        let perCardBonuses = [];
        if (resolvedTargeted.length > 0)
        {
            if (targetCount <= 1)
            {
                resolvedTargeted.forEach(bonus =>
                {
                    if (!bonusStates.some(entry => entry._fromTargeted && entry.id === bonus.id))
                        bonusStates.push({ ...bonus, _fromTargeted: true, index: bonusStates.length, enabled: !bonus._limitReached });
                });
            }
            else
                perCardBonuses = resolvedTargeted;
        }

        let $myContainer = $configGrid.find('.csm-bonus-container');
        if ($myContainer.length === 0)
        {
            $myContainer = $('<div class="csm-bonus-container la2-dmgsec"></div>');
            $configGrid.append($myContainer);

            setTimeout(async () =>
            {
                // Must be serial; parallel calls race on .last() and leak default 1d6 Kin rows.
                const $bonusSection = $form.find('.bonus-damage');
                const $addBtn = $bonusSection.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
                if (!$addBtn.length)
                    return;
                for (const b of bonusStates)
                    await syncBonusToForm(b, $bonusSection, $addBtn);
            }, 200);
        }

        const hudTargets = state.data.damage_hud_data?.targets || [];
        const reach = new Map(targetModifiers.map(mod => [mod, hudTargets.filter(entry => modReaches(mod, entry))]));
        const shownMods = targetModifiers.filter(mod => reach.get(mod).length > 0);
        const sharedTMods = shownMods.filter(mod => hudTargets.length <= 1 || reach.get(mod).length === hudTargets.length);
        const perTargetTMods = shownMods.filter(mod => !sharedTMods.includes(mod));
        const single = hudTargets.length === 1 ? hudTargets[0] : null;
        const scope = _detectSvelteScope($form, 'label.container');
        const headScope = _detectSvelteScope($form, '.damage-hud-section');
        const rows = [
            ...bonusStates.map((bonus, index) => renderBonusRow(bonus, index, scope)),
            ...sharedTMods.map(mod => modRowHtml(mod, single, 'csm-bonus-config-row la-tmod-dmg-row'))
        ];
        $myContainer.html(rows.length ? `<h4 class="damage-hud-section lancer-border-primary ${headScope}" style="justify-content: center;">Global Bonuses</h4>${laSplitGroupHtml(rows)}` : '');
        $myContainer.toggle(rows.length > 0);

        $myContainer.find('.csm-bonus-checkbox').on('change', function()
        {
            const index = Number.parseInt($(this).closest('.csm-bonus-config-row').attr('data-index'));
            const isChecked = $(this).is(':checked');
            if (!bonusStates[index])
                return;
            bonusStates[index].enabled = isChecked;
            if (usageDmgEnabled && bonusStates[index].id)
                usageDmgEnabled.set(bonusStates[index].id, isChecked);

            const $bonusSection = $form.find('.bonus-damage');
            const $addBtn = $bonusSection.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
            if ($addBtn.length > 0)
                syncBonusToForm(bonusStates[index], $bonusSection, $addBtn);
        });

        $form.find('.damage-hud-target-card').each(function (cardIndex)
        {
            const $card = $(this);
            $card.find('.la-tmod-dmg-card').remove();
            // Match by card index -> hudTargets[index].target.id
            const hudTarget = hudTargets[cardIndex];
            if (!hudTarget)
                return;
            for (const mod of perTargetTMods)
            {
                if (reach.get(mod).includes(hudTarget))
                    laCardSlot($card, 'mod').append(modRowHtml(mod, hudTarget, `la2-card la-tmod-dmg-card la-tmod-dmg-${mod.id || mod.subtype}-${accDiffTargetToken(hudTarget)?.id}`));
            }
        });

        if (perCardBonuses.length > 0)
            injectTargetedDamageBonuses(perCardBonuses, $form, state.data.damage_hud_data.targets, state);

        return true;
    };

    let prevTargetSig = (state.data?.damage_hud_data?.targets || []).map(t => accDiffTargetToken(t)?.id).sort().join(',');
    let reinjectPending = false;
    let formWasSeen = false;

    const observer = new MutationObserver(() =>
    {
        const $form = $('#damage-hud');
        if ($form.length === 0)
        {
            if (formWasSeen)
                observer.disconnect();
            return;
        }
        formWasSeen = true;

        const hudData = state.data?.damage_hud_data;
        if (!hudData)
            return;

        const currentTargets = hudData.targets || [];
        const sig = currentTargets.map(t => accDiffTargetToken(t)?.id).sort().join(',');
        const hasContainer = $form.find('.csm-bonus-container').length > 0;
        const targetCount = currentTargets.length;
        const cardsFound = $form.find('.damage-hud-target-card').length;

        // Wait for cards to populate if there are multiple targets
        if (targetCount > 1 && cardsFound < targetCount)
            return;

        if (sig === prevTargetSig && hasContainer && !reinjectPending)
            return;

        if (reinjectPending)
            return;
        reinjectPending = true;

        setTimeout(() =>
        {
            const refreshedForm = $('#damage-hud');
            if (refreshedForm.length === 0)
            {
                reinjectPending = false;
                return;
            }

            if (sig !== prevTargetSig)
            {
                prevTargetSig = sig;
                // Clear per-card injections
                targetedBonuses.forEach(bonus =>
                {
                    const guardClass = `csm-tgt-dmg-${(bonus.id || bonus.name).replace(/[^a-z0-9]/gi, '-')}`;
                    refreshedForm.find(`.${guardClass}`).remove();
                });
                refreshedForm.find('.damage-hud-target-card [class*="csm-tgt-dmg-ctrl-"]').each(function()
                {
                    const $del = $(this).find('button').first();
                    if ($del.length)
                        $del.click();
                    else
                        $(this).remove();
                });

                // Remove targeted bonuses from bonusStates and their global damage entries
                for (let i = bonusStates.length - 1; i >= 0; i--)
                {
                    if (!bonusStates[i]._fromTargeted)
                        continue;
                    const b = bonusStates[i];
                    b.enabled = false;
                    const $bonusSection = refreshedForm.find('.bonus-damage');
                    const $addBtn = $bonusSection.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
                    if ($addBtn.length > 0)
                        syncBonusToForm(b, $bonusSection, $addBtn);
                    bonusStates.splice(i, 1);
                }
                bonusStates.forEach((b, i) =>
                {
                    b.index = i;
                });
            }

            const newResolved = targetedBonuses.map(bonus =>
            {
                const hudTarget = currentTargets.find(candidate => (bonus.applyTo || []).includes(accDiffTargetToken(candidate)?.id));
                return hudTarget ? { ...bonus } : null;
            }).filter(Boolean);

            doInject(refreshedForm, newResolved, targetCount);
            reinjectPending = false;
        }, 50);
    });

    const $hudzone = $('#hudzone');
    if ($hudzone.length > 0)
        observer.observe($hudzone[0], { childList: true, subtree: true });
    else
        observer.observe(document.body, { childList: true, subtree: true });

    // Safety disconnect after 10 minutes
    setTimeout(() => observer.disconnect(), 600000);

    return () =>
    {
        const $form = $('#damage-hud');
        if ($form.length === 0)
            return;
        const currentTargets = state.data?.damage_hud_data?.targets || [];
        const resolved = targetedBonuses
            .filter(bonus => currentTargets.some(candidate => (bonus.applyTo || []).includes(accDiffTargetToken(candidate)?.id)))
            .map(bonus => ({ ...bonus }));
        doInject($form, resolved, currentTargets.length);
    };
}

/**
 * Inject per-target damage bonus checkboxes into each matching target card in the damage HUD.
 * Card order in DOM matches damage_hud_data.targets order, matched by index.
 */
async function injectTargetedDamageBonuses(targetedBonuses, $form, hudTargets, state = null)
{
    if (!document.getElementById('csm-bonus-styles'))
    {
        $('<style id="csm-bonus-styles">.target-bonus-damage-wrapper:not(:has(:not(.csm-hidden-bonus-row))){display:none!important}</style>')
            .appendTo('head');
    }
    const scope = _detectSvelteScope($form, 'label.container');

    $form.find('.damage-hud-target-card').each(function(cardIndex)
    {
        const $card = $(this);
        const tokenId = accDiffTargetToken(hudTargets[cardIndex])?.id;
        if (!tokenId)
            return;

        const matchingBonuses = targetedBonuses.filter(b => (b.applyTo || []).includes(tokenId));
        if (!matchingBonuses.length)
            return;

        const $bonusSection = $card.find('.target-bonus-damage');
        if (!$bonusSection.length)
            return;

        const initialSyncs = [];
        matchingBonuses.forEach((bonus, localIdx) =>
        {
            const guardClass = `csm-tgt-dmg-${(bonus.id || bonus.name).replace(/[^a-z0-9]/gi, '-')}`;
            if ($card.find(`.${guardClass}`).length > 0)
                return; // already injected

            const $row = $(laRowHtml({
                name: bonus.name,
                tag: laDamageChips(bonus.damage || []),
                parts: bonusUsageParts(bonus, state),
                scope,
                cls: `csm-bonus-config-row la2-dmgrow la2-card ${guardClass}`,
                inputCls: 'csm-tgt-dmg-checkbox'
            }));

            // Visual row goes after the AP/Paracausal/Half-damage config row
            laCardSlot($card, 'bonus').append($row);

            let enabled = true;
            const bonusIdClass = `csm-tgt-dmg-ctrl-${guardClass}-${localIdx}`;

            const syncToCard = async (enable) =>
            {
                const $addBtn = $bonusSection.find('.add-damage-type');
                if (!$addBtn.length)
                    return;

                const $existing = $bonusSection.find(`.${bonusIdClass}`);

                if (enable && $existing.length === 0)
                {
                    for (const d of (bonus.damage || []))
                    {
                        $addBtn.click();
                        await new Promise(r => setTimeout(r, 50));
                        const $valInputs = $bonusSection.find('input[type="text"],input[type="number"]');
                        const $lastVal = $valInputs.last();
                        const $rowContainer = $lastVal.closest('.flexrow, .damage-grid-item, div');
                        if ($rowContainer.length && !$rowContainer.hasClass(bonusIdClass))
                        {
                            $rowContainer.addClass(bonusIdClass).addClass('csm-hidden-bonus-row').css('display', 'none');
                            $lastVal.val(d.val);
                            $lastVal[0].dispatchEvent(new Event('input', { bubbles: true }));
                            $lastVal[0].dispatchEvent(new Event('change', { bubbles: true }));
                            const $select = $rowContainer.find('select');
                            if ($select.length)
                            {
                                $select.find('option').each(function()
                                {
                                    if ($(this).text().toLowerCase() === d.type.toLowerCase())
                                    {
                                        $select.val($(this).val()); return false;
                                    }
                                });
                                $select[0].dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    }
                }
                else if (!enable)
                {
                    $existing.each(function()
                    {
                        const $del = $(this).find('button').first();
                        if ($del.length)
                            $del.click(); else
                            $(this).remove();
                    });
                }
            };

            initialSyncs.push(() => syncToCard(true));

            $row.find('.csm-tgt-dmg-checkbox').on('change', function()
            {
                enabled = $(this).is(':checked');
                syncToCard(enabled);
            });
        });

        if (initialSyncs.length)
        {
            setTimeout(async () =>
            {
                // Serial; parallel calls race on .last() and leak default 1d6 Kin rows.
                for (const fn of initialSyncs)
                    await fn();
            }, 200);
        }
    });
}

// Each Lancer release rebuilds with a fresh svelte scope hash; detect rather than hardcode.
function _detectSvelteScope($form, selector)
{
    const refs = $form.find(selector);
    for (let i = 0; i < refs.length; i++)
    {
        for (const cls of refs[i].classList)
        {
            if (cls.startsWith('svelte-'))
                return cls;
        }
    }
    return '';
}

/**
 * Inject a Knockback checkbox into the damage HUD options grid.
 * Pre-fills from the weapon's knockback tag if present; otherwise unchecked but visible.
 * Stores the enabled/value state on state.data._csmKnockback for the knockback damage step.
 */
export function injectKnockbackCheckbox(state)
{
    if (!state.data)
        state.data = {};

    // Read weapon tag to pre-fill
    const item = state.item;
    const tags = state.data?.tags || item?.system?.tags || [];
    const knockbackTag = tags.find(t => t.id === "knockback" || t.lid === "tg_knockback");
    const hasTag = !!knockbackTag;
    let tagVal = hasTag ? (Number.parseInt(knockbackTag.val) || Number.parseInt(knockbackTag.num_val) || 1) : 1;

    // Shared state that the knockbackDamageStep will read
    state.data._csmKnockback = { enabled: hasTag, value: tagVal };

    const doInject = () =>
    {
        const $form = $('#damage-hud');
        if ($form.length === 0)
            return false;

        const $configGrid = $form.find('.damage-hud-options-grid');
        if ($configGrid.length === 0)
            return false;

        // Don't double-inject
        if ($configGrid.find('.csm-knockback-row').length > 0)
            return true;
        const currentAreas = $configGrid.css('grid-template-areas');
        if (currentAreas && currentAreas.includes('empty'))
            $configGrid.css('grid-template-areas', currentAreas.replace('empty', 'knockback'));
        else
        {
            $configGrid.css('grid-template-areas',
                '"title title" "ap overkill" "paracausal reliable" "halfdamage knockback"'
            );
        }

        const checked = state.data._csmKnockback.enabled;
        const val = state.data._csmKnockback.value;

        const containerScope = _detectSvelteScope($form, 'label.container');
        const valueScope = _detectSvelteScope($form, '.reliable-value, .damage-hud-section');

        const $row = $(`
            <div class="csm-knockback-row flexrow" style="grid-area: knockback; align-items: center;">
                <label class="container ${containerScope}" style="max-width: fit-content; padding-right: 0.5em; cursor: pointer;">
                    <input type="checkbox" class="csm-knockback-checkbox ${containerScope}" ${checked ? 'checked' : ''}>
                    <span style="text-wrap: nowrap;">Knockback</span>
                </label>
                <i class="csm-knockback-icon mdi mdi-arrow-expand-all i--2 ${valueScope}" data-tooltip="${localize('LA.bonus.knockback')}" style="${checked ? '' : 'display:none;opacity:0;'}"></i>
                <input class="lancer-input csm-knockback-value reliable-value ${valueScope}"
                       type="text" inputmode="numeric" pattern="[0-9]*" data-dtype="string" value="${val}"
                       style="${checked ? '' : 'display:none;opacity:0;'}">
            </div>
        `);

        $configGrid.append($row);

        $row.find('.csm-knockback-checkbox').on('change', function ()
        {
            const isChecked = $(this).is(':checked');
            state.data._csmKnockback.enabled = isChecked;
            const $targets = $row.find('.csm-knockback-value, .csm-knockback-icon');
            if (isChecked)
            {
                $targets.stop(true, true).animate({ opacity: 1 }, { duration: 400,
                    easing: 'linear',
                    start: function ()
                    {
                        $(this).css('display', '');
                    } });
            }
            else
            {
                $targets.stop(true, true).animate({ opacity: 0 }, { duration: 400,
                    easing: 'linear',
                    complete: function ()
                    {
                        $(this).css('display', 'none');
                    } });
            }
        });

        $row.find('.csm-knockback-value').on('input change', function ()
        {
            state.data._csmKnockback.value = Number.parseInt(String($(this).val())) || 1;
        });

        return true;
    };

    doInject();

    observeHudReinject('#damage-hud', '.csm-knockback-row', doInject);
}

/**
 * Inject a "No Bonus Dmg" checkbox into the damage HUD options grid.
 * Pre-fills from item flag lancer-automations.noBonusDmg; default false.
 * When checked, crosses out the bonus damage it clears: global, per-target and LA's damage rows.
 * Actual suppression is handled by noBonusDmgClearStep in main.js.
 */
export function injectNoBonusDmgCheckbox(state)
{
    if (!state.data)
        state.data = {};

    state.la_extraData = state.la_extraData || {};

    if (!state.la_extraData._csmNoBonusDmg?.enabled)
    {
        const hasFlag = !!(getLAFlag(state.item,'noBonusDmg'));
        state.la_extraData._csmNoBonusDmg = { enabled: hasFlag };
    }

    const applyStrikethrough = ($form) =>
    {
        $form.toggleClass('la2-nobonus', !!state.la_extraData._csmNoBonusDmg.enabled);
    };

    const doInject = () =>
    {
        const $form = $('#damage-hud');
        if ($form.length === 0)
            return false;

        const $configGrid = $form.find('.damage-hud-options-grid');
        if ($configGrid.length === 0)
            return false;

        if ($configGrid.find('.csm-no-bonus-dmg-row').length > 0)
        {
            applyStrikethrough($form);
            return true;
        }

        const currentAreas = $configGrid.css('grid-template-areas') || '';
        if (currentAreas.includes('empty'))
            $configGrid.css('grid-template-areas', currentAreas.replace('empty', 'nobonusdmg'));
        else
            $configGrid.css('grid-template-areas', currentAreas + ' "nobonusdmg nobonusdmg"');

        const checked = state.la_extraData._csmNoBonusDmg.enabled;
        const containerScope = _detectSvelteScope($form, 'label.container');

        const $row = $(`
            <div class="csm-no-bonus-dmg-row" style="grid-area: nobonusdmg; display: flex; align-items: center; margin-top: 4px;">
                <label class="container ${containerScope}" style="max-width: fit-content; padding-right: 0.5em; cursor: pointer;">
                    <input type="checkbox" class="csm-no-bonus-dmg-checkbox ${containerScope}" ${checked ? 'checked' : ''}>
                    <i class="mdi mdi-cancel i--s ${containerScope}"></i>
                    <span style="text-wrap: nowrap;">No Bonus Dmg</span>
                </label>
            </div>
        `);

        $configGrid.append($row);
        applyStrikethrough($form);

        $row.find('.csm-no-bonus-dmg-checkbox').on('change', function ()
        {
            state.la_extraData._csmNoBonusDmg.enabled = $(this).is(':checked');
            applyStrikethrough($form);
        });

        return true;
    };

    doInject();

    observeHudReinject('#damage-hud', '.csm-no-bonus-dmg-row', doInject, ($form) =>
    {
        if (state.la_extraData._csmNoBonusDmg.enabled)
            applyStrikethrough($form);
    });
}

// Throttled checkbox in the damage HUD: drives global Half Damage; unchecking Half Damage drops it.
export function injectThrottledCheckbox(state)
{
    state.la_extraData = state.la_extraData || {};
    if (!state.la_extraData._laThrottled)
        state.la_extraData._laThrottled = { enabled: !!state.actor?.statuses?.has?.('throttled') };
    const throttledState = state.la_extraData._laThrottled;

    const findHalfDamage = ($form) => $form.find('.damage-hud-options-grid > [style*="halfdamage"]').find('input[type="checkbox"]').first();

    const doInject = () =>
    {
        const $form = $('#damage-hud');
        if ($form.length === 0)
            return false;
        const $configGrid = $form.find('.damage-hud-options-grid');
        if ($configGrid.length === 0)
            return false;
        if ($configGrid.find('.la-throttled-row').length > 0)
            return true;

        let areas = $configGrid.css('grid-template-areas') || '';
        if (areas.includes('nobonusdmg nobonusdmg'))
            areas = areas.replace('nobonusdmg nobonusdmg', 'nobonusdmg throttled');
        else if (areas.includes('empty'))
            areas = areas.replace('empty', 'throttled');
        else
            areas = areas + ' "throttled throttled"';
        $configGrid.css('grid-template-areas', areas);

        const containerScope = _detectSvelteScope($form, 'label.container');
        const statusText = localize(CONFIG.statusEffects?.find(effect => effect.id === 'throttled')?.description ?? '');
        const $row = $(`
            <div class="la-throttled-row" style="grid-area: throttled; display: flex; align-items: center; margin-top: 4px;">
                <label class="container ${containerScope}" style="max-width: fit-content; padding-right: 0.5em; cursor: pointer;" data-tooltip="${statusText.replace(/"/g, '&quot;')}">
                    <input type="checkbox" class="la-throttled-checkbox ${containerScope}" ${throttledState.enabled ? 'checked' : ''}>
                    <span style="text-wrap: nowrap;">Throttled (Half Dmg)</span>
                </label>
            </div>
        `);
        $configGrid.append($row);

        const syncHalfToThrottled = () =>
        {
            const $box = findHalfDamage($('#damage-hud'));
            if ($box.length && $box.prop('checked') !== throttledState.enabled)
                $box[0].click();
        };

        $row.find('.la-throttled-checkbox').on('change', function ()
        {
            throttledState.enabled = $(this).is(':checked');
            syncHalfToThrottled();
        });

        $form.off('change.laThrottled').on('change.laThrottled', () =>
        {
            setTimeout(() =>
            {
                const $freshForm = $('#damage-hud');
                const $box = findHalfDamage($freshForm);
                if ($box.length && !$box.prop('checked') && throttledState.enabled)
                {
                    throttledState.enabled = false;
                    $freshForm.find('.la-throttled-checkbox').prop('checked', false);
                }
            }, 0);
        });

        if (throttledState.enabled)
            syncHalfToThrottled();
        return true;
    };

    doInject();

    observeHudReinject('#damage-hud', '.la-throttled-row', doInject);
}

export const genericAccuracyStepAttack = createGenericBonusStep("attack");
export const genericAccuracyStepTechAttack = createGenericBonusStep("tech_attack");
export const genericAccuracyStepWeaponAttack = createGenericBonusStep("weapon_attack");
export const genericAccuracyStepStatRoll = createGenericBonusStep("stat_roll");
export const genericBonusStepDamage = createGenericBonusStep("damage");

/** @returns {Promise<string|undefined>} bonus ID, or undefined if no actor */
const EFFECT_FLAG_RESERVED = new Set([
    'linkedBonusId', 'stack', 'consumption', 'statDirect', 'changes', 'refresh',
    'targetID', 'effect', 'duration', 'note', 'originID', 'appliedRound', 'appliedStack', 'durationEntries'
]);

function _effectFlagsFrom(options)
{
    const flags = options?.effectFlags;
    if (!flags || typeof flags !== 'object')
        return {};
    /** @type {Record<string, any>} */
    const out = {};
    for (const [key, value] of Object.entries(flags))
    {
        if (EFFECT_FLAG_RESERVED.has(key))
        {
            console.warn(`lancer-automations | addGlobalBonus: effectFlags key '${key}' is reserved, skipped.`);
            continue;
        }
        out[key] = value;
    }
    return out;
}

function _bonusDuration(options, originId)
{
    const normalized = normalizeDuration({ label: options.duration || 'indefinite', rounds: options.durationRounds });
    const label = normalized.label;
    if (label === 'roundEnd' || label === 'roundStart')
        return { label, rounds: Math.max(1, Number(normalized.rounds) || 1), turns: null };
    if ((label === 'start' || label === 'end') && game.combat && originId)
    {
        const turnsVal = Number.isFinite(options.durationTurns) ? Math.max(0, options.durationTurns) : 1;
        const isOriginTurn = game.combat?.current?.tokenId === originId;
        const turns = label === 'end' && isOriginTurn ? turnsVal + 1 : (turnsVal === 0 ? 1 : turnsVal);
        return { label, turns, rounds: 0, _preAdjusted: true };
    }
    if (label === 'encounter' || label === 'permanent')
        return { label, turns: null, rounds: null };
    return { label: 'indefinite', turns: null, rounds: null };
}

export async function addGlobalBonus(actor, bonusData, options = {})
{
    if (!actor)
        return;
    bonusData = _acceptBonusInput(bonusData);
    if (options.duration === 'constant')
    {
        await addConstantBonus(actor, bonusData);
        return bonusData.id;
    }
    if (options.effectFlags && bonusData.id && (getLAFlag(actor,"global_bonuses") || []).some(existing => existing.id === bonusData.id))
        await removeGlobalBonus(actor, bonusData.id);
    const bonuses = duplicate(getLAFlag(actor,"global_bonuses") || []);

    if (!bonusData.id)
        bonusData.id = foundry.utils.randomID();
    if (!bonusData.name)
        bonusData.name = "Unnamed Bonus";

    bonusData = serializeBonusLambdas(bonusData);

    const existingIdx = bonuses.findIndex(b => b.id === bonusData.id);
    if (existingIdx !== -1)
        bonuses[existingIdx] = bonusData;
    else
        bonuses.push(bonusData);

    await delegateSetActorFlag(actor, MODULE_ID,"global_bonuses", bonuses);

    options.duration = options.duration || 'indefinite';
    if (options.duration)
    {
        const token = options.forcePrototype
            ? null
            : (actor.token?.object || canvas.tokens.placeables.find(t => t.actor?.id === actor.id));

        if (!token)
        {
            // Prototype / no scene token: write the AE straight to the actor so spawns inherit it.
            const icon = getBonusIconImage(bonusData, options.icon);
            const changes = [];
            let statDirect = null;

            if (bonusData.type === 'stat' && bonusData.stat)
            {
                const statMode = bonusData.statMode || 'add';
                const raw = Number.parseInt(bonusData.val) || 0;
                if (CURRENT_RESOURCE_STATS.has(bonusData.stat))
                {
                    const preBonusValue = foundry.utils.getProperty(actor, bonusData.stat) || 0;
                    const delta = statMode === 'replace' ? raw - preBonusValue : raw;
                    statDirect = { key: bonusData.stat, value: delta, preBonusValue };
                }
                else
                {
                    changes.push({
                        key: bonusData.stat,
                        value: String(raw),
                        mode: statMode === 'replace' ? CONST.ACTIVE_EFFECT_MODES.OVERRIDE : CONST.ACTIVE_EFFECT_MODES.ADD
                    });
                }
            }

            // A filtered resistance is decided per attack, so it must not be baked on permanently.
            if (bonusData.type === 'resistance' && bonusData.damageTypes && !hasBonusFilters(bonusData))
            {
                for (const lcType of expandDamageTypes(bonusData.damageTypes))
                    changes.push({ key: `system.resistances.${lcType}`, mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" });
            }

            const laFlags = /** @type {any} */ ({ linkedBonusId: bonusData.id, ..._effectFlagsFrom(options) });
            const protoDuration = _bonusDuration(options, null);
            if (protoDuration.label !== 'indefinite')
                laFlags.duration = protoDuration;
            if (statDirect)
                laFlags.statDirect = statDirect;
            if (options.consumption?.trigger)
            {
                // No originId: reactions-engine falls back to each prototype-spawned token at trigger time, so each consumes independently.
                laFlags.consumption = {
                    trigger: options.consumption.trigger,
                    role: options.consumption.role || null,
                    groupId: options.consumption.groupId || null,
                    evaluate: options.consumption.evaluate || null,
                    itemLid: options.consumption.itemLid || null,
                    itemId: options.consumption.itemId || null,
                    actionName: options.consumption.actionName || null,
                    minDistance: options.consumption.minDistance ?? null,
                    checkType: options.consumption.checkType || null,
                    checkAbove: options.consumption.checkAbove ?? null,
                    checkBelow: options.consumption.checkBelow ?? null,
                };
            }
            const effectData = { name: bonusData.name, img: icon, changes, flags: { [MODULE_ID]: laFlags } };
            if (bonusData.uses && bonusData.uses > 0)
            {
                foundry.utils.setProperty(effectData, 'flags.statuscounter.value', bonusData.uses);
                foundry.utils.setProperty(effectData, 'flags.statuscounter.visible', bonusData.uses > 1);
            }
            if (options.refresh && actor.effects.some(effect => getLAFlags(effect)?.linkedBonusId === bonusData.id))
                return;
            await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);

            if (statDirect)
            {
                let newVal = Math.max(0, statDirect.preBonusValue + statDirect.value);
                const maxPath = statDirect.key.replace('.value', '.max');
                if (maxPath !== statDirect.key)
                {
                    const maxVal = foundry.utils.getProperty(actor, maxPath);
                    if (maxVal !== undefined)
                        newVal = Math.min(newVal, maxVal);
                }
                await actor.update({ [statDirect.key]: newVal });
            }
        }
        else if (token)
        {
            const durationObj = _bonusDuration(options, options.origin?.id || options.origin || token.id);

            const icon = getBonusIconImage(bonusData, options.icon);

            const extraOptions = /** @type {any} */ ({ linkedBonusId: bonusData.id, ..._effectFlagsFrom(options) });

            // Stack = uses count (statuscounter.value is the single counter)
            if (bonusData.uses)
                extraOptions.stack = bonusData.uses;

            // If consumption trigger is configured, attach it (no 'uses'; stack handles that)
            if (options.consumption?.trigger)
            {
                extraOptions.consumption = {
                    trigger: options.consumption.trigger,
                    originId: options.consumption.originId || token.id,
                    role: options.consumption.role || null,
                    groupId: options.consumption.groupId || null,
                    evaluate: options.consumption.evaluate || null,
                    itemLid: options.consumption.itemLid || null,
                    itemId: options.consumption.itemId || null,
                    actionName: options.consumption.actionName || null,
                    minDistance: options.consumption.minDistance ?? null,
                    checkType: options.consumption.checkType || null,
                    checkAbove: options.consumption.checkAbove ?? null,
                    checkBelow: options.consumption.checkBelow ?? null
                };
            }

            if (bonusData.type === 'stat' && bonusData.stat)
            {
                const statMode = bonusData.statMode || 'add';
                const raw = Number.parseInt(bonusData.val) || 0;
                if (CURRENT_RESOURCE_STATS.has(bonusData.stat))
                {
                    const preBonusValue = foundry.utils.getProperty(token.actor, bonusData.stat) || 0;
                    // Store value as the delta so removal reverses just that delta (same as add mode).
                    const delta = statMode === 'replace' ? raw - preBonusValue : raw;
                    extraOptions.statDirect = { key: bonusData.stat, value: delta, preBonusValue };
                }
                else
                {
                    extraOptions.changes = [{
                        key: bonusData.stat,
                        value: String(raw),
                        mode: statMode === 'replace' ? CONST.ACTIVE_EFFECT_MODES.OVERRIDE : CONST.ACTIVE_EFFECT_MODES.ADD
                    }];
                }
            }

            if (bonusData.type === 'resistance' && bonusData.damageTypes && !hasBonusFilters(bonusData))
            {
                if (!extraOptions.changes)
                    extraOptions.changes = [];
                for (const lcType of expandDamageTypes(bonusData.damageTypes))
                {
                    extraOptions.changes.push({
                        key: `system.resistances.${lcType}`,
                        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
                        value: "true"
                    });
                }
            }

            await applyEffectsToTokens(
                {
                    tokens: [token],
                    effectNames: [{
                        name: bonusData.name,
                        icon: icon,
                        isCustom: true,
                        stack: bonusData.uses || 1
                    }],
                    note: `Linked to Global Bonus: ${bonusData.name}`,
                    duration: { ...durationObj, overrideTurnOriginId: options.origin?.id || options.origin || token.id },
                    refresh: !!options.refresh
                },
                extraOptions
            );

            // Apply direct stat modification for current resources (after effect is created)
            if (extraOptions.statDirect)
            {
                let newVal = extraOptions.statDirect.preBonusValue + extraOptions.statDirect.value;
                newVal = Math.max(0, newVal);
                // Clamp to max if applicable (e.g., hp.value can't exceed hp.max)
                const maxPath = extraOptions.statDirect.key.replace('.value', '.max');
                if (maxPath !== extraOptions.statDirect.key)
                {
                    const maxVal = foundry.utils.getProperty(token.actor, maxPath);
                    if (maxVal !== undefined)
                        newVal = Math.min(newVal, maxVal);
                }
                await token.actor.update({ [extraOptions.statDirect.key]: newVal });
            }
            const originRaw = options.origin;
            const originId = originRaw?.id ?? originRaw;
            const originToken = typeof originId === 'string'
                ? canvas.tokens?.get?.(originId) ?? null
                : (originRaw && originRaw.document ? originRaw : null);
            playBonusAddedFX(token, originToken);
        }
    }

    return bonusData.id;
}

/**
 * @param {string|function(bonuses): boolean} bonusIdOrPredicate - Bonus ID string, or a predicate
 *   to remove all matching bonuses in a single flag update.
 * @returns {Promise<boolean>} true if at least one bonus was removed
 */
const _bonusFlagQueues = new Map();
const _pendingBonusRemovals = new Map();

function _actorKey(actor)
{
    return actor.uuid ?? actor.id;
}

// read-modify-write of the bonus flag must not interleave: a batch delete fires the hook once per effect
function _queueBonusFlagWrite(actor, task)
{
    const key = _actorKey(actor);
    const previous = _bonusFlagQueues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    _bonusFlagQueues.set(key, run);
    run.finally(() =>
    {
        if (_bonusFlagQueues.get(key) === run)
            _bonusFlagQueues.delete(key);
    }).catch(() => undefined);
    return run;
}

/** True while a removal of that bonus is in flight, so lists can drop it before the flag catches up. */
export function isBonusRemovalPending(actor, bonusId)
{
    return !!actor && !!_pendingBonusRemovals.get(_actorKey(actor))?.has(bonusId);
}

export async function removeGlobalBonus(actor, bonusIdOrPredicate, skipEffectRemoval = false)
{
    if (!actor)
        return;
    const predicate = typeof bonusIdOrPredicate === 'function'
        ? bonusIdOrPredicate
        : bonus => bonus.id === bonusIdOrPredicate;

    const key = _actorKey(actor);
    const pendingIds = (getLAFlag(actor,"global_bonuses") || []).filter(predicate).map(bonus => bonus.id);
    const pending = _pendingBonusRemovals.get(key) ?? new Set();
    for (const id of pendingIds)
        pending.add(id);
    _pendingBonusRemovals.set(key, pending);
    try
    {
        return await _queueBonusFlagWrite(actor, async () =>
        {
            let bonuses = duplicate(getLAFlag(actor,"global_bonuses") || []);
            const initialLength = bonuses.length;
            const bonusesToRemove = bonuses.filter(predicate);
            bonuses = bonuses.filter(bonus => !predicate(bonus));
            if (bonuses.length === initialLength)
                return false;

            await delegateSetActorFlag(actor, MODULE_ID,"global_bonuses", bonuses);

            if (!skipEffectRemoval && bonusesToRemove.length > 0)
            {
                const removedIds = new Set(bonusesToRemove.map(bonus => bonus.id));
                const linkedEffects = actor.effects.filter(linkedEffect =>
                    removedIds.has(getLAFlag(linkedEffect,'linkedBonusId'))
                );
                for (const linkedEffect of linkedEffects)
                    await linkedEffect.delete();
            }
            return true;
        });
    }
    finally
    {
        for (const id of pendingIds)
            pending.delete(id);
        if (!pending.size && _pendingBonusRemovals.get(key) === pending)
            _pendingBonusRemovals.delete(key);
    }
}

/** @returns {object[]} */
export function getGlobalBonuses(actor)
{
    if (!actor)
        return [];
    return (getLAFlag(actor,"global_bonuses") || [])
        .filter(bonus => linkTierGate(bonus, actor))
        .map(normalizeBonusShape);
}

/** @returns {object|null} The bonus with that id, or null */
export function getGlobalBonus(actor, bonusId)
{
    if (!actor)
        return null;
    const bonuses = actor ? (getLAFlag(actor,"global_bonuses") || []) : [];
    return bonuses.find(b => b.id === bonusId) || null;
}

Hooks.on("deleteActiveEffect", (effect) =>
{
    if (getLAFlag(effect,'repairKeep'))
        return;
    // Item-source AEs: reversal runs when the transferred copy leaves the actor; removeGlobalBonus on an item no-ops via the flag branch.
    const isItemParent = effect.parent?.documentName === 'Item';

    const linkedBonusId = getLAFlag(effect,"linkedBonusId");
    if (linkedBonusId && effect.parent)
        removeGlobalBonus(effect.parent, linkedBonusId, true);

    if (isItemParent)
        return;

    const statDirect = getLAFlag(effect,'statDirect');
    if (statDirect && effect.parent)
    {
        setTimeout(async () =>
        {
            const actor = effect.parent;
            if (!actor)
                return;
            const currentVal = foundry.utils.getProperty(actor, statDirect.key) || 0;
            let newVal;

            if (statDirect.value > 0)
            {
                // Positive bonus: only remove what's still present above the pre-bonus baseline (damage may have consumed part).
                const remainingBonus = Math.max(0, Math.min(statDirect.value, currentVal - (statDirect.preBonusValue || 0)));
                newVal = currentVal - remainingBonus;
            }
            else
            {
                // Negative bonus: give back full amount, clamp to max
                newVal = currentVal - statDirect.value;
            }

            newVal = Math.max(0, newVal);
            // Clamp to max if applicable (e.g., hp.value can't exceed hp.max)
            const maxPath = statDirect.key.replace('.value', '.max');
            if (maxPath !== statDirect.key)
            {
                const maxVal = foundry.utils.getProperty(actor, maxPath);
                if (maxVal !== undefined)
                    newVal = Math.min(newVal, maxVal);
            }
            await actor.update({ [statDirect.key]: newVal });
        }, 200);
    }

    // Clamp .value when a .max stat bonus is reversed by Foundry
    const maxChanges = (effect.changes || []).filter(c =>
        c.key?.endsWith('.max') && (c.mode === CONST.ACTIVE_EFFECT_MODES.ADD || c.mode === CONST.ACTIVE_EFFECT_MODES.OVERRIDE)
    );
    if (maxChanges.length > 0 && effect.parent)
    {
        setTimeout(async () =>
        {
            const actor = effect.parent;
            if (!actor)
                return;
            const updates = {};
            for (const change of maxChanges)
            {
                const valuePath = change.key.replace('.max', '.value');
                const newMax = foundry.utils.getProperty(actor, change.key);
                const currentValue = foundry.utils.getProperty(actor, valuePath);
                if (currentValue !== undefined && newMax !== undefined && currentValue > newMax)
                    updates[valuePath] = newMax;
            }
            if (Object.keys(updates).length > 0)
                await actor.update(updates);
        }, 200);
    }
});


/** @returns {Promise<void>} */
export async function injectBonusToFlowState(state, bonus)
{
    if (!state)
        return;

    if (!bonus.id)
        bonus.id = foundry.utils.randomID();

    if (!state.la_extraData)
        state.la_extraData = {};
    if (!state.la_extraData.flow_bonus)
        state.la_extraData.flow_bonus = [];

    state.la_extraData.flow_bonus.push(_acceptBonusInput(bonus));
}

// Constant stat bonuses carry no effect, so they are folded into derived data instead.
// Current resources are excluded: rewriting them each prepare would undo damage.
export function initConstantStatHooks()
{
    if (typeof libWrapper === 'undefined')
        return;
    libWrapper.register(MODULE_ID,'CONFIG.Actor.documentClass.prototype.prepareDerivedData',
        function (wrapped)
        {
            wrapped();
            const bonuses = getLAFlags(this)?.constant_bonuses;
            if (!bonuses?.length)
                return;
            for (const bonus of bonuses)
            {
                if (bonus?.type !== 'stat' || !bonus.stat || CURRENT_RESOURCE_STATS.has(bonus.stat))
                    continue;
                if (!linkTierGate(bonus, this))
                    continue;
                const raw = Number.parseInt(bonus.val) || 0;
                const current = Number(foundry.utils.getProperty(this, bonus.stat)) || 0;
                const next = (bonus.statMode || 'add') === 'replace' ? raw : current + raw;
                foundry.utils.setProperty(this, bonus.stat, next);
            }
        }, 'WRAPPER');
}

/** @returns {Promise<void>} */
export async function addConstantBonus(target, bonusData)
{
    if (!target)
        return;
    bonusData = _acceptBonusInput(bonusData);
    const bonuses = duplicate(getLAFlag(target,"constant_bonuses") || []);
    if (!bonusData.id)
        bonusData.id = foundry.utils.randomID();

    bonusData = serializeBonusLambdas(bonusData);

    if (target.documentName === 'Item')
    {
        console.warn('lancer-automations | addConstantBonus on Item is not supported - use linkBonusToItem instead.');
        return;
    }
    const existingIndex = bonuses.findIndex(bonus => bonus.id === bonusData.id);
    if (existingIndex >= 0)
        bonuses[existingIndex] = bonusData;
    else
        bonuses.push(bonusData);
    await delegateSetActorFlag(target, MODULE_ID,"constant_bonuses", bonuses);
}

/** @returns {object[]} */
export function getConstantBonuses(actor)
{
    if (!actor)
        return [];
    return (getLAFlag(actor,"constant_bonuses") || [])
        .filter(bonus => linkTierGate(bonus, actor))
        .map(normalizeBonusShape);
}

/**
 * Remove constant bonus(es) from an actor.
 * @param {Actor} target
 * @param {string|function(bonuses): boolean} bonusIdOrPredicate - Bonus ID string to remove one,
 *   or a predicate function to remove all matching bonuses in a single flag update.
 * @returns {Promise<void>}
 */
export async function removeConstantBonus(target, bonusIdOrPredicate)
{
    if (!target)
        return;
    const bonuses = duplicate(getLAFlag(target,"constant_bonuses") || []);
    const predicate = typeof bonusIdOrPredicate === 'function'
        ? bonusIdOrPredicate
        : bonus => bonus.id === bonusIdOrPredicate;
    const filtered = bonuses.filter(bonus => !predicate(bonus));
    if (filtered.length !== bonuses.length)
    {
        if (target.documentName === 'Item')
            await setLAFlag(target,"constant_bonuses", filtered);
        else
            await delegateSetActorFlag(target, MODULE_ID,"constant_bonuses", filtered);
    }
}

function _bonusTemplateRuntimeId(sourceDoc, templateId)
{
    return `${sourceDoc.uuid}::${templateId}`;
}

async function _materializeBonusTemplatesToTokens(sourceDoc, sourceKey, tokens)
{
    if (!sourceDoc || !tokens?.length)
        return;
    const templates = getLAFlag(sourceDoc,'bonusTemplates') || [];
    if (!templates.length)
        return;
    for (const template of templates)
    {
        const runtimeId = _bonusTemplateRuntimeId(sourceDoc, template.id);
        const persistedUses = Number.isFinite(template.lastRuntimeUses) ? Number(template.lastRuntimeUses) : undefined;
        const templateUses = template.bonusData?.uses;
        const uses = persistedUses !== undefined ? persistedUses : templateUses;
        // Exhausted templates (persistedUses === 0) do not re-materialize until user resets uses.
        if (persistedUses === 0 && templateUses !== undefined)
            continue;
        const rawDuration = template.addOptions?.duration;
        const durationLabel = typeof rawDuration === 'string' ? rawDuration : rawDuration?.label;
        const isConstant = durationLabel === 'constant';
        for (const token of tokens)
        {
            const actor = token?.actor;
            if (!actor)
                continue;
            if (!linkTierGate(template.bonusData, actor, sourceKey === 'sourceItemUuid' ? sourceDoc : null))
                continue;
            const markers = { [sourceKey]: sourceDoc.uuid, sourceTemplateId: template.id, sourceBonusId: template.bonusData?.id };
            if (isConstant)
            {
                const existing = /** @type {any[]} */ (getLAFlag(actor,'constant_bonuses') || []);
                if (existing.some(bonus => bonus.id === runtimeId))
                    continue;
                const bonusDataOut = { ...normalizeBonusShape(template.bonusData || {}), id: runtimeId, ...markers };
                if (uses !== undefined)
                    bonusDataOut.uses = uses;
                try
                {
                    await delegateSetActorFlag(actor, MODULE_ID,'constant_bonuses', [...existing, bonusDataOut]);
                }
                catch (err)
                {
                    console.warn('lancer-automations | bonus template constant write failed:', err);
                }
                continue;
            }
            const already = (getLAFlag(actor,'global_bonuses') || []).some(bonus => bonus.id === runtimeId);
            if (already)
                continue;
            const bonusDataOut = { ...normalizeBonusShape(template.bonusData || {}), id: runtimeId, ...markers };
            if (uses !== undefined)
                bonusDataOut.uses = uses;
            const optsOut = { ...(template.addOptions || {}), ...markers };
            try
            {
                await addGlobalBonus(actor, bonusDataOut, optsOut);
            }
            catch (err)
            {
                console.warn('lancer-automations | bonus template materialize failed:', err);
            }
        }
    }
}

/**
 * Materialize all bonus templates on `item` to the given tokens via addGlobalBonus.
 * Idempotent - skips tokens whose actor already carries the runtime bonus for that template.
 * @param {any} item
 * @param {any[]} tokens
 * @returns {Promise<void>}
 */
export async function applyItemBonusTemplatesToTokens(item, tokens)
{
    if (!item || item.system?.destroyed || item.system?.disabled)
        return;
    await _materializeBonusTemplatesToTokens(item, 'sourceItemUuid', tokens);
}

/**
 * Materialize all bonus templates on prototype `actor` to the given tokens via addGlobalBonus.
 * @param {any} actor
 * @param {any[]} tokens
 * @returns {Promise<void>}
 */
export async function applyActorBonusTemplatesToTokens(actor, tokens)
{
    await _materializeBonusTemplatesToTokens(actor, 'sourceActorUuid', tokens);
}

async function _persistBonusUsesToTemplate(actor, runtimeBonus, explicitUses = undefined)
{
    const sourceUuid = runtimeBonus?.sourceItemUuid ?? runtimeBonus?.sourceActorUuid;
    const sourceTemplateId = runtimeBonus?.sourceTemplateId;
    if (!sourceUuid || !sourceTemplateId)
        return;
    try
    {
        const source = /** @type {any} */ (await fromUuid(sourceUuid));
        if (!source)
            return;
        const templates = getLAFlag(source,'bonusTemplates') || [];
        const template = templates.find(candidate => candidate.id === sourceTemplateId);
        if (!template)
            return;
        const rawDuration = template?.addOptions?.duration;
        const durationLabel = typeof rawDuration === 'string' ? rawDuration : rawDuration?.label;
        let currentUses;
        if (explicitUses !== undefined)
            currentUses = explicitUses;
        else
        {
            // Constant templates have no linked AE and no statuscounter to persist; skip.
            if (durationLabel === 'constant')
                return;
            const linkedAE = /** @type {any[]} */ (Array.from(actor?.effects ?? [])).find(effect =>
                getLAFlags(effect)?.linkedBonusId === runtimeBonus.id);
            const rawUses = linkedAE?.flags?.statuscounter?.value;
            currentUses = Number.isFinite(Number(rawUses)) ? Number(rawUses) : (linkedAE ? undefined : 0);
            if (currentUses === undefined)
                return;
        }
        const updated = templates.map(candidate => candidate.id === sourceTemplateId ? { ...candidate, lastRuntimeUses: currentUses } : candidate);
        await setLAFlag(source,'bonusTemplates', updated);
    }
    catch (err)
    {
        console.warn('lancer-automations | persistBonusUsesToTemplate failed:', err);
    }
}

/** @returns {boolean} */
export function supportsConsumeOnUsage(type, subtype = null)
{
    if (['accuracy', 'difficulty', 'damage', 'target_modifier', 'reroll', 'resistance', 'vulnerability'].includes(type))
        return true;
    if (type === 'immunity')
        return ['effect', 'crit', 'hit', 'miss', 'damage', 'provoke', 'terrain'].includes(subtype);
    return false;
}

function _findStoredBonus(actor, bonusId)
{
    const search = (list, source) =>
    {
        for (const stored of list)
        {
            if (stored.id === bonusId)
                return { stored, source };
            if (stored.type === 'multi' && typeof bonusId === 'string' && bonusId.startsWith(`${stored.id}_sub_`))
                return { stored, source };
        }
        return null;
    };
    return search(getLAFlag(actor,'global_bonuses') || [], 'global')
        ?? search(getLAFlag(actor,'constant_bonuses') || [], 'constant');
}

// Burn one use of a bonus (dual-write uses + linked AE); removes it when exhausted. Auto-consume-triggered bonuses are skipped (their charges belong to the trigger engine).
/** @returns {Promise<string|false>} The consumed bonus id, or false if nothing was spent */
export async function consumeBonusUse(actor, bonus, { removeWhenNoUses = false } = {})
{
    if (!actor || !bonus?.id)
        return false;
    const found = _findStoredBonus(actor, bonus.id);
    if (!found)
        return false;
    const { stored, source } = found;
    const linkedEffect = /** @type {any} */ (Array.from(actor.effects ?? []).find(effect =>
        getLAFlags(effect)?.linkedBonusId === stored.id));
    if (getLAFlags(linkedEffect)?.consumption?.trigger)
        return false;
    const currentUses = typeof stored.uses === 'number' ? stored.uses : null;
    if (currentUses === null && !removeWhenNoUses)
        return false;
    if (currentUses !== null && currentUses > 1)
    {
        const newUses = currentUses - 1;
        if (source === 'constant')
            await addConstantBonus(actor, { ...stored, uses: newUses });
        else
        {
            const bonuses = getLAFlag(actor,'global_bonuses') || [];
            const updated = bonuses.map(existing => existing.id === stored.id ? { ...existing, uses: newUses } : existing);
            await setLAFlag(actor,'global_bonuses', updated);
            if (linkedEffect)
                await linkedEffect.update({ 'flags.statuscounter.value': newUses });
        }
        await _persistBonusUsesToTemplate(actor, stored, newUses);
        return stored.id;
    }
    await _persistBonusUsesToTemplate(actor, stored, 0);
    if (source === 'global')
        await removeGlobalBonus(actor, stored.id, false);
    else
        await removeConstantBonus(actor, stored.id);
    return stored.id;
}

/**
 * @param {any} actor
 * @param {string} subtype
 * @param {any} [state]
 * @param {object} [options]
 * @param {string[]|null} [options.damageTypes] Only consider bonuses covering one of these damage types
 * @param {object[]|null} [options.bonuses] Prefiltered candidates, skips the flag re-read
 * @param {boolean} [options.aoe] Area damage, so "AoE" entries match
 * @returns {Promise<boolean>} True if a charge was spent
 */
export async function consumeImmunityUse(actor, subtype, state = null, { damageTypes = null, bonuses = null, aoe = false } = {})
{
    if (!actor)
        return false;
    if (DAMAGE_DEFENSE_TYPES.has(subtype))
    {
        warnDeprecated(_legacyDefenseMessage(subtype));
        return _consumeDefenseUse(actor, bonuses ?? _getTypedBonuses(actor, subtype, state), state, { damageTypes, aoe });
    }
    return _consumeDefenseUse(actor, bonuses ?? getImmunityBonuses(actor, subtype, state), state, { damageTypes, aoe });
}

export async function consumeResistanceUse(actor, state = null, { damageTypes = null, bonuses = null, aoe = false } = {})
{
    if (!actor)
        return false;
    return _consumeDefenseUse(actor, bonuses ?? getResistanceBonuses(actor, state), state, { damageTypes, aoe });
}

export async function consumeVulnerabilityUse(actor, state = null, { damageTypes = null, bonuses = null, aoe = false } = {})
{
    if (!actor)
        return false;
    return _consumeDefenseUse(actor, bonuses ?? getVulnerabilityBonuses(actor, state), state, { damageTypes, aoe });
}

async function _consumeDefenseUse(actor, candidates, state, { damageTypes, aoe })
{
    const wanted = damageTypes?.map(type => String(type).toLowerCase());
    const matchesType = (bonus) => !wanted || !bonus.damageTypes || bonus.damageTypes.some(type =>
    {
        const lower = String(type).toLowerCase();
        return lower === 'all' || lower === 'variable' || wanted.includes(lower) || (aoe && lower === 'aoe');
    });

    const pool = candidates.filter(matchesType);
    let spent = false;
    const burnedKeys = new Set();
    for (const bonus of pool)
    {
        const key = bonus.frequencyKey ?? bonus.id;
        if (burnedKeys.has(key) || bonusHasAutoConsume(actor, key))
            continue;
        if (await burnBonusFrequency(bonus, state))
        {
            spent = true;
            burnedKeys.add(key);
        }
    }
    for (const bonus of pool.filter(bonus => bonus.consumeOnUsage === true))
    {
        if (await consumeBonusUse(actor, bonus, { removeWhenNoUses: true }))
            return true;
    }
    return spent;
}

// Post-roll pass: burn "consume on usage" bonuses that actually applied in this flow.
export async function burnBonusUsageForFlow(state)
{
    const usage = state?.la_extraData?.bonusUsage;
    const actor = state?.actor;
    if (!usage || !actor)
        return;
    const burnedFrequencyKeys = new Set();
    for (const candidate of Object.values(usage.candidates))
    {
        if (!supportsConsumeOnUsage(candidate.type, candidate.subtype))
            continue;
        // Immunities burn where they are consulted, not on the bearer's own roll.
        if (DEFENSE_TYPES.has(candidate.type))
            continue;
        const consumesUses = candidate.consumeOnUsage !== false;
        if (!candidate.frequency && (!consumesUses || typeof candidate.uses !== 'number'))
            continue;
        if ([...usage.burned].some(id => candidate.id === id || String(candidate.id).startsWith(`${id}_sub_`)))
            continue;
        let used = false;
        if (candidate.bucket === 'acc')
            used = usage.enabledById.get(candidate.id) !== false;
        else if (candidate.bucket === 'targeted')
        {
            const mode = usage.appliedMode?.get(candidate.id);
            if (mode === 'base')
                used = usage.enabledById.get(candidate.id) !== false;
            else if (mode === 'target')
            {
                const targets = state.data?.acc_diff?.targets ?? [];
                const matchedIds = usage.appliedTargetIds?.get(candidate.id) ?? candidate.applyTo ?? [];
                used = targets.some(entry =>
                {
                    const tokenId = accDiffTargetToken(entry)?.id;
                    return tokenId && matchedIds.includes(tokenId) && !usage.disabledByUser?.has(`${candidate.id}:${tokenId}`);
                });
            }
        }
        else if (candidate.bucket === 'tmod')
            used = (usage.modEnabled?.get(candidate.id || candidate.subtype)) !== false;
        else
            used = usage.dmgEnabled.get(candidate.id) !== false;
        if (!used)
            continue;
        const frequencyKey = candidate.frequencyKey ?? candidate.id;
        if (candidate.frequency && !burnedFrequencyKeys.has(frequencyKey) && !bonusHasAutoConsume(actor, frequencyKey))
        {
            burnedFrequencyKeys.add(frequencyKey);
            await burnBonusFrequency(candidate, state);
        }
        if (!consumesUses)
            continue;
        const storedId = await consumeBonusUse(actor, candidate, { removeWhenNoUses: candidate.consumeOnUsage === true });
        if (storedId)
            usage.burned.add(storedId);
    }
}

async function _cleanupBonusRuntimes(actor, predicate)
{
    if (!actor)
        return;
    const globals = /** @type {any[]} */ (getLAFlag(actor,'global_bonuses') || [])
        .filter(predicate);
    for (const runtime of globals)
    {
        try
        {
            await _persistBonusUsesToTemplate(actor, runtime);
        }
        catch (err)
        {
            console.warn('lancer-automations | bonus cleanup persist:', err);
        }
        try
        {
            await removeGlobalBonus(actor, runtime.id, false);
        }
        catch (err)
        {
            console.warn('lancer-automations | bonus cleanup remove:', err);
        }
    }
    const constants = /** @type {any[]} */ (getLAFlag(actor,'constant_bonuses') || []);
    if (constants.some(predicate))
    {
        const remaining = constants.filter(bonus => !predicate(bonus));
        try
        {
            await delegateSetActorFlag(actor, MODULE_ID,'constant_bonuses', remaining);
        }
        catch (err)
        {
            console.warn('lancer-automations | constant cleanup failed:', err);
        }
    }
}

/**
 * Cleanup runtime bonuses on `actor` that originated from a foreign source.
 * @param {Actor} actor
 * @param {Function} isForeignSource
 */
// Duplicated tokens copy runtime bonuses stamped with the ORIGINAL token's uuids; purge those.
export async function cleanupForeignBonusRuntimes(actor, isForeignSource)
{
    await _cleanupBonusRuntimes(actor, bonus =>
    {
        const source = bonus.sourceItemUuid ?? bonus.sourceActorUuid;
        return source ? isForeignSource(source) : false;
    });
}

/** @returns {Promise<void>} */
export async function cleanupItemBonusesFromActor(item, actor)
{
    await _cleanupBonusRuntimes(actor, bonus => bonus.sourceItemUuid === item.uuid);
}

/**
 * Cleanup runtime bonuses on all active-token actors originating from an actor template on `actor`.
 * @param {any} actor
 * @returns {Promise<void>}
 */
export async function cleanupActorBonusesFromTokens(actor)
{
    const tokens = actor?.getActiveTokens?.() ?? [];
    for (const token of tokens)
    {
        if (token?.actor)
            await _cleanupBonusRuntimes(token.actor, bonus => bonus.sourceActorUuid === actor.uuid);
    }
}

async function _cleanupItemBonusTemplateFromActor(item, actor, templateId)
{
    if (!actor)
        return;
    const runtimeId = _bonusTemplateRuntimeId(item, templateId);
    await _cleanupBonusRuntimes(actor, bonus => bonus.id === runtimeId);
}

async function _cleanupActorBonusTemplateFromTokens(actor, templateId)
{
    const runtimeId = _bonusTemplateRuntimeId(actor, templateId);
    const tokens = actor?.getActiveTokens?.() ?? [];
    for (const token of tokens)
    {
        const target = token?.actor;
        if (!target)
            continue;
        await _cleanupBonusRuntimes(target, bonus => bonus.id === runtimeId);
    }
}

/**
 * Stamp a bonus template on each item and immediately materialize on parent-actor tokens.
 * @param {Object} options
 * @param {any[]} options.items
 * @param {Object} options.bonusData
 * @param {Object} [options.addOptions]
 * @param {Object} [extraOptions]
 * @returns {Promise<any[]>} Stamped { item, templateId } pairs
 */
export async function linkBonusToItem(options = /** @type {any} */ ({}), extraOptions = {})
{
    const { items = [], bonusData, addOptions = {} } = /** @type {any} */ (options);
    if (!bonusData)
        return [];
    const serialized = serializeBonusLambdas(_acceptBonusInput(bonusData));
    const stamped = [];
    for (const item of items)
    {
        if (!item || item.documentName !== 'Item')
            continue;
        const templateId = foundry.utils.randomID();
        const template = { id: templateId, bonusData: /** @type {any} */ ({ ...serialized }), addOptions: { ...addOptions, ...extraOptions } };
        const existing = getLAFlag(item,'bonusTemplates') || [];
        await setLAFlag(item,'bonusTemplates', [...existing, template]);
        stamped.push({ item, templateId });
        const parent = item.parent;
        if (parent?.documentName === 'Actor')
            await applyItemBonusTemplatesToTokens(item, parent.getActiveTokens?.() ?? []);
    }
    return stamped;
}

/**
 * linkBonusToItem, but idempotent: skips items already carrying a template with the same bonusData.id.
 * Requires bonusData.id.
 * @param {Object} options  Same shape as linkBonusToItem
 * @param {Object} [extraOptions]
 * @returns {Promise<any[]>} Stamped {item, templateId} pairs; empty when every item already had it
 */
export async function ensureLinkedBonus(options = /** @type {any} */ ({}), extraOptions = {})
{
    const { items = [], bonusData } = /** @type {any} */ (options);
    if (!bonusData?.id)
    {
        console.warn("lancer-automations | ensureLinkedBonus: bonusData.id is required for dedupe.");
        return linkBonusToItem(options, extraOptions);
    }
    const missing = items.filter(item => item?.documentName === 'Item'
        && !(getLAFlag(item,'bonusTemplates') || []).some(template => template.bonusData?.id === bonusData.id));
    if (!missing.length)
        return [];
    return linkBonusToItem({ ...options, items: missing }, extraOptions);
}

/**
 * Stamp a bonus template on each actor (prototype) and immediately materialize on active tokens.
 * @param {Object} options
 * @param {any[]} options.actors
 * @param {Object} options.bonusData
 * @param {Object} [options.addOptions]
 * @param {Object} [extraOptions]
 * @returns {Promise<any[]>} Stamped { actor, templateId } pairs
 */
export async function linkBonusToActor(options = /** @type {any} */ ({}), extraOptions = {})
{
    const { actors = [], bonusData, addOptions = {} } = /** @type {any} */ (options);
    if (!bonusData)
        return [];
    const serialized = serializeBonusLambdas(_acceptBonusInput(bonusData));
    const stamped = [];
    for (const actor of actors)
    {
        if (!actor || actor.documentName !== 'Actor')
            continue;
        const templateId = foundry.utils.randomID();
        const template = { id: templateId, bonusData: /** @type {any} */ ({ ...serialized }), addOptions: { ...addOptions, ...extraOptions } };
        const existing = getLAFlag(actor,'bonusTemplates') || [];
        await setLAFlag(actor,'bonusTemplates', [...existing, template]);
        stamped.push({ actor, templateId });
        await applyActorBonusTemplatesToTokens(actor, actor.getActiveTokens?.() ?? []);
    }
    return stamped;
}

/**
 * Pop templates matching `templateId` from each item's bonusTemplates; cascade cleanup on parent actor.
 * @param {Object} options
 * @param {any[]} options.items
 * @param {string} options.templateId
 * @returns {Promise<any[]>} The removed bonus templates
 */
export async function unlinkBonusFromItem(options = /** @type {any} */ ({}))
{
    const { items = [], templateId } = /** @type {any} */ (options);
    if (!templateId)
        return [];
    const removed = [];
    for (const item of items)
    {
        if (!item || item.documentName !== 'Item')
            continue;
        const existing = getLAFlag(item,'bonusTemplates') || [];
        const filtered = existing.filter(template => template.id !== templateId);
        if (filtered.length === existing.length)
            continue;
        await setLAFlag(item,'bonusTemplates', filtered);
        const parent = item.parent;
        if (parent?.documentName === 'Actor')
            await _cleanupItemBonusTemplateFromActor(item, parent, templateId);
        removed.push({ item, templateId });
    }
    return removed;
}

/**
 * Pop templates matching `templateId` from each actor's bonusTemplates; cascade cleanup on all tokens.
 * @param {Object} options
 * @param {any[]} options.actors
 * @param {string} options.templateId
 * @returns {Promise<any[]>} The removed bonus templates
 */
export async function unlinkBonusFromActor(options = /** @type {any} */ ({}))
{
    const { actors = [], templateId } = /** @type {any} */ (options);
    if (!templateId)
        return [];
    const removed = [];
    for (const actor of actors)
    {
        if (!actor || actor.documentName !== 'Actor')
            continue;
        const existing = getLAFlag(actor,'bonusTemplates') || [];
        const filtered = existing.filter(template => template.id !== templateId);
        if (filtered.length === existing.length)
            continue;
        await setLAFlag(actor,'bonusTemplates', filtered);
        await _cleanupActorBonusTemplateFromTokens(actor, templateId);
        removed.push({ actor, templateId });
    }
    return removed;
}

/** @returns {void} */
export function executeGenericBonusMenu(actor = null)
{
    executeEffectManager({ initialTab: 'bonus', actor });
}

const IMMUNITY_SUBTYPES = new Set(['effect', 'damage', 'crit', 'hit', 'miss', 'elevation', 'terrain', 'obstacle', 'provoke']);
const DAMAGE_DEFENSE_TYPES = new Set(['resistance', 'vulnerability']);
const DEFENSE_TYPES = new Set(['immunity', 'resistance', 'vulnerability']);
let _deprecationNotified = false;

function warnDeprecated(message)
{
    console.warn(`lancer-automations | ${message}`);
    if (_deprecationNotified)
        return;
    _deprecationNotified = true;
    ui.notifications?.warn(localizeFormat('LA.notify.deprecatedApi', { message }));
}

function _isLegacyDefense(bonus)
{
    return bonus?.type === 'immunity' && DAMAGE_DEFENSE_TYPES.has(bonus.subtype);
}

function _legacyDefenseMessage(subtype)
{
    const getter = subtype === 'resistance' ? 'getResistanceBonuses' : 'getVulnerabilityBonuses';
    return `Immunity subtype "${subtype}" is deprecated. Use the "${subtype}" bonus type ({ type: '${subtype}' }) and ${getter}.`;
}

export function normalizeBonusShape(bonus)
{
    if (_isLegacyDefense(bonus))
    {
        const { subtype, ...rest } = bonus;
        return { ...rest, type: subtype };
    }
    if (bonus?.type === 'multi' && Array.isArray(bonus.bonuses) && bonus.bonuses.some(_isLegacyDefense))
        return { ...bonus, bonuses: bonus.bonuses.map(normalizeBonusShape) };
    return bonus;
}

function _acceptBonusInput(bonusData)
{
    const legacy = _isLegacyDefense(bonusData)
        ? bonusData
        : (bonusData?.type === 'multi' && Array.isArray(bonusData.bonuses) ? bonusData.bonuses.find(_isLegacyDefense) : null);
    if (!legacy)
        return bonusData;
    warnDeprecated(_legacyDefenseMessage(legacy.subtype));
    return normalizeBonusShape(bonusData);
}

const BONUS_FREQUENCY_GATES = { round: { rounds: 1 }, turn: { turn: true }, combat: { rounds: null } };
const BONUS_MISSION_FLAG = 'bonusMissionUses';

function bonusGateOwner(bonus, state)
{
    const tokenId = bonus?.context?.ownerTokenId;
    if (tokenId)
        return canvas.tokens?.get(tokenId) ?? null;
    return state?.actor ?? null;
}

function bonusFrequencyCount(bonus)
{
    return Math.max(1, Number.parseInt(bonus?.frequencyCount) || 1);
}

function bonusFrequencySlots(bonus)
{
    return Array.from({ length: bonusFrequencyCount(bonus) }, (_unused, index) => (index === 0 ? null : `use${index + 1}`));
}

function bonusFrequencyKey(bonus)
{
    return bonus?.frequencyKey ?? bonus?.id;
}

function bonusMissionUsed(owner, bonus)
{
    const actor = owner?.actor ?? owner;
    return Number(getLAFlag(actor, BONUS_MISSION_FLAG)?.[bonusFrequencyKey(bonus)] ?? 0);
}

/** False when the bonus has a frequency and its gate is already taken. */
export function bonusFrequencyFree(bonus, state = null)
{
    if (bonus?.frequency === 'mission')
    {
        const owner = bonusGateOwner(bonus, state);
        return !owner || bonusMissionUsed(owner, bonus) < bonusFrequencyCount(bonus);
    }
    if (!bonus?.frequency || !BONUS_FREQUENCY_GATES[bonus.frequency])
        return true;
    const owner = bonusGateOwner(bonus, state);
    return !owner || bonusFrequencySlots(bonus).some(slot => checkGate(owner, `bonus:${bonusFrequencyKey(bonus)}`, slot));
}

function usageCandidateOf(bonus, bucket)
{
    return {
        id: bonus.id,
        bucket,
        type: bonus.type,
        subtype: bonus.subtype ?? null,
        consumeOnUsage: bonus.consumeOnUsage,
        uses: bonus.uses,
        applyTo: bonus.applyTo ?? null,
        frequency: bonus.frequency,
        frequencyCount: bonus.frequencyCount,
        frequencyKey: bonus.frequencyKey,
        context: bonus.context
    };
}

function bonusFrequencyUsed(bonus, owner)
{
    if (bonus?.frequency === 'mission')
        return Math.min(bonusMissionUsed(owner, bonus), bonusFrequencyCount(bonus));
    return bonusFrequencySlots(bonus).filter(slot => !checkGate(owner, `bonus:${bonusFrequencyKey(bonus)}`, slot)).length;
}

const LIMIT_PERIOD_SHORT = { round: 'round', turn: 'turn', combat: 'encounter', mission: 'mission' };

function bonusUsageParts(bonus, state, limitReached = false)
{
    const parts = [];
    if (bonus.uses !== undefined)
        parts.push({ text: `${bonus.uses} left` });
    const period = LIMIT_PERIOD_SHORT[bonus.frequency];
    const owner = period ? bonusGateOwner(bonus, state) : null;
    if (owner)
        parts.push({ text: `${Math.max(0, bonusFrequencyCount(bonus) - bonusFrequencyUsed(bonus, owner))}/${bonusFrequencyCount(bonus)} ${period}`, limit: limitReached });
    return parts;
}

function bonusHasAutoConsume(actor, bonusId)
{
    return !!actor?.effects?.some(effect => getLAFlag(effect, 'linkedBonusId') === bonusId && getLAFlags(effect)?.consumption?.trigger);
}

export function linkedBonusOf(actor, effect)
{
    const bonusId = getLAFlags(effect)?.linkedBonusId;
    return bonusId ? (getLAFlag(actor, 'global_bonuses') || []).find((/** @type {any} */ bonus) => bonus.id === bonusId) ?? null : null;
}

async function takeBonusFrequency(bonus, owner)
{
    if (bonus?.frequency === 'mission')
    {
        const actor = owner?.actor ?? owner;
        const used = bonusMissionUsed(actor, bonus);
        if (used >= bonusFrequencyCount(bonus))
            return false;
        await delegateSetActorFlag(actor, MODULE_ID, BONUS_MISSION_FLAG, { ...(getLAFlag(actor, BONUS_MISSION_FLAG) ?? {}), [bonusFrequencyKey(bonus)]: used + 1 });
        return true;
    }
    const options = BONUS_FREQUENCY_GATES[bonus?.frequency];
    if (!options)
        return false;
    for (const slot of bonusFrequencySlots(bonus))
    {
        if (await consumeGate(owner, `bonus:${bonusFrequencyKey(bonus)}`, { ...options, subject: slot }))
            return true;
    }
    return false;
}

/** Take the bonus's frequency gate, recording it on the flow so reactions can see it fired. */
export async function burnBonusFrequency(bonus, state = null)
{
    if (bonus?.frequency !== 'mission' && !BONUS_FREQUENCY_GATES[bonus?.frequency])
        return false;
    const owner = bonusGateOwner(bonus, state);
    if (!owner)
        return false;
    const taken = await takeBonusFrequency(bonus, owner);
    if (taken && state)
    {
        state.la_extraData = state.la_extraData || {};
        const ids = [bonus.id, bonus.sourceBonusId].filter(Boolean);
        state.la_extraData.burnedFrequency = [...new Set([...(state.la_extraData.burnedFrequency ?? []), ...ids])];
    }
    return taken;
}

async function resetBonusMissionUsesStep(state)
{
    const actor = state?.actor;
    const used = actor ? getLAFlag(actor, BONUS_MISSION_FLAG) : null;
    if (used && Object.values(used).some(count => Number(count) > 0))
        await delegateSetActorFlag(actor, MODULE_ID, BONUS_MISSION_FLAG, Object.fromEntries(Object.keys(used).map(key => [key, 0])));
    return true;
}

export function registerBonusFrequencyFlowSteps(flowSteps, flows)
{
    const step = 'lancer-automations:resetBonusMissionUses';
    flowSteps.set(step, resetBonusMissionUsesStep);
    const flow = flows.get('FullRepairFlow');
    if (flow?.steps?.includes('executeFullRepair') && !flow.steps.includes(step))
        flow.insertStepAfter('executeFullRepair', step);
}

const DAMAGE_TYPE_WILDCARDS = new Set(['all', 'variable']);
const CONCRETE_DAMAGE_TYPES = ['kinetic', 'energy', 'explosive', 'variable', 'burn', 'heat'];

/** Lower-cased damage types a bonus covers, wildcards expanded. */
function expandDamageTypes(damageTypes, aoe = false)
{
    const out = new Set();
    for (const entry of damageTypes ?? [])
    {
        const lower = String(entry).toLowerCase().trim();
        if (!lower || (lower === 'aoe' && !aoe))
            continue;
        if (!DAMAGE_TYPE_WILDCARDS.has(lower) && lower !== 'aoe')
        {
            out.add(lower);
            continue;
        }
        CONCRETE_DAMAGE_TYPES.forEach(type => out.add(type));
        if (getModuleSetting('enableInfectionDamageIntegration'))
            out.add('infection');
    }
    return [...out];
}

/**
 * @param {any} actor Actor, Token or TokenDocument
 * @param {string|null} [subtype] omit for every immunity bonus
 * @returns {object[]}
 */
export function getImmunityBonuses(actor, subtype = null, state = null)
{
    if (DAMAGE_DEFENSE_TYPES.has(subtype))
    {
        warnDeprecated(_legacyDefenseMessage(subtype));
        return _getTypedBonuses(actor, subtype, state);
    }
    actor = actor?.actor ?? actor;
    if (!actor?.getFlag)
        return [];
    if (subtype && !IMMUNITY_SUBTYPES.has(subtype))
        console.warn(`lancer-automations | getImmunityBonuses: unknown subtype "${subtype}"`);

    return _bonusPool(actor, state, !subtype || subtype === 'damage' || subtype === 'effect')
        .filter(bonus => bonus.type === "immunity" && (!subtype || bonus.subtype === subtype) && linkTierGate(bonus, actor));
}

function _bonusPool(actor, state, withData = false)
{
    const constants = getLAFlag(actor,"constant_bonuses") || [];
    const globals = getLAFlag(actor,"global_bonuses") || [];
    const ephemerals = getLAFlag(actor,"ephemeral_bonuses") || [];
    const flowBonuses = state?.la_extraData?.flow_bonus || [];
    const dataBonuses = withData ? _v3DefenseRows(actor).filter(row => !row.off && !row.inactive).map(row => row.bonus) : [];
    return flattenBonuses([...constants, ...globals, ...ephemerals, ...flowBonuses, ...dataBonuses])
        .filter(bonus => !bonus.dataCondition || v3ConditionMet(bonus.dataCondition, actor));
}

function _getTypedBonuses(actor, type, state)
{
    actor = actor?.actor ?? actor;
    if (!actor?.getFlag)
        return [];
    return _bonusPool(actor, state, true).filter(bonus => bonus.type === type && linkTierGate(bonus, actor));
}

function _v3SourceActive(item, path, actor)
{
    const segments = String(path ?? '').split('.');
    if (segments[0] === 'core_system' && segments.some(segment => segment.startsWith('active_')) && !actor?.system?.core_active)
        return false;
    if (item.type === 'reserve' && item.system?.used)
        return false;
    return !isItemCascading(item);
}

function _v3DefenseRows(actor)
{
    const off = new Set(getLAFlag(actor, 'v3Off') || []);
    const rows = [];
    for (const item of actor?.items ?? [])
    {
        for (const { bonus, path, reactionPath, condition, duration } of v3DefenseBonuses(item))
        {
            if (!duration && isItemAvailable(item, reactionPath) && _v3SourceActive(item, path, actor))
                rows.push({ bonus, item, off: off.has(bonus.id), inactive: !v3ConditionMet(condition, actor) });
        }
    }
    return rows;
}

async function _applyV3TimedDefenses(actor, token)
{
    for (const item of actor?.items ?? [])
    {
        for (const { bonus, path, reactionPath, duration } of v3DefenseBonuses(item))
        {
            if (!duration || !isItemAvailable(item, reactionPath) || !_v3SourceActive(item, path, actor))
                continue;
            const timedId = `${bonus.id}_timed`;
            if ((getLAFlag(actor, 'global_bonuses') || []).some((/** @type {any} */ existing) => existing.id === timedId))
                continue;
            await addGlobalBonus(actor, { ...foundry.utils.deepClone(bonus), id: timedId }, v3BonusDurationOptions(duration, token));
        }
    }
}

export function initV3TimedDefenses()
{
    Hooks.on('combatStart', async (/** @type {any} */ combat) =>
    {
        if (!isExecutorGM())
            return;
        for (const combatant of combat.combatants)
            await _applyV3TimedDefenses(combatant.actor, combatant.token?.object ?? null);
    });
    Hooks.on('createCombatant', async (combatant) =>
    {
        if (isExecutorGM() && combatant.combat?.started)
            await _applyV3TimedDefenses(combatant.actor, combatant.token?.object ?? null);
    });
}

export function getV3DefenseRows(actor)
{
    if (actor?.documentName === 'Item')
        return [];
    actor = actor?.actor ?? actor;
    return actor?.items ? _v3DefenseRows(actor) : [];
}

export async function setV3DefenseOff(actor, bonusId, off)
{
    actor = actor?.actor ?? actor;
    if (!actor || !bonusId)
        return;
    const current = new Set(getLAFlag(actor, 'v3Off') || []);
    if (off)
        current.add(bonusId);
    else
        current.delete(bonusId);
    await delegateSetActorFlag(actor, MODULE_ID, 'v3Off', [...current]);
}

export function getResistanceBonuses(actor, state = null)
{
    return _getTypedBonuses(actor, 'resistance', state);
}

export function getVulnerabilityBonuses(actor, state = null)
{
    return _getTypedBonuses(actor, 'vulnerability', state);
}

// Only source for reactorToken in condition lambdas.
function withOwnerContext(bonus, ownerTokenId)
{
    if (!ownerTokenId || bonus.context?.ownerTokenId)
        return bonus;
    return { ...bonus, context: { ...bonus.context, ownerTokenId } };
}

/**
 * Immunity bonuses that also pass their rollTypes / itemLids / condition / applyToCondition filters.
 * Unfiltered when no state is given. `state.actor` is the other party.
 * @param {any} actor Actor, Token or TokenDocument holding the immunity
 * @param {string} subtype
 * @param {any} [state] flow state
 * @param {object} [options]
 * @param {string} [options.flowType] tag set to build
 * @param {string|null} [options.ownerTokenId] bearer token, the `reactorToken` of applyToCondition
 * @param {any} [options.otherToken] other party, the `target` of applyToCondition
 * @returns {object[]}
 */
export function getApplicableImmunityBonuses(actor, subtype, state = null, { flowType = 'damage', ownerTokenId = null, otherToken = null } = {})
{
    return _applicableBonuses(getImmunityBonuses(actor, subtype, state), state, { flowType, ownerTokenId, otherToken });
}

export function getApplicableDefenseBonuses(actor, type, state = null, { flowType = 'damage', ownerTokenId = null, otherToken = null } = {})
{
    return _applicableBonuses(_getTypedBonuses(actor, type, state), state, { flowType, ownerTokenId, otherToken });
}

function _applicableBonuses(bonuses, state, { flowType, ownerTokenId, otherToken })
{
    if (!state || bonuses.length === 0)
        return bonuses;
    const tags = getFlowTags(flowType, state);
    const ownerToken = ownerTokenId ? canvas.tokens.get(ownerTokenId) ?? null : null;
    // No other party means nothing for applyToCondition to judge, so the immunity stands.
    return bonuses.map(bonus => withOwnerContext(bonus, ownerTokenId)).filter(bonus =>
        isBonusApplicable(bonus, tags, state)
        && (!otherToken || runApplyToCondition(bonus, otherToken, state, ownerToken)));
}

/** @returns {string[]} array of immunity source names; empty if not immune */
// These gates are not flows, so the item and roll-type filters are dropped rather than failed.
function passesGateFilters(bonus, state, ownerTokenId, otherToken)
{
    const gateState = state ?? { actor: otherToken?.actor ?? null, data: {} };
    const gated = withOwnerContext({ ...bonus, rollTypes: null, itemLids: null, itemId: null }, ownerTokenId);
    if (!isBonusApplicable(gated, new Set(['all']), gateState))
        return false;
    const ownerToken = ownerTokenId ? canvas.tokens.get(ownerTokenId) ?? null : null;
    return !otherToken || runApplyToCondition(bonus, otherToken, gateState, ownerToken);
}

/**
 * Immunity bonuses passing their condition / applyToCondition gates outside a flow.
 * Unfiltered when no context is supplied, so liveness checks keep the fast path.
 * @param {any} actor bearer
 * @param {string} subtype
 * @param {object} [context]
 * @param {any} [context.ownerToken] bearer token, the `reactorToken` of applyToCondition
 * @param {any} [context.otherToken] other party, the `target` of applyToCondition
 * @param {any} [context.state]
 * @returns {object[]}
 */
export function getGateImmunityBonuses(actor, subtype, { ownerToken = null, otherToken = null, state = null } = {})
{
    const bonuses = getImmunityBonuses(actor, subtype, state);
    if (bonuses.length === 0 || !(state || ownerToken || otherToken))
        return bonuses;
    return bonuses.filter(bonus => passesGateFilters(bonus, state, ownerToken?.id ?? null, otherToken));
}

/**
 * Effect-immunity bonuses matching that status, after their condition / applyToCondition gates.
 * @param {any} actor bearer
 * @param {string} effectIdOrName
 * @param {any} [effect] the ActiveEffect being applied, widens the match
 * @param {any} [state] flow state, when one exists
 * @param {object} [tokens]
 * @param {string|null} [tokens.ownerTokenId] bearer token id
 * @param {any} [tokens.otherToken] whoever applied the status, when known
 * @returns {object[]}
 */
export function getEffectImmunityBonuses(actor, effectIdOrName, effect = null, state = null, { ownerTokenId = null, otherToken = null } = {})
{
    if (!actor || !effectIdOrName)
        return [];

    const ownerToken = ownerTokenId ? canvas.tokens.get(ownerTokenId) ?? null : null;
    const effectImmunities = getGateImmunityBonuses(actor, "effect", { ownerToken, otherToken, state });
    const matched = [];

    const incomingLower = effectIdOrName.toLowerCase();
    const incomingTail = incomingLower.split('.').pop();

    for (const b of effectImmunities)
    {
        if (!b.effects || !Array.isArray(b.effects))
            continue;

        const isImmune = b.effects.some(immuneName =>
        {
            const immuneLower = immuneName.toLowerCase();
            const immuneTail = immuneLower.split('.').pop();

            // 1. Exact string matches
            if (immuneLower === incomingLower || immuneTail === incomingTail)
                return true;

            // 2. Inclusion checks (handles path-based vs simple names)
            if (immuneLower.includes(incomingTail) || incomingLower.includes(immuneTail))
                return true;

            // 3. If ActiveEffect is provided, check its native statuses and flags
            if (effect)
            {
                if (effect.statuses?.has(immuneTail) || effect.statuses?.has(immuneLower))
                    return true;

                const flagName = getLAFlag(effect,'effect') || (game.modules.get('csm-lancer-qol')?.active ? effect.getFlag('csm-lancer-qol', 'effect') : null);
                if (flagName)
                {
                    const flagLower = flagName.toLowerCase();
                    if (flagLower === immuneLower || flagLower.includes(immuneTail))
                        return true;
                }
            }

            return false;
        });

        if (isImmune)
            matched.push(b);
    }

    return matched;
}

/** @returns {string[]} array of immunity source names; empty if not immune */
export function checkEffectImmunities(actor, effectIdOrName, effect = null, state = null, tokens = {})
{
    return getEffectImmunityBonuses(actor, effectIdOrName, effect, state, tokens)
        .map(bonus => bonus.source || bonus.name || "Unknown Immunity");
}

/** @returns {boolean} true when the bonus is gated on something only a flow can answer */
export function hasBonusFilters(bonus)
{
    return !!(bonus?.rollTypes?.length || bonus?.itemLids?.length || bonus?.itemId || bonus?.condition || bonus?.applyToCondition);
}

function _damageBonusesCovering(actor, type, damageType, allowedIds, aoe)
{
    if (!actor || !damageType)
        return [];
    const incomingLower = damageType.toLowerCase();
    return _getTypedBonuses(actor, type, null)
        .filter(bonus => !allowedIds || !hasBonusFilters(bonus) || !bonus.id || allowedIds.includes(bonus.id))
        .filter(bonus => bonus.damageTypes && bonus.damageTypes.some(type => type.toLowerCase() === incomingLower || type.toLowerCase() === "variable" || type.toLowerCase() === "all" || (aoe && type.toLowerCase() === "aoe")));
}

/**
 * @param {any} actor
 * @param {string} damageType
 * @param {string[]|null} [allowedIds] ids that passed their filters in the damage flow; null skips the check
 * @param {boolean} [aoe] the damage came from an area attack
 * @returns {any[]} Resistance bonus source names matching that damage type
 */
export function checkDamageResistances(actor, damageType, allowedIds = null, aoe = false)
{
    return _damageBonusesCovering(actor, "resistance", damageType, allowedIds, aoe)
        .map(bonus => bonus.source || bonus.name || "Unknown Resistance");
}

export function checkDamageVulnerabilities(actor, damageType, allowedIds = null, aoe = false)
{
    return _damageBonusesCovering(actor, "vulnerability", damageType, allowedIds, aoe)
        .map(bonus => bonus.source || bonus.name || "Unknown Vulnerability");
}

export function bonusCoversDamage(bonus, aoe = false)
{
    return expandDamageTypes(bonus?.damageTypes, aoe).length > 0;
}

// Resistance effects consumed on damage burn at apply time, after the halving they granted.
const _deferredResistanceConsumption = new Map();

/** Mirror of the defer, for clients that did not run the damage flow. */
export function receiveDeferredResistanceConsumption({ actorUuid, effectId, clear })
{
    if (!actorUuid)
        return;
    if (clear)
    {
        _deferredResistanceConsumption.delete(actorUuid);
        return;
    }
    if (!effectId)
        return;
    const pending = _deferredResistanceConsumption.get(actorUuid) ?? new Set();
    pending.add(effectId);
    _deferredResistanceConsumption.set(actorUuid, pending);
}

// The flow runs on the attacker's client but damageCalc runs on the defender's owner, so mirror it everywhere.
export function deferResistanceEffectConsumption(actor, effect)
{
    if (!actor?.uuid || !effect?.id)
        return;
    receiveDeferredResistanceConsumption({ actorUuid: actor.uuid, effectId: effect.id });
    game.socket.emit('module.lancer-automations', {
        action: 'deferResistanceConsumption',
        payload: { actorUuid: actor.uuid, effectId: effect.id }
    });
}

async function _consumeDeferredResistanceEffects(actor, damage, options)
{
    const pending = _deferredResistanceConsumption.get(actor.uuid);
    if (!pending)
        return;
    _deferredResistanceConsumption.delete(actor.uuid);
    game.socket.emit('module.lancer-automations', {
        action: 'deferResistanceConsumption',
        payload: { actorUuid: actor.uuid, clear: true }
    });
    if (options?.paracausal || actor.system?.statuses?.shredded)
        return;
    for (const effectId of pending)
    {
        const effect = actor.effects.get(effectId);
        if (!effect)
            continue;
        const coveredTypes = (effect.changes ?? [])
            .filter(change => change.key?.startsWith('system.resistances.'))
            .map(change => change.key.split('.').pop());
        const landed = coveredTypes.some(type => Number(damage?.[type.charAt(0).toUpperCase() + type.slice(1)]) > 0);
        if (landed)
            await consumeEffectCharge(effect);
    }
}

function _scaleVulnerableDamage(actor, damage, options, vulnerabilityIds, aoe)
{
    if (!damage || getVulnerabilityBonuses(actor).length === 0)
        return [];
    const keyOf = (type) => type.charAt(0).toUpperCase() + type.slice(1);
    if (!actor.hasHeatcap?.() && Number(damage.Heat) > 0)
    {
        damage.Energy = (Number(damage.Energy) || 0) + Number(damage.Heat);
        damage.Heat = 0;
    }
    const vulnerable = ['kinetic', 'energy', 'explosive', 'variable', 'burn', 'heat']
        .filter(type => Number(damage[keyOf(type)]) > 0 && checkDamageVulnerabilities(actor, type, vulnerabilityIds, aoe).length > 0);
    if (vulnerable.length === 0)
        return [];
    const multiple = [0.5, 1, 2].includes(options?.multiple) ? options.multiple : 1;
    const exposed = !!actor.system?.statuses?.exposed;
    const armored = ['kinetic', 'energy', 'explosive', 'variable'];
    const scaleOf = (type) => (multiple === 2 ? 2 : 1) * (exposed && armored.includes(type) ? 2 : 1);
    const resisted = (type) => multiple === 0.5 || !!actor.system?.resistances?.[type];
    const mitigated = !options?.paracausal && !actor.system?.statuses?.shredded;
    let armor = mitigated && !options?.ap ? (Number(actor.system?.armor) || 0) : 0;
    const armorTaken = {};
    const armorOrder = [...armored.filter(armoredType => !resisted(armoredType)), ...armored.filter(armoredType => resisted(armoredType))];
    for (const type of armorOrder)
    {
        armorTaken[type] = Math.min(armor, (Number(damage[keyOf(type)]) || 0) * scaleOf(type));
        armor -= armorTaken[type];
    }
    for (const type of vulnerable)
    {
        const landed = Number(damage[keyOf(type)]) * scaleOf(type);
        damage[keyOf(type)] = (2 * landed - (armorTaken[type] ?? 0)) / scaleOf(type);
    }
    return vulnerable;
}

// Bridges bonus-based resistances into damageCalc, which only reads system.resistances.
let _pendingApplyHalvedActorUuid = null;
let _pendingResistanceVerdict = null;
export function initDamageCalcWrapper()
{
    if (typeof libWrapper === 'undefined')
        return;

    // Cards with the half-damage box checked already halved their numbers; skip the bridge for those.
    document.body.addEventListener('click', (ev) =>
    {
        const button = ev.target?.closest?.('.lancer-damage-apply');
        if (!button)
            return;
        _pendingApplyHalvedActorUuid = null;
        _pendingResistanceVerdict = null;
        const chatMessageElement = button.closest('.chat-message.message');
        const damageData = game.messages?.get(chatMessageElement?.dataset.messageId)?.flags?.lancer?.damageData;
        const targetUuid = button.closest('.lancer-damage-button-group')?.dataset?.target;
        if (!damageData || !targetUuid)
            return;
        const targetResult = damageData.targetDamageResults?.find(entry => entry.target === targetUuid);
        const actorUuid = /** @type {any} */ (fromUuidSync(targetUuid))?.actor?.uuid ?? null;
        if (targetResult?.half_damage)
            _pendingApplyHalvedActorUuid = actorUuid;
        if (actorUuid && (Array.isArray(targetResult?.laResistance) || Array.isArray(targetResult?.laVulnerability)))
        {
            _pendingResistanceVerdict = {
                actorUuid,
                ids: Array.isArray(targetResult.laResistance) ? targetResult.laResistance : null,
                vulnerabilityIds: Array.isArray(targetResult.laVulnerability) ? targetResult.laVulnerability : null,
                aoe: targetResult.laAoe === true
            };
        }
    }, { capture: true });

    libWrapper.register(MODULE_ID,'CONFIG.Actor.documentClass.prototype.damageCalc',
        async function (wrapped, damage, options)
        {
            const alreadyHalved = _pendingApplyHalvedActorUuid !== null && _pendingApplyHalvedActorUuid === this.uuid;
            if (alreadyHalved)
                _pendingApplyHalvedActorUuid = null;
            // No verdict means no damage card decided this, so filtered bonuses stay permissive.
            const verdict = _pendingResistanceVerdict?.actorUuid === this.uuid ? _pendingResistanceVerdict : null;
            _pendingResistanceVerdict = null;
            const allowedIds = verdict?.ids ?? null;
            const aoe = verdict?.aoe === true;
            const resistances = this.system?.resistances;
            const bridged = [];
            if (resistances && !alreadyHalved)
            {
                for (const type of ['kinetic', 'energy', 'explosive', 'variable', 'burn', 'heat'])
                {
                    if (!resistances[type] && checkDamageResistances(this, type, allowedIds, aoe).length > 0)
                    {
                        resistances[type] = true;
                        bridged.push(type);
                    }
                }
            }
            // damageCalc mutates the damage record, so snapshot which bridged types actually landed first.
            const mitigationBlocked = options?.paracausal || this.system?.statuses?.shredded;
            const spentOn = mitigationBlocked
                ? []
                : bridged.filter(type => Number(damage?.[type.charAt(0).toUpperCase() + type.slice(1)]) > 0);
            const resistedTypes = mitigationBlocked
                ? []
                : ['kinetic', 'energy', 'explosive', 'variable', 'burn', 'heat']
                    .filter(type => resistances?.[type] && Number(damage?.[type.charAt(0).toUpperCase() + type.slice(1)]) > 0);
            const anyDamageRolled = ['Kinetic', 'Energy', 'Explosive', 'Variable', 'Burn', 'Heat']
                .some(type => Number(damage?.[type]) > 0);
            const showResisted = !mitigationBlocked && (resistedTypes.length > 0 || (options?.multiple === 0.5 && anyDamageRolled));
            let hpLanded;
            let vulnerableTypes = [];
            try
            {
                vulnerableTypes = _scaleVulnerableDamage(this, damage, options, verdict?.vulnerabilityIds ?? null, aoe);
                hpLanded = await wrapped(damage, options);
            }
            finally
            {
                for (const type of bridged)
                    resistances[type] = false;
            }
            if (spentOn.length)
                await consumeResistanceUse(this, null, { damageTypes: spentOn, aoe });
            if (vulnerableTypes.length)
                await consumeVulnerabilityUse(this, null, { damageTypes: vulnerableTypes, aoe });
            await _consumeDeferredResistanceEffects(this, damage, options);
            const floatToken = this.getActiveTokens?.()?.[0];
            if (showResisted && floatToken)
                broadcastFloatTokenText(floatToken, 'Resisted', 0x4da6ff);
            if (vulnerableTypes.length && floatToken)
                broadcastFloatTokenText(floatToken, 'Vulnerable', 0xff5c5c);
            Hooks.callAll('lancer-automations.battelog.damageApplied', this, hpLanded);
            return hpLanded;
        }, 'WRAPPER');
}

/** @returns {object[]} damages with immune types zeroed */
export function applyDamageImmunities(actor, damages, state = null, bonuses = null, aoe = false)
{
    if (!actor || !damages)
        return damages;

    const damageImmunities = bonuses ?? getImmunityBonuses(actor, "damage", state);
    if (damageImmunities.length === 0)
        return damages;

    const immuneTypes = new Set();
    for (const immunity of damageImmunities)
        expandDamageTypes(immunity.damageTypes, aoe).forEach(type => immuneTypes.add(type));

    return damages.map(dmg =>
    {
        if (immuneTypes.has(String(dmg.type).toLowerCase()))
        {
            const cloned = { ...dmg };
            if (cloned.val !== undefined)
                cloned.val = 0;
            if (cloned.amount !== undefined)
                cloned.amount = 0;
            return cloned;
        }
        return dmg;
    });
}

// Heat has no target on a heatless actor (pilot / bio NPC); Lancer's damageCalc does the same for pilots.
export function convertHeatToEnergyIfHeatless(actor, damages)
{
    if (!actor || !Array.isArray(damages))
        return damages;
    try
    {
        if (!getModuleSetting('convertHeatToEnergyOnHeatless'))
            return damages;
    }
    catch (_)
    {
        return damages;
    }
    const heatMax = actor.system?.heat?.max;
    const heatless = heatMax === undefined || heatMax === null || heatMax === 0;
    if (!heatless)
        return damages;
    return damages.map(d => (d?.type === 'Heat' ? { ...d, type: 'Energy' } : d));
}

/**
 * Applicable crit / hit / miss immunity bonuses held by the defender.
 * Unfiltered when the attacker is unknown, matching the old "no attacker means immune" rule.
 * @param {any} actor defender
 * @param {string} subtype crit, hit or miss
 * @param {any} [attackerActor]
 * @param {any} [state] the attack flow state
 * @param {object} [tokens]
 * @param {any} [tokens.defenderToken] bearer, the `reactorToken` of applyToCondition
 * @param {any} [tokens.attackerToken] the `target` of applyToCondition
 * @returns {object[]}
 */
export function getAttackImmunityBonuses(actor, subtype, attackerActor = null, state = null, { defenderToken = null, attackerToken = null } = {})
{
    if (!actor)
        return [];
    const raw = getImmunityBonuses(actor, subtype, state);
    if (raw.length === 0 || !attackerActor)
        return raw;
    const attackerState = state ? { ...state, actor: attackerActor } : { actor: attackerActor };
    return getApplicableImmunityBonuses(actor, subtype, attackerState, {
        flowType: 'attack',
        ownerTokenId: defenderToken?.id ?? null,
        otherToken: attackerToken
    });
}

/** @returns {Promise<boolean>} */
export async function hasCritImmunity(actor, attackerActor = null, state = null, tokens = {})
{
    return getAttackImmunityBonuses(actor, "crit", attackerActor, state, tokens).length > 0;
}

/** @returns {Promise<boolean>} */
export async function hasHitImmunity(actor, attackerActor = null, state = null, tokens = {})
{
    return getAttackImmunityBonuses(actor, "hit", attackerActor, state, tokens).length > 0;
}

/** @returns {Promise<boolean>} */
export async function hasMissImmunity(actor, attackerActor = null, state = null, tokens = {})
{
    return getAttackImmunityBonuses(actor, "miss", attackerActor, state, tokens).length > 0;
}


/**
 * Read bonus templates attached to an item or a prototype actor
 * (from `flags['lancer-automations'].bonusTemplates`).
 * @param {any} source  Item or Actor
 * @returns {any[]}
 */
export function getLinkedBonuses(source)
{
    if (!source)
        return [];
    return /** @type {any[]} */ (getLAFlag(source,'bonusTemplates') || []);
}

export const BonusesAPI = {
    addGlobalBonus,
    removeGlobalBonus,
    getGlobalBonuses,
    getGlobalBonus,
    consumeBonusUse,
    consumeImmunityUse,
    supportsConsumeOnUsage,
    addConstantBonus,
    removeConstantBonus,
    getConstantBonuses,
    linkBonusToItem,
    ensureLinkedBonus,
    linkBonusToActor,
    unlinkBonusFromItem,
    unlinkBonusFromActor,
    getLinkedBonuses,
    applyItemBonusTemplatesToTokens,
    applyActorBonusTemplatesToTokens,
    cleanupItemBonusesFromActor,
    cleanupActorBonusesFromTokens,
    executeGenericBonusMenu,
    getImmunityBonuses,
    getResistanceBonuses,
    getVulnerabilityBonuses,
    consumeResistanceUse,
    consumeVulnerabilityUse,
    getApplicableImmunityBonuses,
    getAttackImmunityBonuses,
    getGateImmunityBonuses,
    getEffectImmunityBonuses,
    checkEffectImmunities,
    applyDamageImmunities,
    checkDamageResistances,
    checkDamageVulnerabilities,
    hasCritImmunity,
    hasHitImmunity,
    hasMissImmunity,
    injectBonusToFlowState
};
