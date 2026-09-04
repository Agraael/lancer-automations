import { applyEffectsToTokens, consumeEffectCharge } from "./flagged-effects.js";
import { executeEffectManager } from "./effectManager.js";
import { stringToAsyncFunction } from "../activations/reaction-manager.js";
import { getWeaponType } from "../tools/misc-tools.js";
import { playBonusAddedFX } from "../fx/actionFX.js";
import { accDiffTargetToken } from "../combat/grid-helpers.js";
import { linkTierGate } from "../interactive/deployables.js";
import { broadcastFloatTokenText } from "../tools/float-text.js";

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

// Prefers bonus.context.ownerTokenId, falls back to state.actor's first token; provides reactorToken for condition lambdas.
function resolveReactorToken(bonus, state)
{
    const ownerTokenId = bonus?.context?.ownerTokenId;
    if (ownerTokenId)
        return canvas.tokens.get(ownerTokenId) ?? canvas.tokens.placeables.find(t => t.id === ownerTokenId) ?? null;
    return state?.actor?.getActiveTokens?.()?.[0] ?? null;
}

/**
 * Evaluate `mod.applyToCondition` against one HUD target entry. Returns true if no condition is set.
 * Lambda must be synchronous and return a boolean.
 */
function evaluateApplyToCondition(mod, targetEntry, state, reactorToken)
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
                ['target', 'state', 'reactorToken'],
                `const api=game.modules.get('lancer-automations')?.api;`
            );
        }
        else
            return true;
        const result = fn(targetEntry, state, reactorToken);
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
                const flatSub = { ...sub };
                if (!flatSub.id)
                    flatSub.id = `${bonus.id || 'multi'}_sub_${idx}`;
                if (bonus.applyTo && !flatSub.applyTo)
                    flatSub.applyTo = bonus.applyTo;
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
                flattened.push(flatSub);
            });
        }
        else
            flattened.push(bonus);
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
            description: `Granted by bonus: ${bonus.name}`
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
    const laFlags = change.flags?.['lancer-automations'];
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
                netBonus: (actor.getFlag("lancer-automations", "generic_accuracy") || 0) -
                           (actor.getFlag("lancer-automations", "generic_difficulty") || 0) +
                           (actor.getFlag("world", "generic_accuracy") || 0) -
                           (actor.getFlag("world", "generic_difficulty") || 0),
                activeBonuses: [],
                rangeBonuses: [],
                damageBonuses: [],
                allTargetedBonuses: [],
                targetedDamageBonuses: [],
                targetModifiers: [],
                disabledByUser: new Set()
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

            if (collected.netBonus > 0)
                base.accuracy += collected.netBonus;
            else if (collected.netBonus < 0)
                base.difficulty += Math.abs(collected.netBonus);

            const appliedMode = new Map();
            const applyTargetedBonuses = (accDiff) =>
            {
                const count = accDiff.targets?.length || 0;
                const accDiffBase = accDiff.base;
                for (const bonus of collected.allTargetedBonuses)
                {
                    const val = Number.parseInt(bonus.val) || 0;
                    if (!val)
                        continue;

                    const prevMode = appliedMode.get(bonus.id);
                    if (prevMode === 'base')
                    {
                        if (bonus.type === 'difficulty')
                            accDiffBase.difficulty -= val;
                        else
                            accDiffBase.accuracy -= val;
                    }
                    else if (prevMode === 'target')
                    {
                        accDiff.targets.forEach(targetEntry =>
                        {
                            if (bonus.applyTo.includes(accDiffTargetToken(targetEntry)?.id))
                            {
                                if (bonus.type === 'difficulty')
                                    targetEntry.difficulty -= val;
                                else
                                    targetEntry.accuracy -= val;
                            }
                        });
                    }

                    const matching = accDiff.targets?.filter(targetEntry => bonus.applyTo.includes(accDiffTargetToken(targetEntry)?.id)) ?? [];
                    if (!matching.length)
                    {
                        appliedMode.set(bonus.id, null);
                        continue;
                    }

                    if (count <= 1)
                    {
                        if (bonus.type === 'difficulty')
                            accDiffBase.difficulty += val;
                        else
                            accDiffBase.accuracy += val;
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
                    t.plugins.invisibility.data = 0;
                else if (mod.subtype === 'no_cover')
                    t.cover = 0;
                else if (mod.subtype === 'soft_cover')
                    t.cover = Math.max(t.cover || 0, 1);
                else if (mod.subtype === 'hard_cover')
                    t.cover = 2;
            };

            const applyTargetModifiers = (hudData) =>
            {
                if (collected.targetModifiers.length === 0)
                    return;
                for (const targetEntry of (hudData.targets || []))
                {
                    for (const modifier of collected.targetModifiers)
                    {
                        if (Array.isArray(modifier.applyTo) && modifier.applyTo.length > 0)
                        {
                            if (!modifier.applyTo.includes(accDiffTargetToken(targetEntry)?.id))
                                continue;
                        }
                        if (!evaluateApplyToCondition(modifier, targetEntry, state, resolveReactorToken(modifier, state)))
                            continue;
                        if (modifier.subtype === 'invisible' && targetEntry.plugins?.invisibility)
                            targetEntry.plugins.invisibility.data = 1;
                        else if (modifier.subtype === 'no_invisible' && targetEntry.plugins?.invisibility)
                            targetEntry.plugins.invisibility.data = 0;
                        else if (modifier.subtype === 'no_cover')
                            targetEntry.cover = 0;
                        else if (modifier.subtype === 'soft_cover')
                            targetEntry.cover = Math.max(targetEntry.cover || 0, 1);
                        else if (modifier.subtype === 'hard_cover')
                            targetEntry.cover = 2;
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
                enabledById: new Map(),
                disabledByUser: collected.disabledByUser,
                dmgEnabled: new Map(),
                modEnabled: null,
                appliedMode,
                burned: new Set()
            };
            const addUsageCandidates = (list, bucket) =>
            {
                for (const bonus of list)
                {
                    if (!bonus?.id)
                        continue;
                    bonusUsage.candidates[bonus.id] = { id: bonus.id, bucket, type: bonus.type, subtype: bonus.subtype ?? null, consumeOnUsage: bonus.consumeOnUsage, uses: bonus.uses, applyTo: bonus.applyTo ?? null };
                }
            };
            addUsageCandidates(collected.activeBonuses, 'acc');
            addUsageCandidates(collected.allTargetedBonuses, 'targeted');
            addUsageCandidates(collected.targetModifiers, 'tmod');
            addUsageCandidates(collected.damageBonuses, 'damage');
            addUsageCandidates(collected.targetedDamageBonuses, 'targetedDamage');
            state.la_extraData.bonusUsage = bonusUsage;

            // Pre-set target_modifier subtypes in state.data so showDamageHUD sees them; hooks replaceTargets.
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
                // Display-only mirror of showDamageBonusNotification's modifier rows, for live changes
                const syncDmgModRows = () =>
                {
                    const $form = $('#damage-hud');
                    if ($form.length === 0)
                        return;
                    const $configGrid = $form.find('.damage-hud-options-grid');
                    if ($configGrid.length === 0)
                        return;
                    const modLabels = { ap: 'Armor Piercing', half_damage: 'Half Damage', paracausal: 'Cannot be Reduced', crit: 'Force Crit', hit: 'Force Hit', miss: 'Force Miss' };
                    const hudTargets = state.data.damage_hud_data?.targets || [];
                    const currentTargetIds = hudTargets.map(target => accDiffTargetToken(target)?.id);
                    const globalTMods = dmgMods.filter(mod =>
                    {
                        if (!Array.isArray(mod.applyTo) || mod.applyTo.length === 0)
                            return true;
                        if (hudTargets.length <= 1)
                            return currentTargetIds.some(id => mod.applyTo.includes(id));
                        return false;
                    });
                    let $myContainer = $configGrid.find('.csm-bonus-container');
                    if ($myContainer.length === 0)
                    {
                        if (globalTMods.length === 0)
                            return;
                        $myContainer = $('<div class="csm-bonus-container" style="grid-column: 1 / -1; border-top: 1px solid var(--primary-light); margin-top: 5px; padding-top: 5px;"></div>');
                        $myContainer.append('<h3 class="damage-hud-section lancer-border-primary svelte-1tnd08e" style="font-size: 0.9em; margin-bottom: 5px;">Global Bonuses</h3>');
                        $configGrid.append($myContainer);
                    }
                    $myContainer.find('.la-tmod-dmg-row').remove();
                    for (const mod of globalTMods)
                    {
                        const name = mod.name ? `${mod.name}: ${modLabels[mod.subtype] || mod.subtype}` : (modLabels[mod.subtype] || mod.subtype);
                        const $row = $(`
                            <div class="csm-bonus-config-row la-tmod-dmg-row" data-sub="${mod.subtype}" style="display: grid; grid-template-columns: 1fr; align-items: center; margin-bottom: 2px;">
                                <label class="container svelte-wt0sk2" style="max-width: fit-content; padding-right: 0.5em;">
                                    <input type="checkbox" class="svelte-wt0sk2" checked>
                                    <span style="text-wrap: nowrap;">${name}</span>
                                </label>
                            </div>
                        `);
                        _remapSvelteScopes($row, $form);
                        $myContainer.append($row);
                    }
                    $myContainer.toggle($myContainer.find('.csm-bonus-config-row').length > 0);
                    _remapSvelteScopes($myContainer, $form);
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
                        // Match the per-target AP / paracausal / half checkboxes by icon class or tooltip text
                        $(this).find('label.container').each(function ()
                        {
                            const labelText = $(this).text().trim().toLowerCase();
                            const iconClass = $(this).find('i, img').attr('class') || '';
                            let matched = false;
                            if (modifier.subtype === 'half_damage' && (labelText.includes('½') || labelText.includes('half') || iconClass.includes('half')))
                                matched = true;
                            if (modifier.subtype === 'ap' && (labelText.includes('ap') || labelText.includes('armor') || iconClass.includes('armor')))
                                matched = true;
                            if (modifier.subtype === 'paracausal' && (labelText.includes('paracausal') || labelText.includes('reduce') || iconClass.includes('paracausal')))
                                matched = true;
                            if (matched)
                            {
                                const checkbox = $(this).find('input[type="checkbox"]')[0];
                                if (checkbox && checkbox.checked !== desired)
                                {
                                    checkbox.checked = desired;
                                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                            }
                        });
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
                const modLabels = { invisible: 'Invisible (*)', no_invisible: 'Not Invisible', no_cover: 'No Cover', soft_cover: 'Soft Cover (+1)', hard_cover: 'Hard Cover (+2)' };
                const modEnabled = new Map(attackMods.map(mod => [mod.id || mod.subtype, true]));
                bonusUsage.modEnabled = modEnabled;
                // Save originals per target for restore on uncheck
                const originals = new Map();
                for (const t of (state.data.acc_diff?.targets || []))
                {
                    for (const mod of attackMods)
                    {
                        const key = `${accDiffTargetToken(t)?.id}::${mod.subtype}`;
                        if ((mod.subtype === 'invisible' || mod.subtype === 'no_invisible') && t.plugins?.invisibility)
                            originals.set(key, t.plugins.invisibility.data);
                        else if (['no_cover', 'soft_cover', 'hard_cover'].includes(mod.subtype))
                            originals.set(key, t.cover);
                    }
                }

                const injectModToggles = () =>
                {
                    const $form = $('form[id^="accdiff"]');
                    if ($form.length === 0)
                        return;
                    $form.find('.la-target-modifier-section, .la-tmod-row').remove();

                    // Get Svelte classes from Prone section or use hardcoded defaults
                    const $proneSection = $form.find('label span:contains("Prone")').closest('.accdiff-grid__section');
                    const $ref = $proneSection.find('label.container').first();
                    const sectionClass = $proneSection.attr('class') || 'accdiff-grid accdiff-grid__section svelte-k5ear2';
                    const columnClass = $proneSection.find('.accdiff-grid__column').attr('class') || 'accdiff-grid__column svelte-k5ear2';
                    const labelClass = $ref.attr('class') || 'container svelte-wt0sk2';
                    const inputClass = $ref.find('input').attr('class') || 'svelte-wt0sk2';

                    const $allCards = $form.find('.accdiff-target');
                    const multiTarget = $allCards.length > 1;

                    // render a mod only when a card target matches its applyTo and passes its applyToCondition
                    const cardMods = attackMods.filter(mod =>
                    {
                        const relevantTargets = (state.data.acc_diff?.targets || []).filter(entry =>
                        {
                            const targetId = accDiffTargetToken(entry)?.id;
                            return !Array.isArray(mod.applyTo) || mod.applyTo.length === 0 || mod.applyTo.includes(targetId);
                        });
                        if (!relevantTargets.length)
                            return false;
                        const reactorToken = resolveReactorToken(mod, state);
                        return relevantTargets.some(entry => evaluateApplyToCondition(mod, entry, state, reactorToken));
                    });

                    // Split: global mods (no applyTo) vs per-target mods (applyTo + multi-target)
                    const globalMods = cardMods.filter(mod => !Array.isArray(mod.applyTo) || mod.applyTo.length === 0 || !multiTarget);
                    const perTargetMods = multiTarget ? cardMods.filter(mod => Array.isArray(mod.applyTo) && mod.applyTo.length > 0) : [];

                    const onToggle = (modifier, isOn) =>
                    {
                        const modKey = modifier.id || modifier.subtype;
                        modEnabled.set(modKey, isOn);
                        const reactorToken = resolveReactorToken(modifier, state);
                        for (const targetEntry of (state.data.acc_diff?.targets || []))
                        {
                            if (Array.isArray(modifier.applyTo) && modifier.applyTo.length > 0 && !modifier.applyTo.includes(accDiffTargetToken(targetEntry)?.id))
                                continue;
                            if (!evaluateApplyToCondition(modifier, targetEntry, state, reactorToken))
                                continue;
                            if (isOn)
                                applyOneModifier(targetEntry, modifier);
                            else
                            {
                                const originalKey = `${accDiffTargetToken(targetEntry)?.id}::${modifier.subtype}`;
                                if (modifier.subtype === 'invisible' && targetEntry.plugins?.invisibility)
                                    targetEntry.plugins.invisibility.data = 0;
                                else if (modifier.subtype === 'no_invisible' && targetEntry.plugins?.invisibility)
                                    targetEntry.plugins.invisibility.data = originals.get(originalKey) ?? 0;
                                else if (['no_cover', 'soft_cover', 'hard_cover'].includes(modifier.subtype))
                                    targetEntry.cover = originals.get(originalKey) ?? 0;
                            }
                        }
                    };

                    if (globalMods.length > 0)
                    {
                        let $insertAfter = $proneSection.length > 0 ? $proneSection : $form.find('label[for="accdiff-manual-adjust"]').closest('.accdiff-grid');
                        if ($insertAfter.length > 0)
                        {
                            const html = globalMods.map(mod =>
                            {
                                const mKey = mod.id || mod.subtype;
                                const checked = modEnabled.get(mKey) !== false;
                                const name = mod.name ? `${mod.name}: ${modLabels[mod.subtype]}` : modLabels[mod.subtype];
                                return `<label class="${labelClass} la-tmod-row" data-mkey="${mKey}" data-sub="${mod.subtype}" style="${checked ? '' : 'opacity:0.5;'}">` +
                                    `<input type="checkbox" class="${inputClass}" ${checked ? 'checked' : ''}> ` +
                                    `<span style="text-wrap: nowrap;">${name}</span></label>`;
                            }).join('');
                            const $modSection = $(`<div class="${sectionClass} la-target-modifier-section" style="width:100%;border-top:1px solid var(--primary-color,#991e2a);margin-top:6px;padding-top:4px;"><div class="${columnClass}">${html}</div></div>`);
                            const $targeting = $form.find('.la-targeting-section').first();
                            if ($targeting.length)
                                $targeting.before($modSection);
                            else
                                $insertAfter.after($modSection);
                            $modSection.find('.la-tmod-row input').on('change', function ()
                            {
                                const $row = $(this).closest('.la-tmod-row');
                                const mKey = String($row.data('mkey'));
                                const mod = globalMods.find(m => (m.id || m.subtype) === mKey);
                                if (!mod)
                                    return;
                                const on = $(this).is(':checked');
                                $row.css('opacity', on ? '1' : '0.5');
                                onToggle(mod, on);
                            });
                        }
                    }

                    // Inject per-target mods into matching target cards
                    for (const mod of perTargetMods)
                    {
                        const mKey = mod.id || mod.subtype;
                        const checked = modEnabled.get(mKey) !== false;
                        const name = mod.name ? `${mod.name}: ${modLabels[mod.subtype]}` : modLabels[mod.subtype];
                        $allCards.each(function ()
                        {
                            const $card = $(this);
                            const tokenId = (mod.applyTo || []).find(id => $card.find(`label.target-name[for="${id}"]`).length > 0);
                            if (!tokenId)
                                return;
                            const guardClass = `la-tmod-${mKey}-${tokenId}`;
                            if ($card.find(`.${guardClass}`).length > 0)
                                return;
                            const $body = $card.find('.accdiff-target-body').first();
                            if ($body.length === 0)
                                return;
                            const $siblingLabel = $form.find('.accdiff-grid__column label').first();
                            const $row = $(`<label class="${$siblingLabel.attr('class') || labelClass} la-tmod-row ${guardClass}" style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;${checked ? '' : 'opacity:0.5;'}">
                                <input type="checkbox" class="${$siblingLabel.find('input').attr('class') || inputClass}" ${checked ? 'checked' : ''}>
                                <span style="text-wrap:wrap;font-size:0.85em;line-height:1.1;" class="${$siblingLabel.find('span').attr('class') || ''}">${name}</span>
                            </label>`);
                            $body.append($row);
                            $row.find('input').on('change', function ()
                            {
                                const on = $(this).is(':checked');
                                $row.css('opacity', on ? '1' : '0.5');
                                onToggle(mod, on);
                            });
                        });
                    }
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
                    showDamageBonusNotification(collected.damageBonuses, state, collected.targetedDamageBonuses, dmgModifiers, bonusUsage.dmgEnabled);
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
                                    if (bonus.type === 'difficulty')
                                        accDiff.base.difficulty -= val;
                                    else
                                        accDiff.base.accuracy -= val;
                                }
                                else if (val && prevMode === 'target')
                                {
                                    for (const targetEntry of (accDiff?.targets ?? []))
                                    {
                                        if (bonus.applyTo.includes(accDiffTargetToken(targetEntry)?.id))
                                        {
                                            if (bonus.type === 'difficulty')
                                                targetEntry.difficulty -= val;
                                            else
                                                targetEntry.accuracy -= val;
                                        }
                                    }
                                }
                                appliedMode.delete(bonus.id);
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
                                bonusUsage.candidates[bonus.id] = { id: bonus.id, bucket, type: bonus.type, subtype: bonus.subtype ?? null, consumeOnUsage: bonus.consumeOnUsage, uses: bonus.uses, applyTo: bonus.applyTo ?? null };
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
        if (bonus.applyToTargetter || !(await isBonusApplicable(bonus, tags, state)) || bonus.type === 'stat' || bonus.type === 'range')
            continue;

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
            if (hasTarget)
            {
                if (targets.some(target => bonus.applyTo.includes(target.id)))
                    results.targetedDamageBonuses.push(bonus);
            }
            else
                results.damageBonuses.push(bonus);
        }
        else if (bonus.type !== 'damage')
        {
            const hasTarget = Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0;
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
export function getBonusDetailString(bonus)
{
    if (bonus.type === 'accuracy')
        return `Accuracy +${bonus.val}`;
    if (bonus.type === 'difficulty')
        return `Difficulty +${bonus.val}`;
    if (bonus.type === 'stat')
    {
        const name = bonus.stat?.split('.').pop() || bonus.stat;
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
            return `Change Type: ${parts.join(', ')}`;
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
    if (bonus.type === 'immunity')
    {
        if (bonus.subtype === 'effect' && bonus.effects)
            return `Immunity: ${bonus.effects.join(', ')}`;
        if ((bonus.subtype === 'damage' || bonus.subtype === 'resistance') && bonus.damageTypes)
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
    if (bonus.type === 'immunity')
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
        const weaponType = getWeaponType(state.item);
        if (weaponType)
        {
            if (weaponType === "Melee")
                tags.add("melee");
            else if (weaponType === "Nexus")
                tags.add("nexus");
            else
                tags.add("ranged");
        }
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

export function isBonusApplicable(bonus, flowTags, state)
{
    if (bonus.rollTypes && Array.isArray(bonus.rollTypes) && bonus.rollTypes.length > 0)
    {
        const hasMatch = bonus.rollTypes.some(rollType => flowTags.has(rollType.toLowerCase()));
        if (!hasMatch)
            return false;
    }

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
                        `const api=game.modules.get('lancer-automations')?.api;` +
                        `const ownerTokenId=context?.ownerTokenId;` +
                        `const reactorToken=ownerTokenId?canvas.tokens.get(ownerTokenId)??canvas.tokens.placeables.find(t=>t.id===ownerTokenId):null;`
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

        const $plusBtn = $('form[id^="accdiff"] button[data-tooltip="Add global accuracy"]');
        const $minusBtn = $('form[id^="accdiff"] button[data-tooltip="Add global difficulty"]');

        if ($plusBtn.length === 0 || $minusBtn.length === 0)
        {
            const $plusBtnAlt = $('form[id^="accdiff"] button:has(.cci-accuracy)');
            const $minusBtnAlt = $('form[id^="accdiff"] button:has(.cci-difficulty)');

            if ($plusBtnAlt.length > 0 && $minusBtnAlt.length > 0)
            {
                const clickCount = Math.abs(val);
                const $buttonToClick = wasEnabled ?
                    (val > 0 ? $minusBtnAlt : $plusBtnAlt) :
                    (val > 0 ? $plusBtnAlt : $minusBtnAlt);

                for (let i = 0; i < clickCount; i++)
                    $buttonToClick[0].click();
                return;
            }
            return;
        }

        const clickCount = Math.abs(val);
        const $buttonToClick = wasEnabled ?
            (val > 0 ? $minusBtn : $plusBtn) :
            (val > 0 ? $plusBtn : $minusBtn);

        for (let i = 0; i < clickCount; i++)
            $buttonToClick[0].click();
    };

    const renderBonusRow = (bonus, index) =>
    {
        const usesText = bonus.uses !== undefined ? ` (${bonus.uses} left)` : '';
        const isDifficulty = bonus.type === 'difficulty';
        const rawVal = Number.parseInt(bonus.val) || 0;
        const effectiveVal = isDifficulty ? -Math.abs(rawVal) : rawVal;
        const valText = (effectiveVal > 0 ? '+' : '') + effectiveVal;
        const isEnabled = bonus.enabled;

        return `
            <label class="container csm-bonus-row csm-global-bonus-row" data-index="${index}" data-bonus-id="${bonus.id || ''}" style="cursor: pointer;">
                <input type="checkbox" class="csm-bonus-checkbox" data-index="${index}" ${isEnabled ? 'checked' : ''}>
                <span style="text-wrap: nowrap;">${bonus.name}${usesText} (${valText})</span>
            </label>
        `;
    };

    const bindEvents = ($container) =>
    {
        $container.find('.csm-bonus-checkbox').on('change', function()
        {
            const bonusIndex = Number.parseInt($(this).data('index'));
            const bonusId = $(this).closest('label').data('bonus-id');
            const isChecked = $(this).is(':checked');
            const currentStates = getCurrentBonusStates();
            const bonus = currentStates[bonusIndex];
            if (!bonus)
                return;
            const wasEnabled = enabledById.has(bonusId) ? enabledById.get(bonusId) : true;
            enabledById.set(bonusId, isChecked);
            $(this).parent().css('opacity', isChecked ? '1' : '0.5');
            updateFlowAccuracy(bonus, wasEnabled);
        });
    };

    const injectIntoCard = () =>
    {
        const $form = $('form[id^="accdiff"]');
        if ($form.length === 0)
            return false;

        const $accurateLabel = $form.find('label:contains("Accurate")').first();
        const $inaccurateLabel = $form.find('label:contains("Inaccurate")').first();

        const $accContainer = $accurateLabel.closest('div');
        const $diffContainer = $inaccurateLabel.closest('div');

        if ($accContainer.length > 0 && $diffContainer.length > 0)
        {
            // Only remove global rows; leave per-target rows untouched
            $form.find('.csm-global-bonus-row').remove();

            const bonusStates = getCurrentBonusStates();
            bonusStates.forEach((bonus, index) =>
            {
                const val = Number.parseInt(bonus.val) || 0;
                if (val === 0)
                    return;

                const isDifficulty = bonus.type === 'difficulty' || val < 0;
                let $target = isDifficulty ? $diffContainer : $accContainer;

                const rowHtml = renderBonusRow(bonus, index);
                const $row = $(rowHtml);

                const $sibling = $target.find('label').first();
                if ($sibling.length > 0)
                {
                    const siblingClassStr = $sibling.attr('class') || '';
                    if (siblingClassStr)
                        $row.addClass(siblingClassStr);

                    const $siblingInput = $sibling.find('input').first();
                    const $myInput = $row.find('input').first();
                    if ($siblingInput.length > 0)
                    {
                        const inputClassStr = $siblingInput.attr('class') || '';
                        if (inputClassStr)
                            $myInput.addClass(inputClassStr);
                    }

                    const $siblingSpan = $sibling.find('span').first();
                    const $mySpan = $row.find('span').first();
                    if ($siblingSpan.length > 0)
                    {
                        const spanClassStr = $siblingSpan.attr('class') || '';
                        if (spanClassStr)
                            $mySpan.addClass(spanClassStr);
                    }
                }

                $target.append($row);
                bindEvents($target);
            });

            return true;
        }

        return false;
    };

    injectIntoCard();

    observeHudReinject('form[id^="accdiff"]', '.csm-global-bonus-row', injectIntoCard);

    // Always set up per-target injection with the same getter so it re-evaluates on each re-injection
    injectTargetedAccuracyBonuses(getTargetedBonuses, state, disabledByUser);

    // Return injectIntoCard so replaceTargets monkey-patch can force a DOM rebuild on target changes
    return injectIntoCard;
}

// Injects per-target acc/diff checkboxes; MutationObserver handles mid-dialog target additions.
// State is pre-set so buttons only clicked on user toggle.
function injectTargetedAccuracyBonuses(getTargetedBonuses, state, disabledByUser)
{
    /**
     * Click the per-target accuracy (+) or difficulty (-) button inside a target card.
     * @param {JQuery} $card   - The .accdiff-target card element
     * @param {string} type    - 'accuracy' or 'difficulty'
     * @param {number} count   - Number of times to click
     * @param {boolean} reverse - If true, click the opposite button
     */
    const clickTargetButton = ($card, type, count, reverse = false) =>
    {
        // The two .accdiff-button elements in the card: first = accuracy, last = difficulty
        const $btns = $card.find('.accdiff-button');
        if ($btns.length < 2)
            return;
        const $accBtn = $btns.first();
        const $diffBtn = $btns.last();
        let $btn;
        if (type === 'difficulty')
            $btn = reverse ? $accBtn : $diffBtn;
        else
            $btn = reverse ? $diffBtn : $accBtn;
        for (let i = 0; i < count; i++)
            $btn[0]?.click();
    };

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

        let injectedAny = false;

        for (const bonus of targetedBonuses)
        {
            const val = Number.parseInt(bonus.val) || 0;
            if (val === 0)
                continue;

            const isDiff = bonus.type === 'difficulty';
            const effectiveVal = isDiff ? -Math.abs(val) : val;
            const valText = (effectiveVal > 0 ? '+' : '') + effectiveVal;
            const usesText = bonus.uses !== undefined ? ` (${bonus.uses} left)` : '';
            const targetName = bonus._targetName || null;

            const matchingCards = [];
            const nonMatchingCards = [];
            $allCards.each(function()
            {
                const $card = $(this);
                let matchedTokenId = null;
                for (const tokenId of (bonus.applyTo || []))
                {
                    if ($card.find(`label.target-name[for="${tokenId}"]`).length > 0)
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
                const $row = $(`
                    <label class="container csm-bonus-row ${guardClass}" style="cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;${isDisabled ? 'opacity:0.5;' : ''}">
                        <input type="checkbox" class="csm-tgt-bonus-checkbox" ${isDisabled ? '' : 'checked'}>
                        <span style="text-wrap:nowrap;">${bonus.name}${usesText} (${valText})</span>
                    </label>
                `);

                const $siblingLabel = $form.find('.accdiff-grid__column label').first();
                if ($siblingLabel.length)
                {
                    $row.addClass($siblingLabel.attr('class') || '');
                    $row.addClass(guardClass);
                    $row.find('input').addClass($siblingLabel.find('input').attr('class') || '');
                    $row.find('span').addClass($siblingLabel.find('span').attr('class') || '');
                }

                $body.append($row);
                injectedAny = true;

                const capturedTokenId = matchedTokenId;
                $row.find('.csm-tgt-bonus-checkbox').on('change', function()
                {
                    const checked = $(this).is(':checked');
                    const key = `${bonus.id}:${capturedTokenId}`;
                    if (checked)
                    {
                        disabledByUser.delete(key);
                        clickTargetButton($card, bonus.type, val, false);
                    }
                    else
                    {
                        disabledByUser.add(key);
                        clickTargetButton($card, bonus.type, val, true);
                    }
                    $(this).closest('label').css('opacity', checked ? '1' : '0.5');
                });
            }

            // Inject invisible placeholders into non-matching cards to keep heights equal
            for (const $card of nonMatchingCards)
            {
                const $body = $card.find('.accdiff-target-body').first();
                if ($body.length === 0)
                    continue;

                const cardId = $card.find('label.target-name').attr('for') || String($card.index());
                const phGuard = `csm-tgt-ph-${bonus.id}-${cardId}`;
                if ($body.find(`.${phGuard}`).length > 0)
                    continue; // already injected

                const $placeholder = $(`
                    <label class="container csm-bonus-row ${phGuard}" style="visibility:hidden;" aria-hidden="true">
                        <input type="checkbox" disabled>
                        <span style="text-wrap:nowrap;">${bonus.name}${usesText} (${valText})</span>
                    </label>
                `);

                const $siblingLabel = $form.find('.accdiff-grid__column label').first();
                if ($siblingLabel.length)
                {
                    $placeholder.addClass($siblingLabel.attr('class') || '');
                    $placeholder.addClass(phGuard);
                    $placeholder.find('input').addClass($siblingLabel.find('input').attr('class') || '');
                    $placeholder.find('span').addClass($siblingLabel.find('span').attr('class') || '');
                }

                $body.append($placeholder);
                injectedAny = true;
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
        enabled: true
    }));

    const renderBonusRow = (bonus, index) =>
    {
        const usesText = bonus.uses !== undefined ? ` (${bonus.uses} left)` : '';
        const isEnabled = bonus.enabled;

        const damageComponents = (bonus.damage || []).map(d =>
        {
            const typeLower = d.type.toLowerCase();
            return `
                <i class="cci i--sm cci-${typeLower} damage--${typeLower} svelte-1tnd08e" data-tooltip="${d.type}"></i>
                <input class="reliable-value svelte-1tnd08e" type="text" value="${d.val}" disabled>
            `;
        }).join('');

        return `
            <div class="csm-bonus-config-row" style="display: grid; grid-template-columns: 1fr 1fr; align-items: center; margin-bottom: 2px;">
                <label class="container svelte-wt0sk2" style="max-width: fit-content; padding-right: 0.5em; grid-column: 1;">
                    <input type="checkbox" class="csm-bonus-checkbox svelte-wt0sk2" data-index="${index}" ${isEnabled ? 'checked' : ''}>
                    <span style="text-wrap: nowrap;">${bonus.name}${usesText}</span>
                </label>
                <div style="grid-column: 2; display: flex; align-items: center;">
                    ${damageComponents}
                </div>
            </div>
        `;
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
                    bonusStates.push({ ...bonus, _fromTargeted: true, index: bonusStates.length, enabled: true });
                });
            }
            else
                perCardBonuses = resolvedTargeted;
        }

        let $myContainer = $configGrid.find('.csm-bonus-container');
        if ($myContainer.length === 0)
        {
            $myContainer = $('<div class="csm-bonus-container" style="grid-column: 1 / -1; border-top: 1px solid var(--primary-light); margin-top: 5px; padding-top: 5px;"></div>');
            $myContainer.append('<h3 class="damage-hud-section lancer-border-primary svelte-1tnd08e" style="font-size: 0.9em; margin-bottom: 5px;">Global Bonuses</h3>');
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
        else
            $myContainer.find('.csm-bonus-config-row').remove();

        bonusStates.forEach((bonus, index) =>
        {
            const $row = $(renderBonusRow(bonus, index));
            _remapSvelteScopes($row, $form);
            $myContainer.append($row);
        });
        // Remap the header / any pre-existing children that were appended above.
        _remapSvelteScopes($myContainer, $form);

        const modLabels = { ap: 'Armor Piercing', half_damage: 'Half Damage', paracausal: 'Cannot be Reduced', crit: 'Force Crit', hit: 'Force Hit', miss: 'Force Miss' };
        const currentTargetIds = (state.data.damage_hud_data?.targets || []).map(t => accDiffTargetToken(t)?.id);
        const globalTMods = targetModifiers.filter(m =>
        {
            if (!Array.isArray(m.applyTo) || m.applyTo.length === 0)
                return true;
            if (targetCount <= 1)
                return currentTargetIds.some(id => m.applyTo.includes(id));
            return false;
        });
        const perTargetTMods = targetCount > 1 ? targetModifiers.filter(m => Array.isArray(m.applyTo) && m.applyTo.length > 0) : [];

        for (const mod of globalTMods)
        {
            const name = mod.name ? `${mod.name}: ${modLabels[mod.subtype] || mod.subtype}` : (modLabels[mod.subtype] || mod.subtype);
            const $row = $(`
                <div class="csm-bonus-config-row la-tmod-dmg-row" data-sub="${mod.subtype}" style="display: grid; grid-template-columns: 1fr; align-items: center; margin-bottom: 2px;">
                    <label class="container svelte-wt0sk2" style="max-width: fit-content; padding-right: 0.5em;">
                        <input type="checkbox" class="svelte-wt0sk2" checked>
                        <span style="text-wrap: nowrap;">${name}</span>
                    </label>
                </div>
            `);
            _remapSvelteScopes($row, $form);
            $myContainer.append($row);
        }

        $myContainer.toggle(bonusStates.length > 0 || globalTMods.length > 0);

        $myContainer.find('.csm-bonus-checkbox').on('change', function()
        {
            const index = Number.parseInt($(this).data('index'));
            const isChecked = $(this).is(':checked');
            bonusStates[index].enabled = isChecked;
            if (usageDmgEnabled && bonusStates[index].id)
                usageDmgEnabled.set(bonusStates[index].id, isChecked);

            const $bonusSection = $form.find('.bonus-damage');
            const $addBtn = $bonusSection.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
            if ($addBtn.length > 0)
                syncBonusToForm(bonusStates[index], $bonusSection, $addBtn);

            const $row = $(this).closest('.csm-bonus-config-row');
            $row.find('.csm-bonus-value').css('opacity', isChecked ? '0.9' : '0.5');
        });

        if (perTargetTMods.length > 0)
        {
            const $allCards = $form.find('.damage-hud-target-card');
            const hudTargets = state.data.damage_hud_data?.targets || [];
            for (const mod of perTargetTMods)
            {
                const name = mod.name ? `${mod.name}: ${modLabels[mod.subtype] || mod.subtype}` : (modLabels[mod.subtype] || mod.subtype);
                $allCards.each(function (cardIndex)
                {
                    const $card = $(this);
                    // Match by card index -> hudTargets[index].target.id
                    const hudTarget = hudTargets[cardIndex];
                    const hudTokenId = accDiffTargetToken(hudTarget)?.id;
                    const tokenId = hudTarget && hudTokenId && (mod.applyTo || []).includes(hudTokenId) ? hudTokenId : null;
                    if (!tokenId)
                        return;
                    const guardClass = `la-tmod-dmg-${mod.id || mod.subtype}-${tokenId}`;
                    if ($card.find(`.${guardClass}`).length > 0)
                        return;
                    const $row = $(`<label class="container svelte-wt0sk2 ${guardClass}" style="cursor:pointer;display:flex;align-items:center;gap:4px;padding:2px 4px;">
                        <input type="checkbox" class="svelte-wt0sk2" checked>
                        <span style="text-wrap:wrap;font-size:0.85em;line-height:1.1;">${name}</span>
                    </label>`);
                    $card.append($row);
                });
            }
        }

        if (perCardBonuses.length > 0)
            injectTargetedDamageBonuses(perCardBonuses, $form, state.data.damage_hud_data.targets);

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

    return bonusStates;
}

/**
 * Inject per-target damage bonus checkboxes into each matching target card in the damage HUD.
 * Card order in DOM matches damage_hud_data.targets order, matched by index.
 */
async function injectTargetedDamageBonuses(targetedBonuses, $form, hudTargets)
{
    if (!document.getElementById('csm-bonus-styles'))
    {
        $('<style id="csm-bonus-styles">.target-bonus-damage-wrapper:not(:has(:not(.csm-hidden-bonus-row))){display:none!important}</style>')
            .appendTo('head');
    }

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

            const usesText = bonus.uses !== undefined ? ` (${bonus.uses} left)` : '';
            const damageComponents = (bonus.damage || []).map(d =>
            {
                const typeLower = d.type.toLowerCase();
                return `<i class="cci i--sm cci-${typeLower} damage--${typeLower}" data-tooltip="${d.type}"></i>
                        <input class="reliable-value" type="text" value="${d.val}" disabled>`;
            }).join('');

            const $row = $(`
                <div class="csm-bonus-config-row ${guardClass}" style="display:grid;grid-template-columns:1fr 1fr;align-items:center;margin-bottom:2px;">
                    <label class="container svelte-wt0sk2" style="max-width:fit-content;padding-right:0.5em;">
                        <input type="checkbox" class="csm-tgt-dmg-checkbox svelte-wt0sk2" checked>
                        <span style="text-wrap:nowrap;">${bonus.name}${usesText}</span>
                    </label>
                    <div style="display:flex;align-items:center;">${damageComponents}</div>
                </div>
            `);
            _remapSvelteScopes($row, $form);

            // Visual row goes after the AP/Paracausal/Half-damage config row
            $card.find('.damage-target-config').after($row);

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
                $(this).closest('label').css('opacity', enabled ? '1' : '0.5');
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

// Swap LA's hardcoded svelte scope classes for v3's live ones so templates don't need per-release edits.
function _remapSvelteScopes($wrapper, $form)
{
    const containerScope = _detectSvelteScope($form, 'label.container');
    const valueScope = _detectSvelteScope($form, '.reliable-value, .damage-hud-section');
    const accdiffScope = _detectSvelteScope($form, '.accdiff-grid, .accdiff-other-grid');
    if (containerScope)
        $wrapper.find('.svelte-wt0sk2').addClass(containerScope).removeClass('svelte-wt0sk2');
    if (valueScope)
        $wrapper.find('.svelte-1tnd08e').addClass(valueScope).removeClass('svelte-1tnd08e');
    if (accdiffScope)
        $wrapper.find('.svelte-k5ear2').addClass(accdiffScope).removeClass('svelte-k5ear2');
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
                <i class="csm-knockback-icon mdi mdi-arrow-expand-all i--2 ${valueScope}" data-tooltip="Knockback" style="${checked ? '' : 'display:none;opacity:0;'}"></i>
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
 * When checked, crosses out .bonus-damage and .csm-bonus-container visually.
 * Actual suppression is handled by noBonusDmgClearStep in main.js.
 */
export function injectNoBonusDmgCheckbox(state)
{
    if (!state.data)
        state.data = {};

    state.la_extraData = state.la_extraData || {};

    if (!state.la_extraData._csmNoBonusDmg?.enabled)
    {
        const hasFlag = !!(state.item?.getFlag('lancer-automations', 'noBonusDmg'));
        state.la_extraData._csmNoBonusDmg = { enabled: hasFlag };
    }

    const applyStrikethrough = ($form) =>
    {
        const active = state.la_extraData._csmNoBonusDmg.enabled;
        $form.find('.bonus-damage').css({
            'text-decoration': active ? 'line-through' : '',
            'opacity':         active ? '0.5'          : '',
            'pointer-events':  active ? 'none'         : ''
        });
        $form.find('.csm-bonus-container').css({
            'text-decoration': active ? 'line-through' : '',
            'opacity':         active ? '0.5'          : '',
            'pointer-events':  active ? 'none'         : ''
        });
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
        const statusText = CONFIG.statusEffects?.find(effect => effect.id === 'throttled')?.description ?? '';
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
export async function addGlobalBonus(actor, bonusData, options = {})
{
    if (!actor)
        return;
    const bonuses = duplicate(actor.getFlag("lancer-automations", "global_bonuses") || []);

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

    await delegateSetActorFlag(actor, "lancer-automations", "global_bonuses", bonuses);

    options.duration = options.duration || { label: 'indefinite', turns: null, rounds: null };
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

            if (bonusData.type === 'immunity' && bonusData.subtype === 'resistance' && bonusData.damageTypes)
            {
                for (const rt of bonusData.damageTypes)
                {
                    const lcType = rt.toLowerCase().trim();
                    if (lcType)
                        changes.push({ key: `system.resistances.${lcType}`, mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" });
                }
            }

            const laFlags = { linkedBonusId: bonusData.id };
            if (statDirect)
                laFlags.statDirect = statDirect;
            if (options.consumption?.trigger)
            {
                // No originId: reactions-engine falls back to each prototype-spawned token at trigger time, so each consumes independently.
                laFlags.consumption = {
                    trigger: options.consumption.trigger,
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
            const effectData = { name: bonusData.name, img: icon, changes, flags: { 'lancer-automations': laFlags } };
            if (bonusData.uses && bonusData.uses > 0)
            {
                foundry.utils.setProperty(effectData, 'flags.statuscounter.value', bonusData.uses);
                foundry.utils.setProperty(effectData, 'flags.statuscounter.visible', bonusData.uses > 1);
            }
            if (options.refresh && actor.effects.some(effect => effect.flags?.['lancer-automations']?.linkedBonusId === bonusData.id))
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
            let durationObj = { label: 'indefinite', turns: null, rounds: null };

            if (options.duration !== 'indefinite' && game.combat)
            {
                const turnsVal = Number.isFinite(options.durationTurns) ? Math.max(0, options.durationTurns) : 1;
                const originId = options.origin?.id || options.origin || token.id;
                const isOriginTurn = game.combat?.current?.tokenId === originId;
                const label = options.duration || 'end';
                let turns;
                if (label === 'end' && isOriginTurn)
                    turns = turnsVal + 1;
                else
                    turns = turnsVal === 0 ? 1 : turnsVal;
                durationObj = { label, turns, rounds: 0, _preAdjusted: true };
            }

            const icon = getBonusIconImage(bonusData, options.icon);

            const extraOptions = { linkedBonusId: bonusData.id };

            // Stack = uses count (statuscounter.value is the single counter)
            if (bonusData.uses)
                extraOptions.stack = bonusData.uses;

            // If consumption trigger is configured, attach it (no 'uses'; stack handles that)
            if (options.consumption?.trigger)
            {
                extraOptions.consumption = {
                    trigger: options.consumption.trigger,
                    originId: options.consumption.originId || token.id,
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

            if (bonusData.type === 'immunity' && bonusData.subtype === 'resistance' && bonusData.damageTypes)
            {
                if (!extraOptions.changes)
                    extraOptions.changes = [];
                const resTypes = bonusData.damageTypes;
                for (const rt of resTypes)
                {
                    const lcType = rt.toLowerCase().trim();
                    if (lcType)
                    {
                        extraOptions.changes.push({
                            key: `system.resistances.${lcType}`,
                            mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
                            value: "true"
                        });
                    }
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
export async function removeGlobalBonus(actor, bonusIdOrPredicate, skipEffectRemoval = false)
{
    if (!actor)
        return;
    let bonuses = duplicate(actor.getFlag("lancer-automations", "global_bonuses") || []);
    const initialLength = bonuses.length;

    const predicate = typeof bonusIdOrPredicate === 'function'
        ? bonusIdOrPredicate
        : b => b.id === bonusIdOrPredicate;

    const bonusesToRemove = bonuses.filter(predicate);
    bonuses = bonuses.filter(b => !predicate(b));



    if (bonuses.length !== initialLength)
    {
        await delegateSetActorFlag(actor, "lancer-automations", "global_bonuses", bonuses);

        if (!skipEffectRemoval && bonusesToRemove.length > 0)
        {
            const removedIds = new Set(bonusesToRemove.map(b => b.id));
            const linkedEffects = actor.effects.filter(e =>
                removedIds.has(e.getFlag('lancer-automations', 'linkedBonusId'))
            );
            for (const e of linkedEffects)
                await e.delete();
        }

        return true;
    }
    return false;
}

/** @returns {object[]} */
export function getGlobalBonuses(actor)
{
    if (!actor)
        return [];
    return (actor.getFlag("lancer-automations", "global_bonuses") || [])
        .filter(bonus => linkTierGate(bonus, actor));
}

/** @returns {object|null} The bonus with that id, or null */
export function getGlobalBonus(actor, bonusId)
{
    if (!actor)
        return null;
    const bonuses = actor ? (actor.getFlag("lancer-automations", "global_bonuses") || []) : [];
    return bonuses.find(b => b.id === bonusId) || null;
}

Hooks.on("deleteActiveEffect", (effect) =>
{
    // Item-source AEs: reversal runs when the transferred copy leaves the actor; removeGlobalBonus on an item no-ops via the flag branch.
    const isItemParent = effect.parent?.documentName === 'Item';

    const linkedBonusId = effect.getFlag("lancer-automations", "linkedBonusId");
    if (linkedBonusId && effect.parent)
        removeGlobalBonus(effect.parent, linkedBonusId, true);

    if (isItemParent)
        return;

    const statDirect = effect.getFlag('lancer-automations', 'statDirect');
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

    state.la_extraData.flow_bonus.push(bonus);
}

// Constant stat bonuses carry no effect, so they are folded into derived data instead.
// Current resources are excluded: rewriting them each prepare would undo damage.
export function initConstantStatHooks()
{
    if (typeof libWrapper === 'undefined')
        return;
    libWrapper.register('lancer-automations', 'CONFIG.Actor.documentClass.prototype.prepareDerivedData',
        function (wrapped)
        {
            wrapped();
            const bonuses = this.flags?.['lancer-automations']?.constant_bonuses;
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
    const bonuses = duplicate(target.getFlag("lancer-automations", "constant_bonuses") || []);
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
    await delegateSetActorFlag(target, "lancer-automations", "constant_bonuses", bonuses);
}

/** @returns {object[]} */
export function getConstantBonuses(actor)
{
    if (!actor)
        return [];
    return (actor.getFlag("lancer-automations", "constant_bonuses") || [])
        .filter(bonus => linkTierGate(bonus, actor));
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
    const bonuses = duplicate(target.getFlag("lancer-automations", "constant_bonuses") || []);
    const predicate = typeof bonusIdOrPredicate === 'function'
        ? bonusIdOrPredicate
        : bonus => bonus.id === bonusIdOrPredicate;
    const filtered = bonuses.filter(bonus => !predicate(bonus));
    if (filtered.length !== bonuses.length)
    {
        if (target.documentName === 'Item')
            await target.setFlag("lancer-automations", "constant_bonuses", filtered);
        else
            await delegateSetActorFlag(target, "lancer-automations", "constant_bonuses", filtered);
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
    const templates = sourceDoc.getFlag?.('lancer-automations', 'bonusTemplates') || [];
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
            const markers = { [sourceKey]: sourceDoc.uuid, sourceTemplateId: template.id };
            if (isConstant)
            {
                const existing = /** @type {any[]} */ (actor.getFlag?.('lancer-automations', 'constant_bonuses') || []);
                if (existing.some(bonus => bonus.id === runtimeId))
                    continue;
                const bonusDataOut = { ...(template.bonusData || {}), id: runtimeId, ...markers };
                if (uses !== undefined)
                    bonusDataOut.uses = uses;
                try
                {
                    await delegateSetActorFlag(actor, 'lancer-automations', 'constant_bonuses', [...existing, bonusDataOut]);
                }
                catch (err)
                {
                    console.warn('lancer-automations | bonus template constant write failed:', err);
                }
                continue;
            }
            const already = (actor.getFlag?.('lancer-automations', 'global_bonuses') || []).some(bonus => bonus.id === runtimeId);
            if (already)
                continue;
            const bonusDataOut = { ...(template.bonusData || {}), id: runtimeId, ...markers };
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
        const templates = source.getFlag?.('lancer-automations', 'bonusTemplates') || [];
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
                effect.flags?.['lancer-automations']?.linkedBonusId === runtimeBonus.id);
            const rawUses = linkedAE?.flags?.statuscounter?.value;
            currentUses = Number.isFinite(Number(rawUses)) ? Number(rawUses) : (linkedAE ? undefined : 0);
            if (currentUses === undefined)
                return;
        }
        const updated = templates.map(candidate => candidate.id === sourceTemplateId ? { ...candidate, lastRuntimeUses: currentUses } : candidate);
        await source.setFlag('lancer-automations', 'bonusTemplates', updated);
    }
    catch (err)
    {
        console.warn('lancer-automations | persistBonusUsesToTemplate failed:', err);
    }
}

/** @returns {boolean} */
export function supportsConsumeOnUsage(type, subtype = null)
{
    if (['accuracy', 'difficulty', 'damage', 'target_modifier', 'reroll'].includes(type))
        return true;
    if (type === 'immunity')
        return ['effect', 'crit', 'hit', 'miss', 'damage', 'resistance', 'provoke', 'terrain'].includes(subtype);
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
    return search(actor.getFlag('lancer-automations', 'global_bonuses') || [], 'global')
        ?? search(actor.getFlag('lancer-automations', 'constant_bonuses') || [], 'constant');
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
        effect.flags?.['lancer-automations']?.linkedBonusId === stored.id));
    if (linkedEffect?.flags?.['lancer-automations']?.consumption?.trigger)
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
            const bonuses = actor.getFlag('lancer-automations', 'global_bonuses') || [];
            const updated = bonuses.map(existing => existing.id === stored.id ? { ...existing, uses: newUses } : existing);
            await actor.setFlag('lancer-automations', 'global_bonuses', updated);
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
 * @param {string[]|null} [options.damageTypes] Only consider bonuses covering one of these damage types
 * @returns {Promise<boolean>} True if a charge was spent
 */
export async function consumeImmunityUse(actor, subtype, state = null, { damageTypes = null } = {})
{
    if (!actor)
        return false;
    const wanted = damageTypes?.map(type => String(type).toLowerCase());
    const candidates = getImmunityBonuses(actor, subtype, state)
        .filter(bonus => bonus.consumeOnUsage === true)
        .filter(bonus => !wanted || !bonus.damageTypes || bonus.damageTypes.some(type =>
        {
            const lower = String(type).toLowerCase();
            return lower === 'all' || lower === 'variable' || wanted.includes(lower);
        }));
    for (const bonus of candidates)
    {
        if (await consumeBonusUse(actor, bonus, { removeWhenNoUses: true }))
            return true;
    }
    return false;
}

// Post-roll pass: burn "consume on usage" bonuses that actually applied in this flow.
export async function burnBonusUsageForFlow(state)
{
    const usage = state?.la_extraData?.bonusUsage;
    const actor = state?.actor;
    if (!usage || !actor)
        return;
    for (const candidate of Object.values(usage.candidates))
    {
        if (candidate.consumeOnUsage === false || !supportsConsumeOnUsage(candidate.type, candidate.subtype))
            continue;
        if (typeof candidate.uses !== 'number')
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
                used = targets.some(entry =>
                {
                    const tokenId = accDiffTargetToken(entry)?.id;
                    return tokenId && candidate.applyTo?.includes(tokenId) && !usage.disabledByUser?.has(`${candidate.id}:${tokenId}`);
                });
            }
        }
        else if (candidate.bucket === 'tmod')
            used = (usage.modEnabled?.get(candidate.id || candidate.subtype)) !== false;
        else
            used = usage.dmgEnabled.get(candidate.id) !== false;
        if (!used)
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
    const globals = /** @type {any[]} */ (actor.getFlag?.('lancer-automations', 'global_bonuses') || [])
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
    const constants = /** @type {any[]} */ (actor.getFlag?.('lancer-automations', 'constant_bonuses') || []);
    if (constants.some(predicate))
    {
        const remaining = constants.filter(bonus => !predicate(bonus));
        try
        {
            await delegateSetActorFlag(actor, 'lancer-automations', 'constant_bonuses', remaining);
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
    const serialized = serializeBonusLambdas(bonusData);
    const stamped = [];
    for (const item of items)
    {
        if (!item || item.documentName !== 'Item')
            continue;
        const templateId = foundry.utils.randomID();
        const template = { id: templateId, bonusData: /** @type {any} */ ({ ...serialized }), addOptions: { ...addOptions, ...extraOptions } };
        const existing = item.getFlag?.('lancer-automations', 'bonusTemplates') || [];
        await item.setFlag('lancer-automations', 'bonusTemplates', [...existing, template]);
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
        && !(item.getFlag?.('lancer-automations', 'bonusTemplates') || []).some(template => template.bonusData?.id === bonusData.id));
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
    const serialized = serializeBonusLambdas(bonusData);
    const stamped = [];
    for (const actor of actors)
    {
        if (!actor || actor.documentName !== 'Actor')
            continue;
        const templateId = foundry.utils.randomID();
        const template = { id: templateId, bonusData: /** @type {any} */ ({ ...serialized }), addOptions: { ...addOptions, ...extraOptions } };
        const existing = actor.getFlag?.('lancer-automations', 'bonusTemplates') || [];
        await actor.setFlag('lancer-automations', 'bonusTemplates', [...existing, template]);
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
        const existing = item.getFlag?.('lancer-automations', 'bonusTemplates') || [];
        const filtered = existing.filter(template => template.id !== templateId);
        if (filtered.length === existing.length)
            continue;
        await item.setFlag('lancer-automations', 'bonusTemplates', filtered);
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
        const existing = actor.getFlag?.('lancer-automations', 'bonusTemplates') || [];
        const filtered = existing.filter(template => template.id !== templateId);
        if (filtered.length === existing.length)
            continue;
        await actor.setFlag('lancer-automations', 'bonusTemplates', filtered);
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

/** @returns {object[]} */
export function getImmunityBonuses(actor, subtype, state = null)
{
    if (!actor)
        return [];

    const constants = actor.getFlag("lancer-automations", "constant_bonuses") || [];
    const globals = actor.getFlag("lancer-automations", "global_bonuses") || [];
    const ephemerals = actor.getFlag("lancer-automations", "ephemeral_bonuses") || [];
    const flowBonuses = state?.la_extraData?.flow_bonus || [];

    return flattenBonuses([...constants, ...globals, ...ephemerals, ...flowBonuses])
        .filter(bonus => bonus.type === "immunity" && bonus.subtype === subtype && linkTierGate(bonus, actor));
}

/** @returns {string[]} array of immunity source names; empty if not immune */
export function checkEffectImmunities(actor, effectIdOrName, effect = null, state = null)
{
    if (!actor || !effectIdOrName)
        return [];

    const effectImmunities = getImmunityBonuses(actor, "effect", state);
    const matchedSources = [];

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

                const flagName = effect.getFlag('lancer-automations', 'effect') || (game.modules.get('csm-lancer-qol')?.active ? effect.getFlag('csm-lancer-qol', 'effect') : null);
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
            matchedSources.push(b.source || b.name || "Unknown Immunity");
    }

    return matchedSources;
}

/** @returns {any[]} Resistance bonuses matching that damage type */
export function checkDamageResistances(actor, damageType)
{
    if (!actor || !damageType)
        return [];
    const resistanceBonuses = getImmunityBonuses(actor, "resistance");
    const incomingLower = damageType.toLowerCase();

    return resistanceBonuses
        .filter(b => b.damageTypes && b.damageTypes.some(t => t.toLowerCase() === incomingLower || t.toLowerCase() === "variable" || t.toLowerCase() === "all"))
        .map(b => b.source || b.name || "Unknown Resistance");
}

// Resistance effects consumed on damage burn at apply time, after the halving they granted.
const _deferredResistanceConsumption = new Map();

export function deferResistanceEffectConsumption(actor, effect)
{
    if (!actor?.uuid || !effect?.id)
        return;
    const pending = _deferredResistanceConsumption.get(actor.uuid) ?? new Set();
    pending.add(effect.id);
    _deferredResistanceConsumption.set(actor.uuid, pending);
}

async function _consumeDeferredResistanceEffects(actor, damage, options)
{
    const pending = _deferredResistanceConsumption.get(actor.uuid);
    if (!pending)
        return;
    _deferredResistanceConsumption.delete(actor.uuid);
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

// Bridges bonus-based resistances into damageCalc, which only reads system.resistances.
let _pendingApplyHalvedActorUuid = null;
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
        const chatMessageElement = button.closest('.chat-message.message');
        const damageData = game.messages?.get(chatMessageElement?.dataset.messageId)?.flags?.lancer?.damageData;
        const targetUuid = button.closest('.lancer-damage-button-group')?.dataset?.target;
        if (!damageData || !targetUuid)
            return;
        const targetResult = damageData.targetDamageResults?.find(entry => entry.target === targetUuid);
        if (targetResult?.half_damage)
            _pendingApplyHalvedActorUuid = /** @type {any} */ (fromUuidSync(targetUuid))?.actor?.uuid ?? null;
    }, { capture: true });

    libWrapper.register('lancer-automations', 'CONFIG.Actor.documentClass.prototype.damageCalc',
        async function (wrapped, damage, options)
        {
            const alreadyHalved = _pendingApplyHalvedActorUuid !== null && _pendingApplyHalvedActorUuid === this.uuid;
            if (alreadyHalved)
                _pendingApplyHalvedActorUuid = null;
            const resistances = this.system?.resistances;
            const bridged = [];
            if (resistances && !alreadyHalved)
            {
                for (const type of ['kinetic', 'energy', 'explosive', 'variable', 'burn', 'heat'])
                {
                    if (!resistances[type] && checkDamageResistances(this, type).length > 0)
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
            try
            {
                hpLanded = await wrapped(damage, options);
            }
            finally
            {
                for (const type of bridged)
                    resistances[type] = false;
            }
            if (spentOn.length)
                await consumeImmunityUse(this, 'resistance', null, { damageTypes: spentOn });
            await _consumeDeferredResistanceEffects(this, damage, options);
            if (showResisted)
            {
                const floatToken = this.getActiveTokens?.()?.[0];
                if (floatToken)
                    broadcastFloatTokenText(floatToken, 'Resisted', 0x4da6ff);
            }
            Hooks.callAll('lancer-automations.battelog.damageApplied', this, hpLanded);
            return hpLanded;
        }, 'WRAPPER');
}

/** @returns {object[]} damages with immune types zeroed */
export function applyDamageImmunities(actor, damages, state = null)
{
    if (!actor || !damages)
        return damages;

    const damageImmunities = getImmunityBonuses(actor, "damage", state);
    if (damageImmunities.length === 0)
        return damages;

    const immuneTypes = new Set();
    for (const b of damageImmunities)
    {
        if (b.damageTypes)
            b.damageTypes.forEach(t => immuneTypes.add(t.toLowerCase()));
    }

    return damages.map(dmg =>
    {
        if (immuneTypes.has(dmg.type.toLowerCase()))
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
        if (!game.settings.get('lancer-automations', 'convertHeatToEnergyOnHeatless'))
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

/** @returns {Promise<boolean>} */
export async function hasCritImmunity(actor, attackerActor = null, state = null)
{
    if (!actor)
        return false;
    const candidates = getImmunityBonuses(actor, "crit", state);
    if (candidates.length === 0)
        return false;
    if (!attackerActor)
        return true;
    const attackerState = state ? { ...state, actor: attackerActor } : { actor: attackerActor };
    for (const b of candidates)
    {
        if (await isBonusApplicable(b, new Set(), attackerState))
            return true;
    }
    return false;
}

/** @returns {Promise<boolean>} */
export async function hasHitImmunity(actor, attackerActor = null, state = null)
{
    if (!actor)
        return false;
    const candidates = getImmunityBonuses(actor, "hit", state);
    if (candidates.length === 0)
        return false;
    if (!attackerActor)
        return true;
    const attackerState = state ? { ...state, actor: attackerActor } : { actor: attackerActor };
    for (const b of candidates)
    {
        if (await isBonusApplicable(b, new Set(), attackerState))
            return true;
    }
    return false;
}

/** @returns {Promise<boolean>} */
export async function hasMissImmunity(actor, attackerActor = null, state = null)
{
    if (!actor)
        return false;
    const candidates = getImmunityBonuses(actor, "miss", state);
    if (candidates.length === 0)
        return false;
    if (!attackerActor)
        return true;
    const attackerState = state ? { ...state, actor: attackerActor } : { actor: attackerActor };
    for (const b of candidates)
    {
        if (await isBonusApplicable(b, new Set(), attackerState))
            return true;
    }
    return false;
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
    return /** @type {any[]} */ (source.getFlag?.('lancer-automations', 'bonusTemplates') || []);
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
    checkEffectImmunities,
    applyDamageImmunities,
    checkDamageResistances,
    hasCritImmunity,
    hasHitImmunity,
    hasMissImmunity,
    injectBonusToFlowState
};
