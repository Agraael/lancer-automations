import { applyFlaggedEffectToTokens } from "./flagged-effects.js";
import { executeEffectManager } from "./effectManager.js";
import { stringToAsyncFunction } from "./reaction-manager.js";

// Current resource stats use direct actor.update() instead of ActiveEffect changes,
// because AE changes get re-applied on every data refresh (breaking consumable resources like overshield).
const CURRENT_RESOURCE_STATS = new Set([
    'system.hp.value', 'system.heat.value', 'system.overshield.value',
    'system.burn', 'system.repairs.value'
]);

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
 * Creates a generic bonus step for a specific flow type
 * @param {string} flowType - The flow type identifier (e.g., "attack", "tech_attack", "hull", "damage")
 * @returns {Function} The flow step function
 */
function createGenericBonusStep(flowType) {
    return async function genericAccuracyStepImpl(state) {
        try {
            const actor = state.actor;
            if (!actor)
                return true;

            const legacyAcc = (actor.getFlag("lancer-automations", "generic_accuracy") || 0) +
                              (actor.getFlag("world", "generic_accuracy") || 0);

            const legacyDiff = (actor.getFlag("lancer-automations", "generic_difficulty") || 0) +
                               (actor.getFlag("world", "generic_difficulty") || 0);

            let netBonus = legacyAcc - legacyDiff;

            const bonuses = actor.getFlag("lancer-automations", "global_bonuses") ||
                            actor.getFlag("csm-lancer-qol", "global_bonuses") || [];

            const activeBonuses = [];       // pure global acc/diff bonuses (no applyTo)
            const damageBonuses = [];
            const allTargetedBonuses = [];  // ALL acc/diff bonuses with applyTo (managed dynamically)
            const targetedDamageBonuses = [];

            // Shared set tracking user-disabled bonus+token pairs ("${bonus.id}:${tokenId}")
            const disabledByUser = new Set();

            if (Array.isArray(bonuses)) {
                const tags = getFlowTags(flowType, state);

                for (const bonus of bonuses) {
                    if (!await isBonusApplicable(bonus, tags, state))
                        continue;

                    if (bonus.type === 'stat')
                        continue;

                    const hasTarget = Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0;

                    if (bonus.type === 'damage') {
                        if (flowType === 'damage') {
                            if (hasTarget) {
                                // Always push to targetedDamageBonuses; injectInfo decides
                                // at render time whether to treat it as global (1 card) or per-card.
                                const matched = Array.from(game.user?.targets || [])
                                    .some(t => bonus.applyTo.includes(t.id));
                                if (matched)
                                    targetedDamageBonuses.push(bonus);
                            } else {
                                damageBonuses.push(bonus);
                            }
                        }
                        continue;
                    }

                    if (hasTarget) {
                        if (!bonus.id)
                            bonus.id = foundry.utils.randomID();
                        allTargetedBonuses.push(bonus);
                    } else {
                        let val = parseInt(bonus.val) || 0;
                        if (bonus.type === 'difficulty')
                            val = -val;
                        netBonus += val;
                        activeBonuses.push(bonus);
                    }
                }
            }

            // Process ephemeral bonuses
            let ephemeralBonuses = actor.getFlag("lancer-automations", "ephemeral_bonuses") || [];
            let ephemeralChanged = false;
            const remainingEphemeral = [];
            const consumedEphemeralNames = [];

            if (ephemeralBonuses.length > 0) {
                const tags = getFlowTags(flowType, state);

                for (const bonus of ephemeralBonuses) {
                    if (await isBonusApplicable(bonus, tags, state)) {
                        const hasTarget = Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0;

                        if (bonus.type === 'damage') {
                            if (flowType === 'damage') {
                                if (hasTarget) {
                                    const matched = Array.from(game.user?.targets || [])
                                        .some(t => bonus.applyTo.includes(t.id));
                                    if (matched) {
                                        targetedDamageBonuses.push({ ...bonus });
                                        if (bonus.name)
                                            consumedEphemeralNames.push(bonus.name);
                                        ephemeralChanged = true;
                                    } else {
                                        remainingEphemeral.push(bonus);
                                    }
                                } else {
                                    damageBonuses.push({ ...bonus });
                                    if (bonus.name)
                                        consumedEphemeralNames.push(bonus.name);
                                    ephemeralChanged = true;
                                }
                            } else {
                                remainingEphemeral.push(bonus);
                            }
                            continue;
                        }

                        if (hasTarget) {
                            const b = { ...bonus };
                            if (!b.id)
                                b.id = foundry.utils.randomID();
                            allTargetedBonuses.push(b);
                            if (bonus.name)
                                consumedEphemeralNames.push(bonus.name);
                            ephemeralChanged = true;
                        } else {
                            let val = parseInt(bonus.val) || 0;
                            if (bonus.type === 'difficulty')
                                val = -val;
                            netBonus += val;
                            activeBonuses.push({ ...bonus });
                            if (bonus.name)
                                consumedEphemeralNames.push(bonus.name);
                            ephemeralChanged = true;
                        }
                    } else {
                        remainingEphemeral.push(bonus);
                    }
                }
            }

            if (ephemeralChanged) {
                await delegateSetActorFlag(actor, "lancer-automations", "ephemeral_bonuses", remainingEphemeral);
            }

            // Process constant bonuses (never consumed)
            const constantBonuses = actor.getFlag("lancer-automations", "constant_bonuses") || [];
            if (constantBonuses.length > 0) {
                const tags = getFlowTags(flowType, state);

                for (const bonus of constantBonuses) {
                    if (!await isBonusApplicable(bonus, tags, state))
                        continue;

                    if (bonus.type === 'stat')
                        continue;

                    const hasTarget = Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0;

                    if (bonus.type === 'damage') {
                        if (flowType === 'damage') {
                            if (hasTarget) {
                                const matched = Array.from(game.user?.targets || [])
                                    .some(t => bonus.applyTo.includes(t.id));
                                if (matched)
                                    targetedDamageBonuses.push(bonus);
                            } else {
                                damageBonuses.push(bonus);
                            }
                        }
                        continue;
                    }

                    if (hasTarget) {
                        const b = { ...bonus };
                        if (!b.id)
                            b.id = foundry.utils.randomID();
                        allTargetedBonuses.push(b);
                    } else {
                        let val = parseInt(bonus.val) || 0;
                        if (bonus.type === 'difficulty')
                            val = -val;
                        netBonus += val;
                        activeBonuses.push(bonus);
                    }
                }
            }

            // Safer approach: scan all actors in active scene for applyToTargetter bonuses.
            // The original applyTo field acts as an attacker filter (empty = any attacker);
            // the owner's token id becomes the effective applyTo after transformation so
            // existing targeted routing applies. Ephemeral bonuses consume only when the
            // owning actor is actually among the current targets.
            const attackerTokenId = actor.token?.id
                ?? canvas.tokens.placeables.find(t => t.actor?.id === actor.id)?.id;
            const targeterTags = getFlowTags(flowType, state);
            const targeterEphemeralUpdates = new Map();

            for (const tokenDoc of game.scenes.active?.tokens ?? []) {
                const sourceActor = tokenDoc.actor;
                const sourceTokenId = tokenDoc.id;
                if (!tokenDoc || sourceTokenId === attackerTokenId)
                    continue;
                const routeTargeterBonus = (bonus) => {
                    const injected = { ...bonus, applyTo: [sourceTokenId] };
                    if (!injected.id)
                        injected.id = foundry.utils.randomID();
                    if (bonus.type === 'damage') {
                        if (flowType === 'damage' && isSourceTargeted)
                            targetedDamageBonuses.push(injected);
                        return;
                    }
                    allTargetedBonuses.push(injected);
                };

                const passesTargeterFilter = async (bonus) => {
                    if (!bonus.applyToTargetter)
                        return false;
                    if (bonus.applyTo?.length && !bonus.applyTo.includes(attackerTokenId))
                        return false;
                    if (!await isBonusApplicable(bonus, targeterTags, state))
                        return false;
                    return bonus.type !== 'stat';
                };

                for (const bonus of (sourceActor.getFlag("lancer-automations", "global_bonuses") || [])) {
                    if (await passesTargeterFilter(bonus))
                        routeTargeterBonus(bonus);
                }

                const sourceEphemeral = duplicate(sourceActor.getFlag("lancer-automations", "ephemeral_bonuses") || []);
                const remainingEphemeral = [];
                let ephemeralConsumed = false;
                for (const bonus of sourceEphemeral) {
                    if (await passesTargeterFilter(bonus) && isSourceTargeted) {
                        routeTargeterBonus(bonus);
                        ephemeralConsumed = true;
                    } else {
                        remainingEphemeral.push(bonus);
                    }
                }
                if (ephemeralConsumed)
                    targeterEphemeralUpdates.set(sourceActor, remainingEphemeral);

                for (const bonus of (sourceActor.getFlag("lancer-automations", "constant_bonuses") || [])) {
                    if (await passesTargeterFilter(bonus))
                        routeTargeterBonus(bonus);
                }
            }

            for (const [sourceActor, remaining] of targeterEphemeralUpdates)
                await delegateSetActorFlag(sourceActor, "lancer-automations", "ephemeral_bonuses", remaining);

            const hasAny = netBonus !== 0 || activeBonuses.length > 0 || damageBonuses.length > 0 ||
                           allTargetedBonuses.length > 0 || targetedDamageBonuses.length > 0;
            if (!hasAny)
                return true;

            if (!state.data)
                state.data = {};
            if (!state.data.acc_diff)
                state.data.acc_diff = {};
            if (!state.data.acc_diff.base)
                state.data.acc_diff.base = {};

            if (typeof state.data.acc_diff.base.accuracy !== 'number')
                state.data.acc_diff.base.accuracy = 0;
            if (typeof state.data.acc_diff.base.difficulty !== 'number')
                state.data.acc_diff.base.difficulty = 0;

            if (netBonus > 0) {
                state.data.acc_diff.base.accuracy += netBonus;
            } else if (netBonus < 0) {
                state.data.acc_diff.base.difficulty += Math.abs(netBonus);
            }

            // Tracks how each targeted bonus is currently applied:
            //   'base'   → applied to acc_diff.base (1 target or no cards)
            //   'target' → applied to specific t.accuracy/t.difficulty (2+ targets)
            //   null     → no matching target currently
            const appliedMode = new Map();

            const applyTargetedBonuses = (accDiff) => {
                const count = accDiff.targets.length;
                const base = accDiff.base;
                for (const bonus of allTargetedBonuses) {
                    const val = parseInt(bonus.val) || 0;
                    if (!val)
                        continue;

                    // Undo previous application
                    const prev = appliedMode.get(bonus.id);
                    if (prev === 'base') {
                        if (bonus.type === 'difficulty')
                            base.difficulty -= val;
                        else
                            base.accuracy -= val;
                    } else if (prev === 'target') {
                        for (const t of accDiff.targets) {
                            if (bonus.applyTo.includes(t.target?.id)) {
                                if (bonus.type === 'difficulty')
                                    t.difficulty -= val;
                                else
                                    t.accuracy -= val;
                            }
                        }
                    }

                    // Find matching targets in the new list
                    const matching = accDiff.targets.filter(t => bonus.applyTo.includes(t.target?.id));
                    if (!matching.length) {
                        appliedMode.set(bonus.id, null);
                        continue;
                    }

                    if (count <= 1) {
                        // Single / no target card: apply globally to base
                        if (bonus.type === 'difficulty')
                            base.difficulty += val;
                        else
                            base.accuracy += val;
                        appliedMode.set(bonus.id, 'base');
                    } else {
                        // Multiple targets: apply per-target
                        for (const t of matching) {
                            if (!disabledByUser.has(`${bonus.id}:${t.target?.id}`)) {
                                if (bonus.type === 'difficulty')
                                    t.difficulty += val;
                                else
                                    t.accuracy += val;
                            }
                        }
                        appliedMode.set(bonus.id, 'target');
                    }
                }
            };

            // Returns current effective lists for injection (re-evaluated each call)
            const getEffectiveActive = () => {
                const result = [...activeBonuses];
                for (const b of allTargetedBonuses) {
                    if (appliedMode.get(b.id) === 'base')
                        result.push(b);
                }
                return result;
            };
            const getEffectiveTargeted = () => allTargetedBonuses.filter(b => appliedMode.get(b.id) === 'target');

            // Apply targeted bonuses for initial render
            if (allTargetedBonuses.length > 0)
                applyTargetedBonuses(state.data.acc_diff);

            // Will be set to injectIntoCard() after showBonusNotification is called below.
            // Captured by the replaceTargets closure so it's always current at call time.
            let reinjectCallback = null;

            // Monkey-patch replaceTargets: re-applies on every target change before Svelte re-renders
            if (typeof state.data.acc_diff.replaceTargets === 'function') {
                const origReplace = state.data.acc_diff.replaceTargets.bind(state.data.acc_diff);
                state.data.acc_diff.replaceTargets = function(ts) {
                    origReplace(ts);
                    if (allTargetedBonuses.length > 0)
                        applyTargetedBonuses(this);
                    // Force-rebuild the global column DOM after Svelte finishes re-rendering
                    if (reinjectCallback)
                        setTimeout(reinjectCallback, 50);
                    return this;
                };
            }

            if (activeBonuses.length > 0 || allTargetedBonuses.length > 0) {
                reinjectCallback = showBonusNotification(getEffectiveActive, state, getEffectiveTargeted, disabledByUser);
            }

            if (flowType === 'damage') {
                if (damageBonuses.length > 0 || targetedDamageBonuses.length > 0) {
                    showDamageBonusNotification(damageBonuses, state, targetedDamageBonuses);
                }
            }

        } catch (e) {
            console.error("lancer-automations | Error in genericAccuracyStep:", e);
        }

        return true; // Continue flow
    };
}

