import { getLAFlag } from "../tools/flag-utils.js";
import { accDiffTargetToken } from "../combat/grid-helpers.js";
import { localize, escapeHtml } from "../tools/string-utils.js";
import { htmlToElement } from "../tools/dom-utils.js";
import { laSigned, laValueTag, laRowHtml, laGroupHtml, laCardSlot, laDamageChips, laInfoRowHtml, laSplitGroupHtml } from "./roll-card-rows.js";
import { runApplyToCondition, bonusUsageParts } from "./genericBonuses.js";

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

    const $hudzone = $(document.querySelector('#hudzone'));
    observer.observe($hudzone.length > 0 ? $hudzone[0] : document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 600000);
    return observer;
}

// The card label's `for` is the token uuid on Lancer 3.x, a bare id before
export function accDiffCardTokenId($card)
{
    return ($card.find('label.target-name').attr('for') || '').split('.').pop();
}

// Prefers bonus.context.ownerTokenId, falls back to state.actor's first token; provides reactorToken for condition lambdas.
export function resolveReactorToken(bonus, state)
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
export function evaluateApplyToCondition(mod, targetEntry, state, reactorToken)
{
    return runApplyToCondition(mod, accDiffTargetToken(targetEntry), state, reactorToken, targetEntry);
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
export function showBonusNotification(getBonuses, state, getTargetedBonuses, disabledByUser = new Set(), enabledById = new Map())
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
        const $form = $(document.querySelectorAll('form[id^="accdiff"]'));
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
            if (val === 0 || (bonus.type !== 'accuracy' && bonus.type !== 'difficulty'))
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
        const $form = $(document.querySelectorAll('form[id^="accdiff"]'));
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

    const $form = $(document.querySelectorAll('form[id^="accdiff"]'));
    const observeTarget = $form.length > 0 ? $form[0] : document.body;
    const observer = new MutationObserver(() =>
    {
        if ($(document.querySelectorAll('form[id^="accdiff"]')).length === 0)
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

function hideNextBonusRow($section, inputSelector)
{
    if (!$section[0])
        return () => {};
    const valueInputs = () => $section.find(inputSelector);
    const previousLast = valueInputs().last()[0] ?? null;
    let $hidden = null;
    const observer = new MutationObserver(() =>
    {
        const $last = valueInputs().last();
        if (!$last.length || $last[0] === previousLast)
            return;
        $hidden = $last.closest('.flexrow, .damage-grid-item, div').css('display', 'none');
        observer.disconnect();
    });
    observer.observe($section[0], { childList: true, subtree: true });
    return (claimClass) =>
    {
        observer.disconnect();
        if ($hidden && !$hidden.hasClass(claimClass))
            $hidden.css('display', '');
    };
}

/**
 * Inject global damage bonus checkboxes into the damage HUD,
 * and also inject per-target damage bonus checkboxes into each matching target card.
 */
export function showDamageBonusNotification(bonuses, state, targetedBonuses = [], targetModifiers = [], usageDmgEnabled = null)
{
    const bonusStates = bonuses.map((bonus, index) => ({
        ...bonus,
        index,
        enabled: !bonus._limitReached && !bonus.defaultOff
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
                    const releaseRow = hideNextBonusRow($bonusSection, 'input[type="text"][placeholder="0"], input[type="number"]');
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
                    releaseRow(bonusIdClass);
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
                        bonusStates.push({ ...bonus, _fromTargeted: true, index: bonusStates.length, enabled: !bonus._limitReached && !bonus.defaultOff });
                });
            }
            else
                perCardBonuses = resolvedTargeted;
        }

        let $myContainer = $configGrid.find('.csm-bonus-container');
        if ($myContainer.length === 0)
        {
            $myContainer = $(htmlToElement('<div class="csm-bonus-container la2-dmgsec"></div>'));
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

    let prevTargetSig = (state.data?.damage_hud_data?.targets || []).map(target => accDiffTargetToken(target)?.id).sort().join(',');
    let reinjectPending = false;
    let formWasSeen = false;

    const observer = new MutationObserver(() =>
    {
        const $form = $(document.querySelector('#damage-hud'));
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
        const sig = currentTargets.map(target => accDiffTargetToken(target)?.id).sort().join(',');
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
            const refreshedForm = $(document.querySelector('#damage-hud'));
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
                for (let stateIdx = bonusStates.length - 1; stateIdx >= 0; stateIdx--)
                {
                    if (!bonusStates[stateIdx]._fromTargeted)
                        continue;
                    const bonusState = bonusStates[stateIdx];
                    bonusState.enabled = false;
                    const $bonusSection = refreshedForm.find('.bonus-damage');
                    const $addBtn = $bonusSection.find('.add-damage-type, button[data-tooltip="Add a bonus damage type"]');
                    if ($addBtn.length > 0)
                        syncBonusToForm(bonusState, $bonusSection, $addBtn);
                    bonusStates.splice(stateIdx, 1);
                }
                bonusStates.forEach((bonusState, index) =>
                {
                    bonusState.index = index;
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

    const $hudzone = $(document.querySelector('#hudzone'));
    if ($hudzone.length > 0)
        observer.observe($hudzone[0], { childList: true, subtree: true });
    else
        observer.observe(document.body, { childList: true, subtree: true });

    // Safety disconnect after 10 minutes
    setTimeout(() => observer.disconnect(), 600000);

    return () =>
    {
        const $form = $(document.querySelector('#damage-hud'));
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
        document.head.append(htmlToElement('<style id="csm-bonus-styles">.target-bonus-damage-wrapper:not(:has(:not(.csm-hidden-bonus-row))){display:none!important}</style>'));
    }
    const scope = _detectSvelteScope($form, 'label.container');

    $form.find('.damage-hud-target-card').each(function(cardIndex)
    {
        const $card = $(this);
        const tokenId = accDiffTargetToken(hudTargets[cardIndex])?.id;
        if (!tokenId)
            return;

        const matchingBonuses = targetedBonuses.filter(bonus => (bonus.applyTo || []).includes(tokenId));
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
                on: !bonus.defaultOff,
                scope,
                cls: `csm-bonus-config-row la2-dmgrow la2-card ${guardClass}`,
                inputCls: 'csm-tgt-dmg-checkbox'
            }));

            // Visual row goes after the AP/Paracausal/Half-damage config row
            laCardSlot($card, 'bonus').append($row);

            let enabled = !bonus.defaultOff;
            const bonusIdClass = `csm-tgt-dmg-ctrl-${guardClass}-${localIdx}`;

            const syncToCard = async (enable) =>
            {
                const $addBtn = $bonusSection.find('.add-damage-type');
                if (!$addBtn.length)
                    return;

                const $existing = $bonusSection.find(`.${bonusIdClass}`);

                if (enable && $existing.length === 0)
                {
                    for (const dmgEntry of (bonus.damage || []))
                    {
                        const releaseRow = hideNextBonusRow($bonusSection, 'input[type="text"],input[type="number"]');
                        $addBtn.click();
                        await new Promise(resolve => setTimeout(resolve, 50));
                        const $valInputs = $bonusSection.find('input[type="text"],input[type="number"]');
                        const $lastVal = $valInputs.last();
                        const $rowContainer = $lastVal.closest('.flexrow, .damage-grid-item, div');
                        if ($rowContainer.length && !$rowContainer.hasClass(bonusIdClass))
                        {
                            $rowContainer.addClass(bonusIdClass).addClass('csm-hidden-bonus-row').css('display', 'none');
                            $lastVal.val(dmgEntry.val);
                            $lastVal[0].dispatchEvent(new Event('input', { bubbles: true }));
                            $lastVal[0].dispatchEvent(new Event('change', { bubbles: true }));
                            const $select = $rowContainer.find('select');
                            if ($select.length)
                            {
                                $select.find('option').each(function()
                                {
                                    if ($(this).text().toLowerCase() === dmgEntry.type.toLowerCase())
                                    {
                                        $select.val($(this).val()); return false;
                                    }
                                });
                                $select[0].dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                        releaseRow(bonusIdClass);
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

            if (enabled)
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
export function _detectSvelteScope($form, selector)
{
    const refs = $form.find(selector);
    for (let refIdx = 0; refIdx < refs.length; refIdx++)
    {
        for (const cls of refs[refIdx].classList)
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
    const knockbackTag = tags.find(tag => tag.id === "knockback" || tag.lid === "tg_knockback");
    const hasTag = !!knockbackTag;
    let tagVal = hasTag ? (Number.parseInt(knockbackTag.val) || Number.parseInt(knockbackTag.num_val) || 1) : 1;

    // Shared state that the knockbackDamageStep will read
    state.data._csmKnockback = { enabled: hasTag, value: tagVal };

    const doInject = () =>
    {
        const $form = $(document.querySelector('#damage-hud'));
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

        const $row = $(htmlToElement(`
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
        `));

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
        const $form = $(document.querySelector('#damage-hud'));
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

        const $row = $(htmlToElement(`
            <div class="csm-no-bonus-dmg-row" style="grid-area: nobonusdmg; display: flex; align-items: center; margin-top: 4px;">
                <label class="container ${containerScope}" style="max-width: fit-content; padding-right: 0.5em; cursor: pointer;">
                    <input type="checkbox" class="csm-no-bonus-dmg-checkbox ${containerScope}" ${checked ? 'checked' : ''}>
                    <i class="mdi mdi-cancel i--s ${containerScope}"></i>
                    <span style="text-wrap: nowrap;">No Bonus Dmg</span>
                </label>
            </div>
        `));

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
        const $form = $(document.querySelector('#damage-hud'));
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
        const $row = $(htmlToElement(`
            <div class="la-throttled-row" style="grid-area: throttled; display: flex; align-items: center; margin-top: 4px;">
                <label class="container ${containerScope}" style="max-width: fit-content; padding-right: 0.5em; cursor: pointer;" data-tooltip="${escapeHtml(statusText)}">
                    <input type="checkbox" class="la-throttled-checkbox ${containerScope}" ${throttledState.enabled ? 'checked' : ''}>
                    <span style="text-wrap: nowrap;">Throttled (Half Dmg)</span>
                </label>
            </div>
        `));
        $configGrid.append($row);

        const syncHalfToThrottled = () =>
        {
            const $box = findHalfDamage($(document.querySelector('#damage-hud')));
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
                const $freshForm = $(document.querySelector('#damage-hud'));
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
