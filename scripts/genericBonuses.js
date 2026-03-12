import { applyEffectsToTokens } from "./flagged-effects.js";
import { executeEffectManager } from "./effectManager.js";
import { stringToAsyncFunction } from "./reaction-manager.js";

/**
 * Session cache for compiled lambda conditions.
 * When a bonus `condition` field starts with `@@fn:`, the remainder is the serialized function source.
 * Compiled functions are cached here (keyed on source string) to avoid recompiling on every evaluation.
 * The source itself lives in the actor flag and survives page reloads — this cache is purely a
 * performance optimization and is rebuilt on demand.
 */
const serializedConditionCache = new Map();

// Current resource stats use direct actor.update() instead of ActiveEffect changes,
// because AE changes get re-applied on every data refresh (breaking consumable resources like overshield).
const CURRENT_RESOURCE_STATS = new Set([
    'system.hp.value', 'system.heat.value', 'system.overshield.value',
    'system.burn', 'system.repairs.value'
]);

export function flattenBonuses(bonuses) {
    if (!bonuses) {
        return [];
    }
    const arr = Array.isArray(bonuses) ? bonuses : [bonuses];
    const flattened = [];
    for (const b of arr) {
        if (b.type === 'multi' && Array.isArray(b.bonuses)) {
            b.bonuses.forEach((sub, idx) => {
                const flatSub = { ...sub };
                if (!flatSub.id) {
                    flatSub.id = `${b.id || 'multi'}_sub_${idx}`;
                }
                if (b.applyTo && !flatSub.applyTo) {
                    flatSub.applyTo = b.applyTo;
                }
                if (!flatSub.source && b.source) {
                    flatSub.source = b.source;
                }
                if (!flatSub.name && b.name) {
                    flatSub.name = b.name;
                }
                if (b.context && !flatSub.context) {
                    flatSub.context = b.context;
                }
                if (!flatSub.context && b.context) {
                    flatSub.context = b.context;
                }
                flattened.push(flatSub);
            });
        } else {
            flattened.push(b);
        }
    }
    return flattened;
}

async function delegateSetActorFlag(actor, ns, key, value) {
    if (game.user.isGM || actor.isOwner) {
        await actor.setFlag(ns, key, value);
    } else {
        game.socket.emit('module.lancer-automations', {
            action: "setActorFlag",
            payload: { actorId: actor.id, ns, key, value }
        });
    }
}


/**
 * Mutates state.data.tags based on a tag bonus payload.
 */
