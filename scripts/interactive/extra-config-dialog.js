// Extra Config dialog for items. First feature: per-type auto-consume opt-out.

import {
    CANONICAL_TYPES, RESOURCE_LABELS, CONSUME_ON_MODES,
    _hasResource, _detectResources, _subResources,
    getAutoConsumeDisabled,
    setItemAutoConsumeDisabled,
    setItemAutoConsumeDisabledAll,
    getSubAutoConsumeDisabled,
    setSubAutoConsumeDisabled,
    getConsumeOn,
    setConsumeOn,
} from './extra-config.js';
import { itemActionSubs, detectHitGatedScopes } from '../combat/per-frequency-tags.js';
import { getExtraDeployableOpts, setExtraDeployableOpts, getDeployableInfoSync, isPrimaryActionHidden, setHidePrimaryAction } from './deployables.js';
import { tierGateControl, bindTierGate, tierGateApplies } from './tier-gate.js';

const TYPE_DESCRIPTIONS = {
    uses:        'Limited N - decrement uses on activation.',
    loading:     'Loading - flip to unloaded on activation.',
    charged:     'Recharge - flip to uncharged on activation (NPC features).',
    perTurn:     'Per-turn limit - increment used-this-turn counter.',
    perRound:    'Per-round limit - increment used-this-round counter.',
    perScene:    'Per-scene limit - increment used-this-scene counter.',
    reserveUsed: 'Reserve - mark used on activation.',
};
const CONSUME_ON_LABELS = { auto: 'Auto', activation: 'On attack', hit: 'On hit' };
const PER_X_TYPES = new Set(['perTurn', 'perRound', 'perScene']);

function isWeaponItem(item)
{
    return ['mech_weapon', 'pilot_weapon'].includes(item.type) || (item.type === 'npc_feature' && item.system?.type === 'Weapon');
}

