import { durationChoice } from "./duration-builders.js";
import { supportsConsumeOnUsage } from "./genericBonuses.js";
import { readTierGate } from "../interactive/tier-gate.js";
import { DAMAGE_CHANGE_TYPE_ALL } from "./effect-manager-template.js";

// Filter fields the dialog offers per immunity subtype. Absent subtype is left untouched on save.
// rollTypes names which roll-type panel applies.
export const IMMUNITY_FILTER_FIELDS = {
    damage:     { rollTypes: 'damage', itemLids: true, condition: true, applyToCondition: true },
    effect:     { condition: true, applyToCondition: true },
    provoke:    { condition: true, applyToCondition: true },
    crit:   { rollTypes: 'roll', itemLids: true, condition: true, applyToCondition: true },
    hit:    { rollTypes: 'roll', itemLids: true, condition: true, applyToCondition: true },
    miss:   { rollTypes: 'roll', itemLids: true, condition: true, applyToCondition: true },
};
export const BONUS_FILTER_FIELDS = {
    reroll: { itemLids: true, itemId: true, condition: true },
    resistance:    { rollTypes: 'damage', itemLids: true, condition: true, applyToCondition: true },
    vulnerability: { rollTypes: 'damage', itemLids: true, condition: true, applyToCondition: true },
};

