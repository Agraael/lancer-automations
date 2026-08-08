// Extra Config dialog for items. First feature: per-type auto-consume opt-out.

import {
    CANONICAL_TYPES, RESOURCE_LABELS,
    _hasResource, _detectResources,
    getAutoConsumeDisabled,
    setItemAutoConsumeDisabled,
    setItemAutoConsumeDisabledAll,
} from './extra-config.js';
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

export function openExtraConfigDialog(item)
{
    if (!item || item.documentName !== 'Item')
    {
        ui.notifications.warn('openExtraConfigDialog: not a valid Item');
        return;
    }

    const present = _detectResources(item);

    const renderContent = () =>
    {
        const disabled = getAutoConsumeDisabled(item);

        let autoConsumeHtml = '';
        if (present.length)
        {
            const allDisabled = present.every(type => disabled.has(type));
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
                </div>`;
            }).join('');
            autoConsumeHtml = `
            <div style="margin-top:10px;font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">Auto-Consume</div>
            <div style="margin-top:4px;display:flex;align-items:center;gap:8px;padding:5px 8px;background:color-mix(in srgb, var(--la-plate), var(--la-ink) 8%);border:1px solid var(--la-edge);">
                <input type="checkbox" class="la-ec-toggle-all" ${allDisabled ? 'checked' : ''} style="margin:0;">
                <span style="flex:1;font-size:0.9em;color:var(--la-ink);font-weight:bold;">Disable ALL auto-consume</span>
            </div>
            <div style="margin-top:4px;border:1px solid var(--la-edge);background:var(--la-plate);">${rows}</div>`;
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
