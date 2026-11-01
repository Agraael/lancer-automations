import { _resolveEmTarget } from "./effect-manager-targets.js";
import { getLAFlag, setLAFlag, unsetLAFlag, getLAFlags } from "../tools/flag-utils.js";
import {
    removeGlobalBonus,
    removeConstantBonus,
    unlinkBonusFromItem,
    unlinkBonusFromActor,
    getBonusDetailString,
    getBonusUsesInfo,
    getV3DefenseRows,
    setItemBonusOff,
    isItemBonusOff,
    itemAttachmentOrigin,
} from "./genericBonuses.js";
import { getBonusConditionHint } from "./bonus-condition.js";
import { tierGateControl, bindTierGate, tierGateApplies } from "../interactive/tier-gate.js";
import { escapeHtml } from "../tools/string-utils.js";
import { htmlToElement } from "../tools/dom-utils.js";
import { durationText, sourceName } from "./status-tooltip.js";
import { v3ConditionLabel } from "../tools/v3-condition.js";

async function modifyEffectStack(targetID, effectID, delta)
{
    const target = canvas.tokens.get(targetID);
    if (!target)
        return;

    const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
    if (customStatusApi)
    {
        await customStatusApi.modifyStack(target.actor, effectID, delta);

        const effect = target.actor.effects.get(effectID);
        if (effect)
        {
            const newStack = effect.flags?.statuscounter?.value || effect.getFlag("temporary-custom-statuses", "stack") || 1;
            if (newStack > 1)
            {
                await effect.update(/** @type {any} */({
                    "flags.statuscounter.visible": true
                }));
            }
        }
    }
    else
    {
        const effect = target.actor.effects.get(effectID);
        if (effect)
        {
            const currentStack = effect.flags?.statuscounter?.value || effect.getFlag("temporary-custom-statuses", "stack") || 1;
            const newStack = currentStack + delta;
            if (newStack <= 0)
                await effect.delete();
            else
            {
                await effect.update(/** @type {any} */({
                    "flags.statuscounter.value": newStack,
                    "flags.statuscounter.visible": newStack > 1
                }));
            }
        }
    }
}

async function pushRemoveEffect(targetID, effectID)
{
    // Supports token id (scene token), actor UUID (prototype), and item UUID (item-carried).
    const { actor, item, token } = _resolveEmTarget(targetID);
    const doc = item ?? (token ? token.actor : actor);
    if (!doc)
        return;

    const canWrite = game.user.isGM || doc.isOwner;
    if (canWrite)
        await doc.deleteEmbeddedDocuments("ActiveEffect", [effectID]);
    else if (item || (actor && !token))
    {
        game.socket.emit('module.lancer-automations', {
            action: "removeEffectFromDoc",
            payload: {
                docUuid: doc.uuid,
                effectID
            }
        });
    }
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: "removeEffect",
            payload: {
                targetID,
                effectID
            }
        });
    }
}

function renderBonusDetails(bonus)
{
    if (bonus.type === 'multi' && Array.isArray(bonus.bonuses))
        return `[${bonus.bonuses.map(getBonusDetailString).join(' | ')}]`;
    return `(${getBonusDetailString(bonus)})`;
}

// Manage Tab. Templates are `disabled:true` by design; still show them so users can remove.
function isTemplateAE(effect)
{
    const laFlags = getLAFlags(effect);
    return laFlags?.isItemTemplate === true || laFlags?.isActorTemplate === true;
}

export function updateManageTabCount(html)
{
    const targetID = String(html.find('#manage-target').val());
    const { actor } = _resolveEmTarget(targetID);
    if (!actor)
    {
        html.find('#manage-tab-count').text('');
        return;
    }
    const effectCount = actor.effects.filter(effect =>
        (isTemplateAE(effect) || !effect.disabled) && (effect.icon || effect.img) && !getLAFlag(effect,"linkedBonusId")
    ).length;
    const bonusCount = (getLAFlag(actor,"global_bonuses") || []).length
        + (getLAFlag(actor,"constant_bonuses") || []).length
        + (getLAFlag(actor,"bonusTemplates") || []).length
        + getV3DefenseRows(actor).length;
    const total = effectCount + bonusCount;
    html.find('#manage-tab-count').text(total > 0 ? `(${total})` : '');
}