function getFlowTags(flowType, state) {
    const tags = new Set(["all"]);

    if (flowType === "attack" || flowType === "basic_attack" || flowType === "weapon_attack") {
        tags.add("attack");
        if (state.item) {
            const type = state.item.system?.type || "";
            if (type)
                tags.add(type.toLowerCase());
        }
    }

    if (flowType === "tech_attack") {
        tags.add("attack");
        tags.add("tech_attack");
    }

    if (flowType === "stat_roll") {
        tags.add("check");
        if (state.data && state.data.path) {
            const path = state.data.path.toLowerCase();
            if (path.includes("hull"))
                tags.add("hull");
            if (path.includes("agility") || path.includes("agi"))
                tags.add("agility");
            if (path.includes("systems") || path.includes("sys"))
                tags.add("systems");
            if (path.includes("engineering") || path.includes("eng"))
                tags.add("engineering");
            if (path.includes("grit"))
                tags.add("grit");
        }

        if (state.actor && state.actor.is_npc && state.data && state.data.path && state.data.path.includes("tier")) {
            tags.add("tier");
        }
    }

    if (flowType === "structure") {
        tags.add("structure");
    }

    if (flowType === "overheat") {
        tags.add("overheat");
    }

    if (flowType === "damage") {
        tags.add("damage");
        if (state.item) {
            const type = state.item.system?.type || "";
            if (type)
                tags.add(type.toLowerCase());
        }
    }

    return tags;
}

