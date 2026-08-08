/* global $, game, ui, Dialog, FilePicker, fromUuid, fromUuidSync */

import {
    addExtraActions,
    getActorActions,
    removeExtraActions,
    addExtraDeploymentActor,
    removeExtraDeploymentActor,
    addExtraDeploymentLids,
    reloadExtraAction,
    getExtraDeployableOpts,
    setExtraDeployableOpts,
    openDeployablePicker,
} from './deployables.js';
import { addExtraBar, removeExtraBar, getExtraBars } from '../tah/tokenStatBar.js';
import { isWhiteIcon } from '../tah/item-helpers.js';
import { tierGateControl, bindTierGate, tierGateApplies, readTierGate } from './tier-gate.js';

const ACTIVATIONS = ['Quick', 'Full', 'Free', 'Reaction', 'Protocol', 'Quick Tech', 'Full Tech', 'Invade'];

function escAttr(str)
{
    return String(str).replace(/"/g, '&quot;');
}

function iconHtml(img, size = 22)
{
    if (!img)
        return '';
    const filter = isWhiteIcon(img) ? 'invert(1)' : 'none';
    const safe = escAttr(img);
    return `<img src="${safe}" onerror="this.onerror=null;this.src='icons/svg/dice-target.svg';" style="width:${size}px;height:${size}px;filter:${filter};vertical-align:middle;flex-shrink:0;border:none;">`;
}

const DAMAGE_TYPES = ['Kinetic', 'Energy', 'Explosive', 'Heat', 'Burn', 'Infection'];
const RANGE_TYPES = ['Range', 'Threat', 'Line', 'Cone', 'Blast', 'Burst', 'Thrown'];

function dmgRowHtml(val = '', type = 'Kinetic')
{
    const opts = DAMAGE_TYPES.map(dt => `<option${dt === type ? ' selected' : ''}>${dt}</option>`).join('');
    return `<div class="la-extras-dmg-row" style="display:flex;align-items:center;gap:6px;">
        <input type="text" class="la-extras-act-dmgval" value="${escAttr(val)}" placeholder="1d6" style="width:60px;height:22px;">
        <select class="la-extras-act-dmgtype" style="height:22px;">${opts}</select>
        <span class="la-extras-dmg-del" title="Remove" style="cursor:pointer;color:#a33;padding:0 4px;"><i class="fas fa-times"></i></span>
    </div>`;
}

function rangeRowHtml(val = '', type = 'Range')
{
    const opts = RANGE_TYPES.map(rt => `<option${rt === type ? ' selected' : ''}>${rt}</option>`).join('');
    return `<div class="la-extras-range-row" style="display:flex;align-items:center;gap:6px;">
        <input type="number" class="la-extras-act-rangeval" value="${escAttr(val)}" placeholder="&mdash;" style="width:44px;height:22px;">
        <select class="la-extras-act-rangetype" style="height:22px;">${opts}</select>
        <span class="la-extras-range-del" title="Remove" style="cursor:pointer;color:#a33;padding:0 4px;"><i class="fas fa-times"></i></span>
    </div>`;
}

// Detached actor picker so the main Extras window stays compact.
function openActorPickerPopup(target, onAdded)
{
    const actors = (game.actors?.contents ?? [])
        .slice()
        .sort((/** @type {any} */ actorA, /** @type {any} */ actorB) => actorA.name.localeCompare(actorB.name));
    const rowsHtml = actors.length
        ? actors.map((/** @type {any} */ actor) => `
            <div class="la-ap-row" data-uuid="${escAttr(actor.uuid)}" data-name="${escAttr(actor.name)}" style="cursor:pointer;padding:4px 8px;display:flex;align-items:center;gap:8px;background:var(--la-plate);border-left:3px solid transparent;">
                ${iconHtml(actor.img, 20)}
                <span style="flex:1;font-size:0.88em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${actor.name} <span style="color:var(--la-ink-dim);font-size:0.85em;">[${actor.type}]</span></span>
            </div>`).join('')
        : '<div style="padding:8px;text-align:center;color:var(--la-ink-dim);font-size:0.82em;font-style:italic;">No actors in world.</div>';
    const content = `
        <div class="lancer-dialog-header"><div class="lancer-dialog-title">ADD DEPLOYABLE ACTOR</div></div>
        <input type="text" class="la-ap-search" placeholder="Search actors..." style="margin-top:8px;width:100%;height:28px;padding:2px 8px;font-size:0.9em;box-sizing:border-box;">
        <div class="la-ap-list lancer-scroll" style="margin-top:6px;max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${rowsHtml}</div>`;
    const dlg = new Dialog({
        title: 'Add Deployable Actor',
        content,
        buttons: { close: { label: 'Close' } },
        default: 'close',
        render: (/** @type {any} */ html) =>
        {
            html.find('.la-ap-search').on('input', (/** @type {any} */ ev) =>
            {
                const query = String($(ev.currentTarget).val() ?? '').toLowerCase().trim();
                html.find('.la-ap-row').each((/** @type {any} */ _i, /** @type {any} */ el) =>
                {
                    const name = String($(el).data('name') ?? '').toLowerCase();
                    $(el).toggle(!query || name.includes(query));
                });
            });
            html.find('.la-ap-row').on('click', async (/** @type {any} */ ev) =>
            {
                const uuid = $(ev.currentTarget).data('uuid');
                if (!uuid)
                    return;
                const doc = /** @type {any} */ (await fromUuid(uuid));
                if (doc?.documentName !== 'Actor')
                    return;
                await addExtraDeploymentActor(target, doc);
                const cur = target.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [];
                if (!cur.includes(uuid))
                    await target.setFlag('lancer-automations', 'extraDeployableActorsViaUI', [...cur, uuid]);
                dlg.close();
                onAdded();
            });
            html.find('.la-ap-search').trigger('focus');
        },
    }, { width: 360, height: 'auto', classes: ['lancer-dialog-base', 'lancer-no-title'] });
    dlg.render(true);
}

function renderExtraBarsSection(target)
{
    const bars = getExtraBars(target) || [];
    const settingOn = (() =>
    {
        try
        {
            return !!game.settings.get('lancer-automations', 'tokenStatBar');
        }
        catch
        {
            return false;
        }
    })();
    const rows = bars.length
        ? bars.map((record) =>
        {
            const entry = record.entry ?? {};
            const label = entry.label || '(unnamed)';
            const swatch = entry.color?.stops?.[0] || '#888888';
            const valueSource = entry.valueSource ?? {};
            const maxSource = entry.maxSource ?? {};
            const summary = `${valueSource.kind === 'path' ? (valueSource.path || '?') : (valueSource.value ?? 0)} / ${maxSource.kind === 'path' ? (maxSource.path || '?') : (maxSource.value ?? 1)}`;
            return `
                <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;background:var(--la-plate);border-left:3px solid ${swatch};">
                    <span style="width:12px;height:12px;background:${swatch};border:1px solid rgba(0,0,0,0.4);border-radius:2px;flex-shrink:0;"></span>
                    <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}
                        <span style="color:var(--la-ink-dim);font-size:0.85em;margin-left:6px;">${summary}</span>
                    </span>
                    ${tierGateApplies(target) ? tierGateControl(entry.tier, `data-bar-id="${escAttr(record.id)}"`) : ''}
                    <span class="la-extras-remove-bar" data-id="${escAttr(record.id)}" title="Remove" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>
                </div>`;
        }).join('')
        : '<div style="padding:8px;text-align:center;color:var(--la-ink-dim);font-size:0.82em;font-style:italic;">No extra bars linked here.</div>';
    const hint = settingOn ? '' : '<div style="margin-top:4px;padding:6px 8px;background:rgba(200,120,40,0.1);border-left:2px solid #c87828;font-size:0.78em;color:var(--la-ink-dim);">Custom Token Stat Bars are disabled. Enable them in module settings to render these on tokens. Data is still saved.</div>';
    return `
        <div class="lancer-scroll" style="margin-top:4px;max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${rows}</div>
        ${hint}
    `;
}

export function openExtrasDialog(target)
{
    if (!target)
    {
        ui.notifications.warn("openExtrasDialog: no target (actor or item).");
        return;
    }
    const isItem = target.documentName === 'Item';
    let actIcon = 'icons/svg/dice-target.svg';
    let editingName = null;

    const renderContent = () =>
    {
        const allActions = getActorActions(target) || [];
        const uiActions = allActions.filter((/** @type {any} */ action) => action._addedViaExtrasUI === true);
        const allDepUuids = new Set(target.getFlag('lancer-automations', 'extraDeployableActors') || []);
        const uiMarkerUuids = (target.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [])
            .filter((/** @type {string} */ uuid) => allDepUuids.has(uuid));
        const allDepLids = new Set(target.getFlag('lancer-automations', 'extraDeployables') || []);
        const uiMarkerLids = (target.getFlag('lancer-automations', 'extraDeployableLidsViaUI') || [])
            .map((/** @type {any} */ entry) => (typeof entry === 'string' ? { lid: entry, name: entry, img: null } : entry))
            .filter((/** @type {any} */ e) => e?.lid && allDepLids.has(e.lid));

        const stateBadge = (/** @type {any} */ a) =>
        {
            const tags = a.tags ?? [];
            const parts = [];
            if (tags.some((/** @type {any} */ tag) => tag.lid === 'tg_loading'))
                parts.push(a.loaded === false ? '<span style="color:#c33;">⬡</span>' : '<span style="color:#3a9e6e;">⬢</span>');
            if (tags.some((/** @type {any} */ t) => t.lid === 'tg_recharge'))
            {
                const charged = a.charged !== false;
                parts.push(`<span style="color:${charged ? '#3a9e6e' : '#c33'};">⟳${a.recharge ?? ''}</span>`);
            }
            if (tags.some((/** @type {any} */ t) => t.lid === 'tg_limited'))
            {
                const usesValue = a.uses?.value ?? 0;
                const usesMax = a.uses?.max ?? 0;
                parts.push(`<span style="color:${usesValue <= 0 ? '#c33' : '#3a9e6e'};">${usesValue}/${usesMax}</span>`);
            }
            if (tags.some((/** @type {any} */ t) => t.lid === 'tg_turn'))
            {
                const v = a.usesPerTurn?.value ?? 0;
                const m = a.usesPerTurn?.max ?? 0;
                parts.push(`<span style="color:${v <= 0 ? '#c33' : '#3a9e6e'};" title="Per turn">↻${v}/${m}T</span>`);
            }
            if (tags.some((/** @type {any} */ t) => t.lid === 'tg_round'))
            {
                const v = a.usesPerRound?.value ?? 0;
                const m = a.usesPerRound?.max ?? 0;
                parts.push(`<span style="color:${v <= 0 ? '#c33' : '#3a9e6e'};" title="Per round">↻${v}/${m}R</span>`);
            }
            return parts.length ? `<span style="font-size:0.82em;margin-right:4px;">${parts.join(' ')}</span>` : '';
        };
        const hasResetable = (/** @type {any} */ a) =>
        {
            const tags = a.tags ?? [];
            return tags.some((/** @type {any} */ t) => ['tg_loading', 'tg_recharge', 'tg_limited', 'tg_turn', 'tg_round'].includes(t.lid));
        };
        const showTier = tierGateApplies(target);
        const actionRows = uiActions.length
            ? uiActions.map((/** @type {any} */ a) => `
                <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;background:var(--la-plate);border-left:3px solid transparent;">
                    ${iconHtml(a.icon || 'icons/svg/dice-target.svg', 22)}
                    <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.name} <span style="color:var(--la-ink-dim);font-size:0.85em;">[${a.activation || ''}]</span></span>
                    ${stateBadge(a)}
                    ${showTier ? tierGateControl(a.tier, `data-action-name="${escAttr(a.name)}"`) : ''}
                    ${hasResetable(a) ? `<span class="la-extras-reset-action" data-name="${escAttr(a.name)}" title="Reset" style="cursor:pointer;color:var(--la-ink-dim);padding:2px 6px;"><i class="fas fa-undo"></i></span>` : ''}
                    <span class="la-extras-modify-action" data-name="${escAttr(a.name)}" title="Modify" style="cursor:pointer;color:var(--la-ink-dim);padding:2px 6px;"><i class="fas fa-pen"></i></span>
                    <span class="la-extras-remove-action" data-name="${escAttr(a.name)}" title="Remove" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>
                </div>`).join('')
            : '<div style="padding:8px;text-align:center;color:var(--la-ink-dim);font-size:0.82em;font-style:italic;">No actions added via this dialog.</div>';
        const depRowsUuid = uiMarkerUuids.map((/** @type {string} */ uuid) =>
        {
            const actor = /** @type {any} */ (fromUuidSync(uuid));
            const name = actor?.name ?? '(missing)';
            const img = actor?.img ?? 'icons/svg/hazard.svg';
            const opts = getExtraDeployableOpts(target, uuid) || {};
            return `
                <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;background:var(--la-plate);border-left:3px solid transparent;">
                    ${iconHtml(img, 22)}
                    <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</span>
                    <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Range override">R<input type="number" class="la-extras-dep-range" data-uuid="${escAttr(uuid)}" value="${opts.range ?? ''}" min="0" max="99" style="width:42px;height:22px;font-size:0.85em;"></label>
                    <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Count override">C<input type="number" class="la-extras-dep-count" data-uuid="${escAttr(uuid)}" value="${opts.count ?? ''}" min="1" max="20" style="width:42px;height:22px;font-size:0.85em;"></label>
                    ${showTier ? tierGateControl(opts.tier, `data-uuid="${escAttr(uuid)}"`) : ''}
                    <span class="la-extras-remove-dep" data-uuid="${escAttr(uuid)}" title="Remove" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>
                </div>`;
        }).join('');
        const depRowsLid = uiMarkerLids.map((/** @type {any} */ e) =>
        {
            const opts = getExtraDeployableOpts(target, e.lid) || {};
            const img = e.img || 'icons/svg/hazard.svg';
            return `
                <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;background:var(--la-plate);border-left:3px solid var(--primary-color);" title="${escAttr(e.lid)}">
                    ${iconHtml(img, 22)}
                    <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.name}</span>
                    <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Range override">R<input type="number" class="la-extras-dep-lid-range" data-lid="${escAttr(e.lid)}" value="${opts.range ?? ''}" min="0" max="99" style="width:42px;height:22px;font-size:0.85em;"></label>
                    <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Count override">C<input type="number" class="la-extras-dep-lid-count" data-lid="${escAttr(e.lid)}" value="${opts.count ?? ''}" min="1" max="20" style="width:42px;height:22px;font-size:0.85em;"></label>
                    ${showTier ? tierGateControl(opts.tier, `data-lid="${escAttr(e.lid)}"`) : ''}
                    <span class="la-extras-remove-dep-lid" data-lid="${escAttr(e.lid)}" title="Remove" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>
                </div>`;
        }).join('');
        const depRows = (depRowsUuid + depRowsLid)
            || '<div style="padding:8px;text-align:center;color:var(--la-ink-dim);font-size:0.82em;font-style:italic;">No deployables added via this dialog.</div>';

        const actOptions = ACTIVATIONS.map(activation => `<option value="${activation}">${activation}</option>`).join('');
        const depPickActors = (game.actors?.contents ?? [])
            .slice()
            .sort((/** @type {any} */ actorA, /** @type {any} */ actorB) => actorA.name.localeCompare(actorB.name));
        const depActorRows = depPickActors.length
            ? depPickActors.map((/** @type {any} */ actor) => `
                <div class="la-extras-dep-pick-row" data-uuid="${escAttr(actor.uuid)}" data-name="${escAttr(actor.name)}" style="cursor:pointer;padding:4px 8px;display:flex;align-items:center;gap:8px;background:var(--la-plate);border-left:3px solid transparent;">
                    ${iconHtml(actor.img, 20)}
                    <span style="flex:1;font-size:0.85em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${actor.name} <span style="color:var(--la-ink-dim);font-size:0.85em;">[${actor.type}]</span></span>
                </div>`).join('')
            : '<div style="padding:8px;text-align:center;color:var(--la-ink-dim);font-size:0.82em;font-style:italic;">No actors in world.</div>';

        return `
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">EXTRAS</div>
                <div class="lancer-dialog-subtitle">Manage extras on ${target.name}${isItem ? ' (item)' : ''}. Only entries created via this dialog are listed.</div>
            </div>
            <div class="la-extras-lists" style="margin-top:10px;display:flex;flex-direction:column;gap:12px;">
                <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">Extra Actions</div>
                        <button class="la-extras-act-new" type="button" style="box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;line-height:1;padding:0 12px;font-size:0.82em;background:var(--primary-color);color:#fff;border:none;cursor:pointer;"><i class="fas fa-plus"></i> New</button>
                    </div>
                    <div class="lancer-scroll" style="margin-top:4px;max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${actionRows}</div>
                </div>
                <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">Extra Deployment Actors</div>
                        <button class="la-extras-dep-new" type="button" style="box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;line-height:1;padding:0 12px;font-size:0.82em;background:var(--primary-color);color:#fff;border:none;cursor:pointer;"><i class="fas fa-plus"></i> Add</button>
                    </div>
                    <div class="lancer-scroll" style="margin-top:4px;max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${depRows}</div>
                    <div class="la-extras-dep-drop" style="margin-top:6px;padding:8px;border:1px dashed var(--la-edge);text-align:center;font-size:0.82em;color:var(--la-ink-dim);">Drop a deployable actor here to add it.</div>
                </div>
                <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">Extra Bars</div>
                        <button class="la-extras-bar-new" type="button" style="box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;line-height:1;padding:0 12px;font-size:0.82em;background:var(--primary-color);color:#fff;border:none;cursor:pointer;"><i class="fas fa-plus"></i> Add</button>
                    </div>
                    ${renderExtraBarsSection(target)}
                </div>
            </div>
            <div class="la-extras-drawer lancer-dialog-base" style="position:absolute;top:0;left:100%;margin-left:8px;width:300px;height:100%;box-sizing:border-box;padding:12px;overflow:hidden;display:flex;flex-direction:column;background:var(--la-plate);color:var(--la-ink);font-family:var(--font-primary);border:1px solid var(--la-edge);box-shadow:-6px 0 16px rgba(0,0,0,0.45);transform:translateX(-100%);opacity:0;pointer-events:none;transition:transform 0.28s ease, opacity 0.28s ease;z-index:5;">
                <div style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                    <div class="la-extras-drawer-title" style="font-size:0.82em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink);font-weight:bold;">New Action</div>
                    <span class="la-extras-drawer-close" title="Close" style="cursor:pointer;color:var(--la-ink-dim);font-size:1.3em;line-height:1;padding:0 4px;">&times;</span>
                </div>
                <div class="la-extras-editor-action" style="flex:1 1 auto;min-height:0;flex-direction:column;">
                    <div class="la-extras-action-fields" style="flex:1 1 auto;min-height:0;overflow-y:auto;padding-right:2px;">
                    <div style="display:grid;grid-template-columns:34px 1fr 1fr;gap:6px;align-items:center;">
                        <span class="la-extras-act-icon" title="Click to change icon" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${iconHtml(actIcon, 22)}</span>
                        <input type="text" class="la-extras-act-name" placeholder="Name" style="height:26px;padding:2px 6px;font-size:0.9em;">
                        <select class="la-extras-act-act" style="height:26px;padding:2px 6px;font-size:0.9em;">${actOptions}</select>
                    </div>
                    <textarea class="la-extras-act-detail" placeholder="Detail (optional)" rows="2" style="margin-top:4px;width:100%;font-size:0.85em;padding:4px;box-sizing:border-box;"></textarea>
                    <div style="margin-top:4px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;"><input type="checkbox" class="la-extras-act-loading"> Loading</label>
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Limited <input type="number" class="la-extras-act-uses" placeholder="—" min="1" max="99" style="width:46px;height:22px;font-size:0.85em;"></label>
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Recharge <input type="number" class="la-extras-act-recharge" placeholder="—" min="2" max="6" style="width:42px;height:22px;font-size:0.85em;"></label>
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Per Turn <input type="number" class="la-extras-act-perturn" placeholder="—" min="1" max="9" style="width:42px;height:22px;font-size:0.85em;"></label>
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Per Round <input type="number" class="la-extras-act-perround" placeholder="—" min="1" max="9" style="width:42px;height:22px;font-size:0.85em;"></label>
                        ${showTier ? tierGateControl(null, 'data-role="act-add"') : ''}
                    </div>
                    <div class="la-extras-combat" style="margin-top:6px;padding:6px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 4%);font-size:0.8em;">
                        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
                            <span style="color:var(--la-ink-dim);text-transform:uppercase;letter-spacing:0.5px;">Combat</span>
                            <label style="display:flex;align-items:center;gap:3px;"><input type="radio" name="la-extras-combat-mode" value="" checked> None</label>
                            <label style="display:flex;align-items:center;gap:3px;"><input type="radio" name="la-extras-combat-mode" value="attack"> Attack</label>
                            <label style="display:flex;align-items:center;gap:3px;"><input type="radio" name="la-extras-combat-mode" value="damage"> Damage</label>
                            <label style="margin-left:auto;display:flex;align-items:center;gap:3px;"><input type="checkbox" class="la-extras-act-melee"> Melee</label>
                        </div>
                        <div style="margin-top:5px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;">
                            <label style="display:flex;align-items:center;gap:3px;">Acc<input type="number" class="la-extras-act-acc" value="0" style="width:38px;height:22px;"></label>
                            <label style="display:flex;align-items:center;gap:3px;">Diff<input type="number" class="la-extras-act-diff" value="0" style="width:38px;height:22px;"></label>
                            <label style="display:flex;align-items:center;gap:3px;">Bonus<input type="number" class="la-extras-act-atkbonus" value="0" style="width:38px;height:22px;"></label>
                        </div>
                        <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px 10px;">
                            ${[['tg_smart', 'Smart'], ['tg_seeking', 'Seeking'], ['tg_ap', 'AP'], ['tg_reliable', 'Reliable'], ['tg_overkill', 'Overkill'], ['tg_accurate', 'Accurate'], ['tg_inaccurate', 'Inaccurate']].map(([lid, label]) => `<label style="display:flex;align-items:center;gap:3px;"><input type="checkbox" class="la-extras-wtag" value="${lid}"> ${label}</label>`).join('')}
                        </div>
                        <div style="margin-top:5px;">
                            <div style="display:flex;align-items:center;gap:6px;"><span style="color:var(--la-ink-dim);">Dmg</span><span class="la-extras-dmg-add" title="Add damage" style="cursor:pointer;color:var(--primary-color);"><i class="fas fa-plus"></i></span></div>
                            <div class="la-extras-dmg-rows" style="margin-top:3px;display:flex;flex-direction:column;gap:3px;">${dmgRowHtml()}</div>
                        </div>
                        <div style="margin-top:5px;">
                            <div style="display:flex;align-items:center;gap:6px;"><span style="color:var(--la-ink-dim);">Range</span><span class="la-extras-range-add" title="Add range" style="cursor:pointer;color:var(--primary-color);"><i class="fas fa-plus"></i></span></div>
                            <div class="la-extras-range-rows" style="margin-top:3px;display:flex;flex-direction:column;gap:3px;">${rangeRowHtml()}</div>
                        </div>
                    </div>
                    </div>
                    <div style="flex:0 0 auto;margin-top:8px;text-align:right;">
                        <button class="la-extras-act-add" style="background:var(--primary-color);color:#fff;border:none;padding:4px 14px;cursor:pointer;font-size:0.85em;font-weight:bold;">Add Action</button>
                    </div>
                </div>
                <div class="la-extras-editor-dep" style="display:none;flex:1 1 auto;min-height:0;flex-direction:column;">
                    <input type="text" class="la-extras-dep-search" placeholder="Search actors..." style="flex:0 0 auto;width:100%;height:26px;padding:2px 8px;font-size:0.9em;box-sizing:border-box;">
                    <div class="la-extras-dep-pick-list lancer-scroll" style="flex:1 1 auto;min-height:0;margin-top:6px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${depActorRows}</div>
                    <button class="la-extras-dep-find-lid" type="button" style="flex:0 0 auto;margin-top:8px;width:100%;height:28px;padding:2px 10px;font-size:0.85em;background:var(--primary-color);color:#fff;border:none;cursor:pointer;"><i class="fas fa-rocket"></i> Add by LID</button>
                </div>
                <div class="la-extras-editor-bar" style="display:none;flex:0 0 auto;">
                    <div style="display:grid;grid-template-columns:1fr 34px;gap:6px;align-items:center;">
                        <input type="text" class="la-extras-bar-label" placeholder="Label" maxlength="14" style="height:26px;padding:2px 6px;font-size:0.9em;">
                        <input type="color" class="la-extras-bar-color" value="#66cc66" style="width:32px;height:26px;padding:0;cursor:pointer;">
                    </div>
                    <div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                        <input type="number" class="la-extras-bar-val" placeholder="Value" value="1" style="height:26px;padding:2px 6px;font-size:0.9em;">
                        <input type="number" class="la-extras-bar-max" placeholder="Max" value="3" style="height:26px;padding:2px 6px;font-size:0.9em;">
                    </div>
                    <button class="la-extras-bar-add" style="margin-top:8px;width:100%;background:var(--primary-color);color:#fff;border:none;padding:4px 12px;cursor:pointer;font-size:0.85em;font-weight:bold;">Add Bar</button>
                </div>
            </div>
        `;
    };

    const encodeKey = (key) => String(key).replace(/\./g, '$DOT$');
    const commitAllInputs = async (html) =>
    {
        const map = { ...(target.getFlag('lancer-automations', 'extraDeployableOpts') || {}) };
        const readOne = (sel, prop, dataKey) =>
        {
            html.find(sel).each((_i, el) =>
            {
                const raw = $(el).data(dataKey);
                if (!raw)
                    return;
                const encodedKey = encodeKey(raw);
                const rawVal = String($(el).val() ?? '').trim();
                const parsedNum = rawVal === '' ? null : Number(rawVal);
                const cur = { ...map[encodedKey] };
                if (parsedNum == null || Number.isNaN(parsedNum))
                    delete cur[prop];
                else
                    cur[prop] = parsedNum;
                if (Object.keys(cur).length === 0)
                    delete map[encodedKey];
                else
                    map[encodedKey] = cur;
            });
        };
        readOne('.la-extras-dep-range', 'range', 'uuid');
        readOne('.la-extras-dep-count', 'count', 'uuid');
        readOne('.la-extras-dep-lid-range', 'range', 'lid');
        readOne('.la-extras-dep-lid-count', 'count', 'lid');
        await target.setFlag('lancer-automations', 'extraDeployableOpts', map);
    };

    let floatingDrawer = null;
    /** @type {any} */
    const dialogOpts = { width: 480, height: 'auto', top: 450, left: 150, classes: ['lancer-dialog-base', 'lancer-no-title'] };
    const dlg = new Dialog({
        title: 'Extras',
        content: `<div class="la-extras-body" style="position:relative;overflow:visible;">${renderContent()}</div>`,
        buttons: {
            save: {
                label: 'Save',
                callback: (html) => commitAllInputs(html),
            },
        },
        default: 'save',
        render: (html) =>
        {
            const wire = () =>
            {
                const drawer = html.find('.la-extras-drawer');
                const dq = (/** @type {string} */ sel) => drawer.find(sel);
                dq('.la-extras-act-icon').on('click', () =>
                {
                    new FilePicker({
                        type: 'image',
                        current: actIcon,
                        callback: (path) =>
                        {
                            actIcon = path;
                            dq('.la-extras-act-icon').html(iconHtml(path, 22));
                        },
                    }).render(true);
                });
                const fillActionForm = (/** @type {any} */ src) =>
                {
                    dq('.la-extras-act-name').val(src.name ?? '');
                    dq('.la-extras-act-act').val(src.activation ?? 'Quick');
                    dq('.la-extras-act-detail').val(src.detail ?? '');
                    actIcon = src.icon || 'icons/svg/dice-target.svg';
                    dq('.la-extras-act-icon').html(iconHtml(actIcon, 22));
                    const tags = src.tags ?? [];
                    const hasLid = (/** @type {string} */ lid) => tags.some((/** @type {any} */ tag) => tag.lid === lid);
                    /** @type {any} */ (dq('.la-extras-act-loading')[0]).checked = hasLid('tg_loading');
                    dq('.la-extras-act-uses').val(src.uses?.max ?? '');
                    dq('.la-extras-act-recharge').val(src.recharge ?? '');
                    dq('.la-extras-act-perturn').val(src.usesPerTurn?.max ?? '');
                    dq('.la-extras-act-perround').val(src.usesPerRound?.max ?? '');
                    dq(`input[name="la-extras-combat-mode"][value="${src.laCombat ?? ''}"]`).prop('checked', true);
                    /** @type {any} */ (dq('.la-extras-act-melee')[0]).checked = src.attack_type === 'Melee';
                    dq('.la-extras-act-acc').val(src.accuracy ?? 0);
                    dq('.la-extras-act-diff').val(src.difficulty ?? 0);
                    dq('.la-extras-act-atkbonus').val(src.attack_bonus ?? 0);
                    dq('.la-extras-wtag').each((/** @type {number} */ _i, /** @type {any} */ el) =>
                    {
                        el.checked = tags.some((/** @type {any} */ tag) => tag.lid === el.value);
                    });
                    const dmgList = src.damage ?? [];
                    dq('.la-extras-dmg-rows').html(dmgList.length
                        ? dmgList.map((/** @type {any} */ dmgEntry) => dmgRowHtml(dmgEntry.val, dmgEntry.type)).join('')
                        : dmgRowHtml());
                    const rangeList = src.range ?? [];
                    dq('.la-extras-range-rows').html(rangeList.length
                        ? rangeList.map((/** @type {any} */ rangeEntry) => rangeRowHtml(rangeEntry.val, rangeEntry.type)).join('')
                        : rangeRowHtml());
                    editingName = src.name;
                    dq('.la-extras-act-add').text('Save Changes');
                };
                const clearActionForm = () =>
                {
                    editingName = null;
                    dq('.la-extras-act-name').val('');
                    dq('.la-extras-act-act').val('Quick');
                    dq('.la-extras-act-detail').val('');
                    actIcon = 'icons/svg/dice-target.svg';
                    dq('.la-extras-act-icon').html(iconHtml(actIcon, 22));
                    /** @type {any} */ (dq('.la-extras-act-loading')[0]).checked = false;
                    dq('.la-extras-act-uses, .la-extras-act-recharge, .la-extras-act-perturn, .la-extras-act-perround').val('');
                    dq('input[name="la-extras-combat-mode"][value=""]').prop('checked', true);
                    /** @type {any} */ (dq('.la-extras-act-melee')[0]).checked = false;
                    dq('.la-extras-act-acc, .la-extras-act-diff, .la-extras-act-atkbonus').val(0);
                    dq('.la-extras-wtag').each((/** @type {number} */ _i, /** @type {any} */ el) =>
                    {
                        el.checked = false;
                    });
                    dq('.la-extras-dmg-rows').html(dmgRowHtml());
                    dq('.la-extras-range-rows').html(rangeRowHtml());
                    dq('.la-extras-act-add').text('Add Action');
                };
                const openDrawer = (/** @type {string} */ type, /** @type {string} */ title) =>
                {
                    if (drawer[0] && drawer[0].parentElement !== document.body)
                        document.body.appendChild(/** @type {any} */ (drawer[0]));
                    floatingDrawer = drawer[0];
                    dq('.la-extras-drawer-title').text(title);
                    dq('.la-extras-editor-action, .la-extras-editor-dep, .la-extras-editor-bar').css('display', 'none');
                    dq('.la-extras-editor-' + type).css('display', type === 'bar' ? 'block' : 'flex');
                    const appEl = html.find('.la-extras-body')[0]?.closest('.app, .window-app, .application, dialog');
                    const rect = appEl ? appEl.getBoundingClientRect() : null;
                    const drawerWidth = 300;
                    const viewportWidth = globalThis.innerWidth || 1920;
                    const openLeft = !!rect && (rect.right + drawerWidth + 12 > viewportWidth) && (rect.left - drawerWidth - 12 >= 0);
                    const appZ = appEl ? Number.parseInt(globalThis.getComputedStyle(appEl).zIndex, 10) : Number.NaN;
                    const behindZ = Number.isFinite(appZ) ? appZ - 1 : 90;
                    drawer.css({
                        position: 'fixed',
                        top: rect ? (rect.top + 14) + 'px' : '',
                        left: rect ? (openLeft ? (rect.left - drawerWidth + 6) : (rect.right - 6)) + 'px' : '',
                        width: drawerWidth + 'px',
                        height: rect ? (rect.height - 28) + 'px' : '',
                        'margin-left': '0',
                        'z-index': String(behindZ),
                        'box-shadow': (openLeft ? '6px' : '-6px') + ' 0 16px rgba(0,0,0,0.45)',
                        transform: 'translateX(' + (openLeft ? '100%' : '-100%') + ')',
                        opacity: '0',
                        'pointer-events': 'none',
                    });
                    /** @type {any} */ (drawer[0]).getBoundingClientRect();
                    drawer.css({ transform: 'translateX(0)', opacity: '1', 'pointer-events': 'auto' });
                };
                const closeDrawer = () =>
                {
                    editingName = null;
                    drawer.css({ transform: 'translateX(-100%)', opacity: '0', 'pointer-events': 'none' });
                };
                dq('.la-extras-drawer-close').on('click', () => closeDrawer());
                html.find('.la-extras-act-new').on('click', () =>
                {
                    clearActionForm();
                    openDrawer('action', 'New Action');
                });
                html.find('.la-extras-dep-new').on('click', () => openDrawer('dep', 'Add Deployable'));
                html.find('.la-extras-bar-new').on('click', () => openDrawer('bar', 'Add Bar'));
                dq('.la-extras-dep-search').on('input', (/** @type {any} */ ev) =>
                {
                    const query = String($(ev.currentTarget).val() ?? '').toLowerCase().trim();
                    dq('.la-extras-dep-pick-row').each((/** @type {any} */ _i, /** @type {any} */ el) =>
                    {
                        const name = String($(el).data('name') ?? '').toLowerCase();
                        $(el).toggle(!query || name.includes(query));
                    });
                });
                dq('.la-extras-dep-pick-row').on('click', async (/** @type {any} */ ev) =>
                {
                    const uuid = $(ev.currentTarget).data('uuid');
                    const doc = /** @type {any} */ (await fromUuid(uuid));
                    if (doc?.documentName !== 'Actor')
                        return;
                    await addExtraDeploymentActor(target, doc);
                    const cur = target.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [];
                    if (!cur.includes(doc.uuid))
                        await target.setFlag('lancer-automations', 'extraDeployableActorsViaUI', [...cur, doc.uuid]);
                    rerender();
                });
                dq('.la-extras-dmg-add').on('click', () => dq('.la-extras-dmg-rows').append(dmgRowHtml()));
                dq('.la-extras-range-add').on('click', () => dq('.la-extras-range-rows').append(rangeRowHtml()));
                dq('.la-extras-dmg-rows').on('click', '.la-extras-dmg-del', (/** @type {any} */ ev) =>
                {
                    const rows = dq('.la-extras-dmg-row');
                    if (rows.length > 1)
                        $(ev.currentTarget).closest('.la-extras-dmg-row').remove();
                    else
                        rows.find('.la-extras-act-dmgval').val('');
                });
                dq('.la-extras-range-rows').on('click', '.la-extras-range-del', (/** @type {any} */ ev) =>
                {
                    const rows = dq('.la-extras-range-row');
                    if (rows.length > 1)
                        $(ev.currentTarget).closest('.la-extras-range-row').remove();
                    else
                        rows.find('.la-extras-act-rangeval').val('');
                });
                html.find('.la-extras-modify-action').on('click', (/** @type {any} */ ev) =>
                {
                    const name = $(ev.currentTarget).data('name');
                    const src = (getActorActions(target) || []).find((/** @type {any} */ item) => item.name === name && item._addedViaExtrasUI === true);
                    if (src)
                    {
                        fillActionForm(src);
                        openDrawer('action', 'Edit Action');
                    }
                });
                html.find('.la-extras-act-add').on('click', async () =>
                {
                    const name = String(dq('.la-extras-act-name').val() ?? '').trim();
                    if (!name)
                    {
                        ui.notifications.warn('Action needs a name.');
                        return;
                    }
                    const activation = String(dq('.la-extras-act-act').val() ?? 'Quick');
                    const detail = String(dq('.la-extras-act-detail').val() ?? '');
                    const loading = /** @type {HTMLInputElement} */ (dq('.la-extras-act-loading')[0])?.checked === true;
                    const usesRaw = dq('.la-extras-act-uses').val();
                    const usesMax = usesRaw ? Math.max(1, Number(usesRaw)) : 0;
                    const rechargeRaw = dq('.la-extras-act-recharge').val();
                    const recharge = rechargeRaw ? Math.min(6, Math.max(2, Number(rechargeRaw))) : 0;
                    const perTurnRaw = dq('.la-extras-act-perturn').val();
                    const perTurn = perTurnRaw ? Math.max(1, Number(perTurnRaw)) : 0;
                    const perRoundRaw = dq('.la-extras-act-perround').val();
                    const perRound = perRoundRaw ? Math.max(1, Number(perRoundRaw)) : 0;
                    /** @type {any} */
                    const entry = { name, activation, detail, icon: actIcon, _addedViaExtrasUI: true };
                    const addGate = dq('.la-tier-gate[data-role="act-add"]')[0];
                    const addTier = addGate ? readTierGate(addGate) : null;
                    if (addTier)
                        entry.tier = addTier;
                    const tags = [];
                    if (loading)
                    {
                        tags.push({ lid: 'tg_loading', name: 'Loading', val: '' });
                        entry.loaded = true;
                    }
                    if (usesMax > 0)
                    {
                        tags.push({ lid: 'tg_limited', name: 'Limited {VAL}', val: String(usesMax) });
                        entry.uses = { value: usesMax, max: usesMax };
                    }
                    if (recharge > 0)
                    {
                        tags.push({ lid: 'tg_recharge', name: 'Recharge {VAL}+', val: String(recharge) });
                        entry.charged = true;
                        entry.recharge = recharge;
                    }
                    if (perTurn > 0)
                    {
                        tags.push({ lid: 'tg_turn', name: '{VAL}/turn', val: String(perTurn) });
                        entry.usesPerTurn = { value: perTurn, max: perTurn };
                    }
                    if (perRound > 0)
                    {
                        tags.push({ lid: 'tg_round', name: '{VAL}/round', val: String(perRound) });
                        entry.usesPerRound = { value: perRound, max: perRound };
                    }
                    const combatMode = String(dq('input[name="la-extras-combat-mode"]:checked').val() ?? '');
                    if (combatMode === 'attack' || combatMode === 'damage')
                    {
                        entry.laCombat = combatMode;
                        dq('.la-extras-wtag').each((/** @type {number} */ _i, /** @type {any} */ el) =>
                        {
                            if (el.checked)
                                tags.push({ lid: String($(el).val()), val: '' });
                        });
                        const acc = Number(dq('.la-extras-act-acc').val() ?? 0);
                        const diff = Number(dq('.la-extras-act-diff').val() ?? 0);
                        const atkBonus = Number(dq('.la-extras-act-atkbonus').val() ?? 0);
                        if (acc)
                            entry.accuracy = acc;
                        if (diff)
                            entry.difficulty = diff;
                        if (atkBonus)
                            entry.attack_bonus = atkBonus;
                        entry.attack_type = /** @type {HTMLInputElement} */ (dq('.la-extras-act-melee')[0])?.checked ? 'Melee' : 'Ranged';
                        const damage = [];
                        dq('.la-extras-dmg-row').each((/** @type {number} */ _i, /** @type {any} */ rowEl) =>
                        {
                            const dmgVal = String($(rowEl).find('.la-extras-act-dmgval').val() ?? '').trim();
                            if (dmgVal)
                                damage.push({ val: dmgVal, type: String($(rowEl).find('.la-extras-act-dmgtype').val() ?? 'Kinetic') });
                        });
                        if (damage.length)
                            entry.damage = damage;
                        const range = [];
                        dq('.la-extras-range-row').each((/** @type {number} */ _i, /** @type {any} */ rowEl) =>
                        {
                            const rangeVal = String($(rowEl).find('.la-extras-act-rangeval').val() ?? '').trim();
                            if (rangeVal)
                                range.push({ type: String($(rowEl).find('.la-extras-act-rangetype').val() ?? 'Range'), val: rangeVal });
                        });
                        if (range.length)
                            entry.range = range;
                    }
                    if (tags.length)
                        entry.tags = tags;
                    if (editingName)
                    {
                        await removeExtraActions(target, (/** @type {any} */ old) => old.name === editingName && old._addedViaExtrasUI === true);
                        editingName = null;
                    }
                    await addExtraActions(target, entry);
                    rerender();
                });
                html.find('.la-extras-remove-action').on('click', async (ev) =>
                {
                    const name = $(ev.currentTarget).data('name');
                    if (!name)
                        return;
                    await removeExtraActions(target, (/** @type {any} */ a) => a.name === name && a._addedViaExtrasUI === true);
                    rerender();
                });
                html.find('.la-extras-reset-action').on('click', async (ev) =>
                {
                    const name = $(ev.currentTarget).data('name');
                    if (!name)
                        return;
                    await reloadExtraAction(target, name);
                    rerender();
                });
                dq('.la-extras-dep-find-lid').on('click', () =>
                {
                    openDeployablePicker({
                        onPick: async (entry) =>
                        {
                            await addExtraDeploymentLids(target, entry.lid);
                            const cur = target.getFlag('lancer-automations', 'extraDeployableLidsViaUI') || [];
                            if (!cur.some((/** @type {any} */ e) => (typeof e === 'string' ? e : e?.lid) === entry.lid))
                                await target.setFlag('lancer-automations', 'extraDeployableLidsViaUI', [...cur, { lid: entry.lid, name: entry.name, img: entry.img }]);
                            rerender();
                        },
                    });
                });
                html.find('.la-extras-remove-dep').on('click', async (ev) =>
                {
                    const uuid = $(ev.currentTarget).data('uuid');
                    if (!uuid)
                        return;
                    await removeExtraDeploymentActor(target, uuid);
                    rerender();
                });
                html.find('.la-extras-remove-dep-lid').on('click', async (ev) =>
                {
                    const lid = String($(ev.currentTarget).data('lid') ?? '');
                    if (!lid)
                        return;
                    const cur = target.getFlag('lancer-automations', 'extraDeployables') || [];
                    await target.setFlag('lancer-automations', 'extraDeployables', cur.filter((/** @type {string} */ existingLid) => existingLid !== lid));
                    const marker = target.getFlag('lancer-automations', 'extraDeployableLidsViaUI') || [];
                    await target.setFlag('lancer-automations', 'extraDeployableLidsViaUI', marker.filter((/** @type {any} */ e) => (typeof e === 'string' ? e : e?.lid) !== lid));
                    rerender();
                });
                html.find('.la-extras-dep-range').on('change', async (ev) =>
                {
                    const uuid = $(ev.currentTarget).data('uuid');
                    if (!uuid)
                        return;
                    const raw = String($(ev.currentTarget).val() ?? '').trim();
                    const range = raw === '' ? null : Number(raw);
                    await setExtraDeployableOpts(target, uuid, { range });
                });
                html.find('.la-extras-dep-count').on('change', async (ev) =>
                {
                    const uuid = $(ev.currentTarget).data('uuid');
                    if (!uuid)
                        return;
                    const raw = String($(ev.currentTarget).val() ?? '').trim();
                    const count = raw === '' ? null : Number(raw);
                    await setExtraDeployableOpts(target, uuid, { count });
                });
                html.find('.la-extras-dep-lid-range').on('change', async (ev) =>
                {
                    const lid = String($(ev.currentTarget).data('lid') ?? '');
                    if (!lid)
                        return;
                    const raw = String($(ev.currentTarget).val() ?? '').trim();
                    const range = raw === '' ? null : Number(raw);
                    await setExtraDeployableOpts(target, lid, { range });
                });
                html.find('.la-extras-dep-lid-count').on('change', async (ev) =>
                {
                    const lid = String($(ev.currentTarget).data('lid') ?? '');
                    if (!lid)
                        return;
                    const raw = String($(ev.currentTarget).val() ?? '').trim();
                    const count = raw === '' ? null : Number(raw);
                    await setExtraDeployableOpts(target, lid, { count });
                });
                bindTierGate(html, async (tier, gate) =>
                {
                    if (gate.getAttribute('data-role') === 'act-add')
                        return;
                    const actionName = gate.getAttribute('data-action-name');
                    if (actionName)
                    {
                        const list = foundry.utils.deepClone(target.getFlag('lancer-automations', 'extraActions') || []);
                        const entry = list.find((/** @type {any} */ a) => a.name === actionName && a._addedViaExtrasUI === true);
                        if (entry)
                        {
                            if (tier)
                                entry.tier = tier;
                            else
                                delete entry.tier;
                            await target.setFlag('lancer-automations', 'extraActions', list);
                        }
                        return;
                    }
                    const barId = gate.getAttribute('data-bar-id');
                    if (barId)
                    {
                        const records = foundry.utils.deepClone(target.getFlag('lancer-automations', 'extraBarTemplates') || []);
                        const record = records.find((/** @type {any} */ r) => r.id === barId);
                        if (record)
                        {
                            record.entry = record.entry ?? {};
                            if (tier)
                                record.entry.tier = tier;
                            else
                                delete record.entry.tier;
                            await target.setFlag('lancer-automations', 'extraBarTemplates', records);
                        }
                        return;
                    }
                    const key = gate.getAttribute('data-uuid') || gate.getAttribute('data-lid');
                    if (key)
                        await setExtraDeployableOpts(target, key, { tier });
                });
                const drop = html.find('.la-extras-dep-drop');
                drop.on('dragover', (ev) =>
                {
                    ev.preventDefault(); drop.css('border-color', 'var(--primary-color)');
                });
                drop.on('dragleave', () => drop.css('border-color', '#888'));
                drop.on('drop', async (ev) =>
                {
                    ev.preventDefault();
                    drop.css('border-color', '#888');
                    try
                    {
                        const dropPayload = JSON.parse(ev.originalEvent.dataTransfer.getData('text/plain'));
                        const doc = /** @type {any} */ (await fromUuid(dropPayload?.uuid));
                        if (doc?.documentName === 'Actor')
                        {
                            await addExtraDeploymentActor(target, doc);
                            const cur = target.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [];
                            if (!cur.includes(doc.uuid))
                                await target.setFlag('lancer-automations', 'extraDeployableActorsViaUI', [...cur, doc.uuid]);
                            rerender();
                        }
                    }
                    catch
                    { /* ignore */ }
                });
                html.find('.la-extras-bar-add').on('click', async () =>
                {
                    const label = String(dq('.la-extras-bar-label').val() ?? '').trim() || 'Extra';
                    const initialValue = Number(dq('.la-extras-bar-val').val()) || 0;
                    const max = Math.max(1, Number(dq('.la-extras-bar-max').val()) || 1);
                    const color = String(dq('.la-extras-bar-color').val() ?? '#66cc66');
                    const created = await addExtraBar(target, {
                        label,
                        valueSource: { kind: 'manual', value: initialValue },
                        maxSource: { kind: 'manual', value: max },
                        color: { kind: 'solid', stops: [color] },
                    });
                    if (!created)
                        ui.notifications?.warn('Could not add extra bar.');
                    rerender();
                });
                html.find('.la-extras-remove-bar').on('click', async (ev) =>
                {
                    const id = $(ev.currentTarget).data('id');
                    if (!id)
                        return;
                    await removeExtraBar(target, id);
                    rerender();
                });
            };
            const rerender = () =>
            {
                if (floatingDrawer)
                {
                    /** @type {any} */ (floatingDrawer).remove();
                    floatingDrawer = null;
                }
                html.find('.la-extras-body').html(renderContent());
                wire();
            };
            wire();
        },
        close: () =>
        {
            if (floatingDrawer)
            {
                /** @type {any} */ (floatingDrawer).remove();
                floatingDrawer = null;
            }
        },
    }, dialogOpts);
    dlg.render(true);
    globalThis.setTimeout(() =>
    {
        try
        {
            dlg.setPosition({ height: 'auto' });
        }
        catch
        { /* ignore */ }
    }, 40);
}
