/* global canvas, game, ui, FilePicker, Dialog, CodeMirror, PIXI, performance */

import { EACH_ORIGIN, _emTargetIds, _emApplyGroups, _emTargetLabel, _resolveEmTargets, _setEmTargetValue, _resolveEmTarget } from "./effect-manager-targets.js";
import {
    applyEffectsToTokens,
    linkEffectToItem,
    linkEffectToActor
} from "./flagged-effects.js";
import { createDurationMarks, buildDuration } from "./duration-widget.js";
import { durationChoice, ANY_TURN_ORIGIN } from "./duration-builders.js";
import { getLAFlag, unsetLAFlag } from "../tools/flag-utils.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import {
    addGlobalBonus,
    addConstantBonus,
    linkBonusToItem,
    linkBonusToActor,
    supportsConsumeOnUsage,
    STAT_BONUS_GROUPS,
} from "./genericBonuses.js";
import { attachEditorResizeObserver } from "../tools/misc-tools.js";
import {
    updateCodeFieldBadge,
    presetCategoryFor,
    getStoredPresets,
    setStoredPresets,
    gatherPresetData,
    applyPresetData,
    openCodeFieldDialog,
    openItemBrowser,
    openStatusPicker,
    initLaMultiSelect,
    setupTriggerUI,
    getTriggerConfig,
} from "./effect-manager-widgets.js";
import { bindTierGate, readTierGate, tierGateApplies } from "../interactive/tier-gate.js";
import { TG } from "../interactive/canvas-helpers.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { htmlToElement } from "../tools/dom-utils.js";
import { cancelButton } from "../tools/dialog-utils.js";
import { updateManageList as renderManageList, updateManageTabCount as renderManageTabCount } from "./effect-manager-manage.js";
import { buildEffectManagerContent, DAMAGE_CHANGE_TYPE_ALL } from "./effect-manager-template.js";
import { IMMUNITY_FILTER_FIELDS, BONUS_FILTER_FIELDS, gatherBonusFormData } from "./effect-manager-bonus-data.js";
export { openItemBrowser };

async function fetchAvailableTags()
{
    let tags = [];
    // Core tags live in the lancer-data compendium.
    for (const pack of game.packs)
    {
        if (pack.metadata.type === "Item" && pack.metadata.packageName === "lancer-data")
        {
            const index = pack.index || await pack.getIndex({ fields: ["type", "system.lid", "system.val"] });
            for (const item of index)
            {
                if (item.type === "tag")
                {
                    tags.push({
                        id: item.system?.lid || item._id,
                        name: item.name,
                        val: item.system?.val || 0
                    });
                }
            }
        }
    }
    tags.sort((a, b) => a.name.localeCompare(b.name));

    // Fallback if none found (e.g. system not fully loaded or different pack structure)
    if (tags.length === 0)
    {
        tags = [
            { id: "tg_accurate", name: "Accurate" },
            { id: "tg_inaccurate", name: "Inaccurate" },
            { id: "tg_reliable", name: "Reliable" },
            { id: "tg_ap", name: "Armor Piercing" },
            { id: "tg_knockback", name: "Knockback" },
            { id: "tg_overkill", name: "Overkill" },
            { id: "tg_heat_self", name: "Heat (Self)" },
            { id: "tg_burn", name: "Burn" },
            { id: "tg_smart", name: "Smart" },
            { id: "tg_seeking", name: "Seeking" },
            { id: "tg_arcing", name: "Arcing" }
        ];
    }
    return tags;
}

