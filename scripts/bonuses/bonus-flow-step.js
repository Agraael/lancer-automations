import { getLAFlag, getLAFlags } from "../tools/flag-utils.js";
import { accDiffTargetToken } from "../combat/grid-helpers.js";
import { linkTierGate } from "../interactive/deployables.js";
import { htmlToElement } from "../tools/dom-utils.js";
import { laValueTag, laRowHtml, laGroupHtml, laCardSlot, laSyncInvisibility } from "./roll-card-rows.js";
import { accDiffCardTokenId, resolveReactorToken, evaluateApplyToCondition, showBonusNotification, showDamageBonusNotification, _detectSvelteScope } from "./bonus-roll-hud.js";
import { flattenBonuses, applyTagBonus, getFlowTags, isBonusApplicable, getGlobalBonuses, getConstantBonuses, bonusFrequencyFree, getV3DataBonuses } from "./genericBonuses.js";

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

const DEATHS_HEAD_LID = 'mf_deaths_head';

function deathsHeadFromData(state, flatBonuses)
{
    const frame = state.actor?.system?.loadout?.frame?.value;
    if (frame?.system?.lid !== DEATHS_HEAD_LID || !state.item?.is_mech_weapon?.())
        return false;
    if (!(state.item.system?.active_profile?.range ?? []).some((/** @type {any} */ range) => range?.type !== 'Threat'))
        return false;
    return flatBonuses.some((/** @type {any} */ bonus) => bonus.dataSource?.uuid === frame.uuid);
}

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
                flatBonus: 0,
                flatBonuses: [],
                disabledByUser: new Set(),
                limitReached: new Set()
            };

            await processBonusBatch(flattenBonuses(getGlobalBonuses(actor)), flowType, tags, state, collected);
            await processBonusBatch(getConstantBonuses(actor), flowType, tags, state, collected);
            await processBonusBatch(_v3RollBonuses(actor), flowType, tags, state, collected);
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
            const flatTotal = collected.flatBonus - (deathsHeadFromData(state, collected.flatBonuses) ? 1 : 0);
            if (flatTotal)
                base.flatBonus = (Number(base.flatBonus) || 0) + flatTotal;

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

            const applyOneModifier = (targetEntry, mod) =>
            {
                if (mod.subtype === 'invisible' && targetEntry.plugins?.invisibility)
                    targetEntry.plugins.invisibility.data = 1;
                else if (mod.subtype === 'no_invisible' && targetEntry.plugins?.invisibility)
                    targetEntry.plugins.invisibility.data = -1;
                else if (mod.subtype === 'no_cover')
                    targetEntry.cover = 0;
                else if (mod.subtype === 'soft_cover')
                    targetEntry.cover = Math.max(targetEntry.cover || 0, 1);
                else if (mod.subtype === 'hard_cover')
                    targetEntry.cover = 2;
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
            for (const bonus of [...collected.damageBonuses, ...collected.targetedDamageBonuses])
            {
                if (bonus.defaultOff && bonus.id)
                    bonusUsage.dmgEnabled.set(bonus.id, false);
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
                    const $box = $(document.querySelector('#damage-hud')).find(`.damage-hud-options-grid > [style*="${area}"]`).find('input[type="checkbox"]').first();
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
                    const $form = $(document.querySelector('#damage-hud'));
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
            const attackMods = collected.targetModifiers.filter(mod => attackModSubtypes.has(mod.subtype));
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
                    const $form = $(document.querySelectorAll('form[id^="accdiff"]'));
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
                        const $modSection = $(htmlToElement(`<div class="accdiff-grid accdiff-grid__section ${gridScope} la-target-modifier-section la2-modsec"><div class="accdiff-grid__column ${gridScope}">${laGroupHtml(rowsHtml)}</div></div>`));
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
                const dmgModifiers = collected.targetModifiers.filter(mod => ['ap', 'half_damage', 'paracausal', 'crit', 'hit', 'miss'].includes(mod.subtype));
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
            const resolved = resolveDamageBonus(bonus, state);
            if (!resolved)
                continue;
            const hasTarget = Array.isArray(resolved.applyTo) && resolved.applyTo.length > 0;
            const routed = limitReached ? { ...resolved, _limitReached: true } : resolved;
            if (hasTarget)
            {
                if (targets.some(target => resolved.applyTo.includes(target.id)))
                    results.targetedDamageBonuses.push(routed);
            }
            else
                results.damageBonuses.push(routed);
        }
        else if (bonus.type === 'flat')
        {
            results.flatBonus = (results.flatBonus || 0) + (Number.parseInt(bonus.val) || 0);
            results.flatBonuses?.push(bonus);
            results.activeBonuses.push(bonus);
        }
        else if (bonus.type === 'accuracy' || bonus.type === 'difficulty')
        {
            const hasTarget = (Array.isArray(bonus.applyTo) && bonus.applyTo.length > 0) || !!bonus.applyToCondition;
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
        else if (bonus.type !== 'damage')
            results.activeBonuses.push(bonus);
    }
}

export function resolveDamageBonus(bonus, state)
{
    const untyped = (bonus.damage ?? []).some(entry => !entry.type);
    if (!untyped && !bonus.critOnly)
        return bonus;
    const attackType = state?.data?.damage?.[0]?.type ?? 'Kinetic';
    const damage = (bonus.damage ?? []).map(entry => (entry.type ? entry : { ...entry, type: attackType }));
    if (!bonus.critOnly)
        return { ...bonus, damage };
    const hitResults = state?.data?.hit_results ?? [];
    const critIds = hitResults.filter(result => result.crit).map(result => result.target?.id)
        .filter(id => id && (!bonus.applyTo?.length || bonus.applyTo.includes(id)));
    if (!critIds.length)
        return null;
    const halved = hitResults.length > 1 ? damage.map(entry => ({ ...entry, val: `ceil((${entry.val}) / 2)` })) : damage;
    return { ...bonus, damage: halved, applyTo: critIds };
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

export const genericAccuracyStepAttack = createGenericBonusStep("attack");
export const genericAccuracyStepTechAttack = createGenericBonusStep("tech_attack");
export const genericAccuracyStepWeaponAttack = createGenericBonusStep("weapon_attack");
export const genericAccuracyStepStatRoll = createGenericBonusStep("stat_roll");
export const genericBonusStepDamage = createGenericBonusStep("damage");

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

const DATA_ROLL_TYPES = ['accuracy', 'difficulty', 'flat', 'damage', 'tag'];

function _v3RollBonuses(actor)
{
    return getV3DataBonuses(actor, DATA_ROLL_TYPES).map(row => row.bonus);
}
