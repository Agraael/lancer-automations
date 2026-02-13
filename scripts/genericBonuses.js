import { applyFlaggedEffectToTokens } from "./flagged-effects.js";
import { executeEffectManager } from "./effectManager.js";
import { stringToAsyncFunction } from "./reaction-manager.js";

// Current resource stats use direct actor.update() instead of ActiveEffect changes,
// because AE changes get re-applied on every data refresh (breaking consumable resources like overshield).
const CURRENT_RESOURCE_STATS = new Set([
    'system.hp.value', 'system.heat.value', 'system.overshield.value',
    'system.burn', 'system.repairs.value'
]);


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

            const activeBonuses = [];
            const damageBonuses = [];

            if (Array.isArray(bonuses)) {
                const tags = getFlowTags(flowType, state);

                for (const bonus of bonuses) {
                    if (!await isBonusApplicable(bonus, tags, state))
                        continue;

                    if (bonus.type === 'stat')
                        continue; // Applied via ActiveEffect, not flow
                    if (bonus.type === 'damage') {
                        if (flowType === 'damage') {
                            damageBonuses.push(bonus);
                        }
                        continue;
                    }

                    let val = parseInt(bonus.val) || 0;
                    if (bonus.type === 'difficulty')
                        val = -val;

                    netBonus += val;
                    activeBonuses.push(bonus);
                }
            }

            if (netBonus === 0 && activeBonuses.length === 0 && damageBonuses.length === 0)
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

            if (activeBonuses.length > 0) {
                showBonusNotification(activeBonuses, state);
            }

            if (flowType === 'damage') {
                if (damageBonuses.length > 0) {
                    showDamageBonusNotification(damageBonuses, state);
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

function showBonusNotification(bonuses, state) {
    const bonusStates = bonuses.map((b, index) => ({
        ...b,
        index,
        enabled: true
    }));

    const updateFlowAccuracy = (bonusIndex, wasEnabled) => {
        const bonus = bonusStates[bonusIndex];
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
            <label class="container csm-bonus-row" data-index="${index}" style="cursor: pointer;">
                <input type="checkbox" class="csm-bonus-checkbox" data-index="${index}" ${isEnabled ? 'checked' : ''}>
                <span style="text-wrap: nowrap;">${bonus.name}${usesText} (${valText})</span>
            </label>
        `;

    };

    const bindEvents = ($container) => {
        $container.find('.csm-bonus-checkbox').on('change', function(e) {
            const index = parseInt($(this).data('index'));
            const isChecked = $(this).is(':checked');
            const wasEnabled = bonusStates[index].enabled;
            bonusStates[index].enabled = isChecked;

            // Visual feedback
            $(this).parent().css('opacity', isChecked ? '1' : '0.5');


            updateFlowAccuracy(index, wasEnabled);
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
            $form.find('.csm-bonus-row').remove();

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

    if (!injectIntoCard()) {
        const observer = new MutationObserver((mutations, obs) => {
            if (injectIntoCard()) {
                obs.disconnect();
            }
        });

        const $hudzone = $('#hudzone');
        if ($hudzone.length > 0) {
            observer.observe($hudzone[0], { childList: true, subtree: true });
        } else {
            observer.observe(document.body, { childList: true, subtree: true });
        }

        setTimeout(() => observer.disconnect(), 2000);
    }

    return bonusStates;
}

function showDamageBonusNotification(bonuses, state) {
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

    const syncBonusToForm = async (bonusState, $form) => {
        const $bonusSection = $form.find('.bonus-damage');
        const $addBtn = $bonusSection.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');

        if ($addBtn.length === 0)
            return;

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

    const injectInfo = ($html) => {
        const $form = $html.is('#damage-hud') ? $html : $html.find('#damage-hud');

        if ($form.length === 0)
            return false;

        if ($form.length === 0)
            return false;

        const $configGrid = $form.find('.damage-hud-options-grid');

        if ($configGrid.length === 0) {
            console.warn("lancer-automations | .damage-hud-options-grid not found");
            return false;
        }

        let $myContainer = $configGrid.find('.csm-bonus-container');
        if ($myContainer.length === 0) {
            $myContainer = $('<div class="csm-bonus-container" style="grid-column: 1 / -1; border-top: 1px solid var(--primary-light); margin-top: 5px; padding-top: 5px;"></div>');
            $myContainer.append('<h3 class="damage-hud-section lancer-border-primary svelte-1tnd08e" style="font-size: 0.9em; margin-bottom: 5px;">Global Bonuses</h3>');
            $configGrid.append($myContainer);

            setTimeout(() => {
                bonusStates.forEach(b => syncBonusToForm(b, $form));
            }, 200);
        } else {
            $myContainer.find('.csm-bonus-config-row').remove();
        }

        bonusStates.forEach((bonus, index) => {
            const $row = $(renderBonusRow(bonus, index));
            $myContainer.append($row);
        });

        $myContainer.find('.csm-bonus-checkbox').on('change', function() {
            const index = parseInt($(this).data('index'));
            const isChecked = $(this).is(':checked');
            bonusStates[index].enabled = isChecked;

            syncBonusToForm(bonusStates[index], $form);

            const $row = $(this).closest('.csm-bonus-config-row');
            $row.find('.csm-bonus-value').css('opacity', isChecked ? '0.9' : '0.5');
        });

        return true;
    };

    const hookId = Hooks.on('renderApplication', (app, $html, data) => {
        if (injectInfo($html)) {
            if (app.id === 'damage-hud' || ($html.attr && $html.attr('id') === 'damage-hud')) {
                Hooks.off('renderApplication', hookId);
            }
        }
    });

    setTimeout(() => Hooks.off('renderApplication', hookId), 10000);

    const observer = new MutationObserver((mutations, obs) => {
        const $hud = $('#damage-hud');
        if ($hud.length > 0) {
            if (injectInfo($hud)) {
                obs.disconnect();
                Hooks.off('renderApplication', hookId);
            }
        }
    });

    const target = document.body;
    observer.observe(target, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);

    return bonusStates;
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

    await actor.setFlag("lancer-automations", "global_bonuses", bonuses);

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
        await actor.setFlag("lancer-automations", "global_bonuses", bonuses);

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

export function executeGenericBonusMenu() {
    executeEffectManager({ initialTab: 'bonus' });
}