async function isBonusApplicable(bonus, flowTags, state) {
    if (bonus.targetTypes && Array.isArray(bonus.targetTypes) && bonus.targetTypes.length > 0) {
        const hasMatch = bonus.targetTypes.some(t => flowTags.has(t.toLowerCase()));
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
                const fn = stringToAsyncFunction(bonus.condition, ['state', 'actor', 'data', 'context']);
                result = await fn(state, state.actor, state.data, context);
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
        let val = parseInt(bonus.val) || 0;
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
        const rawVal = parseInt(bonus.val) || 0;
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
            const index = parseInt($(this).data('index'));
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
                const val = parseInt(bonus.val) || 0;
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
     * @param {jQuery} $card   - The .accdiff-target card element
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
            const val = parseInt(bonus.val) || 0;
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

    // Watch for target cards added or changed during the dialog lifetime.
    // Disconnects when form#accdiff is removed (dialog closed), not on a fixed timer.
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

                    await new Promise(r => setTimeout(r, 50));

                    await new Promise(r => setTimeout(r, 50));

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
            const index = parseInt($(this).data('index'));
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

        let prevTargetSig = (state.data?.damage_hud_data?.targets || []).map(t => t.target?.id).sort().join(',');
        const watchInterval = setInterval(() => {
            if ($('#damage-hud').length === 0) {
                clearInterval(watchInterval);
                return;
            }
            const currentTargets = state.data?.damage_hud_data?.targets || [];
            const sig = currentTargets.map(t => t.target?.id).sort().join(',');
            if (sig === prevTargetSig)
                return;
            prevTargetSig = sig;
            const newCount = currentTargets.length;

            // Clear per-card injections
            targetedBonuses.forEach(bonus => {
                const gc = `csm-tgt-dmg-${(bonus.id || bonus.name).replace(/[^a-z0-9]/gi, '-')}`;
                $form.find(`.${gc}`).remove();
            });
            $form.find('.damage-hud-target-card [class*="csm-tgt-dmg-ctrl-"]').each(function() {
                const $del = $(this).find('button').first();
                if ($del.length)
                    $del.click(); else
                    $(this).remove();
            });

            // Remove targeted bonuses from bonusStates and their global damage entries
            for (let i = bonusStates.length - 1; i >= 0; i--) {
                if (!bonusStates[i]._fromTargeted)
                    continue;
                const b = bonusStates[i];
                b.enabled = false;
                const $bs = $form.find('.bonus-damage');
                const $addBtn = $bs.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
                if ($addBtn.length > 0)
                    syncBonusToForm(b, $bs, $addBtn);
                bonusStates.splice(i, 1);
            }
            bonusStates.forEach((b, i) => {
                b.index = i;
            });

            // Re-render global container and re-inject targeted bonuses
            $myContainer.find('.csm-bonus-config-row').remove();
            bonusStates.forEach((bonus, index) => $myContainer.append($(renderBonusRow(bonus, index))));
            $myContainer.toggle(bonusStates.length > 0);

            perCardBonuses = [];
            const newResolved = targetedBonuses.map(bonus => {
                const ht = currentTargets.find(ht => (bonus.applyTo || []).includes(ht.target?.id));
                return ht ? { ...bonus } : null;
            }).filter(Boolean);
            if (newResolved.length > 0) {
                if (newCount <= 1) {
                    newResolved.forEach(bonus => {
                        bonusStates.push({ ...bonus, _fromTargeted: true, index: bonusStates.length, enabled: true });
                        $myContainer.append($(renderBonusRow(bonusStates[bonusStates.length - 1], bonusStates.length - 1)));
                    });
                    $myContainer.show();
                    setTimeout(() => {
                        newResolved.forEach(bonus => {
                            const b = bonusStates.find(bs => bs._fromTargeted && (bs.id || bs.name) === (bonus.id || bonus.name));
                            if (!b)
                                return;
                            const $bs = $form.find('.bonus-damage');
                            const $addBtn = $bs.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
                            if ($addBtn.length > 0)
                                syncBonusToForm(b, $bs, $addBtn);
                        });
                    }, 200);
                } else {
                    perCardBonuses = newResolved;
                    injectTargetedDamageBonuses(perCardBonuses, $form, currentTargets);
                }
            }
        }, 100);

        return true;
    };

    let elapsed = 0;
    const MAX_WAIT = 10000;
    const POLL_MS = 50;

    const poll = () => {
        const hudData = state.data?.damage_hud_data;
        const $form = $('#damage-hud');

        if (!hudData || !$form.length) {
            elapsed += POLL_MS;
            if (elapsed < MAX_WAIT)
                setTimeout(poll, POLL_MS);
            return;
        }

        const hudTargets = hudData.targets || [];
        const targetCount = hudTargets.length;

        const resolved = targetedBonuses.map(bonus => {
            const ht = hudTargets.find(ht => (bonus.applyTo || []).includes(ht.target?.id));
            return ht ? { ...bonus } : null;
        }).filter(Boolean);

        if (targetCount > 1 && $form.find('.damage-hud-target-card').length < targetCount) {
            elapsed += POLL_MS;
            if (elapsed < MAX_WAIT)
                setTimeout(poll, POLL_MS);
            return;
        }

        doInject($form, resolved, targetCount);
    };

    setTimeout(poll, POLL_MS);

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

export const genericAccuracyStepAttack = createGenericBonusStep("attack");
export const genericAccuracyStepTechAttack = createGenericBonusStep("tech_attack");
export const genericAccuracyStepWeaponAttack = createGenericBonusStep("weapon_attack");
export const genericAccuracyStepStatRoll = createGenericBonusStep("stat_roll");
export const genericBonusStepDamage = createGenericBonusStep("damage");

export async function addGlobalBonus(actor, bonusData, options = {}) {
    if (!actor)
        return;
    const bonuses = duplicate(actor.getFlag("lancer-automations", "global_bonuses") ||
                              actor.getFlag("csm-lancer-qol", "global_bonuses") || []);

    if (!bonusData.id)
        bonusData.id = foundry.utils.randomID();
    if (!bonusData.name)
        bonusData.name = "Unnamed Bonus";

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

            const isPositive = (parseInt(bonusData.val) || 0) >= 0;
            let icon = "systems/lancer/assets/icons/white/accuracy.svg";

            if (bonusData.type === 'difficulty') {
                icon = "systems/lancer/assets/icons/white/difficulty.svg";
            } else if (bonusData.type === 'damage') {
                icon = "systems/lancer/assets/icons/white/melee.svg";
            } else if (bonusData.type === 'stat') {
                icon = "systems/lancer/assets/icons/white/generic_item.svg";
            } else if (!isPositive) {
                icon = "systems/lancer/assets/icons/white/difficulty.svg";
            }

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
                    actionName: options.consumption.actionName || null,
                    isBoost: options.consumption.isBoost ?? null,
                    minDistance: options.consumption.minDistance ?? null,
                    checkType: options.consumption.checkType || null,
                    checkAbove: options.consumption.checkAbove ?? null,
                    checkBelow: options.consumption.checkBelow ?? null
                };
            }

            // For stat bonuses, differentiate between current resources and max/flat stats
            if (bonusData.type === 'stat' && bonusData.stat) {
                if (CURRENT_RESOURCE_STATS.has(bonusData.stat)) {
                    // Direct modification for current resources - stored in flags for manual reversal
                    // (AE changes don't work here because Foundry re-applies them after damage/healing)
                    extraOptions.statDirect = {
                        key: bonusData.stat,
                        value: parseInt(bonusData.val) || 0,
                        preBonusValue: foundry.utils.getProperty(token.actor, bonusData.stat) || 0
                    };
                } else {
                    // Use ActiveEffect changes for max/flat stats (Foundry auto-applies/reverses)
                    extraOptions.changes = [{
                        key: bonusData.stat,
                        value: String(parseInt(bonusData.val) || 0),
                        mode: CONST.ACTIVE_EFFECT_MODES.ADD
                    }];
                }
            }

            await applyFlaggedEffectToTokens(
                {
                    tokens: [token],
                    effectNames: {
                        name: bonusData.name,
                        icon: icon,
                        isCustom: true,
                        stack: bonusData.uses || 1
                    },
                    note: `Linked to Global Bonus: ${bonusData.name}`,
                    duration: durationObj,
                    useTokenAsOrigin: false,
                    customOriginId: options.origin?.id || options.origin || token.id
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

export async function removeGlobalBonus(actor, bonusId, skipEffectRemoval = false) {
    if (!actor)
        return;
    let bonuses = duplicate(actor.getFlag("lancer-automations", "global_bonuses") || []);
    const initialLength = bonuses.length;

    const bonusToRemove = bonuses.find(b => b.id === bonusId);
    bonuses = bonuses.filter(b => b.id !== bonusId);

    if (bonuses.length !== initialLength) {
        await delegateSetActorFlag(actor, "lancer-automations", "global_bonuses", bonuses);

        // Only remove the specific linked effect, not all effects with the same name
        if (!skipEffectRemoval && bonusToRemove && bonusToRemove.name) {
            const token = actor.token?.object || canvas.tokens.placeables.find(t => t.actor?.id === actor.id);
            if (token && token.actor) {
                // Find only the effect linked to THIS specific bonus, not all with the same name
                const linkedEffect = token.actor.effects.find(e =>
                    e.getFlag('lancer-automations', 'linkedBonusId') === bonusId
                );
                if (linkedEffect) {
                    await linkedEffect.delete();
                }
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



export async function injectBonusToNextRoll(actor, bonus) {
    if (!actor)
        return;
    const bonuses = duplicate(actor.getFlag("lancer-automations", "ephemeral_bonuses") || []);
    if (!bonus.id)
        bonus.id = foundry.utils.randomID();
    bonuses.push(bonus);
    await delegateSetActorFlag(actor, "lancer-automations", "ephemeral_bonuses", bonuses);
}

export async function addConstantBonus(actor, bonusData) {
    if (!actor)
        return;
    const bonuses = duplicate(actor.getFlag("lancer-automations", "constant_bonuses") || []);
    if (!bonusData.id)
        bonusData.id = foundry.utils.randomID();
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

export async function removeConstantBonus(actor, bonusId) {
    if (!actor)
        return;
    const bonuses = duplicate(actor.getFlag("lancer-automations", "constant_bonuses") || []);
    const filtered = bonuses.filter(b => b.id !== bonusId);
    if (filtered.length !== bonuses.length)
        await delegateSetActorFlag(actor, "lancer-automations", "constant_bonuses", filtered);
}

export function executeGenericBonusMenu() {
    executeEffectManager({ initialTab: 'bonus' });
}