export function updateManageList(html, dialog)
{
    const targetID = String(html.find('#manage-target').val());
    const { actor } = _resolveEmTarget(targetID);
    const list = html.find('#manage-list');
    list.empty();

    if (!actor)
        return;

    const effects = actor.effects.filter(effect =>
        (isTemplateAE(effect) || !effect.disabled) &&
        (effect.icon || effect.img) &&
        !getLAFlag(effect,"linkedBonusId")
    );

    if (effects.length === 0)
        list.html('<p style="text-align:center; color:var(--la-ink-dim)">No effects found.</p>');

    effects.forEach(effect =>
    {
        const dur = getLAFlag(effect,'duration') || (game.modules.get('csm-lancer-qol')?.active ? effect.getFlag('csm-lancer-qol', 'duration') : null);
        const consumption = getLAFlag(effect,'consumption');
        const stack = effect.flags?.statuscounter?.value ||
            effect.flags?.['temporary-custom-statuses']?.stack || 0;

        let durText = "Indefinite";
        if (getLAFlags(effect))
            durText = durationText(effect) || "Indefinite";
        else if (dur)
            durText = `${dur.label}, ${dur.turns}t`;

        let consumptionText = '';
        if (consumption?.trigger)
        {
            let triggerLabel = Array.isArray(consumption.trigger)
                ? consumption.trigger.join(', ')
                : consumption.trigger;
            if (consumption.itemId)
                triggerLabel += ` ID:${consumption.itemId}`;
            else if (consumption.itemLid)
                triggerLabel += ` ${consumption.itemLid}`;
            consumptionText = `<span style="font-size:0.75em; color:var(--la-accent); margin-left:4px;">[${triggerLabel}]</span>`;
        }

        const item = $(htmlToElement(`
            <div class="te-effect-item">
                <div class="te-effect-info">
                    <img src="${effect.img}" width="24" height="24" style="border:none; background:#1a1a1a; border-radius:3px; padding:1px; object-fit:contain;">
                    <span>${effect.name}</span>
                    <span style="font-size:0.8em; opacity:0.7; display:inline-block; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom;">(${escapeHtml(durText)})</span>
                    ${consumptionText}
                    ${stack > 0 ? `<span style="font-weight:bold; margin-left:4px;">x${stack}</span>` : ''}
                </div>
                <div style="display:flex; gap: 5px; align-items: center;">
                    ${isTemplateAE(effect) && tierGateApplies(actor) ? tierGateControl(getLAFlag(effect,'tier'), `data-effect-id="${effect.id}"`) : ''}
                    ${stack > 0 ? `
                    <div class="te-stack-ctrl">
                        <i class="fas fa-minus stack-btn" data-action="dec"></i>
                        <i class="fas fa-plus stack-btn" data-action="inc"></i>
                    </div>` : ''}
                    <div class="te-delete-btn" title="Remove"><i class="fas fa-trash"></i></div>
                </div>
            </div>
        `));

        bindTierGate(item, async (tier) =>
        {
            if (tier)
                await setLAFlag(effect,'tier', tier);
            else
                await unsetLAFlag(effect,'tier');
        });

        item.find('.te-delete-btn').click(async () =>
        {
            await pushRemoveEffect(targetID, effect.id);
            setTimeout(() => updateManageList(html, dialog), 200);
        });

        item.find('.stack-btn').click(async (ev) =>
        {
            const action = $(ev.currentTarget).data('action');
            const delta = action === 'inc' ? 1 : -1;
            await modifyEffectStack(targetID, effect.id, delta);
            setTimeout(() => updateManageList(html, dialog), 200);
        });

        list.append(item);
    });

    const bonusList = html.find('#manage-bonus-list');
    bonusList.empty();
    const globalBonuses = getLAFlag(actor,"global_bonuses") || [];
    const constantBonuses = getLAFlag(actor,"constant_bonuses") || [];
    const bonusTemplates = getLAFlag(actor,"bonusTemplates") || [];
    const allBonuses = [
        ...globalBonuses.map(bonus => ({ ...bonus, _kind: 'global', _off: isItemBonusOff(actor, bonus) })),
        ...constantBonuses.map(bonus => ({ ...bonus, _kind: 'constant', _off: isItemBonusOff(actor, bonus) })),
        ...bonusTemplates.map(template => ({ ...(template.bonusData || {}), _kind: 'template', _templateId: template.id, _addOptions: template.addOptions, uses: template.lastRuntimeUses ?? template.bonusData?.uses })),
        ...getV3DefenseRows(actor).map(({ bonus, off, inactive, replaced }) => ({ ...bonus, _kind: 'data', _off: off, _inactive: inactive, _replaced: replaced }))
    ];

    updateManageTabCount(html);

    if (allBonuses.length > 0)
    {
        bonusList.append(htmlToElement('<p style="margin:8px 0 4px; font-weight:bold; border-top:1px solid var(--la-edge); padding-top:6px;">Bonuses</p>'));
        allBonuses.forEach(bonus =>
        {
            const details = renderBonusDetails(bonus);
            const lids = (bonus.itemLids && bonus.itemLids.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[${bonus.itemLids.join(', ')}]</span>` : '';
            const types = (bonus.rollTypes && bonus.rollTypes.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[Flows: ${bonus.rollTypes.join(', ')}]</span>` : '';
            const itemIdInfo = bonus.itemId ? ` <span style="font-size:0.8em; opacity:0.7;">[Item: ${bonus.itemId}]</span>` : '';
            let kindLabel = '';
            if (bonus._kind === 'constant')
                kindLabel = ' <span style="font-size:0.75em; color:var(--la-ink-dim);">(constant)</span>';
            else if (bonus._kind === 'template')
                kindLabel = ' <span style="font-size:0.75em; color:var(--la-ink-dim);">(template)</span>';
            else if (bonus._kind === 'data')
                kindLabel = ' <span style="font-size:0.75em; color:#2a9d8f;">(data)</span>';
            const source = sourceName(bonus);
            const origin = itemAttachmentOrigin(bonus);
            let sourceText = source ? `<i class="fas fa-link"></i> ${escapeHtml(source)}` : '';
            if (source && origin === 'automation')
                sourceText = `<i class="fas fa-gear"></i> Automation on ${escapeHtml(source)}`;
            else if (source && origin === 'hand')
                sourceText = `<i class="fas fa-link"></i> ${escapeHtml(source)} · remove it in its L.A menu`;
            if (bonus._replaced)
                sourceText = '<i class="fas fa-right-left"></i> Replaced by automation';
            const sourceLine = sourceText
                ? `<span style="display:block; font-size:0.8em; color:var(--la-ink-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${sourceText}</span>`
                : '';
            const laMark = origin ? '<span style="font-family:var(--la-mono, ui-monospace, monospace); font-size:0.78em; letter-spacing:0.04em; padding-right:4px; margin-right:4px; border-right:1px solid currentColor;">L.A</span>' : '';
            const dataConditionLine = bonus.dataCondition
                ? `<span style="display:block; font-size:0.8em; color:${bonus._inactive ? 'var(--la-ink-dim)' : '#2a9d8f'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><i class="fas fa-code-branch"></i> ${escapeHtml(`while ${v3ConditionLabel(bonus.dataCondition)}`)}</span>`
                : '';
            const switchable = !bonus._replaced && (bonus._kind === 'data' || (bonus._kind !== 'template' && !!bonus.sourceItemUuid));
            let actionBtn = switchable
                ? `<div class="te-delete-btn manage-bonus-toggle-btn" title="${bonus._off ? 'Switch on' : 'Switch off'}" style="color:${bonus._kind === 'data' ? '#2a9d8f' : 'var(--la-ink)'};"><i class="fas ${bonus._off ? 'fa-toggle-off' : 'fa-toggle-on'}"></i></div>`
                : `<div class="te-delete-btn manage-bonus-remove-btn" data-id="${bonus.id}" data-kind="${bonus._kind}" title="Remove"><i class="fas fa-trash"></i></div>`;
            if (bonus._replaced)
                actionBtn = '<div style="color:var(--la-ink); opacity:0.75; padding:2px 6px;"><i class="fas fa-right-left"></i></div>';
            const condHint = getBonusConditionHint(bonus);
            const condLabel = condHint
                ? ' <span class="te-bonus-cond" style="font-size:0.75em; color:var(--la-accent); cursor:help;"><i class="fas fa-code-branch"></i> conditional</span>'
                : '';

            let usesInfo = '';
            const uses = getBonusUsesInfo(actor, bonus);
            if (uses)
            {
                usesInfo = ` <span style="color:var(--la-accent);">[${uses.label}]</span>`;
                if (uses.onUse)
                    usesInfo += ' <span style="font-size:0.75em; color:var(--la-ink-dim);">[on-use]</span>';
            }

            const bonusRow = $(htmlToElement(`
                <div class="te-bonus-item"${bonus._off || bonus._inactive || bonus._replaced ? ' style="opacity:0.5;"' : ''}>
                    <span style="min-width:0;">${laMark}<strong>${bonus.name}</strong>${kindLabel}${condLabel} ${bonus._replaced ? `<span style="text-decoration:line-through;">${details}</span>` : details}${usesInfo}${lids}${itemIdInfo}${types}${sourceLine}${dataConditionLine}</span>
                    ${tierGateApplies(actor) && bonus._kind !== 'data' ? tierGateControl(bonus.tier, `data-bonus-id="${bonus.id}"`) : ''}
                    ${actionBtn}
                </div>
            `));
            bonusRow.find('.manage-bonus-toggle-btn').click(async () =>
            {
                await setItemBonusOff(actor, bonus.id, !bonus._off);
                setTimeout(() => updateManageList(html, dialog), 200);
            });
            if (condHint)
                bonusRow.find('.te-bonus-cond').attr('title', condHint);

            bindTierGate(bonusRow, async (tier) =>
            {
                if (bonus._kind === 'template')
                {
                    const templates = foundry.utils.deepClone(getLAFlag(actor,'bonusTemplates') || []);
                    const record = templates.find((/** @type {any} */ tpl) => tpl.id === bonus._templateId);
                    if (!record)
                        return;
                    record.bonusData = record.bonusData ?? {};
                    if (tier)
                        record.bonusData.tier = tier;
                    else
                        delete record.bonusData.tier;
                    await setLAFlag(actor,'bonusTemplates', templates);
                    return;
                }
                const flagKey = bonus._kind === 'constant' ? 'constant_bonuses' : 'global_bonuses';
                const listCopy = foundry.utils.deepClone(getLAFlag(actor,flagKey) || []);
                const entry = listCopy.find((/** @type {any} */ stored) => stored.id === bonus.id);
                if (!entry)
                    return;
                if (tier)
                    entry.tier = tier;
                else
                    delete entry.tier;
                await setLAFlag(actor,flagKey, listCopy);
            });

            bonusRow.find('.manage-bonus-remove-btn').click(async () =>
            {
                if (bonus._kind === 'template')
                {
                    if (actor.documentName === 'Item')
                        await unlinkBonusFromItem({ items: [actor], templateId: bonus._templateId });
                    else
                        await unlinkBonusFromActor({ actors: [actor], templateId: bonus._templateId });
                }
                else if (bonus._kind === 'constant')
                    await removeConstantBonus(actor, bonus.id);
                else if (bonus.sourceItemUuid || bonus.sourceActorUuid)
                {
                    const source = /** @type {any} */ (fromUuidSync(bonus.sourceItemUuid ?? bonus.sourceActorUuid));
                    if (source?.documentName === 'Item')
                        await unlinkBonusFromItem({ items: [source], templateId: bonus.sourceTemplateId });
                    else if (source?.documentName === 'Actor')
                        await unlinkBonusFromActor({ actors: [source], templateId: bonus.sourceTemplateId });
                    else
                        await removeGlobalBonus(actor, bonus.id);
                }
                else
                    await removeGlobalBonus(actor, bonus.id);
                setTimeout(() => updateManageList(html, dialog), 200);
            });

            bonusList.append(bonusRow);
        });
    }

    if (dialog.position)
        dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
}