/** @returns {Promise<void>} */
export async function executeEffectManager(options = {})
{
    console.log('lancer-automations | Executing Effect Manager');

    const availableTags = await fetchAvailableTags();


    let defaultTarget = null;
    const itemTarget = options.item ?? null;
    const isItemContext = !!itemTarget;
    if (!options.forcePrototype && !isItemContext && options.actor)
    {
        const active = options.actor.getActiveTokens?.() || [];
        if (active[0])
            defaultTarget = active[0];
    }
    // Several tokens selected: open targeting all of them.
    const multiDefault = (!options.forcePrototype && !isItemContext && canvas.tokens.controlled.length > 1)
        ? canvas.tokens.controlled.map(token => token.id).join(', ')
        : null;
    if (!options.forcePrototype && !isItemContext && !defaultTarget && canvas.tokens.controlled.length > 0)
        defaultTarget = canvas.tokens.controlled[0];
    else if (!options.forcePrototype && !isItemContext && !defaultTarget && game.user.targets.size > 0)
        defaultTarget = game.user.targets.first();

    const tokens = canvas.tokens.placeables;
    const protoActor = (options.actor && !isItemContext && (options.forcePrototype || !options.actor.getActiveTokens?.().length))
        ? options.actor : null;
    const itemHtml = itemTarget
        ? `<option value="${itemTarget.uuid}" selected>${itemTarget.name} (item)</option>`
        : '';
    const protoHtml = protoActor
        ? `<option value="${protoActor.uuid}" selected>${protoActor.name} (prototype)</option>`
        : '';
    const tokensHtml = itemHtml + protoHtml + tokens.map(token =>
    {
        const isSelf = !protoActor && !isItemContext && token.id === defaultTarget?.id;
        return `<option value="${token.id}" ${isSelf ? 'selected' : ''}>${token.name}${isSelf ? ' (self)' : ''}</option>`;
    }).join('');
    // Target selects only: the multi option wins over the (self) one; origin selects keep the single list.
    const targetsHtml = multiDefault
        ? `<option class="em-multi-opt" value="${multiDefault}" selected>${canvas.tokens.controlled.length} tokens</option>`
            + tokensHtml.replaceAll(' selected>', '>')
        : tokensHtml;
    // Origin selects: EACH_ORIGIN makes every target its own duration reference. Default when several targets.
    const originsHtml = `<optgroup label="Special"><option value="${ANY_TURN_ORIGIN}">Any</option><option value="${EACH_ORIGIN}"${multiDefault ? ' selected' : ''}>Each Target</option></optgroup>`
        + `<optgroup label="Tokens">${multiDefault ? tokensHtml.replaceAll(' selected>', '>') : tokensHtml}</optgroup>`;

    let durations = [{
        label: 'end',
        turns: 1,
        rounded: 0,
        name: "End of Turn"
    },
    {
        label: 'start',
        turns: 1,
        rounded: 0,
        name: "Start of Turn"
    }
    ];
    // Permanent: same as indefinite at apply time, but survives Full Repair (snapshot/restore in lancer-modif.js).
    durations.push(
        { label: 'roundEnd', turns: null, rounded: 1, name: "End of Round" },
        { label: 'roundStart', turns: null, rounded: 1, name: "Start of Round" },
        { label: 'encounter', turns: null, rounded: null, name: "End of Encounter" },
        { label: 'indefinite', turns: null, rounded: null, name: "Indefinite" },
        { label: 'permanent',  turns: null, rounded: null, name: "Permanent (kept through Full Repair)" }
    );
    const allDurations = [...durations];

    if (!game.combat)
        durations = durations.filter(duration => duration.label === 'indefinite' || duration.label === 'permanent');

    const customStatusModule = game.modules.get("temporary-custom-statuses");
    const hasCustomStatus = customStatusModule?.active;
    const savedStatuses = hasCustomStatus ? (game.settings.get("temporary-custom-statuses", "savedStatuses") || []) : [];
    const allPresets = getStoredPresets();

    const defaultDuration = 'indefinite';
    const durationOptionsHtml = durations.map(duration => `<option value="${duration.label}" ${duration.label === defaultDuration ? 'selected' : ''}>${duration.name}</option>`).join('');

    // Bonus tab: same options as std/cust, plus "Constant" (no icon, always active, invisible; routes to addConstantBonus).
    const bonusDurationOptionsHtml = durations.map(duration => `<option value="${duration.label}" ${duration.label === defaultDuration ? 'selected' : ''}>${duration.name}</option>`).join('')
        + '<option value="constant">Constant (no icon, always active)</option>';

    const dmgTypeOptionsHtml = ['Kinetic', 'Explosive', 'Energy', 'Heat', 'Burn', 'Infection', 'Variable']
        .map(dmgType => `<option value="${dmgType}">${dmgType}</option>`).join('');

    const statusEffectIconsHtml = /** @type {any[]} */ ([...CONFIG.statusEffects])
        .sort((a, b) => (localize(a.name) || a.name).localeCompare(localize(b.name) || b.name))
        .map(statusEffect =>
        {
            const label = localize(statusEffect.name) || statusEffect.name;
            return `
        <div class="bonus-immunity-effect-option" data-effect="${statusEffect.name}" data-name="${label}" title="${label}" style="cursor:pointer; display:flex; align-items:center; gap:3px; padding:0 3px; border-radius:2px; border-left:3px solid transparent; background:var(--la-plate); color:var(--la-ink); font-size:0.75em; min-width:0;">
            <img src="${statusEffect.img || statusEffect.icon}" style="width:20px; height:20px; object-fit:contain; flex-shrink:0; background:#2a2a2a; border-radius:2px; padding:1px; pointer-events:none;">
            <span class="la-hud-clip" style="flex:1; overflow:hidden; min-width:0; pointer-events:none;"><span class="la-hud-pan" style="display:inline-block; white-space:nowrap; padding-right:6px;">${label}</span></span>
        </div>`;
        }).join('');

    const damageTypes = [
        { name: 'All', icon: 'modules/lancer-automations/icons/resist_all.svg' },
        { name: 'Kinetic', icon: 'systems/lancer/assets/icons/white/damage_kinetic.svg' },
        { name: 'Energy', icon: 'systems/lancer/assets/icons/white/damage_energy.svg' },
        { name: 'Explosive', icon: 'systems/lancer/assets/icons/white/damage_explosive.svg' },
        { name: 'Heat', icon: 'systems/lancer/assets/icons/white/damage_heat.svg' },
        { name: 'Burn', icon: 'systems/lancer/assets/icons/white/damage_burn.svg' }
    ];
    if (getModuleSetting('enableInfectionDamageIntegration'))
        damageTypes.push({ name: 'Infection', icon: 'modules/lancer-automations/icons/infection.svg' });
    damageTypes.push({ name: 'AoE', icon: 'systems/lancer/assets/icons/white/aoe_blast.svg' });
    const damageTypeIconsHtml = damageTypes.map(dmgType => `
        <div class="bonus-immunity-damage-option te-icon-option" data-type="${dmgType.name}" title="${dmgType.name}">
            <img src="${dmgType.icon}" width="24" height="24">
        </div>
    `).join('');

    const content = buildEffectManagerContent({
        hasCustomStatus,
        allPresets,
        targetsHtml,
        tokensHtml,
        originsHtml,
        durationOptionsHtml,
        bonusDurationOptionsHtml,
        dmgTypeOptionsHtml,
        statusEffectIconsHtml,
        damageTypeIconsHtml,
        savedStatuses,
        availableTags,
        STAT_BONUS_GROUPS,
    });

    // White target mark, yellow tethered mark on every reference token, while the manager is open.
    const emMarks = createDurationMarks();
    const clearEmHighlight = () => emMarks.destroy();
    const highlightEmToken = (tokenId, originIds = []) =>
    {
        emMarks.update({
            targetTokens: _emTargetIds(tokenId).map(id => canvas.tokens?.get(id)),
            originTokens: originIds.flatMap(id => _emTargetIds(id)).map(id => canvas.tokens?.get(id)),
        });
    };

    const dialog = new Dialog({
        title: localize('LA.dialogTitle.effectManager'),
        content: content,
        buttons: {},
        close: () =>
        {
            $(document).off('click.la-multiselect');
            $(document).off('.la-em-trigger');
        },
        render: (html) =>
        {
            const root = html[0] ?? html.get(0);
            const dlg = /** @type {any} */ (dialog);

            const _rebuildDurationSelects = () =>
            {
                const inCombat = !!game.combat;
                const def = 'indefinite';
                const opts = allDurations
                    .filter(duration => inCombat || duration.label === 'indefinite' || duration.label === 'permanent')
                    .map(duration => `<option value="${duration.label}">${duration.name}</option>`).join('');
                const bonusOpts = opts + '<option value="constant">Constant (no icon, always active)</option>';
                for (const id of ['#std-duration', '#cust-duration'])
                {
                    const $sel = html.find(id);
                    if (!$sel.length)
                        continue;
                    const cur = String($sel.val() ?? '');
                    $sel.html(opts);
                    $sel.val($sel.find(`option[value="${cur}"]`).length ? cur : def);
                    $sel.trigger('change');
                }
                const $bonusSel = html.find('#bonus-duration');
                if ($bonusSel.length)
                {
                    const bonusCur = String($bonusSel.val() ?? '');
                    $bonusSel.html(bonusOpts);
                    $bonusSel.val(($bonusSel.find(`option[value="${bonusCur}"]`).length ? bonusCur : def));
                    $bonusSel.trigger('change');
                }
                constrainStdDuration();
                constrainCustDuration();
                constrainDurationForTarget();
            };
            const _onCombatChange = () => _rebuildDurationSelects();
            Hooks.on('createCombat', _onCombatChange);
            Hooks.on('deleteCombat', _onCombatChange);
            Hooks.on('combatStart', _onCombatChange);
            dlg._laCombatHooks = _onCombatChange;

            if (root && typeof ResizeObserver !== 'undefined' && !dlg._laResizeObserver)
            {
                let lastScrollHeight = 0;
                let rafId = 0;
                const refit = () =>
                {
                    rafId = 0;
                    if (!dlg.element?.length)
                        return;
                    const currentHeight = root.scrollHeight;
                    if (currentHeight === lastScrollHeight || currentHeight === 0)
                        return;
                    lastScrollHeight = currentHeight;
                    dlg.setPosition(/** @type {any} */ ({ height: 'auto', left: dlg.position.left, top: dlg.position.top }));
                };
                const resizeObserver = new ResizeObserver(() =>
                {
                    if (rafId)
                        cancelAnimationFrame(rafId);
                    rafId = requestAnimationFrame(refit);
                });
                resizeObserver.observe(root);
                dlg._laResizeObserver = resizeObserver;
            }

            // Highlight the active tab's target token on the scene. Tab keys differ from select prefixes.
            const TAB_TARGET_PREFIX = { standard: 'std', custom: 'cust', bonus: 'bonus', manage: 'manage' };
            const TAB_ORIGIN_SELECT = { std: '#std-origin', cust: '#cust-origin', bonus: '#bonus-durOrigin' };
            const TAB_TRIGGER_SELECT = { std: '#std-trigger-origin', cust: '#cust-trigger-origin', bonus: '#bonus-trigger-origin' };
            const TAB_DURATION_SELECT = { std: '#std-duration', cust: '#cust-duration', bonus: '#bonus-duration' };
            const refreshEmHighlight = () =>
            {
                const prefix = TAB_TARGET_PREFIX[html.find('.te-tab.active').data('tab')] || 'std';
                const label = String(html.find(TAB_DURATION_SELECT[prefix] ?? '').val() ?? '');
                const turnBased = label === 'end' || label === 'start';
                const originSelect = TAB_ORIGIN_SELECT[prefix];
                const triggerSelect = TAB_TRIGGER_SELECT[prefix];
                const origins = [];
                if (turnBased && originSelect)
                    origins.push(html.find(originSelect).val());
                // Trigger origin only matters once a consumption trigger is checked.
                if (triggerSelect && html.find(`#${prefix}-trigger input:checked`).length)
                    origins.push(html.find(triggerSelect).val());
                highlightEmToken(html.find(`#${prefix}-target`).val(), origins.filter(Boolean));
            };
            html.find('#std-target, #cust-target, #bonus-target, #manage-target').on('change', refreshEmHighlight);
            html.find('#std-origin, #cust-origin, #bonus-durOrigin').on('change', refreshEmHighlight);
            html.find('#std-trigger-origin, #cust-trigger-origin, #bonus-trigger-origin').on('change', refreshEmHighlight);
            html.find('#std-duration, #cust-duration, #bonus-duration').on('change', refreshEmHighlight);

            // One target for the whole manager: Standard / Custom / Bonus / Manage stay in step.
            const EM_TARGET_IDS = ['std-target', 'cust-target', 'bonus-target', 'manage-target'];
            let syncingTargets = false;
            const syncEmTargets = (sourceId) =>
            {
                if (syncingTargets)
                    return;
                syncingTargets = true;
                const ids = _emTargetIds(html.find(`#${sourceId}`).val());
                for (const id of EM_TARGET_IDS)
                {
                    if (id === sourceId)
                        continue;
                    const $select = html.find(`#${id}`);
                    // Manage lists one actor's effects, so it follows the first target only.
                    const next = id === 'manage-target' ? ids.slice(0, 1) : ids;
                    if (!$select.length || _emTargetIds($select.val()).join(',') === next.join(','))
                        continue;
                    _setEmTargetValue($select, next);
                }
                syncingTargets = false;
            };
            html.find('#std-target, #cust-target, #bonus-target, #manage-target').on('change', function ()
            {
                syncEmTargets(String(this.id));
            });
            syncEmTargets('std-target');

            // Several targets default to each being its own duration reference.
            html.find('#std-target, #cust-target, #bonus-target').on('change', function ()
            {
                const prefix = String(this.id).replace('-target', '');
                const $origin = html.find(TAB_ORIGIN_SELECT[prefix]);
                const ids = _emTargetIds($(this).val());
                if (ids.length > 1 && String($origin.val()) !== ANY_TURN_ORIGIN)
                    $origin.val(EACH_ORIGIN).change();
                else if (String($origin.val()) === EACH_ORIGIN)
                    $origin.val(ids[0] ?? '').change();
            });

            // Tier pills only where a tier can matter; std/cust also hide for live-token targets (direct apply, no template).
            const updateTierSlots = () =>
            {
                for (const tab of ['std', 'cust', 'bonus'])
                {
                    const targetID = String(html.find(`#${tab}-target`).val() ?? '');
                    const { actor, item, token } = _resolveEmTarget(targetID);
                    const liveOnly = tab !== 'bonus' && !!token && !item;
                    html.find(`.em-tier-slot[data-tab="${tab}"]`).toggle(!liveOnly && tierGateApplies(item ?? actor));
                }
            };
            updateTierSlots();
            html.find('#std-target, #cust-target, #bonus-target').on('change', updateTierSlots);
            bindTierGate(html, () =>
            {});

            html.find('.te-tab').click(e =>
            {
                const tab = $(e.currentTarget).data('tab');
                html.find('.te-tab').removeClass('active');
                html.find('.te-content').removeClass('active');
                $(e.currentTarget).addClass('active');
                html.find(`#tab-${tab}`).addClass('active');
                if (tab === 'manage')
                    updateManageList();
                if (tab === 'bonus')
                    updateBonusList();
                refreshEmHighlight();
                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            });
            refreshEmHighlight();

            const toggleDurOpts = (prefix) =>
            {
                const val = html.find(`#${prefix}-duration`).val();
                const $opts = html.find(`#${prefix}-duration`).siblings('.dur-opts');
                const isRound = val === 'roundEnd' || val === 'roundStart';
                if (val === 'indefinite' || val === 'permanent' || val === 'encounter')
                    $opts.hide();
                else
                    $opts.show();
                if (isRound)
                    $opts.filter('.dur-origin').hide();
                $opts.filter('.dur-count').text(isRound ? 'Rounds:' : 'Turns:');
                $opts.filter('input').attr('title', isRound ? 'Rounds, counting the current one' : '0 = next matching trigger (end/start of the current or next turn)');
                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            };
            html.find('#std-duration').change(() => toggleDurOpts('std'));
            html.find('#cust-duration').change(() => toggleDurOpts('cust'));
            toggleDurOpts('std');
            toggleDurOpts('cust');

            setupTriggerUI(html, 'std');
            setupTriggerUI(html, 'cust');

            html.find('.manage-close').click(() => dialog.close());

            const _syncIconPreview = (inputId) =>
            {
                const path = String(html.find(`#${inputId}`).val() ?? '');
                const $img = html.find(`#${inputId}-preview`);
                if ($img.length)
                {
                    $img.attr('src', path);
                    $img[0].style.opacity = '1';
                }
            };
            const _syncCustIconPreview = () => _syncIconPreview('cust-icon');

            // File Picker: honors the button's data-target so each input has its own.
            html.find('.file-picker').click(function ()
            {
                const targetId = $(this).data('target') || 'cust-icon';
                const input = html.find(`#${targetId}`);
                new FilePicker({
                    type: "image",
                    callback: (path) =>
                    {
                        input.val(path);
                        _syncIconPreview(targetId);
                    }
                }).browse(String(input.val()));
            });

            html.find('#cust-icon').on('input change', _syncCustIconPreview);
            html.find('#bonus-icon').on('input change', () => _syncIconPreview('bonus-icon'));

            const _findStatusDesc = (id) =>
            {
                const statusEffect = (CONFIG.statusEffects ?? []).find(se => se.id === id || se.name === id);
                if (!statusEffect)
                    return '';
                const desc = /** @type {any} */ (statusEffect).description;
                return typeof desc === 'string' && desc.trim() ? localize(desc) : '';
            };
            let _laHoverTip = null;
            const _hideEffectTooltip = () =>
            {
                _laHoverTip?.remove();
                _laHoverTip = null;
            };
            const _showEffectTooltip = (anchor, label, desc) =>
            {
                _hideEffectTooltip();
                if (!desc)
                    return;
                const tip = $(htmlToElement(`<div class="la-status-tooltip" style="position:fixed;z-index:9999;background:#1a1a1a;color:#eee;border:1px solid #555;border-radius:3px;padding:6px 8px;max-width:280px;font-size:0.78em;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.6);">
                    <div style="font-weight:bold;color:#fff;margin-bottom:4px;">${label}</div>
                    <div style="color:#bbb;line-height:1.4;">${desc}</div>
                </div>`));
                tip.appendTo(document.body);
                const rect = anchor.getBoundingClientRect();
                const tooltipHeight = tip.outerHeight() ?? 0;
                const top = Math.min(rect.top, window.innerHeight - tooltipHeight - 8);
                tip.css({ top, left: rect.right + 6 });
                _laHoverTip = tip;
            };
            const _attachEffectHoverTooltip = (selector, idAttr) =>
            {
                let timer = null;
                html.find(selector)
                    .on('mouseenter', function ()
                    {
                        const id = $(this).attr(idAttr) ?? $(this).data('name');
                        const label = String($(this).data('name') ?? id ?? '');
                        const desc = _findStatusDesc(String(id));
                        if (!desc)
                            return;
                        const el = this;
                        timer = setTimeout(() => _showEffectTooltip(el, label, desc), 500);
                    })
                    .on('mouseleave', function ()
                    {
                        if (timer)
                        {
                            clearTimeout(timer);
                            timer = null;
                        }
                        _hideEffectTooltip();
                    });
            };
            _attachEffectHoverTooltip('.std-effect-option', 'data-id');
            _attachEffectHoverTooltip('.bonus-immunity-effect-option', 'data-effect');

            html.find('#bonus-frequency').on('change', function ()
            {
                html.find('#bonus-frequency-count').css('display', $(this).val() ? '' : 'none');
            });

            html.find('.bonus-uses-step').on('click', function ()
            {
                const step = Number($(this).data('step')) || 0;
                const $input = html.find('#bonus-uses');
                const currentUses = Number.parseInt(String($input.val() ?? ''));
                const nextUses = Number.isFinite(currentUses) ? currentUses + step : (step > 0 ? 1 : 0);
                if (nextUses < 1)
                    $input.val('');
                else
                    $input.val(nextUses);
            });

            html.find('.la-num-step').on('click', function ()
            {
                const target = String($(this).data('target') ?? '');
                if (!target)
                    return;
                const step = Number($(this).data('step')) || 0;
                const $input = html.find(`#${target}`);
                if (!$input.length)
                    return;
                const min = Number($input.attr('min'));
                const currentValue = Number.parseInt(String($input.val() ?? '0'));
                let nextValue = (Number.isFinite(currentValue) ? currentValue : 0) + step;
                if (Number.isFinite(min) && nextValue < min)
                    nextValue = min;
                $input.val(nextValue).trigger('change');
            });

            // fresh read, the render snapshot goes stale after a save
            const findSavedStatus = (/** @type {string} */ name) =>
            {
                if (!hasCustomStatus)
                    return null;
                const list = /** @type {any[]} */ (game.settings.get('temporary-custom-statuses', 'savedStatuses') || []);
                return list.find(saved => saved.name === name) || null;
            };

            html.find('#cust-saved').change(event =>
            {
                const savedStatusName = $(event.currentTarget).val();
                if (savedStatusName)
                {
                    html.find('#cust-name').val(savedStatusName);
                    html.find('#cust-description').val(findSavedStatus(String(savedStatusName))?.description ?? '');
                    const icon = $(event.currentTarget).find(':selected').data('icon');
                    if (icon)
                    {
                        html.find('#cust-icon').val(icon);
                        html.find('#cust-saved-icon').attr('src', icon).show();
                        _syncCustIconPreview();
                    }
                    else
                        html.find('#cust-saved-icon').hide();
                }
                else
                    html.find('#cust-saved-icon').hide();
                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            });

            html.find('.std-effect-option').click(function()
            {
                const id = $(this).data('id');
                const name = $(this).data('name');
                const icon = $(this).data('icon');
                html.find('#std-effect').val(id);
                html.find('#std-effect-label').text(name);
                html.find('#std-effect-icon').attr('src', icon).attr('title', name).show();
                html.find('.std-effect-option').css({ background: 'var(--la-plate)', borderLeftColor: 'transparent', color: 'var(--la-ink)' });
                $(this).css({ background: '#b8d4f0', borderLeftColor: '#1a4a7a', color: '#111' });
            }).on('mouseenter', function ()
            {
                const clip = this.querySelector('.la-hud-clip');
                const pan = this.querySelector('.la-hud-pan');
                if (clip && pan)
                {
                    const overflow = pan.scrollWidth - clip.clientWidth;
                    if (overflow > 4)
                        $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                }
            }).on('mouseleave', function ()
            {
                $(this).find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
            });

            const initStdGrid = () =>
            {
                const initialId = html.find('#std-effect').val();
                const $initOpt = html.find(`.std-effect-option[data-id="${initialId}"]`);
                if ($initOpt.length)
                    $initOpt.click();
                else
                {
                    // Fallback to first if initial hidden value doesn't match a data-id
                    html.find('.std-effect-option').first().click();
                }
            };
            initStdGrid();

            html.find('#std-effect-search').on('input', function ()
            {
                const query = String($(this).val() ?? '').toLowerCase().trim();
                html.find('.std-effect-option').each(function ()
                {
                    const name = String($(this).data('name') ?? '').toLowerCase();
                    $(this).toggle(!query || name.includes(query));
                });
                html.find('.std-effect-group').each(function ()
                {
                    const options = html.find(`.std-effect-option[data-group="${$(this).data('group')}"]`).toArray();
                    $(this).toggle(options.some(option => option.style.display !== 'none'));
                });
            });

            html.find('.save-status-btn').click(async () =>
            {
                const name = String(html.find('#cust-name').val() || '').trim();
                const icon = String(html.find('#cust-icon').val() || '').trim();
                const description = String(html.find('#cust-description').val() || '').trim();
                if (!name)
                    return ui.notifications.warn(localize('LA.notify.nameIsRequiredToSaveAStatus'));
                if (!icon)
                    return ui.notifications.warn(localize('LA.notify.iconIsRequiredToSaveAStatus'));
                const list = game.settings.get('temporary-custom-statuses', 'savedStatuses') || [];
                const existing = list.find(saved => saved.name === name);
                if (existing)
                {
                    existing.icon = icon;
                    existing.description = description;
                }
                else
                    list.push({ name, icon, description });
                await game.settings.set('temporary-custom-statuses', 'savedStatuses', list);
                game.modules.get('temporary-custom-statuses')?.api?.syncStatusEffects?.();
                // Refresh the Saved dropdown so the new entry is selectable immediately.
                const $sel = html.find('#cust-saved');
                const prev = String($sel.val() || '');
                $sel.find('option:not(:first)').remove();
                for (const savedStatus of list)
                    $sel.append(`<option value="${savedStatus.name}" data-icon="${savedStatus.icon}">${savedStatus.name}</option>`);
                $sel.val(prev || name);
                ui.notifications.info(localizeFormat('LA.notify.savedCustomStatus', { name }));
            });

            const _codeFieldMeta = {
                'bonus-condition':        { title: localize('LA.effectManager.codeField.condition'),            def: '(state, actor, data, context) => { return true; }' },
                'bonus-applyToCondition': { title: localize('LA.effectManager.codeField.applyToCondition'),   def: '(target, state, reactorToken) => { return true; }' },
                'std-evaluate':           { title: localize('LA.effectManager.codeField.consumptionEvaluate'), def: '(triggerType, triggerData, effectBearerToken, effect) => { return true; }' },
                'cust-evaluate':          { title: localize('LA.effectManager.codeField.consumptionEvaluate'), def: '(triggerType, triggerData, effectBearerToken, effect) => { return true; }' },
                'cust-changes':           { title: localize('LA.effectManager.codeField.activeEffectChanges'), def: '// Modes: 0=CUSTOM 1=MULTIPLY 2=ADD 3=DOWNGRADE 4=UPGRADE 5=OVERRIDE\n[\n // { "key": "system.armor", "mode": 2, "value": 1 }\n]' },
            };
            // Immunity flips who is who: the bearer is the defender, so the other party is the attacker.
            const _immunityCodeDefs = {
                'bonus-condition':        '(state, attacker, data, context) => { return true; }',
                'bonus-applyToCondition': '(attacker, state, me) => { return true; }',
            };
            const _rebuildPresetSelect = (prefix) =>
            {
                const cat = presetCategoryFor(prefix);
                const presets = getStoredPresets()[cat] || [];
                const $sel = html.find(`#${prefix}-preset-load`);
                const prev = String($sel.val() || '');
                $sel.empty();
                $sel.append('<option value="">— Load —</option>');
                for (const preset of presets)
                    $sel.append(`<option value="${preset.name}">${preset.name}</option>`);
                $sel.val(prev);
            };
            html.find('.save-preset-btn').click(async function ()
            {
                const prefix = $(this).data('prefix');
                const cat = presetCategoryFor(prefix);
                const name = await new Promise((resolve) =>
                {
                    new Dialog({
                        title: localize('LA.dialogTitle.savePreset'),
                        content: '<p style="padding:6px 8px;">Preset name:</p><input type="text" id="preset-name-input" style="width:100%; padding:4px;">',
                        buttons: {
                            save: { icon: '<i class="fas fa-save"></i>', label: localize('LA.common.save'), callback: (dlgHtml) => resolve(String(dlgHtml.find('#preset-name-input').val() || '').trim()) },
                            cancel: cancelButton(() => resolve(''))
                        },
                        default: 'save',
                        close: () => resolve(''),
                        render: (dlgHtml) => setTimeout(() => dlgHtml.find('#preset-name-input').focus(), 50)
                    }, { classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
                });
                if (!name)
                    return;
                const all = getStoredPresets();
                const data = gatherPresetData(html, prefix);
                const existing = all[cat].find(p => p.name === name);
                if (existing)
                {
                    const overwrite = await new Promise((resolve) =>
                    {
                        new Dialog({
                            title: localize('LA.dialogTitle.presetExists'),
                            content: `<p style="padding:6px 8px;">${localizeFormat('LA.effectManager.presetExists', { name })}</p>`,
                            buttons: {
                                yes: { icon: '<i class="fas fa-check"></i>', label: localize('LA.effectManager.mode.overwrite'), callback: () => resolve(true) },
                                no:  cancelButton(() => resolve(false))
                            },
                            default: 'yes',
                            close: () => resolve(false)
                        }, { classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
                    });
                    if (!overwrite)
                        return;
                    existing.data = data;
                }
                else
                    all[cat].push({ name, data });
                await setStoredPresets(all);
                _rebuildPresetSelect(prefix);
                html.find(`#${prefix}-preset-load`).val(name);
                renderManagePresets();
                ui.notifications.info(localizeFormat('LA.notify.savedPreset', { name }));
            });
            html.find('#std-preset-load, #cust-preset-load, #bonus-preset-load').change(function ()
            {
                const name = String($(this).val() || '');
                if (!name)
                    return;
                const id = this.id;
                const prefix = id.startsWith('std') ? 'std' : id.startsWith('cust') ? 'cust' : 'bonus';
                const cat = presetCategoryFor(prefix);
                const preset = getStoredPresets()[cat].find(p => p.name === name);
                if (!preset)
                    return;
                applyPresetData(html, prefix, preset.data);
                ui.notifications.info(localizeFormat('LA.notify.loadedPreset', { name }));
            });
            html.find('.std-preset-delete, .cust-preset-delete, .bonus-preset-delete').click(async function ()
            {
                const prefix = $(this).closest('.preset-bar').data('prefix');
                const $sel = html.find(`#${prefix}-preset-load`);
                const name = String($sel.val() || '');
                if (!name)
                    return ui.notifications.warn(localize('LA.notify.selectAPresetToDeleteFirst'));
                const all = getStoredPresets();
                const cat = presetCategoryFor(prefix);
                all[cat] = (all[cat] || []).filter(p => p.name !== name);
                await setStoredPresets(all);
                _rebuildPresetSelect(prefix);
                $sel.val('');
                renderManagePresets();
                ui.notifications.info(localizeFormat('LA.notify.deletedPreset', { name }));
            });

            const renderManagePresets = () =>
            {
                const all = getStoredPresets();
                const rows = [];
                for (const [cat, prefix, label] of [['standard', 'std', 'Standard'], ['custom', 'cust', 'Custom'], ['bonus', 'bonus', 'Bonus']])
                {
                    for (const preset of (all[cat] ?? []))
                    {
                        rows.push(`<div style="display:flex; align-items:center; gap:6px;" data-cat="${cat}" data-prefix="${prefix}" data-name="${preset.name}">
                            <span style="flex:0 0 62px; font-size:0.75em; opacity:0.7; text-transform:uppercase;">${label}</span>
                            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${preset.name}</span>
                            <button type="button" class="te-btn-icon manage-preset-load" title="Load in its tab" style="flex:0 0 28px; width:28px; height:24px; padding:0;"><i class="fas fa-file-import"></i></button>
                            <button type="button" class="te-btn-icon manage-preset-delete" title="Delete" style="flex:0 0 28px; width:28px; height:24px; padding:0;"><i class="fas fa-trash"></i></button>
                        </div>`);
                    }
                }
                html.find('#manage-presets-list').html(rows.join('') || '<p style="opacity:0.6; margin:2px 0;">No presets saved.</p>');
            };
            renderManagePresets();
            html.find('#manage-presets-list').on('click', '.manage-preset-load', function ()
            {
                const row = $(this).closest('[data-name]');
                const cat = String(row.data('cat'));
                const prefix = String(row.data('prefix'));
                const name = String(row.data('name'));
                const preset = (getStoredPresets()[cat] ?? []).find(entry => entry.name === name);
                if (!preset)
                    return;
                const tabButton = html.find(`.te-tab[data-tab="${cat}"]`);
                if (!tabButton.length)
                    return ui.notifications.warn(localize('LA.notify.thatTabIsNotAvailable'));
                tabButton.trigger('click');
                applyPresetData(html, prefix, preset.data);
                html.find(`#${prefix}-preset-load`).val(name);
            });
            html.find('#manage-presets-list').on('click', '.manage-preset-delete', async function ()
            {
                const row = $(this).closest('[data-name]');
                const cat = String(row.data('cat'));
                const prefix = String(row.data('prefix'));
                const name = String(row.data('name'));
                const all = getStoredPresets();
                all[cat] = (all[cat] ?? []).filter(entry => entry.name !== name);
                await setStoredPresets(all);
                _rebuildPresetSelect(prefix);
                renderManagePresets();
                ui.notifications.info(localizeFormat('LA.notify.deletedPreset', { name }));
            });

            const formatSnippet = (obj) => JSON.stringify(obj, null, 4)
                .replaceAll(/"([A-Za-z_$][A-Za-z0-9_$]*)":/g, '$1:')
                .replaceAll('"__REACTOR_TOKENS__"', '[reactorToken]')
                .replaceAll('"__REACTOR_ID__"', 'reactorToken.id');

            const pruneSnippet = (obj) =>
            {
                const out = {};
                for (const [key, value] of Object.entries(obj))
                {
                    if (value === undefined || value === null || value === '' || value === false)
                        continue;
                    if (Array.isArray(value) && value.length === 0)
                        continue;
                    out[key] = value;
                }
                return out;
            };

            // "roll" is a UI grouping; the stored type is the acc/diff sub-select.
            const selectedBonusType = () =>
            {
                const type = String(html.find('#bonus-type').val());
                return type === 'roll' ? String(html.find('#bonus-rollType').val()) : type;
            };

            const buildExtractedCode = (tab) =>
            {
                if (tab === 'bonus')
                {
                    const type = selectedBonusType();
                    const { bonusData, addOptions, duration } = gatherBonusFormData(html, type);
                    const prunedBonus = pruneSnippet(bonusData);
                    if (duration === 'constant')
                        return `await api.addConstantBonus(reactorToken.actor, ${formatSnippet(prunedBonus)});`;
                    const options = pruneSnippet({ ...addOptions, origin: '__REACTOR_ID__', forcePrototype: undefined });
                    return `await api.addGlobalBonus(reactorToken.actor, ${formatSnippet(prunedBonus)}, ${formatSnippet(options)});`;
                }
                const prefix = tab === 'standard' ? 'std' : 'cust';
                const { label: durationLabel } = durationChoice(String(html.find(`#${prefix}-duration`).val()), String(html.find(`#${prefix}-origin`).val()));
                const turnsRaw = Number.parseInt(String(html.find(`#${prefix}-turns`).val()));
                const turns = Number.isNaN(turnsRaw) ? 1 : Math.max(0, turnsRaw);
                const stack = Number.parseInt(String(html.find(`#${prefix}-stack`).val())) || 1;
                const note = String(html.find(`#${prefix}-note`).val());
                const duration = buildDuration(durationLabel, '', turns);
                delete duration._preAdjusted;
                if (['end', 'start'].includes(durationLabel))
                    duration.overrideTurnOriginId = '__REACTOR_ID__';
                const extraOptions = {};
                if (stack > 1)
                    extraOptions.stack = stack;
                const consumption = getTriggerConfig(html, prefix);
                if (consumption)
                    extraOptions.consumption = consumption;
                const tier = readTierGate(html.find(`.la-tier-gate[data-role="em-${prefix}"]`)[0]);
                if (tier)
                    extraOptions.tier = tier;
                let effectNames;
                if (tab === 'standard')
                    effectNames = String(html.find('#std-effect').val());
                else
                {
                    const snippetName = String(html.find('#cust-name').val());
                    const snippetDescription = String(html.find('#cust-description').val() || '').trim();
                    effectNames = pruneSnippet({
                        name: snippetName,
                        icon: String(html.find('#cust-icon').val()),
                        isCustom: true,
                        description: findSavedStatus(snippetName) ? '' : snippetDescription
                    });
                    const changesSrc = String(html.find('#cust-changes-value').val() || '').trim();
                    if (changesSrc)
                    {
                        try
                        {
                            extraOptions.changes = (new Function(`return (${changesSrc});`))();
                        }
                        catch
                        {
                            ui.notifications.warn(localize('LA.notify.activeEffectChangesCouldNotBeParsed'));
                        }
                    }
                }
                const options = pruneSnippet({ tokens: '__REACTOR_TOKENS__', effectNames, note, duration });
                const hasExtra = Object.keys(extraOptions).length > 0;
                return `await api.applyEffectsToTokens(${formatSnippet(options)}${hasExtra ? `, ${formatSnippet(extraOptions)}` : ''});`;
            };

            const showExtractedCode = (code) =>
            {
                let editor;
                let resizeObserver;
                new Dialog({
                    title: localize('LA.dialogTitle.extractCode'),
                    content: `<div class="lcm-host"></div>
                        <style>
                            .lcm-dialog .window-content { padding:0 !important; overflow:hidden !important; background:#272822; }
                            .lcm-dialog .dialog-buttons { height:40px !important; min-height:40px !important; max-height:40px !important; background:#333 !important; border-top:1px solid #111 !important; padding:0 !important; margin:0 !important; display:flex !important; }
                            .lcm-dialog button.dialog-button { background:#444 !important; color:#fff !important; border:none !important; border-right:1px solid #222 !important; width:100% !important; height:100% !important; margin:0 !important; display:flex !important; align-items:center !important; justify-content:center !important; font-size:1em !important; border-radius:0 !important; box-shadow:none !important; }
                            .lcm-dialog button.dialog-button:last-child { border-right:none !important; }
                            .lcm-dialog button.dialog-button:hover { background:#555 !important; }
                        </style>`,
                    buttons: {
                        copy: {
                            label: localize('LA.common.copy'),
                            icon: '<i class="fas fa-copy" style="margin-right:8px;"></i>',
                            callback: async () =>
                            {
                                await navigator.clipboard.writeText(code);
                                ui.notifications.info(localize('LA.notify.copiedToClipboard'));
                            }
                        },
                        close: {
                            label: localize('LA.common.close'),
                            icon: '<i class="fas fa-times" style="margin-right:8px;"></i>'
                        }
                    },
                    default: 'copy',
                    render: (dlgHtml) =>
                    {
                        const host = dlgHtml.find('.lcm-host')[0];
                        if (typeof CodeMirror === 'undefined')
                        {
                            host.innerHTML = '<textarea readonly spellcheck="false" style="width:100%; height:100%; font-family:var(--font-mono, monospace); font-size:12px; white-space:pre; resize:none;"></textarea>';
                            host.firstChild.value = code;
                            return;
                        }
                        editor = CodeMirror(host, {
                            value: code,
                            mode: 'javascript',
                            theme: 'monokai',
                            lineNumbers: true,
                            matchBrackets: true,
                            readOnly: true,
                            indentUnit: 4,
                            lineWrapping: false,
                            scrollbarStyle: "native"
                        });
                        const windowEl = dlgHtml.closest('.window-app')[0];
                        resizeObserver = attachEditorResizeObserver(editor, windowEl);
                    },
                    close: () =>
                    {
                        resizeObserver?.disconnect();
                    }
                }, {
                    width: 700,
                    height: 460,
                    resizable: true,
                    classes: ["dialog", "lcm-dialog", "lancer-dialog-base", "lancer-no-title"]
                }).render(true);
            };

            html.find('.extract-code-btn').click(function ()
            {
                const tab = $(this).data('tab');
                try
                {
                    showExtractedCode(buildExtractedCode(tab));
                }
                catch (err)
                {
                    ui.notifications.error(localizeFormat('LA.notify.extractFailed', { error: err.message }));
                }
            });

            html.find('.code-field-badge').click(function ()
            {
                const id = $(this).data('target');
                const meta = _codeFieldMeta[id] ?? { title: localize('LA.effectManager.codeField.code'), def: '' };
                const isDefense = ['immunity', 'resistance', 'vulnerability'].includes(String(html.find('#bonus-type').val() ?? ''));
                const def = (isDefense && _immunityCodeDefs[id]) ? _immunityCodeDefs[id] : meta.def;
                openCodeFieldDialog(html, id, meta.title, def);
            });
            html.find('.code-clear-btn').click(function ()
            {
                const id = $(this).data('target');
                html.find(`#${id}-value`).val('');
                updateCodeFieldBadge(html, id);
            });

            html.find('.apply-btn').click(async (e) =>
            {
                e.preventDefault();
                const tab = $(e.currentTarget).data('tab');

                if (tab === 'standard')
                {
                    const targetID = String(html.find('#std-target').val());
                    const effectName = html.find('#std-effect').val();
                    const stack = Number.parseInt(String(html.find('#std-stack').val())) || 1;
                    const { label: durationLabel, originID } = durationChoice(String(html.find('#std-duration').val()), String(html.find('#std-origin').val()));
                    const note = String(html.find('#std-note').val());
                    const turnsInputRaw = Number.parseInt(String(html.find('#std-turns').val()));
                    const turnsInput = Number.isNaN(turnsInputRaw) ? 1 : Math.max(0, turnsInputRaw);

                    const perEach = originID === EACH_ORIGIN;
                    const docOrigin = perEach ? '' : originID;
                    const duration = buildDuration(durationLabel, docOrigin, turnsInput);

                    const consumption = getTriggerConfig(html, 'std');
                    const ownConsumptionOrigin = perEach && !consumption?.originId;
                    const extraOptions = {};
                    if (stack > 1 || consumption)
                        extraOptions.stack = stack;
                    if (consumption)
                    {
                        if (!consumption.originId)
                            consumption.originId = _emTargetIds(targetID)[0] ?? targetID;
                        extraOptions.consumption = consumption;
                    }
                    const stdTier = readTierGate(html.find('.la-tier-gate[data-role="em-std"]')[0]);
                    if (stdTier)
                        extraOptions.tier = stdTier;

                    const resolved = _resolveEmTargets(targetID);
                    const liveTokens = resolved.filter(entry => entry.token && !entry.item).map(entry => entry.token);
                    if (liveTokens.length)
                    {
                        for (const group of _emApplyGroups(liveTokens, originID))
                        {
                            const groupOptions = ownConsumptionOrigin
                                ? { ...extraOptions, consumption: { ...consumption, originId: group.origin } }
                                : extraOptions;
                            await applyEffectsToTokens({
                                tokens: group.tokens,
                                effectNames: effectName,
                                note: note,
                                duration: { ...buildDuration(durationLabel, group.origin, turnsInput), overrideTurnOriginId: group.origin },
                            }, groupOptions);
                        }
                        ui.notifications.info(localizeFormat('LA.notify.appliedTo', { effect: effectName, target: _emTargetLabel(liveTokens) }));
                    }
                    else
                    {
                        const { actor: resolvedActor, item: resolvedItem } = resolved[0] ?? {};
                        const doc = resolvedItem ?? resolvedActor;
                        if (!doc)
                            return ui.notifications.error(localize('LA.notify.targetNotFound'));
                        const linkOpts = {
                            effectNames: effectName,
                            note: note,
                            duration: { ...duration, overrideTurnOriginId: docOrigin },
                        };
                        if (doc.documentName === 'Item')
                            await linkEffectToItem({ items: [doc], ...linkOpts }, { ...extraOptions, addedViaUI: true });
                        else
                            await linkEffectToActor({ actors: [doc], ...linkOpts }, extraOptions);
                        ui.notifications.info(localizeFormat('LA.notify.appliedToDoc', { effect: effectName, target: doc.name, kind: doc.documentName === 'Item' ? ' (item)' : ' (prototype)' }));
                    }
                    setTimeout(updateManageTabCount, 200);

                }
                else if (tab === 'custom')
                {
                    const targetID = String(html.find('#cust-target').val());
                    const name = html.find('#cust-name').val();
                    const icon = html.find('#cust-icon').val();
                    const stack = Number.parseInt(String(html.find('#cust-stack').val())) || 1;
                    const { label: durationLabel, originID } = durationChoice(String(html.find('#cust-duration').val()), String(html.find('#cust-origin').val()));
                    const note = String(html.find('#cust-note').val());
                    const turnsInputRaw = Number.parseInt(String(html.find('#cust-turns').val()));
                    const turnsInput = Number.isNaN(turnsInputRaw) ? 1 : Math.max(0, turnsInputRaw);

                    if (!name)
                        return ui.notifications.error(localize('LA.notify.nameIsRequired'));

                    const perEach = originID === EACH_ORIGIN;
                    const docOrigin = perEach ? '' : originID;
                    const duration = buildDuration(durationLabel, docOrigin, turnsInput);

                    const consumption = getTriggerConfig(html, 'cust');
                    const ownConsumptionOrigin = perEach && !consumption?.originId;
                    const extraOptions = {};
                    if (stack > 1)
                        extraOptions.stack = stack;
                    if (consumption)
                    {
                        if (!consumption.originId)
                            consumption.originId = _emTargetIds(targetID)[0] ?? targetID;
                        extraOptions.consumption = consumption;
                        extraOptions.stack = stack;
                    }
                    const custTier = readTierGate(html.find('.la-tier-gate[data-role="em-cust"]')[0]);
                    if (custTier)
                        extraOptions.tier = custTier;
                    const changesSrc = String(html.find('#cust-changes-value').val() || '').trim();
                    if (changesSrc)
                    {
                        try
                        {
                            const parsed = (new Function(`return (${changesSrc});`))();
                            if (!Array.isArray(parsed))
                                return ui.notifications.error(localize('LA.notify.activeEffectChangesMustBeAnArray'));
                            extraOptions.changes = parsed;
                        }
                        catch (err)
                        {
                            return ui.notifications.error(localizeFormat('LA.notify.aeChangesParseError', { error: err.message }));
                        }
                    }

                    const resolved = _resolveEmTargets(targetID);
                    const liveTokens = resolved.filter(entry => entry.token && !entry.item).map(entry => entry.token);
                    // saved statuses resolve from CONFIG, stamp only one-offs
                    const description = String(html.find('#cust-description').val() || '').trim();
                    const stampDescription = description && !findSavedStatus(String(name));
                    const effectData = {
                        name: name,
                        icon: icon,
                        stack: stack,
                        isCustom: true,
                        ...(stampDescription ? { description } : {})
                    };
                    if (liveTokens.length)
                    {
                        for (const group of _emApplyGroups(liveTokens, originID))
                        {
                            const groupOptions = ownConsumptionOrigin
                                ? { ...extraOptions, consumption: { ...consumption, originId: group.origin } }
                                : extraOptions;
                            await applyEffectsToTokens({
                                tokens: group.tokens,
                                effectNames: effectData,
                                note: note,
                                duration: { ...buildDuration(durationLabel, group.origin, turnsInput), overrideTurnOriginId: group.origin },
                            }, groupOptions);
                        }
                        ui.notifications.info(localizeFormat('LA.notify.appliedTo', { effect: name, target: _emTargetLabel(liveTokens) }));
                    }
                    else
                    {
                        const { actor: resolvedActor, item: resolvedItem } = resolved[0] ?? {};
                        const doc = resolvedItem ?? resolvedActor;
                        if (!doc)
                            return ui.notifications.error(localize('LA.notify.targetNotFound'));
                        const linkOpts = {
                            effectNames: effectData,
                            note: note,
                            duration: { ...duration, overrideTurnOriginId: docOrigin },
                        };
                        if (doc.documentName === 'Item')
                            await linkEffectToItem({ items: [doc], ...linkOpts }, { ...extraOptions, addedViaUI: true });
                        else
                            await linkEffectToActor({ actors: [doc], ...linkOpts }, extraOptions);
                        ui.notifications.info(localizeFormat('LA.notify.appliedToDoc', { effect: name, target: doc.name, kind: doc.documentName === 'Item' ? ' (item)' : ' (prototype)' }));
                    }
                    setTimeout(updateManageTabCount, 200);
                }
            });

            const updateManageTabCount = () => renderManageTabCount(html);
            const updateManageList = () => renderManageList(html, dialog);

            html.find('#manage-target').change(updateManageList);
            html.find('.te-tab[data-tab="manage"]').click(updateManageList);

            const updateBonusList = () =>
            {
                const targetID = String(html.find('#bonus-target').val());
                const { actor: resolvedActor } = _resolveEmTarget(targetID);
                const summary = html.find('#bonus-summary');

                if (!resolvedActor)
                {
                    summary.text('—').removeClass('has-bonuses').attr('title', 'No target selected');
                    return;
                }
                const actor = resolvedActor;
                const bonuses = getLAFlag(actor,"global_bonuses") || [];
                const constantBonuses = getLAFlag(actor,"constant_bonuses") || [];
                const bonusTemplates = getLAFlag(actor,"bonusTemplates") || [];
                const total = bonuses.length + constantBonuses.length + bonusTemplates.length;
                if (total > 0)
                    summary.text(`${total} active`).addClass('has-bonuses').attr('title', `${total} active bonus${total > 1 ? 'es' : ''} — see Manage tab.`);
                else
                    summary.text('—').removeClass('has-bonuses').attr('title', 'No active bonuses');

                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            };

            // Durations valid for item / prototype-actor targets (no round or encounter anchor on a template).
            const _durationsAllowedForDoc = new Set(['indefinite', 'permanent', 'constant', 'end', 'start']);
            const _durationsAllowedForItem = new Set(['indefinite', 'constant']);
            const _constrainDurationDropdown = (targetSelector, durationSelector) =>
            {
                const tid = String(html.find(targetSelector).val());
                const { item, actor, token } = _resolveEmTarget(tid);
                const isDoc = !!(item || (actor && !token));
                const allowed = item ? _durationsAllowedForItem : _durationsAllowedForDoc;
                const $sel = html.find(durationSelector);
                if (!$sel.length)
                    return;
                $sel.find('option').each((_i, el) =>
                {
                    const opt = /** @type {HTMLOptionElement} */ (el);
                    opt.disabled = isDoc && !allowed.has(String(opt.value));
                    opt.hidden = !!item && opt.disabled;
                });
                if (isDoc && $sel.find('option:selected').is(':disabled'))
                    $sel.val('indefinite').trigger('change');
            };
            const constrainDurationForTarget = () => _constrainDurationDropdown('#bonus-target', '#bonus-duration');
            const constrainStdDuration = () => _constrainDurationDropdown('#std-target', '#std-duration');
            const constrainCustDuration = () => _constrainDurationDropdown('#cust-target', '#cust-duration');
            html.find('#bonus-target').on('change', constrainDurationForTarget);
            html.find('#std-target').on('change', constrainStdDuration);
            html.find('#cust-target').on('change', constrainCustDuration);
            constrainStdDuration();
            constrainCustDuration();
            html.find('#bonus-target').change(updateBonusList);

            const toggleBonusDurOpts = () =>
            {
                const val = html.find('#bonus-duration').val();
                const $opts = html.find('.bonus-dur-opts');
                const isRound = val === 'roundEnd' || val === 'roundStart';
                if (!val || val === 'indefinite' || val === 'permanent' || val === 'constant' || val === 'encounter')
                    $opts.hide();
                else
                    $opts.show();
                if (isRound)
                    $opts.filter('.dur-origin').hide();
                $opts.filter('.dur-count').text(isRound ? 'Rounds:' : 'Turns:');
                $opts.filter('input').attr('title', isRound ? 'Rounds, counting the current one' : '0 = next matching trigger (end/start of the current or next turn)');
                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            };
            html.find('#bonus-duration').on('change', toggleBonusDurOpts);
            toggleBonusDurOpts();
            constrainDurationForTarget();

            // Bonus consumption trigger filter toggle
            const bonusFilterMap = {
                onAttack: ['bonus-filter-itemLid', 'bonus-filter-itemId', 'bonus-filter-role'],
                onHit: ['bonus-filter-itemLid', 'bonus-filter-itemId', 'bonus-filter-role'],
                onMiss: ['bonus-filter-itemLid', 'bonus-filter-itemId', 'bonus-filter-role'],
                onPreDamage: ['bonus-filter-itemLid', 'bonus-filter-itemId', 'bonus-filter-role'],
                onDamage: ['bonus-filter-itemLid', 'bonus-filter-itemId', 'bonus-filter-role'],
                onTechAttack: ['bonus-filter-itemLid', 'bonus-filter-itemId', 'bonus-filter-role'],
                onTechHit: ['bonus-filter-itemLid', 'bonus-filter-itemId', 'bonus-filter-role'],
                onMove: ['bonus-filter-boost', 'bonus-filter-distance'],
                onPreMove: ['bonus-filter-boost', 'bonus-filter-distance'],
                onInitActivation: ['bonus-filter-actionName'],
                onActivation: ['bonus-filter-actionName'],
                onInitEndActivation: ['bonus-filter-actionName'],
                onEndActivation: ['bonus-filter-actionName'],
                onDeploy: ['bonus-filter-itemLid', 'bonus-filter-itemId'],
                onCheck: ['bonus-filter-check', 'bonus-filter-checkValues', 'bonus-filter-role'],
                onPreStatusApplied: ['bonus-filter-statusId'],
                onPreStatusRemoved: ['bonus-filter-statusId'],
                onStatusApplied: ['bonus-filter-statusId'],
                onStatusRemoved: ['bonus-filter-statusId']
            };

            initLaMultiSelect(html, 'bonus-trigger');
            $(document).off('change.la-em-bonus-trigger').on('change.la-em-bonus-trigger', '#bonus-trigger-panel input[type=checkbox]', function ()
            {
                const triggers = Array.from(document.querySelectorAll('#bonus-trigger-panel input:checked'), box => /** @type {HTMLInputElement} */ (box).value);
                const $fields = html.find('#bonus-trigger-fields');
                $fields.find('.form-group').hide();
                if (triggers.length > 0)
                {
                    $fields.show();
                    $fields.find('.form-group').first().show();
                    const classes = new Set(triggers.flatMap(trigger => bonusFilterMap[trigger] ?? []));
                    classes.forEach(cls => $fields.find(`.${cls}`).show());
                }
                else
                    $fields.hide();
                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            });

            // Bonus LID finder buttons
            html.find('#tab-bonus .find-lid-btn').on('click', function (e)
            {
                e.preventDefault();
                const targetId = $(this).data('target');
                openItemBrowser(html.find(`#${targetId}`));
            });

            // Token selector buttons (interactive picking)
            html.find('.token-picker-btn').on('click', async function (e)
            {
                e.preventDefault();
                const targetId = $(this).data('target');
                // Origin fields hold one token, so Shift-click can't extend them.
                const single = !['std-target', 'cust-target', 'bonus-target', 'bonus-applyTo'].includes(targetId);
                const api = game.modules.get(MODULE_ID).api;
                const currentIds = _emTargetIds(html.find(`#${targetId}`).val());

                // Use currently selected token as caster for the selection tool context if possible
                const caster = canvas.tokens.get(currentIds[0] ?? '') || canvas.tokens.controlled[0];

                // Reference picks (duration / trigger origin) mark yellow and tether back to the target.
                const prefix = TAB_TARGET_PREFIX[html.find('.te-tab.active').data('tab')] || 'std';
                const anchors = single
                    ? _emTargetIds(html.find(`#${prefix}-target`).val()).map(id => canvas.tokens.get(id)).filter(Boolean)
                    : [];

                clearEmHighlight(); // drop the target highlight so it doesn't clash with the canvas picker
                const selected = await api.pickTokensCardless(caster, {
                    includeSelf: true,
                    single: single,
                    preselected: single ? [] : currentIds,
                    markColor: single ? TG.placed : TG.reference,
                    linkFrom: anchors,
                });

                if (selected && selected.length > 0)
                    _setEmTargetValue(html.find(`#${targetId}`), selected.map(token => token.id));
                refreshEmHighlight();
            });

            // Specific Item ID selector buttons (interactive picking)
            html.find('.item-picker-btn').on('click', async function (e)
            {
                e.preventDefault();
                const targetId = $(this).data('target');

                // trace token from bonus-applyTo or currently controlled
                const applyToStr = String(html.find('#bonus-applyTo').val());
                let targetToken = null;

                if (applyToStr)
                {
                    const firstTargetId = applyToStr.split(',')[0].trim();
                    targetToken = canvas.tokens.get(firstTargetId);
                }
                if (!targetToken)
                    targetToken = canvas.tokens.controlled[0];

                if (!targetToken?.actor)
                {
                    ui.notifications.warn(localize('LA.notify.pleaseSelectATargetTokenOnThe'));
                    return;
                }

                const items = targetToken.actor.items.filter(item => !['skill', 'talent', 'core_bonus', 'integrated'].includes(item.type));
                if (items.length === 0)
                {
                    ui.notifications.warn(localizeFormat('LA.notify.noValidItems', { name: targetToken.name }));
                    return;
                }

                items.sort((a, b) =>
                {
                    if (a.type !== b.type)
                        return a.type.localeCompare(b.type);
                    return a.name.localeCompare(b.name);
                });

                const buildItemHtml = (item) =>
                {
                    const icon = item.img || "systems/lancer/assets/icons/white/generic_item.svg";
                    const displayType = item.system?.type ? `${item.type.toUpperCase()} - ${item.system.type.toUpperCase()}` : item.type.toUpperCase();
                    return `<div class="lancer-item-card actor-item-entry" data-id="${item.id}" data-type="${item.type}" style="margin-bottom:6px;padding:10px; cursor:pointer; display:flex; gap:10px;">
                        <div class="lancer-item-icon" style="width:32px; height:32px; background:url('${icon}') no-repeat center/contain;"></div>
                        <div class="lancer-item-content" style="flex:1;min-width:0;">
                            <div class="lancer-item-name" style="font-weight:bold;">${item.name}</div>
                            <div class="lancer-item-details" style="font-size:0.85em; opacity:0.8;">[${displayType}]</div>
                        </div>
                    </div>`;
                };

                const itemPickerDialog = new Dialog({
                    title: localizeFormat('LA.effectManager.selectItemOn', { name: targetToken.name }),
                    content: `
                        <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                            <h1 class="lancer-dialog-title">Select Item on ${targetToken.name.toUpperCase()}</h1>
                            <p class="lancer-dialog-subtitle">Choose which item this bonus applies to.</p>
                        </div>
                        <div id="actor-item-list" style="height:400px;overflow-y:auto;padding:4px;border:1px solid var(--la-edge);background:var(--la-plate);border-radius:4px;">
                            ${items.map(buildItemHtml).join('')}
                        </div>
                    `,
                    buttons: {
                        cancel: cancelButton()
                    },
                    render: (htmlContent) =>
                    {
                        htmlContent.find('#actor-item-list').on('click', '.actor-item-entry', (ev) =>
                        {
                            const el = $(ev.currentTarget);
                            html.find(`#${targetId}`).val(el.data('id')).change();
                            itemPickerDialog.close();
                        });
                    },
                    default: "cancel"
                }, {
                    width: 500,
                    classes: ["lancer-dialog-base", "lancer-item-browser-dialog", "lancer-no-title"]
                });
                itemPickerDialog.render(true);
            });

            // Status picker button for bonus consumption filter
            html.find('.bonus-status-picker-btn').on('click', function (e)
            {
                e.preventDefault();
                const targetId = $(this).data('target');
                openStatusPicker(html.find(`#${targetId}`));
            });

            const addBonusFromTab = async (type) =>
            {
                const targetID = String(html.find('#bonus-target').val());
                const resolvedTargets = _resolveEmTargets(targetID).filter(entry => entry.actor || entry.item);
                if (!resolvedTargets.length)
                    return ui.notifications.error(localize('LA.notify.targetNotFound'));
                const { bonusData, addOptions, duration } = gatherBonusFormData(html, type);
                const durOrigin = html.find('#bonus-durOrigin').val();
                if (bonusData.uses === undefined && (addOptions.consumption || bonusData.consumeOnUsage === true))
                    ui.notifications.warn(localizeFormat('LA.notify.noUsesSet', { name: bonusData.name }));
                for (const entry of resolvedTargets)
                {
                    const targetIsItem = !!entry.item;
                    const targetIsPrototype = !targetIsItem && !entry.token && entry.actor?.documentName === 'Actor';
                    const entryOptions = durOrigin === EACH_ORIGIN
                        ? { ...addOptions, origin: entry.token?.id ?? '' }
                        : addOptions;
                    if (targetIsItem)
                        await linkBonusToItem({ items: [entry.item], bonusData, addOptions: { ...entryOptions, addedViaUI: true } });
                    else if (targetIsPrototype)
                        await linkBonusToActor({ actors: [entry.actor], bonusData, addOptions: entryOptions });
                    else if (duration === 'constant')
                        await addConstantBonus(entry.actor, bonusData);
                    else
                        await addGlobalBonus(entry.actor, bonusData, entryOptions);
                }
                setTimeout(updateBonusList, 200);
                setTimeout(updateManageTabCount, 200);
            };

            const ensureUsesForConsumption = () =>
            {
                const $uses = html.find('#bonus-uses');
                if (String($uses.val() ?? '').trim() !== '')
                    return;
                const hasTrigger = html.find('#bonus-trigger input:checked').length > 0;
                const usageOn = html.find('#bonus-consume-usage-row').is(':visible') && html.find('#bonus-consumeOnUsage').is(':checked');
                if (hasTrigger || usageOn)
                    $uses.val(1);
            };

            let lastUsageUiType = null;
            const updateConsumeUsageRow = () =>
            {
                const uiType = String(html.find('#bonus-type').val() ?? '');
                const subtype = String(html.find('#bonus-immunity-subtype').val() ?? '');
                const show = ['roll', 'damage', 'target_modifier', 'reroll', 'resistance', 'vulnerability'].includes(uiType)
                    || (uiType === 'immunity' && supportsConsumeOnUsage('immunity', subtype));
                const $row = html.find('#bonus-consume-usage-row');
                if (uiType !== lastUsageUiType)
                {
                    lastUsageUiType = uiType;
                    html.find('#bonus-consumeOnUsage').prop('checked', !['immunity', 'resistance', 'vulnerability'].includes(uiType));
                    html.find('#bonus-uses').val('');
                    html.find('#bonus-frequency').val('');
                    html.find('#bonus-frequency-count').val(1).css('display', 'none');
                }
                $row.css('display', show ? 'inline-flex' : 'none');
                html.find('#bonus-frequency-row').css('display', show ? 'flex' : 'none');
                if (!show)
                {
                    html.find('#bonus-frequency').val('');
                    html.find('#bonus-frequency-count').val(1).css('display', 'none');
                }
                ensureUsesForConsumption();
            };

            const updateFilterRows = () =>
            {
                const uiType = String(html.find('#bonus-type').val() ?? '');
                const isImmunity = uiType === 'immunity';
                const isDefense = ['immunity', 'resistance', 'vulnerability'].includes(uiType);
                const fields = isImmunity
                    ? (IMMUNITY_FILTER_FIELDS[String(html.find('#bonus-immunity-subtype').val() ?? '')] ?? {})
                    : (BONUS_FILTER_FIELDS[uiType] ?? null);
                const showItems = fields
                    ? Object.keys(fields).length > 0
                    : ['roll', 'damage', 'tag', 'range', 'target_modifier'].includes(uiType);
                html.find('#bonus-items-row').toggle(showItems);
                if (!showItems)
                    return;
                html.find('#row-bonus-rollTypes-roll').toggle(fields ? fields.rollTypes === 'roll' : uiType === 'roll');
                html.find('#row-bonus-rollTypes-damage').toggle(fields ? fields.rollTypes === 'damage' : uiType === 'damage');
                html.find('#row-bonus-itemLids').toggle(!fields || !!fields.itemLids);
                html.find('#row-bonus-itemId').toggle(!fields || !!fields.itemId);
                html.find('#row-bonus-tokens').toggle(!fields || !!fields.applyTo);
                html.find('#bonus-condition-badge').closest('.form-group').toggle(!fields || !!fields.condition);
                html.find('#bonus-applyToCondition-badge').closest('.form-group').toggle(!fields || !!fields.applyToCondition);
                html.find('#bonus-condition-badge').attr('title', localize(isDefense ? 'LA.effectManager.tip.conditionImmunity' : 'LA.effectManager.tip.conditionRoll'));
                html.find('#bonus-applyToCondition-badge').attr('title', localize(isDefense ? 'LA.effectManager.tip.applyToConditionImmunity' : 'LA.effectManager.tip.applyToConditionRoll'));
            };
            html.find('#bonus-consumeOnUsage').on('change', ensureUsesForConsumption);
            html.find('#bonus-trigger').on('change', 'input', ensureUsesForConsumption);

            const syncDamageTypesRow = () =>
            {
                const type = String(html.find('#bonus-type').val() ?? '');
                const subtype = String(html.find('#bonus-immunity-subtype').val() ?? '');
                html.find('#bonus-immunity-damage-row').toggle(type === 'resistance' || type === 'vulnerability' || (type === 'immunity' && subtype === 'damage'));
            };

            html.find('#bonus-type').on('change', function ()
            {
                const type = $(this).val();
                html.find('#bonus-type-stat, #bonus-type-roll, #bonus-type-damage, #bonus-type-tag, #bonus-type-range, #bonus-type-immunity, #bonus-type-target_modifier, #bonus-type-reroll, #bonus-type-movement_extra, #bonus-type-action_extra').hide();
                html.find(`#bonus-type-${type}`).show();
                syncDamageTypesRow();
                updateConsumeUsageRow();

                updateFilterRows();

                // Range bonuses are applied via libWrapper on currentProfile(); applyToTargetter makes no sense for them
                const targetter = html.find('#bonus-applyToTargetter');
                if (type === 'range')
                    targetter.prop('checked', false).closest('.form-group').hide();
                else
                    targetter.closest('.form-group').show();

                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            });

            html.find('#bonus-immunity-subtype').on('change', function ()
            {
                const subtype = $(this).val();
                html.find('#bonus-immunity-effects-row').toggle(subtype === 'effect');
                syncDamageTypesRow();
                updateConsumeUsageRow();
                updateFilterRows();
                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            });

            html.find('.bonus-immunity-damage-option').on('click', function()
            {
                const $option = $(this);
                $option.toggleClass('selected');
                if ($option.data('type') === 'All')
                    html.find('.bonus-immunity-damage-option').not($option).removeClass('selected');
                else if ($option.hasClass('selected'))
                    html.find('.bonus-immunity-damage-option[data-type="All"]').removeClass('selected');
            });

            html.find('.bonus-immunity-effect-option').on('click', function()
            {
                const $el = $(this);
                $el.toggleClass('selected');
                if ($el.hasClass('selected'))
                    $el.css({ background: '#b8d4f0', borderLeftColor: '#1a4a7a', color: '#111' });
                else
                    $el.css({ background: 'var(--la-plate)', borderLeftColor: 'transparent', color: 'var(--la-ink)' });
            }).on('mouseenter', function ()
            {
                const clip = this.querySelector('.la-hud-clip');
                const pan = this.querySelector('.la-hud-pan');
                if (clip && pan)
                {
                    const overflow = pan.scrollWidth - clip.clientWidth;
                    if (overflow > 4)
                        $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                }
            }).on('mouseleave', function ()
            {
                $(this).find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
            });

            html.find('#bonus-immunity-effect-search').on('input', function ()
            {
                const query = String($(this).val() ?? '').toLowerCase().trim();
                html.find('.bonus-immunity-effect-option').each(function ()
                {
                    const name = String($(this).data('name') ?? '').toLowerCase();
                    $(this).toggle(!query || name.includes(query));
                });
            });

            // Multi-select dropdowns for roll types
            initLaMultiSelect(html, 'bonus-rollTypes-roll');
            initLaMultiSelect(html, 'bonus-rollTypes-damage');
            initLaMultiSelect(html, 'bonus-reroll-rollTypes');

            html.find('#bonus-add').click(() => addBonusFromTab(selectedBonusType()));

            // Dynamic damage entries
            let bonusDmgEntryCounter = 1;
            html.find('#bonus-add-dmg-entry').click(function ()
            {
                const idx = bonusDmgEntryCounter++;
                const currentMode = html.find('#bonus-damageMode').val() || 'add';
                const isChangeType = currentMode === 'change_type';
                const newEntry = $(htmlToElement(`
                    <div class="bonus-damage-entry form-group" data-index="${idx}">
                        <select id="bonus-dmgFrom-${idx}" class="bonus-damage-from" style="flex:1; display:${isChangeType ? '' : 'none'};">
                            <option value="${DAMAGE_CHANGE_TYPE_ALL}">All Types</option>
                            ${dmgTypeOptionsHtml}
                        </select>
                        <span class="bonus-damage-arrow" style="display:${isChangeType ? '' : 'none'}; padding:0 4px;">→</span>
                        <input type="text" id="bonus-dmgVal-${idx}" value="1d6" placeholder="1d6" class="bonus-damage-val" style="flex:1; display:${isChangeType ? 'none' : ''};">
                        <select id="bonus-dmgType-${idx}" style="flex:1;">${dmgTypeOptionsHtml}</select>
                        <button type="button" class="bonus-remove-dmg te-delete-btn" data-index="${idx}" style="flex:0 0 22px;"><i class="fas fa-times"></i></button>
                    </div>
                `));
                html.find('#bonus-damage-list').append(newEntry);
                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            });

            // change_type swaps rows to from→to; other modes keep val+type
            const applyDamageModeMarkup = () =>
            {
                const mode = html.find('#bonus-damageMode').val() || 'add';
                const isChangeType = mode === 'change_type';
                html.find('#bonus-damageScope-row').toggle(isChangeType);
                html.find('#bonus-damage-list .bonus-damage-entry').each(function ()
                {
                    $(this).find('.bonus-damage-from').css('display', isChangeType ? '' : 'none');
                    $(this).find('.bonus-damage-arrow').css('display', isChangeType ? '' : 'none');
                    $(this).find('.bonus-damage-val').css('display', isChangeType ? 'none' : '');
                });
                updateDamageApplyToWarning();
                if (dialog.position)
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
            };
            // warn if user set per-target while picking a base-mutating mode (applyTo is stripped on save)
            const updateDamageApplyToWarning = () =>
            {
                const mode = html.find('#bonus-damageMode').val() || 'add';
                const bonusType = html.find('#bonus-type').val();
                if (bonusType !== 'damage')
                {
                    html.find('#bonus-damageMode-warning').hide();
                    return;
                }
                const applyToStr = String(html.find('#bonus-applyTo').val() || '').trim();
                const hasTargets = applyToStr.split(',').map(s => s.trim()).filter(Boolean).length > 0;
                html.find('#bonus-damageMode-warning').toggle((mode !== 'add') && hasTargets);
            };
            html.find('#bonus-damageMode').on('change', applyDamageModeMarkup);
            html.find('#bonus-applyTo').on('input change', updateDamageApplyToWarning);
            html.find('#bonus-type').on('change', updateDamageApplyToWarning);

            html.on('click', '.bonus-remove-dmg', function ()
            {
                const $list = html.find('#bonus-damage-list');
                if ($list.find('.bonus-damage-entry').length > 1)
                {
                    $(this).closest('.bonus-damage-entry').remove();
                    if (dialog.position)
                        dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            });

            html.find('#bonus-clear-all').click(async () =>
            {
                const targetID = String(html.find('#bonus-target').val());
                const { actor } = _resolveEmTarget(targetID);
                if (!actor)
                    return;
                await unsetLAFlag(actor,"global_bonuses");
                setTimeout(updateBonusList, 200);
                setTimeout(updateManageTabCount, 200);
            });

            if (options.initialTab)
            {
                html.find('.te-tab').removeClass('active');
                html.find('.te-content').removeClass('active');
                html.find(`.te-tab[data-tab="${options.initialTab}"]`).addClass('active');
                html.find(`#tab-${options.initialTab}`).addClass('active');
                if (options.initialTab === 'bonus')
                    updateBonusList();
                if (options.initialTab === 'manage')
                    updateManageList();
            }
            updateManageTabCount();
        }
    }, /** @type {any} */ ({
        width: 560,
        height: 'auto',
        left: 100,
        top: 60,
        classes: ['lancer-effect-manager', 'lancer-dialog-base', 'lancer-no-title']
    }));

    const _origClose = dialog.close.bind(dialog);
    dialog.close = (...args) =>
    {
        const dlg = /** @type {any} */ (dialog);
        clearEmHighlight();
        try
        {
            dlg._laResizeObserver?.disconnect();
        }
        catch
        {
            /* noop */
        }
        dlg._laResizeObserver = null;
        if (dlg._laCombatHooks)
        {
            try
            {
                Hooks.off('createCombat', dlg._laCombatHooks);
                Hooks.off('deleteCombat', dlg._laCombatHooks);
                Hooks.off('combatStart', dlg._laCombatHooks);
            }
            catch
            {
                /* noop */
            }
            dlg._laCombatHooks = null;
        }
        return _origClose(...args);
    };

    dialog.render(true);
}

export const EffectManagerAPI = {
    executeEffectManager,
    openItemBrowser
};