export function applyTagBonus(state, bonus) {
    if (!state.data)
        state.data = {};
    if (!state.data.tags)
        state.data.tags = [];

    const tagName = bonus.tagName || bonus.name; // In effect manager, we'll store tag id/name
    const tagId = bonus.tagId;
    const isRemove = !!bonus.removeTag;

    if (isRemove) {
        // Filter out tag by LID or ID
        state.data.tags = state.data.tags.filter(t => t.id !== tagId && t.lid !== tagId);
        return;
    }

    // Adding or Overriding
    const existingIdx = state.data.tags.findIndex(t => t.id === tagId || t.lid === tagId);
    if (existingIdx !== -1) {
        // Tag exists. Modify it.
        const tag = { ...state.data.tags[existingIdx] }; // Clone so we don't mutate the base definition
        const isOverride = bonus.tagMode === 'override';
        const val = Number.parseInt(bonus.val) || 0;

        if (isOverride) {
            tag.val = String(val);
        } else {
            // Add
            const currentVal = Number.parseInt(tag.val) || Number.parseInt(tag.num_val) || 0;
            tag.val = String(currentVal + val);
        }
        state.data.tags[existingIdx] = tag;
    } else {
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
 * Preserves _Range prototype instances by mutating in-place.
 */
export function applyRangeBonus(state, bonus) {
    if (!state.data)
        state.data = {};
    if (!state.data.range)
        state.data.range = [];

    const rangeType = bonus.rangeType;
    const isOverride = bonus.rangeMode === 'override';
    const val = Number.parseInt(bonus.val) || 0;

    const existingIdx = state.data.range.findIndex(r => r.type === rangeType);
    if (existingIdx !== -1) {
        // Mutate in-place to preserve _Range prototype methods (icon getter, etc.)
        const entry = state.data.range[existingIdx];
        if (isOverride) {
            entry.val = val;
        } else {
            entry.val = (Number.parseInt(entry.val) || 0) + val;
        }
    } else {
        // Try to reuse the constructor from an existing range to preserve prototype methods
        const RangeClass = state.data.range[0]?.constructor;
        if (RangeClass && RangeClass !== Object) {
            state.data.range.push(new RangeClass({ type: rangeType, val }));
        } else {
            // Fallback: plain object with computed icon
            state.data.range.push({ type: rangeType, val, icon: `cci-${rangeType.toLowerCase()}`, formatted: `${rangeType} ${val}` });
        }
    }
}

/**
 * Creates a generic bonus step for a specific flow type
 * @param {string} flowType - The flow type identifier (e.g., "attack", "tech_attack", "hull", "damage")
 * @returns {Function} The flow step function
 */
function createGenericBonusStep(flowType) {
    return async function genericAccuracyStepImpl(state) {
        try {
            const actor = state.actor;
            if (!actor) {
                return true;
            }

            const tags = getFlowTags(flowType, state);
            const r = {
                netBonus: (actor.getFlag("lancer-automations", "generic_accuracy") || 0) -
                           (actor.getFlag("lancer-automations", "generic_difficulty") || 0) +
                           (actor.getFlag("world", "generic_accuracy") || 0) -
                           (actor.getFlag("world", "generic_difficulty") || 0),
                activeBonuses: [],
                damageBonuses: [],
                allTargetedBonuses: [],
                targetedDamageBonuses: [],
                disabledByUser: new Set()
            };

            await processBonusBatch(flattenBonuses(actor.getFlag("lancer-automations", "global_bonuses")), flowType, tags, state, r);
            await processBonusBatch(actor.getFlag("lancer-automations", "constant_bonuses"), flowType, tags, state, r);
            await processEphemeralBonuses(actor, flowType, tags, state, r);

            const attackerId = actor.token?.id ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id)?.id;
            await collectTargeterBonuses(attackerId, flowType, tags, state, r);

            const hasAny = r.netBonus !== 0 || r.activeBonuses.length > 0 || r.damageBonuses.length > 0 ||
                           r.allTargetedBonuses.length > 0 || r.targetedDamageBonuses.length > 0;
            if (!hasAny) {
                return true;
            }

            if (!state.data) {
                state.data = {};
            }
            if (!state.data.acc_diff) {
                state.data.acc_diff = {};
            }
            if (!state.data.acc_diff.base) {
                state.data.acc_diff.base = {};
            }

            const base = state.data.acc_diff.base;
            if (typeof base.accuracy !== 'number')
                base.accuracy = 0;
            if (typeof base.difficulty !== 'number')
                base.difficulty = 0;

            if (r.netBonus > 0) {
                base.accuracy += r.netBonus;
            } else if (r.netBonus < 0) {
                base.difficulty += Math.abs(r.netBonus);
            }

            const appliedMode = new Map();
            const applyTargetedBonuses = (accDiff) => {
                const count = accDiff.targets?.length || 0;
                const bBase = accDiff.base;
                for (const bonus of r.allTargetedBonuses) {
                    const val = Number.parseInt(bonus.val) || 0;
                    if (!val) {
                        continue;
                    }

                    const prev = appliedMode.get(bonus.id);
                    if (prev === 'base') {
                        if (bonus.type === 'difficulty') {
                            bBase.difficulty -= val;
                        } else {
                            bBase.accuracy -= val;
                        }
                    } else if (prev === 'target') {
                        accDiff.targets.forEach(t => {
                            if (bonus.applyTo.includes(t.target?.id)) {
                                if (bonus.type === 'difficulty') {
                                    t.difficulty -= val;
                                } else {
                                    t.accuracy -= val;
                                }
                            }
                        });
                    }

                    const matching = accDiff.targets?.filter(t => bonus.applyTo.includes(t.target?.id)) ?? [];
                    if (!matching.length) {
                        appliedMode.set(bonus.id, null);
                        continue;
                    }

                    if (count <= 1) {
                        if (bonus.type === 'difficulty') {
                            bBase.difficulty += val;
                        } else {
                            bBase.accuracy += val;
                        }
                        appliedMode.set(bonus.id, 'base');
                    } else {
                        matching.forEach(t => {
                            if (!r.disabledByUser.has(`${bonus.id}:${t.target?.id}`)) {
                                if (bonus.type === 'difficulty') {
                                    t.difficulty += val;
                                } else {
                                    t.accuracy += val;
                                }
                            }
                        });
                        appliedMode.set(bonus.id, 'target');
                    }
                }
            };

            const getEffActive = () => [...r.activeBonuses, ...r.allTargetedBonuses.filter(b => appliedMode.get(b.id) === 'base')];
            const getEffTargeted = () => r.allTargetedBonuses.filter(b => appliedMode.get(b.id) === 'target');

            if (r.allTargetedBonuses.length > 0) {
                applyTargetedBonuses(state.data.acc_diff);
            }

            let reinjectCallback = null;
            if (typeof state.data.acc_diff.replaceTargets === 'function') {
                const origReplace = state.data.acc_diff.replaceTargets.bind(state.data.acc_diff);
                state.data.acc_diff.replaceTargets = function(ts) {
                    origReplace(ts);
                    if (r.allTargetedBonuses.length > 0) {
                        applyTargetedBonuses(this);
                    }
                    if (reinjectCallback) {
                        setTimeout(reinjectCallback, 50);
                    }
                    return this;
                };
            }

            if (r.activeBonuses.length > 0 || r.allTargetedBonuses.length > 0) {
                reinjectCallback = showBonusNotification(getEffActive, state, getEffTargeted, r.disabledByUser);
            }

            if (flowType === 'damage' && (r.damageBonuses.length > 0 || r.targetedDamageBonuses.length > 0)) {
                showDamageBonusNotification(r.damageBonuses, state, r.targetedDamageBonuses);
            }

        } catch (e) {
            console.error("lancer-automations | Error in genericAccuracyStep:", e);
        }

        return true;
    };
}

/**
 * Internal helper to process a list of bonuses and sort them into results buckets.
 */
async function processBonusBatch(bonuses, flowType, tags, state, results) {
    if (!Array.isArray(bonuses))
        return;
    const targets = Array.from(game.user?.targets || []);

    for (const bonus of bonuses) {
        if (bonus.applyToTargetter || !(await isBonusApplicable(bonus, tags, state)) || bonus.type === 'stat') {
            continue;
        }

        if (bonus.type === 'tag') {
            applyTagBonus(state, bonus);
            results.activeBonuses.push(bonus);
        } else if (bonus.type === 'range') {
            applyRangeBonus(state, bonus);
            results.activeBonuses.push(bonus);
        } else if (bonus.type === 'damage' && flowType === 'damage') {
            const hasTarget = Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0;
            if (hasTarget) {
                if (targets.some(t => bonus.applyTo.includes(t.id))) {
                    results.targetedDamageBonuses.push(bonus);
                }
            } else {
                results.damageBonuses.push(bonus);
            }
        } else if (bonus.type !== 'damage') {
            const hasTarget = Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0;
            if (hasTarget) {
                const b = { ...bonus, id: bonus.id || foundry.utils.randomID() };
                results.allTargetedBonuses.push(b);
            } else {
                let val = Number.parseInt(bonus.val) || 0;
                if (bonus.type === 'difficulty') {
                    val = -val;
                }
                results.netBonus += val;
                results.activeBonuses.push(bonus);
            }
        }
    }
}

/**
 * Specifically handles ephemeral bonuses and their consumption.
 */
async function processEphemeralBonuses(actor, flowType, tags, state, results) {
    const bonuses = state?.la_extraData?.flow_bonus || [];
    if (!bonuses.length) {
        return;
    }
    const remaining = [];
    let changed = false;

    for (const b of bonuses) {
        if (await isBonusApplicable(b, tags, state)) {
            const res = { netBonus: 0, activeBonuses: [], damageBonuses: [], allTargetedBonuses: [], targetedDamageBonuses: [] };
            await processBonusBatch([b], flowType, tags, state, res);

            // If it was actually applicable and used in the current context, consume it
            const consumed = (res.activeBonuses.length > 0) || (res.damageBonuses.length > 0) ||
                             (res.allTargetedBonuses.length > 0) || (res.targetedDamageBonuses.length > 0) ||
                             (res.netBonus !== 0);

            if (consumed) {
                results.netBonus += res.netBonus;
                results.activeBonuses.push(...res.activeBonuses);
                results.damageBonuses.push(...res.damageBonuses);
                results.allTargetedBonuses.push(...res.allTargetedBonuses);
                results.targetedDamageBonuses.push(...res.targetedDamageBonuses);
                changed = true;
            } else {
                remaining.push(b);
            }
        } else {
            remaining.push(b);
        }
    }
    if (changed && state?.la_extraData) {
        state.la_extraData.flow_bonus = remaining;
    }
}

/**
 * Scans for bonuses from other tokens on the active scene (applyToTargetter).
 */
async function collectTargeterBonuses(attackerTokenId, flowType, tags, state, results) {
    const targets = Array.from(game.user?.targets || []);
    for (const token of (game.scenes.active?.tokens ?? [])) {
        if (!token.actor || token.id === attackerTokenId) {
            continue;
        }
        const sourceActor = token.actor;
        const isTargeted = targets.some(t => t.id === token.id);
        const filter = async (b) => {
            return b.applyToTargetter && (!b.applyTo?.length || b.applyTo.includes(attackerTokenId)) &&
                                   await isBonusApplicable(b, tags, state) && b.type !== 'stat';
        };
        const route = (b) => {
            const injected = { ...b, applyTo: [token.id], id: b.id || foundry.utils.randomID() };
            if (b.type === 'damage') {
                if (flowType === 'damage' && isTargeted) {
                    results.targetedDamageBonuses.push(injected);
                }
            } else if (b.type === 'tag') {
                applyTagBonus(state, b);
                results.activeBonuses.push(injected);
            } else if (b.type === 'range') {
                applyRangeBonus(state, b);
                results.activeBonuses.push(injected);
            } else {
                results.allTargetedBonuses.push(injected);
            }
        };

        for (const b of flattenBonuses(sourceActor.getFlag("lancer-automations", "global_bonuses"))) {
            if (await filter(b)) {
                route(b);
            }
        }
        for (const b of (sourceActor.getFlag("lancer-automations", "constant_bonuses") || [])) {
            if (await filter(b)) {
                route(b);
            }
        }
        /*
        // This is the old ephemeral bonus system utilizing actor flags.
        const ephemerals = sourceActor.getFlag("lancer-automations", "ephemeral_bonuses") || [];
        const rem = [];
        let consumed = false;
        for (const b of ephemerals) {
            if (await filter(b) && isTargeted) {
                route(b);
                consumed = true;
            } else {
                rem.push(b);
            }
        }
        if (consumed) {
            updates.set(sourceActor, rem);
        }
        */
    }
}

/**
 * Determines the appropriate icon for a bonus based on its type and value.
 * @param {object} bonus - The bonus data
 * @returns {string} The path to the SVG icon
 */
export function getBonusIcon(bonus) {
    const ACC = "systems/lancer/assets/icons/white/accuracy.svg";
    const DIFF = "systems/lancer/assets/icons/white/difficulty.svg";
    const RANGE = "systems/lancer/assets/icons/white/range.svg";
    const MELEE = "systems/lancer/assets/icons/white/melee.svg";
    const GENERIC = "systems/lancer/assets/icons/white/generic_item.svg";
    const IMMUNITY = "modules/lancer-automations/icons/immunity.svg";

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

    if (bonus.type === 'multi' && Array.isArray(bonus.bonuses)) {
        const counts = {};
        let maxCount = 0, maxType = null;
        for (const sub of bonus.bonuses) {
            counts[sub.type] = (counts[sub.type] || 0) + 1;
            if (counts[sub.type] > maxCount) {
                maxCount = counts[sub.type];
                maxType = sub.type;
            }
        }
        return getBonusIcon({ type: maxType });
    }

    const val = Number.parseInt(bonus.val) || 0;
    return val >= 0 ? ACC : DIFF;
}

function getFlowTags(flowType, state) {
    const tags = new Set(["all"]);
    const itemType = state.item?.system?.type?.toLowerCase();

    if (["attack", "basic_attack", "weapon_attack"].includes(flowType)) {
        tags.add("attack");
        if (itemType) {
            tags.add(itemType);
        }
    } else if (flowType === "tech_attack") {
        tags.add("attack");
        tags.add("tech_attack");
    } else if (flowType === "stat_roll") {
        tags.add("check");
        const path = state.data?.path?.toLowerCase() || "";
        ["hull", "agility", "systems", "engineering", "grit"].forEach(t => {
            if (path.includes(t) || path.includes(t.slice(0, 3))) {
                tags.add(t);
            }
        });
        if (state.actor?.is_npc && path.includes("tier")) {
            tags.add("tier");
        }
    } else if (["structure", "overheat", "damage"].includes(flowType)) {
        tags.add(flowType);
        if (flowType === "damage" && itemType) {
            tags.add(itemType);
        }
    }
    return tags;
}

export async function isBonusApplicable(bonus, flowTags, state) {
    if (bonus.rollTypes && Array.isArray(bonus.rollTypes) && bonus.rollTypes.length > 0) {
        const hasMatch = bonus.rollTypes.some(t => flowTags.has(t.toLowerCase()));
        if (!hasMatch)
            return false;
    }

    if (bonus.condition) {
        try {
            const context = bonus.context || {};
            let result;
            if (typeof bonus.condition === 'function') {
                result = await bonus.condition(state, state.actor, state.data, context);
            } else if (typeof bonus.condition === 'string' && bonus.condition.trim() !== '') {
                if (bonus.condition.startsWith('@@fn:')) {
                    const src = bonus.condition.slice('@@fn:'.length);
                    let fn = serializedConditionCache.get(src);
                    if (!fn) {
                        fn = new Function('state', 'actor', 'data', 'context',
                            `const api=game.modules.get('lancer-automations')?.api;` +
                            `const ownerTokenId=context?.ownerTokenId;` +
                            `const reactorToken=ownerTokenId` +
                            `?canvas.tokens.get(ownerTokenId)??canvas.tokens.placeables.find(t=>t.id===ownerTokenId)` +
                            `:null;` +
                            `return(${src})(state,actor,data,context);`
                        );
                        serializedConditionCache.set(src, fn);
                    }
                    result = await fn(state, state.actor, state.data, context);
                } else {
                    const fn = stringToAsyncFunction(bonus.condition, ['state', 'actor', 'data', 'context']);
                    result = await fn(state, state.actor, state.data, context);
                }
            }
            if (!result)
                return false;
        } catch (e) {
            console.warn("lancer-automations | Condition evaluation failed:", e);
            return false;
        }
    }

    if (bonus.itemLids && Array.isArray(bonus.itemLids) && bonus.itemLids.length > 0) {
        if (!state.item)
            return false;
        const itemLid = state.item.system?.lid;
        if (!itemLid || !bonus.itemLids.includes(itemLid))
            return false;
    }

    if (bonus.itemId) {
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
 * @param {object} state                - Flow state
 * @param {Function} getTargetedBonuses - Getter returning current targeted bonuses
 * @param {Set} disabledByUser          - Shared set of "${bonusId}:${tokenId}" keys for user-disabled bonuses
 */
function showBonusNotification(getBonuses, state, getTargetedBonuses, disabledByUser = new Set()) {
    // Persistent enabled state by bonus ID — survives mode switches (base ↔ target)
    const enabledById = new Map();

    const getCurrentBonusStates = () => {
        const currentBonuses = typeof getBonuses === 'function' ? getBonuses() : (getBonuses || []);
        return currentBonuses.map((b, index) => ({
            ...b,
            index,
            enabled: enabledById.has(b.id) ? enabledById.get(b.id) : true
        }));
    };

    const updateFlowAccuracy = (bonus, wasEnabled) => {
        let val = Number.parseInt(bonus.val) || 0;
        if (bonus.type === 'difficulty')
            val = -val;

        const $plusBtn = $('form#accdiff button[data-tooltip="Add global accuracy"]');
        const $minusBtn = $('form#accdiff button[data-tooltip="Add global difficulty"]');

        if ($plusBtn.length === 0 || $minusBtn.length === 0) {
            const $plusBtnAlt = $('form#accdiff button:has(.cci-accuracy)');
            const $minusBtnAlt = $('form#accdiff button:has(.cci-difficulty)');

            if ($plusBtnAlt.length > 0 && $minusBtnAlt.length > 0) {
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

        for (let i = 0; i < clickCount; i++) {
            $buttonToClick[0].click();
        }
    };

    const renderBonusRow = (bonus, index) => {
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

    const bindEvents = ($container) => {
        $container.find('.csm-bonus-checkbox').on('change', function() {
            const index = Number.parseInt($(this).data('index'));
            const bonusId = $(this).closest('label').data('bonus-id');
            const isChecked = $(this).is(':checked');
            const currentStates = getCurrentBonusStates();
            const bonus = currentStates[index];
            if (!bonus)
                return;
            const wasEnabled = enabledById.has(bonusId) ? enabledById.get(bonusId) : true;
            enabledById.set(bonusId, isChecked);
            $(this).parent().css('opacity', isChecked ? '1' : '0.5');
            updateFlowAccuracy(bonus, wasEnabled);
        });
    };

    const injectIntoCard = () => {
        const $form = $('form#accdiff');
        if ($form.length === 0)
            return false;

        const $accurateLabel = $form.find('label:contains("Accurate")').first();
        const $inaccurateLabel = $form.find('label:contains("Inaccurate")').first();

        const $accContainer = $accurateLabel.closest('div');
        const $diffContainer = $inaccurateLabel.closest('div');

        if ($accContainer.length > 0 && $diffContainer.length > 0) {
            // Only remove global rows — leave per-target rows untouched
            $form.find('.csm-global-bonus-row').remove();

            const bonusStates = getCurrentBonusStates();
            bonusStates.forEach((bonus, index) => {
                const val = Number.parseInt(bonus.val) || 0;
                if (val === 0)
                    return;

                const isDifficulty = bonus.type === 'difficulty' || val < 0;
                let $target = isDifficulty ? $diffContainer : $accContainer;

                const rowHtml = renderBonusRow(bonus, index);
                const $row = $(rowHtml);

                const $sibling = $target.find('label').first();
                if ($sibling.length > 0) {
                    const siblingClassStr = $sibling.attr('class') || '';
                    if (siblingClassStr)
                        $row.addClass(siblingClassStr);

                    const $siblingInput = $sibling.find('input').first();
                    const $myInput = $row.find('input').first();
                    if ($siblingInput.length > 0) {
                        const inputClassStr = $siblingInput.attr('class') || '';
                        if (inputClassStr)
                            $myInput.addClass(inputClassStr);
                    }

                    const $siblingSpan = $sibling.find('span').first();
                    const $mySpan = $row.find('span').first();
                    if ($siblingSpan.length > 0) {
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

    // Always watch for Svelte re-renders so we re-inject with the current effective list.
    // Disconnects when the dialog closes (form#accdiff removed), not on a fixed timer.
    let reinjectPending = false;
    const observer = new MutationObserver(() => {
        const $form = $('form#accdiff');
        if ($form.length === 0) {
            observer.disconnect();
            return;
        }
        if ($form.find('.csm-global-bonus-row').length === 0 && !reinjectPending) {
            reinjectPending = true;
            setTimeout(() => {
                injectIntoCard();
                reinjectPending = false;
            }, 50);
        }
    });

    const $hudzone = $('#hudzone');
    if ($hudzone.length > 0) {
        observer.observe($hudzone[0], { childList: true, subtree: true });
    } else {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Safety disconnect after 10 minutes (dialog should never live this long)
    setTimeout(() => observer.disconnect(), 600000);

    // Always set up per-target injection with the same getter so it re-evaluates on each re-injection
    injectTargetedAccuracyBonuses(getTargetedBonuses, state, disabledByUser);

    // Return injectIntoCard so replaceTargets monkey-patch can force a DOM rebuild on target changes
    return injectIntoCard;
}

/**
 * Inject per-target accuracy/difficulty bonus checkboxes into each matching target card
 * inside the accdiff dialog. Uses a MutationObserver so it works for both the initial
 * render and for target cards added mid-dialog.
 *
 * State is already pre-set (via flow step + replaceTargets monkey-patch), so no button
 * clicking is needed at injection time — only on user toggle.
 */
function injectTargetedAccuracyBonuses(getTargetedBonuses, state, disabledByUser) {
    /**
     * Click the per-target accuracy (+) or difficulty (-) button inside a target card.
     * @param {JQuery} $card   - The .accdiff-target card element
     * @param {string} type    - 'accuracy' or 'difficulty'
     * @param {number} count   - Number of times to click
     * @param {boolean} reverse - If true, click the opposite button
     */
    const clickTargetButton = ($card, type, count, reverse = false) => {
        // The two .accdiff-button elements in the card: first = accuracy, last = difficulty
        const $btns = $card.find('.accdiff-button');
        if ($btns.length < 2)
            return;
        const $accBtn = $btns.first();
        const $diffBtn = $btns.last();
        let $btn;
        if (type === 'difficulty') {
            $btn = reverse ? $accBtn : $diffBtn;
        } else {
            $btn = reverse ? $diffBtn : $accBtn;
        }
        for (let i = 0; i < count; i++)
            $btn[0]?.click();
    };

    const tryInjectTargeted = () => {
        const $form = $('form#accdiff');
        if ($form.length === 0)
            return false;

        const $allCards = $form.find('.accdiff-target');
        if ($allCards.length === 0)
            return false;

        // Re-evaluate current targeted bonuses each time (reflects mode switches)
        const targetedBonuses = typeof getTargetedBonuses === 'function' ? getTargetedBonuses() : (getTargetedBonuses || []);

        let injectedAny = false;

        for (const bonus of targetedBonuses) {
            const val = Number.parseInt(bonus.val) || 0;
            if (val === 0)
                continue;

            const isDiff = bonus.type === 'difficulty';
            const effectiveVal = isDiff ? -Math.abs(val) : val;
            const valText = (effectiveVal > 0 ? '+' : '') + effectiveVal;
            const usesText = bonus.uses !== undefined ? ` (${bonus.uses} left)` : '';
            const targetName = bonus._targetName || null;

            // Separate cards into matching and non-matching for this bonus
            const matchingCards = [];
            const nonMatchingCards = [];
            $allCards.each(function() {
                const $card = $(this);
                let matchedTokenId = null;
                for (const tokenId of (bonus.applyTo || [])) {
                    if ($card.find(`label.target-name[for="${tokenId}"]`).length > 0) {
                        matchedTokenId = tokenId;
                        break;
                    }
                    if (targetName) {
                        const hasName = $card.find('label.target-name').filter(function() {
                            return $(this).find('span').first().text().trim() === targetName;
                        }).length > 0;
                        if (hasName) {
                            matchedTokenId = tokenId;
                            break;
                        }
                    }
                }
                if (matchedTokenId !== null) {
                    matchingCards.push({ $card, matchedTokenId });
                } else {
                    nonMatchingCards.push($card);
                }
            });

            // Only proceed if at least one card matches this bonus
            if (matchingCards.length === 0)
                continue;

            // Inject real checkbox into matching cards
            for (const { $card, matchedTokenId } of matchingCards) {
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
                if ($siblingLabel.length) {
                    $row.addClass($siblingLabel.attr('class') || '');
                    $row.addClass(guardClass);
                    $row.find('input').addClass($siblingLabel.find('input').attr('class') || '');
                    $row.find('span').addClass($siblingLabel.find('span').attr('class') || '');
                }

                $body.append($row);
                injectedAny = true;

                const capturedTokenId = matchedTokenId;
                $row.find('.csm-tgt-bonus-checkbox').on('change', function() {
                    const checked = $(this).is(':checked');
                    const key = `${bonus.id}:${capturedTokenId}`;
                    if (checked) {
                        disabledByUser.delete(key);
                        clickTargetButton($card, bonus.type, val, false);
                    } else {
                        disabledByUser.add(key);
                        clickTargetButton($card, bonus.type, val, true);
                    }
                    $(this).closest('label').css('opacity', checked ? '1' : '0.5');
                });
            }

            // Inject invisible placeholders into non-matching cards to keep heights equal
            for (const $card of nonMatchingCards) {
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
                if ($siblingLabel.length) {
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

    // Observer for dynamic target changes
    const $form = $('form#accdiff');
    const observeTarget = $form.length > 0 ? $form[0] : document.body;
    const observer = new MutationObserver(() => {
        if ($('form#accdiff').length === 0) {
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
function showDamageBonusNotification(bonuses, state, targetedBonuses = []) {
    const bonusStates = bonuses.map((b, index) => ({
        ...b,
        index,
        enabled: true
    }));

    const renderBonusRow = (bonus, index) => {
        const usesText = bonus.uses !== undefined ? ` (${bonus.uses} left)` : '';
        const isEnabled = bonus.enabled;

        const damageComponents = (bonus.damage || []).map(d => {
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

    const syncBonusToForm = async (bonusState, $bonusSection, $addBtn) => {
        const bonusIdClass = `csm-bonus-controlled-${bonusState.index}`;
        const $existingRows = $bonusSection.find(`.${bonusIdClass}`);

        if (bonusState.enabled) {
            if ($existingRows.length === 0) {
                const damages = bonusState.damage || [];
                for (const d of damages) {
                    $addBtn.click();
                    await new Promise(r => setTimeout(r, 100));
                    const $valInputs = $bonusSection.find('input[type="text"][placeholder="0"], input[type="number"]');
                    const $lastValInput = $valInputs.last();

                    const $rowContainer = $lastValInput.closest('.flexrow, .damage-grid-item, div');

                    if ($rowContainer.length > 0 && !$rowContainer.hasClass(bonusIdClass)) {
                        $rowContainer.addClass(bonusIdClass);
                        $rowContainer.addClass('csm-hidden-bonus-row');
                        $rowContainer.css('display', 'none');

                        $lastValInput.val(d.val);
                        $lastValInput[0].dispatchEvent(new Event('input', { bubbles: true }));
                        $lastValInput[0].dispatchEvent(new Event('change', { bubbles: true }));

                        const $select = $rowContainer.find('select');
                        if ($select.length > 0) {
                            $select.find('option').each(function() {
                                if ($(this).text().toLowerCase() === d.type.toLowerCase() ||
                                         $(this).val().toLowerCase() === d.type.toLowerCase()) {
                                    $select.val($(this).val());
                                    return false;
                                }
                            });
                            $select[0].dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                }
            }
        } else {
            $existingRows.each(function() {
                const $deleteBtn = $(this).find('button.delete, i.fa-trash, i.mdi-delete, button i.mdi-delete').closest('button');
                if ($deleteBtn.length > 0) {
                    $deleteBtn.click();
                } else {
                    $(this).remove(); // Fallback
                }
            });
        }
    };

    const doInject = ($form, resolvedTargeted, targetCount) => {
        const $configGrid = $form.find('.damage-hud-options-grid');
        if ($configGrid.length === 0)
            return false;

        let perCardBonuses = [];
        if (resolvedTargeted.length > 0) {
            if (targetCount <= 1) {
                resolvedTargeted.forEach(bonus => {
                    bonusStates.push({ ...bonus, _fromTargeted: true, index: bonusStates.length, enabled: true });
                });
            } else {
                perCardBonuses = resolvedTargeted;
            }
        }

        let $myContainer = $configGrid.find('.csm-bonus-container');
        if ($myContainer.length === 0) {
            $myContainer = $('<div class="csm-bonus-container" style="grid-column: 1 / -1; border-top: 1px solid var(--primary-light); margin-top: 5px; padding-top: 5px;"></div>');
            $myContainer.append('<h3 class="damage-hud-section lancer-border-primary svelte-1tnd08e" style="font-size: 0.9em; margin-bottom: 5px;">Global Bonuses</h3>');
            $configGrid.append($myContainer);

            setTimeout(() => {
                bonusStates.forEach(b => {
                    const $bonusSection = $form.find('.bonus-damage');
                    const $addBtn = $bonusSection.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
                    if ($addBtn.length > 0)
                        syncBonusToForm(b, $bonusSection, $addBtn);
                });
            }, 200);
        } else {
            $myContainer.find('.csm-bonus-config-row').remove();
        }

        bonusStates.forEach((bonus, index) => {
            const $row = $(renderBonusRow(bonus, index));
            $myContainer.append($row);
        });

        $myContainer.toggle(bonusStates.length > 0);

        $myContainer.find('.csm-bonus-checkbox').on('change', function() {
            const index = Number.parseInt($(this).data('index'));
            const isChecked = $(this).is(':checked');
            bonusStates[index].enabled = isChecked;

            const $bonusSection = $form.find('.bonus-damage');
            const $addBtn = $bonusSection.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
            if ($addBtn.length > 0)
                syncBonusToForm(bonusStates[index], $bonusSection, $addBtn);

            const $row = $(this).closest('.csm-bonus-config-row');
            $row.find('.csm-bonus-value').css('opacity', isChecked ? '0.9' : '0.5');
        });

        if (perCardBonuses.length > 0)
            injectTargetedDamageBonuses(perCardBonuses, $form, state.data.damage_hud_data.targets);

        return true;
    };

    let prevTargetSig = (state.data?.damage_hud_data?.targets || []).map(t => t.target?.id).sort().join(',');
    let reinjectPending = false;

    const observer = new MutationObserver(() => {
        const $form = $('#damage-hud');
        if ($form.length === 0) {
            observer.disconnect();
            return;
        }

        const hudData = state.data?.damage_hud_data;
        if (!hudData) {
            return;
        }

        const currentTargets = hudData.targets || [];
        const sig = currentTargets.map(t => t.target?.id).sort().join(',');
        const hasContainer = $form.find('.csm-bonus-container').length > 0;
        const targetCount = currentTargets.length;
        const cardsFound = $form.find('.damage-hud-target-card').length;

        // Wait for cards to populate if there are multiple targets
        if (targetCount > 1 && cardsFound < targetCount) {
            return;
        }

        if (sig === prevTargetSig && hasContainer && !reinjectPending) {
            return;
        }

        if (reinjectPending) {
            return;
        }
        reinjectPending = true;

        setTimeout(() => {
            const refreshedForm = $('#damage-hud');
            if (refreshedForm.length === 0) {
                reinjectPending = false;
                return;
            }

            // Signature change logic
            if (sig !== prevTargetSig) {
                prevTargetSig = sig;
                // Clear per-card injections
                targetedBonuses.forEach(bonus => {
                    const gc = `csm-tgt-dmg-${(bonus.id || bonus.name).replace(/[^a-z0-9]/gi, '-')}`;
                    refreshedForm.find(`.${gc}`).remove();
                });
                refreshedForm.find('.damage-hud-target-card [class*="csm-tgt-dmg-ctrl-"]').each(function() {
                    const $del = $(this).find('button').first();
                    if ($del.length) {
                        $del.click();
                    } else {
                        $(this).remove();
                    }
                });

                // Remove targeted bonuses from bonusStates and their global damage entries
                for (let i = bonusStates.length - 1; i >= 0; i--) {
                    if (!bonusStates[i]._fromTargeted) {
                        continue;
                    }
                    const b = bonusStates[i];
                    b.enabled = false;
                    const $bs = refreshedForm.find('.bonus-damage');
                    const $addBtn = $bs.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
                    if ($addBtn.length > 0) {
                        syncBonusToForm(b, $bs, $addBtn);
                    }
                    bonusStates.splice(i, 1);
                }
                bonusStates.forEach((b, i) => {
                    b.index = i;
                });
            }

            const newResolved = targetedBonuses.map(bonus => {
                const ht = currentTargets.find(ht => (bonus.applyTo || []).includes(ht.target?.id));
                return ht ? { ...bonus } : null;
            }).filter(Boolean);

            doInject(refreshedForm, newResolved, targetCount);
            reinjectPending = false;
        }, 50);
    });

    const $hudzone = $('#hudzone');
    if ($hudzone.length > 0) {
        observer.observe($hudzone[0], { childList: true, subtree: true });
    } else {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Safety disconnect after 10 minutes
    setTimeout(() => observer.disconnect(), 600000);

    return bonusStates;
}

/**
 * Inject per-target damage bonus checkboxes into each matching target card in the damage HUD.
 * Card order in DOM matches damage_hud_data.targets order — matched by index.
 */
async function injectTargetedDamageBonuses(targetedBonuses, $form, hudTargets) {
    if (!document.getElementById('csm-bonus-styles')) {
        $('<style id="csm-bonus-styles">.target-bonus-damage-wrapper:not(:has(:not(.csm-hidden-bonus-row))){display:none!important}</style>')
            .appendTo('head');
    }

    $form.find('.damage-hud-target-card').each(function(cardIndex) {
        const $card = $(this);
        const tokenId = hudTargets[cardIndex]?.target?.id;
        if (!tokenId)
            return;

        const matchingBonuses = targetedBonuses.filter(b => (b.applyTo || []).includes(tokenId));
        if (!matchingBonuses.length)
            return;

        const $bonusSection = $card.find('.target-bonus-damage');
        if (!$bonusSection.length)
            return;

        matchingBonuses.forEach((bonus, localIdx) => {
            const guardClass = `csm-tgt-dmg-${(bonus.id || bonus.name).replace(/[^a-z0-9]/gi, '-')}`;
            if ($card.find(`.${guardClass}`).length > 0)
                return; // already injected

            const usesText = bonus.uses !== undefined ? ` (${bonus.uses} left)` : '';
            const damageComponents = (bonus.damage || []).map(d => {
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

            // Visual row goes after the AP/Paracausal/Half-damage config row
            $card.find('.damage-target-config').after($row);

            // Track enabled state per row
            let enabled = true;
            const bonusIdClass = `csm-tgt-dmg-ctrl-${guardClass}-${localIdx}`;

            const syncToCard = async (enable) => {
                const $addBtn = $bonusSection.find('.add-damage-type');
                if (!$addBtn.length)
                    return;

                const $existing = $bonusSection.find(`.${bonusIdClass}`);

                if (enable && $existing.length === 0) {
                    for (const d of (bonus.damage || [])) {
                        $addBtn.click();
                        await new Promise(r => setTimeout(r, 50));
                        const $valInputs = $bonusSection.find('input[type="text"],input[type="number"]');
                        const $lastVal = $valInputs.last();
                        const $rowContainer = $lastVal.closest('.flexrow, .damage-grid-item, div');
                        if ($rowContainer.length && !$rowContainer.hasClass(bonusIdClass)) {
                            $rowContainer.addClass(bonusIdClass).addClass('csm-hidden-bonus-row').css('display', 'none');
                            $lastVal.val(d.val);
                            $lastVal[0].dispatchEvent(new Event('input', { bubbles: true }));
                            $lastVal[0].dispatchEvent(new Event('change', { bubbles: true }));
                            const $select = $rowContainer.find('select');
                            if ($select.length) {
                                $select.find('option').each(function() {
                                    if ($(this).text().toLowerCase() === d.type.toLowerCase()) {
                                        $select.val($(this).val()); return false;
                                    }
                                });
                                $select[0].dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    }
                } else if (!enable) {
                    $existing.each(function() {
                        const $del = $(this).find('button').first();
                        if ($del.length)
                            $del.click(); else
                            $(this).remove();
                    });
                }
            };

            // Apply immediately
            setTimeout(() => syncToCard(true), 200);

            $row.find('.csm-tgt-dmg-checkbox').on('change', function() {
                enabled = $(this).is(':checked');
                $(this).closest('label').css('opacity', enabled ? '1' : '0.5');
                syncToCard(enabled);
            });
        });
    });
}

/**
 * Inject a Knockback checkbox into the damage HUD options grid.
 * Pre-fills from the weapon's knockback tag if present; otherwise unchecked but visible.
 * Stores the enabled/value state on state.data._csmKnockback for the knockback damage step.
 */
export function injectKnockbackCheckbox(state) {
    if (!state.data)
        state.data = {};

    // Read weapon tag to pre-fill
    const item = state.item;
    const tags = state.data?.tags || item?.system?.tags || [];
    const kbTag = tags.find(t => t.id === "knockback" || t.lid === "tg_knockback");
    const hasTag = !!kbTag;
    let tagVal = hasTag ? (Number.parseInt(kbTag.val) || Number.parseInt(kbTag.num_val) || 1) : 1;

    // Shared state that the knockbackDamageStep will read
    state.data._csmKnockback = { enabled: hasTag, value: tagVal };

    const doInject = () => {
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
        if (currentAreas && currentAreas.includes('empty')) {
            $configGrid.css('grid-template-areas', currentAreas.replace('empty', 'knockback'));
        } else {
            $configGrid.css('grid-template-areas',
                '"title title" "ap overkill" "paracausal reliable" "halfdamage knockback"'
            );
        }

        const checked = state.data._csmKnockback.enabled;
        const val = state.data._csmKnockback.value;

        // Build the HTML matching the Reliable checkbox pattern
        const $row = $(`
            <div class="csm-knockback-row" style="grid-area: knockback; display: flex; align-items: center; gap: 4px;">
                <label class="container svelte-wt0sk2" style="max-width: fit-content; padding-right: 0.5em; cursor: pointer;">
                    <input type="checkbox" class="csm-knockback-checkbox svelte-wt0sk2" ${checked ? 'checked' : ''}>
                    <i class="mdi mdi-arrow-expand-all i--s svelte-wt0sk2"></i>
                    <span style="text-wrap: nowrap;">Knockback</span>
                </label>
                <input class="csm-knockback-value reliable-value svelte-1tnd08e"
                       type="number" value="${val}" min="1"
                       style="width: 3em; ${checked ? '' : 'display:none;'}">
            </div>
        `);

        $configGrid.append($row);

        // Bind checkbox toggle
        $row.find('.csm-knockback-checkbox').on('change', function () {
            const isChecked = $(this).is(':checked');
            state.data._csmKnockback.enabled = isChecked;
            $row.find('.csm-knockback-value').toggle(isChecked);
        });

        // Bind value input
        $row.find('.csm-knockback-value').on('input change', function () {
            state.data._csmKnockback.value = Number.parseInt(String($(this).val())) || 1;
        });

        return true;
    };

    // Try immediately
    doInject();

    // MutationObserver to re-inject on Svelte re-renders
    let reinjectPending = false;
    const observer = new MutationObserver(() => {
        const $form = $('#damage-hud');
        if ($form.length === 0) {
            observer.disconnect();
            return;
        }
        if ($form.find('.csm-knockback-row').length === 0 && !reinjectPending) {
            reinjectPending = true;
            setTimeout(() => {
                doInject();
                reinjectPending = false;
            }, 50);
        }
    });

    const $hudzone = $('#hudzone');
    if ($hudzone.length > 0) {
        observer.observe($hudzone[0], { childList: true, subtree: true });
    } else {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Safety disconnect after 10 minutes
    setTimeout(() => observer.disconnect(), 600000);
}

/**
 * Inject a "No Bonus Dmg" checkbox into the damage HUD options grid.
 * Pre-fills from item flag lancer-automations.noBonusDmg; default false.
 * When checked, crosses out .bonus-damage and .csm-bonus-container visually.
 * Actual suppression is handled by noBonusDmgClearStep in main.js.
 */
export function injectNoBonusDmgCheckbox(state) {
    if (!state.data)
        state.data = {};

    state.la_extraData = state.la_extraData || {};

    if (!state.la_extraData._csmNoBonusDmg?.enabled) {
        const hasFlag = !!(state.item?.getFlag('lancer-automations', 'noBonusDmg'));
        state.la_extraData._csmNoBonusDmg = { enabled: hasFlag };
    }

    const applyStrikethrough = ($form) => {
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

    const doInject = () => {
        const $form = $('#damage-hud');
        if ($form.length === 0)
            return false;

        const $configGrid = $form.find('.damage-hud-options-grid');
        if ($configGrid.length === 0)
            return false;

        if ($configGrid.find('.csm-no-bonus-dmg-row').length > 0) {
            applyStrikethrough($form);
            return true;
        }

        const currentAreas = $configGrid.css('grid-template-areas') || '';
        if (currentAreas.includes('empty')) {
            $configGrid.css('grid-template-areas', currentAreas.replace('empty', 'nobonusdmg'));
        } else {
            $configGrid.css('grid-template-areas', currentAreas + ' "nobonusdmg nobonusdmg"');
        }

        const checked = state.la_extraData._csmNoBonusDmg.enabled;

        const $row = $(`
            <div class="csm-no-bonus-dmg-row" style="grid-area: nobonusdmg; display: flex; align-items: center; margin-top: 4px;">
                <label class="container svelte-wt0sk2" style="max-width: fit-content; padding-right: 0.5em; cursor: pointer;">
                    <input type="checkbox" class="csm-no-bonus-dmg-checkbox svelte-wt0sk2" ${checked ? 'checked' : ''}>
                    <i class="mdi mdi-cancel i--s svelte-wt0sk2"></i>
                    <span style="text-wrap: nowrap;">No Bonus Dmg</span>
                </label>
            </div>
        `);

        $configGrid.append($row);
        applyStrikethrough($form);

        $row.find('.csm-no-bonus-dmg-checkbox').on('change', function () {
            state.la_extraData._csmNoBonusDmg.enabled = $(this).is(':checked');
            applyStrikethrough($form);
        });

        return true;
    };

    doInject();

    let reinjectPending = false;
    const observer = new MutationObserver(() => {
        const $form = $('#damage-hud');
        if ($form.length === 0) {
            observer.disconnect();
            return;
        }
        if ($form.find('.csm-no-bonus-dmg-row').length === 0 && !reinjectPending) {
            reinjectPending = true;
            setTimeout(() => {
                doInject();
                reinjectPending = false;
            }, 50);
        } else if (state.la_extraData._csmNoBonusDmg.enabled) {
            applyStrikethrough($form);
        }
    });

    const $hudzone = $('#hudzone');
    if ($hudzone.length > 0) {
        observer.observe($hudzone[0], { childList: true, subtree: true });
    } else {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    setTimeout(() => observer.disconnect(), 600000);
}

export const genericAccuracyStepAttack = createGenericBonusStep("attack");
export const genericAccuracyStepTechAttack = createGenericBonusStep("tech_attack");
export const genericAccuracyStepWeaponAttack = createGenericBonusStep("weapon_attack");
export const genericAccuracyStepStatRoll = createGenericBonusStep("stat_roll");
export const genericBonusStepDamage = createGenericBonusStep("damage");

export async function addGlobalBonus(actor, bonusData, options = {}) {
    if (!actor)
        return;
    const bonuses = duplicate(actor.getFlag("lancer-automations", "global_bonuses") || []);

    if (!bonusData.id)
        bonusData.id = foundry.utils.randomID();
    if (!bonusData.name)
        bonusData.name = "Unnamed Bonus";

    // Lambda condition support — serialize function source into the condition field
    if (typeof bonusData.condition === 'function') {
        bonusData = { ...bonusData, condition: '@@fn:' + bonusData.condition.toString() };
    }

    // Also handle lambda conditions on sub-bonuses (multi type)
    if (bonusData.type === 'multi' && Array.isArray(bonusData.bonuses)) {
        bonusData = {
            ...bonusData,
            bonuses: bonusData.bonuses.map(sub => {
                if (typeof sub.condition !== 'function')
                    return sub;
                return { ...sub, condition: '@@fn:' + sub.condition.toString() };
            })
        };
    }

    const existingIdx = bonuses.findIndex(b => b.id === bonusData.id);
    if (existingIdx !== -1) {
        bonuses[existingIdx] = bonusData;
    } else {
        bonuses.push(bonusData);
    }

    await delegateSetActorFlag(actor, "lancer-automations", "global_bonuses", bonuses);

    if (options.duration) {
        const token = actor.token?.object || canvas.tokens.placeables.find(t => t.actor?.id === actor.id);

        if (token) {
            let durationObj = { label: 'indefinite', turns: null, rounds: null };

            if (options.duration !== 'indefinite' && game.combat) {
                const turnsVal = options.durationTurns || 1;
                durationObj = {
                    label: options.duration || 'end',
                    turns: turnsVal,
                    rounds: 0
                };
                // Adjust if it's currently the origin's turn
                const originId = options.origin?.id || options.origin || token.id;
                if (game.combat?.current?.tokenId === originId) {
                    durationObj.turns = turnsVal + 1;
                }
            }

            const icon = getBonusIcon(bonusData);

            const extraOptions = { linkedBonusId: bonusData.id };

            // Stack = uses count (statuscounter.value is the single counter)
            if (bonusData.uses)
                extraOptions.stack = bonusData.uses;

            // If consumption trigger is configured, attach it (no 'uses' — stack handles that)
            if (options.consumption?.trigger) {
                extraOptions.consumption = {
                    trigger: options.consumption.trigger,
                    originId: options.consumption.originId || token.id,
                    groupId: options.consumption.groupId || null,
                    evaluate: options.consumption.evaluate || null,
                    itemLid: options.consumption.itemLid || null,
                    itemId: options.consumption.itemId || null,
                    actionName: options.consumption.actionName || null,
                    isBoost: options.consumption.isBoost ?? null,
                    minDistance: options.consumption.minDistance ?? null,
                    checkType: options.consumption.checkType || null,
                    checkAbove: options.consumption.checkAbove ?? null,
                    checkBelow: options.consumption.checkBelow ?? null
                };
            }

            if (bonusData.type === 'stat' && bonusData.stat) {
                if (CURRENT_RESOURCE_STATS.has(bonusData.stat)) {
                    // Direct modification for current resources - stored in flags for manual reversal
                    // (AE changes don't work here because Foundry re-applies them after damage/healing)
                    extraOptions.statDirect = {
                        key: bonusData.stat,
                        value: Number.parseInt(bonusData.val) || 0,
                        preBonusValue: foundry.utils.getProperty(token.actor, bonusData.stat) || 0
                    };
                } else {
                    // Use ActiveEffect changes for max/flat stats (Foundry auto-applies/reverses)
                    extraOptions.changes = [{
                        key: bonusData.stat,
                        value: String(Number.parseInt(bonusData.val) || 0),
                        mode: CONST.ACTIVE_EFFECT_MODES.ADD
                    }];
                }
            }

            if (bonusData.type === 'immunity' && bonusData.subtype === 'resistance' && bonusData.damageTypes) {
                if (!extraOptions.changes) {
                    extraOptions.changes = [];
                }
                const resTypes = bonusData.damageTypes;
                for (const rt of resTypes) {
                    const lcType = rt.toLowerCase().trim();
                    if (lcType) {
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
                },
                extraOptions
            );

            // Apply direct stat modification for current resources (after effect is created)
            if (extraOptions.statDirect) {
                let newVal = extraOptions.statDirect.preBonusValue + extraOptions.statDirect.value;
                newVal = Math.max(0, newVal);
                // Clamp to max if applicable (e.g., hp.value can't exceed hp.max)
                const maxPath = extraOptions.statDirect.key.replace('.value', '.max');
                if (maxPath !== extraOptions.statDirect.key) {
                    const maxVal = foundry.utils.getProperty(token.actor, maxPath);
                    if (maxVal !== undefined)
                        newVal = Math.min(newVal, maxVal);
                }
                await token.actor.update({ [extraOptions.statDirect.key]: newVal });
            }
        }
    }

    return bonusData.id;
}

/**
 * @param {string|function(bonuses): boolean} bonusIdOrPredicate - Bonus ID string, or a predicate
 *   to remove all matching bonuses in a single flag update.
 */
export async function removeGlobalBonus(actor, bonusIdOrPredicate, skipEffectRemoval = false) {
    if (!actor)
        return;
    let bonuses = duplicate(actor.getFlag("lancer-automations", "global_bonuses") || []);
    const initialLength = bonuses.length;

    const predicate = typeof bonusIdOrPredicate === 'function'
        ? bonusIdOrPredicate
        : b => b.id === bonusIdOrPredicate;

    const bonusesToRemove = bonuses.filter(predicate);
    bonuses = bonuses.filter(b => !predicate(b));



    if (bonuses.length !== initialLength) {
        await delegateSetActorFlag(actor, "lancer-automations", "global_bonuses", bonuses);

        if (!skipEffectRemoval && bonusesToRemove.length > 0) {
            const token = actor.token?.object || canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
            if (token && token.actor) {
                const removedIds = new Set(bonusesToRemove.map(b => b.id));
                const linkedEffects = token.actor.effects.filter(e =>
                    removedIds.has(e.getFlag('lancer-automations', 'linkedBonusId'))
                );
                for (const e of linkedEffects)
                    await e.delete();
            }
        }

        return true;
    }
    return false;
}

export function getGlobalBonuses(actor) {
    return actor ? (actor.getFlag("lancer-automations", "global_bonuses") || []) : [];
}

export function getGlobalBonus(actor, bonusId) {
    if (!actor)
        return null;
    const bonuses = actor ? (actor.getFlag("lancer-automations", "global_bonuses") || []) : [];
    return bonuses.find(b => b.id === bonusId) || null;
}

Hooks.on("deleteActiveEffect", (effect) => {
    const linkedBonusId = effect.getFlag("lancer-automations", "linkedBonusId");
    if (linkedBonusId && effect.parent) {
        // skipEffectRemoval=true because the effect is already being deleted
        removeGlobalBonus(effect.parent, linkedBonusId, true);
    }

    // Reverse direct stat modification for current resource bonuses
    const statDirect = effect.getFlag('lancer-automations', 'statDirect');
    if (statDirect && effect.parent) {
        setTimeout(async () => {
            const actor = effect.parent;
            if (!actor)
                return;
            const currentVal = foundry.utils.getProperty(actor, statDirect.key) || 0;
            let newVal;

            if (statDirect.value > 0) {
                // Positive bonus: only remove what's left of the bonus (damage may have consumed it)
                // remainingBonus = how much of our bonus is still present above the pre-bonus baseline
                const remainingBonus = Math.max(0, Math.min(statDirect.value, currentVal - (statDirect.preBonusValue || 0)));
                newVal = currentVal - remainingBonus;
            } else {
                // Negative bonus: give back full amount, clamp to max
                newVal = currentVal - statDirect.value;
            }

            newVal = Math.max(0, newVal);
            // Clamp to max if applicable (e.g., hp.value can't exceed hp.max)
            const maxPath = statDirect.key.replace('.value', '.max');
            if (maxPath !== statDirect.key) {
                const maxVal = foundry.utils.getProperty(actor, maxPath);
                if (maxVal !== undefined)
                    newVal = Math.min(newVal, maxVal);
            }
            await actor.update({ [statDirect.key]: newVal });
        }, 200);
    }

    // Clamp .value when a .max stat bonus is reversed by Foundry
    const maxChanges = (effect.changes || []).filter(c =>
        c.key?.endsWith('.max') && c.mode === CONST.ACTIVE_EFFECT_MODES.ADD
    );
    if (maxChanges.length > 0 && effect.parent) {
        setTimeout(async () => {
            const actor = effect.parent;
            if (!actor)
                return;
            const updates = {};
            for (const change of maxChanges) {
                const valuePath = change.key.replace('.max', '.value');
                const newMax = foundry.utils.getProperty(actor, change.key);
                const currentValue = foundry.utils.getProperty(actor, valuePath);
                if (currentValue !== undefined && newMax !== undefined && currentValue > newMax) {
                    updates[valuePath] = newMax;
                }
            }
            if (Object.keys(updates).length > 0) {
                await actor.update(updates);
            }
        }, 200);
    }
});


/**
 * Inject a bonus to the active flow state.
 * @param {Object} state - The flow state object
 * @param {Object} bonus - The bonus to inject
 */
export async function injectBonusToFlowState(state, bonus) {
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

export async function addConstantBonus(actor, bonusData) {
    if (!actor)
        return;
    const bonuses = duplicate(actor.getFlag("lancer-automations", "constant_bonuses") || []);
    if (!bonusData.id)
        bonusData.id = foundry.utils.randomID();

    // If condition is a function, serialize its source into the condition field so it survives reloads.
    if (typeof bonusData.condition === 'function') {
        bonusData = { ...bonusData, condition: '@@fn:' + bonusData.condition.toString() };
    }

    const existingIndex = bonuses.findIndex(b => b.id === bonusData.id);
    if (existingIndex >= 0)
        bonuses[existingIndex] = bonusData;
    else
        bonuses.push(bonusData);
    await delegateSetActorFlag(actor, "lancer-automations", "constant_bonuses", bonuses);
}

export function getConstantBonuses(actor) {
    if (!actor)
        return [];
    return actor.getFlag("lancer-automations", "constant_bonuses") || [];
}

/**
 * Remove constant bonus(es) from an actor.
 * @param {Actor} actor
 * @param {string|function(bonuses): boolean} bonusIdOrPredicate - Bonus ID string to remove one,
 *   or a predicate function to remove all matching bonuses in a single flag update.
 */
export async function removeConstantBonus(actor, bonusIdOrPredicate) {
    if (!actor)
        return;
    const bonuses = duplicate(actor.getFlag("lancer-automations", "constant_bonuses") || []);
    const predicate = typeof bonusIdOrPredicate === 'function'
        ? bonusIdOrPredicate
        : b => b.id === bonusIdOrPredicate;
    const filtered = bonuses.filter(b => !predicate(b));
    if (filtered.length !== bonuses.length) {
        await delegateSetActorFlag(actor, "lancer-automations", "constant_bonuses", filtered);
    }
}

export function executeGenericBonusMenu(actor = null) {
    executeEffectManager({ initialTab: 'bonus', actor });
}

export function getImmunityBonuses(actor, subtype, state = null) {
    if (!actor) {
        return [];
    }

    const constants = actor.getFlag("lancer-automations", "constant_bonuses") || [];
    const globals = actor.getFlag("lancer-automations", "global_bonuses") || [];
    const ephemerals = actor.getFlag("lancer-automations", "ephemeral_bonuses") || [];
    const flowBonuses = state?.la_extraData?.flow_bonus || [];

    return flattenBonuses([...constants, ...globals, ...ephemerals, ...flowBonuses]).filter(b => b.type === "immunity" && b.subtype === subtype);
}

export function checkEffectImmunities(actor, effectIdOrName, effect = null, state = null) {
    if (!actor || !effectIdOrName) {
        return [];
    }

    const effectImmunities = getImmunityBonuses(actor, "effect", state);
    const matchedSources = [];

    const incomingLower = effectIdOrName.toLowerCase();
    const incomingTail = incomingLower.split('.').pop();

    for (const b of effectImmunities) {
        if (!b.effects || !Array.isArray(b.effects)) {
            continue;
        }

        const isImmune = b.effects.some(immuneName => {
            const immuneLower = immuneName.toLowerCase();
            const immuneTail = immuneLower.split('.').pop();

            // 1. Exact string matches
            if (immuneLower === incomingLower || immuneTail === incomingTail) {
                return true;
            }

            // 2. Inclusion checks (handles path-based vs simple names)
            if (immuneLower.includes(incomingTail) || incomingLower.includes(immuneTail)) {
                return true;
            }

            // 3. If ActiveEffect is provided, check its native statuses and flags
            if (effect) {
                if (effect.statuses?.has(immuneTail) || effect.statuses?.has(immuneLower)) {
                    return true;
                }

                const flagName = effect.getFlag('lancer-automations', 'effect') || (game.modules.get('csm-lancer-qol')?.active ? effect.getFlag('csm-lancer-qol', 'effect') : null);
                if (flagName) {
                    const flagLower = flagName.toLowerCase();
                    if (flagLower === immuneLower || flagLower.includes(immuneTail)) {
                        return true;
                    }
                }
            }

            return false;
        });

        if (isImmune) {
            matchedSources.push(b.source || b.name || "Unknown Immunity");
        }
    }

    return matchedSources;
}

export function checkDamageResistances(actor, damageType) {
    if (!actor || !damageType) {
        return [];
    }
    const resistanceBonuses = getImmunityBonuses(actor, "resistance");
    const incomingLower = damageType.toLowerCase();

    return resistanceBonuses
        .filter(b => b.damageTypes && b.damageTypes.some(t => t.toLowerCase() === incomingLower || t.toLowerCase() === "variable" || t.toLowerCase() === "all"))
        .map(b => b.source || b.name || "Unknown Resistance");
}

export function applyDamageImmunities(actor, damages, state = null) {
    if (!actor || !damages) {
        return damages;
    }

    const damageImmunities = getImmunityBonuses(actor, "damage", state);
    if (damageImmunities.length === 0) {
        return damages;
    }

    const immuneTypes = new Set();
    for (const b of damageImmunities) {
        if (b.damageTypes) {
            b.damageTypes.forEach(t => immuneTypes.add(t.toLowerCase()));
        }
    }

    return damages.map(d => {
        if (immuneTypes.has(d.type.toLowerCase())) {
            const newD = { ...d };
            if (newD.val !== undefined) {
                newD.val = 0;
            }
            if (newD.amount !== undefined) {
                newD.amount = 0;
            }
            return newD;
        }
        return d;
    });
}

export async function hasCritImmunity(actor, attackerActor = null, state = null) {
    if (!actor)
        return false;
    const candidates = getImmunityBonuses(actor, "crit", state);
    if (candidates.length === 0)
        return false;
    if (!attackerActor)
        return true;
    const attackerState = state ? { ...state, actor: attackerActor } : { actor: attackerActor };
    for (const b of candidates) {
        if (await isBonusApplicable(b, new Set(), attackerState))
            return true;
    }
    return false;
}

export async function hasHitImmunity(actor, attackerActor = null, state = null) {
    if (!actor)
        return false;
    const candidates = getImmunityBonuses(actor, "hit", state);
    if (candidates.length === 0)
        return false;
    if (!attackerActor)
        return true;
    const attackerState = state ? { ...state, actor: attackerActor } : { actor: attackerActor };
    for (const b of candidates) {
        if (await isBonusApplicable(b, new Set(), attackerState))
            return true;
    }
    return false;
}

export async function hasMissImmunity(actor, attackerActor = null, state = null) {
    if (!actor)
        return false;
    const candidates = getImmunityBonuses(actor, "miss", state);
    if (candidates.length === 0)
        return false;
    if (!attackerActor)
        return true;
    const attackerState = state ? { ...state, actor: attackerActor } : { actor: attackerActor };
    for (const b of candidates) {
        if (await isBonusApplicable(b, new Set(), attackerState))
            return true;
    }
    return false;
}


export const BonusesAPI = {
    addGlobalBonus,
    removeGlobalBonus,
    getGlobalBonuses,
    addConstantBonus,
    removeConstantBonus,
    getConstantBonuses,
    executeGenericBonusMenu,
    getImmunityBonuses,
    checkEffectImmunities,
    applyDamageImmunities,
    hasCritImmunity,
    hasHitImmunity,
    hasMissImmunity
};