export function openExtraConfigDialog(item)
{
    if (!item || item.documentName !== 'Item')
    {
        ui.notifications.warn('openExtraConfigDialog: not a valid Item');
        return;
    }

    const present = _detectResources(item);
    const subs = itemActionSubs(item).map(sub => ({ ...sub, types: _subResources(sub.data) })).filter(sub => sub.types.length);
    const isWeapon = isWeaponItem(item);

    const renderContent = () =>
    {
        const disabled = getAutoConsumeDisabled(item);
        const detectedHit = new Set(detectHitGatedScopes(item));

        const consumeOnSelect = (type) =>
        {
            if (!isWeapon || !PER_X_TYPES.has(type))
                return '';
            const mode = getConsumeOn(item, type);
            const autoLabel = `Auto (${detectedHit.has(type) ? 'on hit' : 'on attack'})`;
            const options = CONSUME_ON_MODES.map(candidate =>
                `<option value="${candidate}" ${candidate === mode ? 'selected' : ''}>${candidate === 'auto' ? autoLabel : CONSUME_ON_LABELS[candidate]}</option>`).join('');
            return `<select class="la-ec-consume-on" data-type="${type}" title="When the attack spends this counter" style="height:22px;font-size:0.8em;">${options}</select>`;
        };

        let autoConsumeHtml = '';
        if (present.length || subs.length)
        {
            const allDisabled = present.every(type => disabled.has(type))
                && subs.every(sub => sub.types.every(type => getSubAutoConsumeDisabled(item, sub.key).has(type)));
            const rows = present.map(type =>
            {
                const isOff = disabled.has(type);
                return `
                <div class="la-ec-row" style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--la-edge);">
                    <input type="checkbox" class="la-ec-toggle" data-type="${type}" ${isOff ? '' : 'checked'} style="margin:0;">
                    <div style="flex:1;">
                        <div style="font-size:0.9em;color:var(--la-ink);font-weight:bold;">Auto-consume ${RESOURCE_LABELS[type]}</div>
                        <div style="font-size:0.78em;color:var(--la-ink-dim);">${TYPE_DESCRIPTIONS[type] ?? ''}</div>
                    </div>
                    ${consumeOnSelect(type)}
                </div>`;
            }).join('');
            const subBlocks = subs.map(sub =>
            {
                const subDisabled = getSubAutoConsumeDisabled(item, sub.key);
                const subRows = sub.types.map(type => `
                <div class="la-ec-row" style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--la-edge);">
                    <input type="checkbox" class="la-ec-sub-toggle" data-sub-key="${sub.key}" data-type="${type}" ${subDisabled.has(type) ? '' : 'checked'} style="margin:0;">
                    <div style="flex:1;">
                        <div style="font-size:0.9em;color:var(--la-ink);font-weight:bold;">Auto-consume ${RESOURCE_LABELS[type]}</div>
                        <div style="font-size:0.78em;color:var(--la-ink-dim);">${TYPE_DESCRIPTIONS[type] ?? ''}</div>
                    </div>
                </div>`).join('');
                return `
                <div style="margin-top:8px;font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">Action: ${sub.name ?? sub.key}</div>
                <div style="margin-top:4px;border:1px solid var(--la-edge);background:var(--la-plate);">${subRows}</div>`;
            }).join('');
            autoConsumeHtml = `
            <div style="margin-top:10px;font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">Auto-Consume</div>
            <div style="margin-top:4px;display:flex;align-items:center;gap:8px;padding:5px 8px;background:color-mix(in srgb, var(--la-plate), var(--la-ink) 8%);border:1px solid var(--la-edge);">
                <input type="checkbox" class="la-ec-toggle-all" ${allDisabled ? 'checked' : ''} style="margin:0;">
                <span style="flex:1;font-size:0.9em;color:var(--la-ink);font-weight:bold;">Disable ALL auto-consume</span>
            </div>
            ${rows ? `<div style="margin-top:4px;border:1px solid var(--la-edge);background:var(--la-plate);">${rows}</div>` : ''}
            ${subBlocks}`;
        }

        const nativeLids = item.type === 'frame'
            ? (item.system?.core_system?.deployables || [])
            : (item.system?.deployables || []);
        const depRows = [...new Set(nativeLids)].map(lid =>
        {
            const info = getDeployableInfoSync(lid, item.actor) || {};
            const name = info.name || lid;
            const safeImg = String(info.img || 'icons/svg/hazard.svg').replaceAll('"', '&quot;');
            const safeLid = String(lid).replaceAll('"', '&quot;');
            const opts = getExtraDeployableOpts(item, lid) || {};
            return `
                <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid var(--la-edge);" title="${safeLid}">
                    <img src="${safeImg}" onerror="this.onerror=null;this.src='icons/svg/hazard.svg';" style="width:22px;height:22px;flex-shrink:0;border:none;">
                    <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</span>
                    <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Range override">R<input type="number" class="la-ec-dep-range" data-lid="${safeLid}" value="${opts.range ?? ''}" min="0" max="99" style="width:42px;height:22px;font-size:0.85em;"></label>
                    <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Count override">C<input type="number" class="la-ec-dep-count" data-lid="${safeLid}" value="${opts.count ?? ''}" min="1" max="20" style="width:42px;height:22px;font-size:0.85em;"></label>
                    ${tierGateApplies(item) ? tierGateControl(opts.tier, `data-lid="${safeLid}"`) : ''}
                </div>`;
        }).join('');
        const deployHtml = depRows
            ? `<div style="margin-top:14px;font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">Deployable Range / Count</div>
               <div style="margin-top:4px;border:1px solid var(--la-edge);background:var(--la-plate);">${depRows}</div>`
            : '';

        const hidePrimaryHtml = `
            <div style="margin-top:14px;font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">HUD</div>
            <div style="margin-top:4px;display:flex;align-items:center;gap:8px;padding:5px 8px;background:color-mix(in srgb, var(--la-plate), var(--la-ink) 8%);border:1px solid var(--la-edge);">
                <input type="checkbox" class="la-ec-hide-primary" ${isPrimaryActionHidden(item) ? 'checked' : ''} style="margin:0;">
                <div style="flex:1;">
                    <div style="font-size:0.9em;color:var(--la-ink);font-weight:bold;">Hide primary action</div>
                    <div style="font-size:0.78em;color:var(--la-ink-dim);">Show only this item's deployables / extras in the HUD.</div>
                </div>
            </div>`;

        const body = (autoConsumeHtml + deployHtml + hidePrimaryHtml)
            || '<div style="padding:12px;color:var(--la-ink-dim);font-size:0.9em;font-style:italic;text-align:center;">Nothing to configure for this item.</div>';
        return `
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">EXTRA CONFIG</div>
                <div class="lancer-dialog-subtitle">${item.name}</div>
            </div>
            ${body}`;
    };

    const dlg = new Dialog({
        title: 'Extra Config',
        content: `<div class="la-ec-body">${renderContent()}</div>`,
        buttons: {
            close: { label: 'Close' },
        },
        default: 'close',
        render: (html) =>
        {
            const wire = () =>
            {
                html.find('.la-ec-toggle').on('change', async (ev) =>
                {
                    const type = String($(ev.currentTarget).data('type') ?? '');
                    if (!CANONICAL_TYPES.includes(type))
                        return;
                    const checked = ev.currentTarget.checked === true;
                    await setItemAutoConsumeDisabled(item, type, !checked);
                    rerender();
                });
                html.find('.la-ec-sub-toggle').on('change', async (ev) =>
                {
                    const subKey = String($(ev.currentTarget).data('subKey') ?? '');
                    const type = String($(ev.currentTarget).data('type') ?? '');
                    if (!subKey || !PER_X_TYPES.has(type))
                        return;
                    await setSubAutoConsumeDisabled(item, subKey, type, ev.currentTarget.checked !== true);
                    rerender();
                });
                html.find('.la-ec-consume-on').on('change', async (ev) =>
                {
                    const type = String($(ev.currentTarget).data('type') ?? '');
                    const mode = String($(ev.currentTarget).val() ?? 'auto');
                    if (!PER_X_TYPES.has(type) || !CONSUME_ON_MODES.includes(mode))
                        return;
                    await setConsumeOn(item, type, mode);
                    rerender();
                });
                html.find('.la-ec-toggle-all').on('change', async (ev) =>
                {
                    const disableAll = ev.currentTarget.checked === true;
                    await setItemAutoConsumeDisabledAll(item, disableAll);
                    rerender();
                });
                html.find('.la-ec-dep-range').on('change', async (ev) =>
                {
                    const lid = String($(ev.currentTarget).data('lid') ?? '');
                    if (!lid)
                        return;
                    const raw = String($(ev.currentTarget).val() ?? '').trim();
                    const range = raw === '' ? null : Number(raw);
                    await setExtraDeployableOpts(item, lid, { range });
                });
                html.find('.la-ec-dep-count').on('change', async (ev) =>
                {
                    const lid = String($(ev.currentTarget).data('lid') ?? '');
                    if (!lid)
                        return;
                    const raw = String($(ev.currentTarget).val() ?? '').trim();
                    const count = raw === '' ? null : Number(raw);
                    await setExtraDeployableOpts(item, lid, { count });
                });
                html.find('.la-ec-hide-primary').on('change', async (ev) =>
                {
                    await setHidePrimaryAction(item, /** @type {HTMLInputElement} */ (ev.currentTarget).checked === true);
                });
                bindTierGate(html, async (tier, gate) =>
                {
                    const lid = gate.getAttribute('data-lid');
                    if (lid)
                        await setExtraDeployableOpts(item, lid, { tier });
                });
            };
            const rerender = () =>
            {
                html.find('.la-ec-body').html(renderContent());
                wire();
            };
            wire();
        },
    }, { width: 380, height: 'auto', classes: ['lancer-dialog-base', 'lancer-no-title'] });
    dlg.render(true);
}