export function gatherBonusFormData(html, type)
{
    const targetID = String(html.find('#bonus-target').val());
    const name = String(html.find('#bonus-name').val() || "Test Bonus");
    const usesStr = String(html.find('#bonus-uses').val());
    const uses = usesStr ? Number.parseInt(usesStr) : undefined;
    const { label: duration, originID: durOrigin } = durationChoice(String(html.find('#bonus-duration').val() ?? ''), String(html.find('#bonus-durOrigin').val() ?? ''));
    const durTurnsRaw = Number.parseInt(String(html.find('#bonus-durTurns').val()));
    const durTurns = Number.isNaN(durTurnsRaw) ? 1 : Math.max(0, durTurnsRaw);
    const itemLidsStr = String(html.find('#bonus-itemLids').val());
    const itemLids = itemLidsStr ? itemLidsStr.split(',').map(lid => lid.trim()).filter(lid => lid) : [];

    let rollPanel = null;
    if (type === 'accuracy' || type === 'difficulty' || type === 'flat')
        rollPanel = 'roll';
    else if (type === 'damage')
        rollPanel = 'damage';
    else if (type === 'immunity')
        rollPanel = IMMUNITY_FILTER_FIELDS[String(html.find('#bonus-immunity-subtype').val() ?? '')]?.rollTypes ?? null;
    else if (type === 'resistance' || type === 'vulnerability')
        rollPanel = 'damage';
    const rollTypes = rollPanel
        ? html.find(`#bonus-rollTypes-${rollPanel} input:checked`).map((_, el) => /** @type {HTMLInputElement} */ (el).value).get()
        : [];

    const applyToStr = String(html.find('#bonus-applyTo').val());
    const applyTo = applyToStr ? applyToStr.split(',').map(id => id.trim()).filter(id => id) : undefined;
    const applyToTargetter = html.find('#bonus-applyToTargetter').is(':checked');
    const itemId = String(html.find('#bonus-itemId').val())?.trim() || undefined;

    const bonusData = {
        name,
        type,
        uses,
        itemLids,
        itemId,
        rollTypes,
        applyTo,
        applyToTargetter
    };
    const bonusTier = readTierGate(html.find('.la-tier-gate[data-role="em-bonus"]')[0]);
    if (bonusTier)
        bonusData.tier = bonusTier;
    const conditionSrc = String(html.find('#bonus-condition-value').val() || '').trim();
    if (conditionSrc)
        bonusData.condition = '@@fn:' + conditionSrc;
    const applyToConditionSrc = String(html.find('#bonus-applyToCondition-value').val() || '').trim();
    if (applyToConditionSrc)
        bonusData.applyToCondition = '@@fn:' + applyToConditionSrc;

    if (type === 'stat')
    {
        bonusData.stat = html.find('#bonus-stat').val();
        bonusData.val = html.find('#bonus-statVal').val() || "1";
        bonusData.statMode = html.find('#bonus-statMode').val() || 'add';
    }
    else if (type === 'damage')
    {
        const damageMode = html.find('#bonus-damageMode').val() || 'add';
        bonusData.damageMode = damageMode;
        if (damageMode === 'change_type')
            bonusData.damageScope = html.find('#bonus-damageScope').val() || 'base';
        const damageEntries = [];
        html.find('#bonus-damage-list .bonus-damage-entry').each(function ()
        {
            const idx = $(this).data('index');
            const damageType = $(this).find(`#bonus-dmgType-${idx}`).val();
            if (damageMode === 'change_type')
            {
                const from = $(this).find(`#bonus-dmgFrom-${idx}`).val() || DAMAGE_CHANGE_TYPE_ALL;
                damageEntries.push({ from, to: damageType });
            }
            else
            {
                const val = $(this).find(`#bonus-dmgVal-${idx}`).val() || "1d6";
                damageEntries.push({ val, type: damageType });
            }
        });
        if (damageEntries.length === 0)
        {
            bonusData.damage = damageMode === 'change_type'
                ? [{ from: DAMAGE_CHANGE_TYPE_ALL, to: 'Kinetic' }]
                : [{ val: "1d6", type: 'Kinetic' }];
        }
        else
            bonusData.damage = damageEntries;
        // non-add modes mutate the weapon's base damage; per-target doesn't apply
        if (damageMode !== 'add')
            bonusData.applyTo = undefined;
    }
    else if (type === 'tag')
    {
        const selectEl = /** @type {HTMLSelectElement} */ (html.find('#bonus-tagSelect')[0]);
        bonusData.tagId = selectEl.options[selectEl.selectedIndex].value;
        bonusData.tagName = selectEl.options[selectEl.selectedIndex].text;
        bonusData.tagMode = html.find('#bonus-tagMode').val();
        bonusData.val = html.find('#bonus-tagVal').val() || "0";
        bonusData.removeTag = html.find('#bonus-removeTag').is(':checked');
    }
    else if (type === 'range')
    {
        bonusData.rangeType = html.find('#bonus-rangeType').val();
        bonusData.rangeMode = html.find('#bonus-rangeMode').val();
        bonusData.val = html.find('#bonus-rangeVal').val() || "0";
    }
    else if (type === 'immunity')
    {
        bonusData.subtype = html.find('#bonus-immunity-subtype').val();
        const allowed = IMMUNITY_FILTER_FIELDS[bonusData.subtype];
        if (allowed)
        {
            for (const field of ['rollTypes', 'itemLids', 'itemId', 'applyTo', 'applyToTargetter', 'condition', 'applyToCondition'])
            {
                if (!allowed[field])
                    delete bonusData[field];
            }
        }
        if (bonusData.subtype === 'effect')
        {
            bonusData.effects = [];
            html.find('.bonus-immunity-effect-option.selected').each(function()
            {
                bonusData.effects.push($(this).data('effect'));
            });
        }
        else if (bonusData.subtype === 'damage')
        {
            bonusData.damageTypes = [];
            html.find('.bonus-immunity-damage-option.selected').each(function()
            {
                bonusData.damageTypes.push($(this).data('type'));
            });
        }
    }
    else if (type === 'resistance' || type === 'vulnerability')
    {
        for (const field of ['rollTypes', 'itemLids', 'itemId', 'applyTo', 'applyToTargetter', 'condition', 'applyToCondition'])
        {
            if (!BONUS_FILTER_FIELDS[type][field])
                delete bonusData[field];
        }
        bonusData.damageTypes = [];
        html.find('.bonus-immunity-damage-option.selected').each(function()
        {
            bonusData.damageTypes.push($(this).data('type'));
        });
    }
    else if (type === 'target_modifier')
        bonusData.subtype = html.find('#bonus-target-modifier-subtype').val();
    else if (type === 'movement_extra')
    {
        bonusData.subtype = html.find('#bonus-movement-extra-subtype').val() || 'boost';
        bonusData.val = html.find('#bonus-movement-extra-val').val() || "1";
    }
    else if (type === 'action_extra')
    {
        bonusData.subtype = html.find('#bonus-action-extra-subtype').val() || 'reaction';
        bonusData.val = html.find('#bonus-action-extra-val').val() || "1";
    }
    else if (type === 'reroll')
    {
        for (const field of ['itemLids', 'itemId', 'applyTo', 'applyToTargetter', 'condition', 'applyToCondition'])
        {
            if (!BONUS_FILTER_FIELDS.reroll[field])
                delete bonusData[field];
        }
        const list = Array.from(document.querySelectorAll('#bonus-reroll-rollTypes input:checked'), box => /** @type {HTMLInputElement} */ (box).value);
        if (list.length > 0)
            bonusData.rollTypes = list;
        const sub = String(html.find('#bonus-reroll-subtype').val() ?? 'retry');
        bonusData.subtype = ['retry', 'highest', 'lowest', 'choose'].includes(sub) ? sub : 'retry';
    }
    else
        bonusData.val = html.find('#bonus-accDiffVal').val() || "1";

    const addOptions = {
        duration,
        durationTurns: durTurns,
        origin: durOrigin,
        forcePrototype: typeof targetID === 'string' && targetID.includes('.'),
    };
    if (duration === 'roundEnd' || duration === 'roundStart')
        addOptions.durationRounds = durTurns;
    const customIcon = String(html.find('#bonus-icon').val() || '').trim();
    if (customIcon)
        addOptions.icon = customIcon;

    const consumptionTriggers = html.find('#bonus-trigger input:checked')
        .map((_, el) => /** @type {HTMLInputElement} */ (el).value).get();
    if (consumptionTriggers.length > 0)
    {
        const consumption = {
            trigger: consumptionTriggers.length === 1 ? consumptionTriggers[0] : consumptionTriggers
        };
        const consumptionOrigin = html.find('#bonus-trigger-origin').val();
        if (consumptionOrigin)
            consumption.originId = consumptionOrigin;
        const filterItemLid = String(html.find('#bonus-filter-itemLid').val())?.trim();
        if (filterItemLid)
            consumption.itemLid = filterItemLid;
        const filterItemId = String(html.find('#bonus-filter-itemId').val())?.trim();
        if (filterItemId)
            consumption.itemId = filterItemId;
        const filterActionName = String(html.find('#bonus-filter-actionName').val())?.trim();
        if (filterActionName)
            consumption.actionName = filterActionName;
        const filterMinDistance = String(html.find('#bonus-filter-minDistance').val());
        if (filterMinDistance)
            consumption.minDistance = Number.parseInt(filterMinDistance);
        const filterCheckType = String(html.find('#bonus-filter-checkType').val())?.trim();
        if (filterCheckType)
            consumption.checkType = filterCheckType;
        const filterCheckAbove = String(html.find('#bonus-filter-checkAbove').val());
        if (filterCheckAbove)
            consumption.checkAbove = Number.parseInt(filterCheckAbove);
        const filterCheckBelow = String(html.find('#bonus-filter-checkBelow').val());
        if (filterCheckBelow)
            consumption.checkBelow = Number.parseInt(filterCheckBelow);
        const filterStatusId = String(html.find('#bonus-filter-statusId').val())?.trim();
        if (filterStatusId)
            consumption.statusId = filterStatusId;
        consumption.role = String(html.find('#bonus-filter-role').val() || '') || 'source';
        addOptions.consumption = consumption;
    }

    if (supportsConsumeOnUsage(type, bonusData.subtype ?? null))
        bonusData.consumeOnUsage = html.find('#bonus-consumeOnUsage').is(':checked');
    const frequency = String(html.find('#bonus-frequency').val() || '');
    if (frequency)
    {
        bonusData.frequency = frequency;
        const frequencyCount = Number.parseInt(String(html.find('#bonus-frequency-count').val() ?? '')) || 1;
        if (frequencyCount > 1)
            bonusData.frequencyCount = frequencyCount;
    }
    return { bonusData, addOptions, duration };
}
