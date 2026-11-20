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
    addDeployableSpec,
    getDeployableSpecs,
    removeDeployableSpec,
} from './deployables.js';
import { localize, localizeFormat, escapeHtml as escAttr } from '../tools/string-utils.js';
import { getActionOverlays, getActionOverlay, setActionOverlay, removeActionOverlay } from './action-overlays.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag, setLAFlag } from '../tools/flag-utils.js';
import { addExtraBar, removeExtraBar, getExtraBars } from '../tah/tokenStatBar.js';
import { isWhiteIcon } from '../tah/item-helpers.js';
import { tierGateControl, bindTierGate, tierGateApplies, readTierGate } from './tier-gate.js';
import { ownEconomyControls, bindOwnEconomy, readOwnEconomy } from './deployable-settings.js';

const ACTIVATIONS = ['Quick', 'Full', 'Free', 'Reaction', 'Protocol', 'Quick Tech', 'Full Tech', 'Invade'];

function iconHtml(img, size = 22)
{
    if (!img)
        return '';

    const filter = isWhiteIcon(img) ? 'invert(1)' : 'none';
    const safe = escAttr(img);
    return `<img src="${safe}" onerror="this.onerror=null;this.src='icons/svg/dice-target.svg';" style="width:${size}px;height:${size}px;filter:${filter};vertical-align:middle;flex-shrink:0;border:none;">`;
}

const DEPLOYABLE_TYPES = ['Deployable', 'Drone', 'Mine'];
const SPEC_STATS = [['hp', 'HP', '5'], ['size', 'Size', '0.5'], ['armor', 'Armor', '0'], ['evasion', 'Evasion', '10'], ['edef', 'E-Def', '10'], ['save', 'Save', '10'], ['heatcap', 'Heat Cap', '0'], ['speed', 'Speed', '0']];
const SPEC_ACTIVATIONS = [['activation', 'Activate'], ['deactivation', 'Deactivate'], ['recall', 'Recall'], ['redeploy', 'Redeploy']];
const SPEC_BOX = 'margin-top:6px;padding:6px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 4%);font-size:0.8em;';
const SPEC_BUTTON = 'background:var(--primary-color);color:#fff;border:none;padding:4px 14px;cursor:pointer;font-size:0.85em;font-weight:bold;';
const SPEC_SMALL_BUTTON = 'background:transparent;color:var(--la-ink-dim);border:1px solid var(--la-edge);padding:3px 8px;cursor:pointer;font-size:0.78em;white-space:nowrap;';

function specActivationValue(value)
{
    const text = String(value ?? '').trim().toLowerCase().replace(/\s+action$/, '');
    return ACTIVATIONS.find(activation => activation.toLowerCase() === text) ?? '';
}

function specTagsText(tags)
{
    return (tags ?? []).map((/** @type {any} */ tag) =>
    {
        const lid = tag.lid ?? tag.id;
        return tag.val ? `${lid}:${tag.val}` : lid;
    }).filter(Boolean).join(', ');
}

function specTagsFromText(text)
{
    return String(text ?? '').split(',').map(part => part.trim()).filter(Boolean).map(part =>
    {
        const [id, val] = part.split(':').map(piece => piece.trim());
        return val ? { id, val } : { id };
    });
}

const DAMAGE_TYPES = ['Kinetic', 'Energy', 'Explosive', 'Heat', 'Burn', 'Infection'];
const RANGE_TYPES = ['Range', 'Threat', 'Line', 'Cone', 'Blast', 'Burst', 'Thrown'];
const COMBAT_MODES = [['', 'None'], ['attack', 'Attack'], ['damage', 'Damage']];

// Third entry lists the modes the tag actually reaches, the rest are hidden and cleared.
const COMBAT_TAGS = [
    ['tg_smart', 'Smart', 'attack'],
    ['tg_seeking', 'Seeking', 'attack'],
    ['tg_ap', 'AP', 'attack damage'],
    ['tg_reliable', 'Reliable', 'attack damage'],
    ['tg_overkill', 'Overkill', 'attack damage'],
    ['tg_accurate', 'Accurate', 'attack'],
    ['tg_inaccurate', 'Inaccurate', 'attack'],
];

function dmgRowHtml(dmgAmount = '', type = 'Kinetic')
{
    const opts = DAMAGE_TYPES.map(dt => `<option${dt === type ? ' selected' : ''}>${dt}</option>`).join('');
    return `<div class="la-extras-dmg-row" style="display:flex;align-items:center;gap:6px;">
        <input type="text" class="la-extras-act-dmgval" value="${escAttr(dmgAmount)}" placeholder="1d6" style="width:60px;height:22px;">
        <select class="la-extras-act-dmgtype" style="height:22px;">${opts}</select>
        <span class="la-extras-dmg-del" title="Remove" style="cursor:pointer;color:#a33;padding:0 4px;"><i class="fas fa-times"></i></span>
    </div>`;
}

function rangeRowHtml(rangeValue = '', type = 'Range')
{
    const opts = RANGE_TYPES.map(rt => `<option${rt === type ? ' selected' : ''}>${rt}</option>`).join('');
    return `<div class="la-extras-range-row" style="display:flex;align-items:center;gap:6px;">
        <input type="number" class="la-extras-act-rangeval" value="${escAttr(rangeValue)}" placeholder="&mdash;" style="width:44px;height:22px;">
        <select class="la-extras-act-rangetype" style="height:22px;">${opts}</select>
        <span class="la-extras-range-del" title="Remove" style="cursor:pointer;color:#a33;padding:0 4px;"><i class="fas fa-times"></i></span>
    </div>`;
}

function renderExtraBarsSection(target)
{
    const bars = getExtraBars(target) || [];
    const settingOn = !!getModuleSetting('tokenStatBar');

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

/** @returns {void} */
export function openExtrasDialog(target)
{
    if (!target)
    {
        ui.notifications.warn(localize('LA.notify.extrasDialogNoTarget'));
        return;
    }

    const isItem = target.documentName === 'Item';
    let actIcon = 'icons/svg/dice-target.svg';
    let editingName = null;
    // Set while the action editor is in combat-only mode for a native action.
    let overlayEditing = null;
    let specIcon = null;
    let specEditingLid = null;
    let specBase = {};
    let specActions = [];
    let specExtraActions = [];
    let depActionIndex = null;
    let specExtraIndex = null;

    const renderContent = () =>
    {
        const allActions = getActorActions(target) || [];
        const uiActions = allActions.filter((/** @type {any} */ action) => action._addedViaExtrasUI === true);
        const allDepUuids = new Set(getLAFlag(target,'extraDeployableActors') || []);

        const uiMarkerUuids = (getLAFlag(target,'extraDeployableActorsViaUI') || [])
            .filter((/** @type {string} */ uuid) => allDepUuids.has(uuid));

        const allDepLids = new Set(getLAFlag(target,'extraDeployables') || []);

        const uiMarkerLids = (getLAFlag(target,'extraDeployableLidsViaUI') || [])
            .map((/** @type {any} */ entry) => (typeof entry === 'string' ? { lid: entry, name: entry, img: null } : entry))
            .filter((/** @type {any} */ lidEntry) => lidEntry?.lid && allDepLids.has(lidEntry.lid));

        const stateBadge = (/** @type {any} */ action) =>
        {
            const tags = action.tags ?? [];
            const parts = [];

            if (tags.some((/** @type {any} */ tag) => tag.lid === 'tg_loading'))
                parts.push(action.loaded === false ? '<span style="color:#c33;">⬡</span>' : '<span style="color:#3a9e6e;">⬢</span>');

            if (tags.some((/** @type {any} */ tag) => tag.lid === 'tg_recharge'))
            {
                const charged = action.charged !== false;
                parts.push(`<span style="color:${charged ? '#3a9e6e' : '#c33'};">⟳${action.recharge ?? ''}</span>`);
            }

            if (tags.some((/** @type {any} */ tag) => tag.lid === 'tg_limited'))
            {
                const usesValue = action.uses?.value ?? 0;
                const usesMax = action.uses?.max ?? 0;
                parts.push(`<span style="color:${usesValue <= 0 ? '#c33' : '#3a9e6e'};">${usesValue}/${usesMax}</span>`);
            }

            if (tags.some((/** @type {any} */ tag) => tag.lid === 'tg_turn'))
            {
                const perTurnValue = action.usesPerTurn?.value ?? 0;
                const perTurnMax = action.usesPerTurn?.max ?? 0;
                parts.push(`<span style="color:${perTurnValue <= 0 ? '#c33' : '#3a9e6e'};" title="Per turn">↻${perTurnValue}/${perTurnMax}T</span>`);
            }

            if (tags.some((/** @type {any} */ tag) => tag.lid === 'tg_round'))
            {
                const perRoundValue = action.usesPerRound?.value ?? 0;
                const perRoundMax = action.usesPerRound?.max ?? 0;
                parts.push(`<span style="color:${perRoundValue <= 0 ? '#c33' : '#3a9e6e'};" title="Per round">↻${perRoundValue}/${perRoundMax}R</span>`);
            }

            return parts.length ? `<span style="font-size:0.82em;margin-right:4px;">${parts.join(' ')}</span>` : '';
        };

        const hasResetable = (/** @type {any} */ action) =>
        {
            const tags = action.tags ?? [];
            return tags.some((/** @type {any} */ tag) => ['tg_loading', 'tg_recharge', 'tg_limited', 'tg_turn', 'tg_round'].includes(tag.lid));
        };

        const showTier = tierGateApplies(target);

        const actionRows = uiActions.length
            ? uiActions.map((/** @type {any} */ action) => `
                <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;background:var(--la-plate);border-left:3px solid transparent;">
                    ${iconHtml(action.icon || 'icons/svg/dice-target.svg', 22)}
                    <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${action.name} <span style="color:var(--la-ink-dim);font-size:0.85em;">[${action.activation || ''}]</span></span>
                    ${stateBadge(action)}
                    ${showTier ? tierGateControl(action.tier, `data-action-name="${escAttr(action.name)}"`) : ''}
                    ${hasResetable(action) ? `<span class="la-extras-reset-action" data-name="${escAttr(action.name)}" title="Reset" style="cursor:pointer;color:var(--la-ink-dim);padding:2px 6px;"><i class="fas fa-undo"></i></span>` : ''}
                    <span class="la-extras-modify-action" data-name="${escAttr(action.name)}" title="Modify" style="cursor:pointer;color:var(--la-ink-dim);padding:2px 6px;"><i class="fas fa-pen"></i></span>
                    <span class="la-extras-remove-action" data-name="${escAttr(action.name)}" title="Remove" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>
                </div>`).join('')
            : '<div style="padding:8px;text-align:center;color:var(--la-ink-dim);font-size:0.82em;font-style:italic;">No actions added via this dialog.</div>';

        const depRowsUuid = uiMarkerUuids.map((/** @type {string} */ uuid) =>
        {
            const actor = /** @type {any} */ (fromUuidSync(uuid));
            const name = actor?.name ?? '(missing)';
            const img = actor?.img ?? 'icons/svg/hazard.svg';
            const opts = getExtraDeployableOpts(target, uuid) || {};
            return `
                <div style="background:var(--la-plate);border-left:3px solid transparent;">
                    <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;">
                        ${iconHtml(img, 22)}
                        <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</span>
                        <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Range override">R<input type="number" class="la-extras-dep-range" data-uuid="${escAttr(uuid)}" value="${opts.range ?? ''}" min="0" max="99" style="width:42px;height:22px;font-size:0.85em;"></label>
                        <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Count override">C<input type="number" class="la-extras-dep-count" data-uuid="${escAttr(uuid)}" value="${opts.count ?? ''}" min="1" max="20" style="width:42px;height:22px;font-size:0.85em;"></label>
                        ${showTier ? tierGateControl(opts.tier, `data-uuid="${escAttr(uuid)}"`) : ''}
                        <span class="la-extras-remove-dep" data-uuid="${escAttr(uuid)}" title="Remove" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>
                    </div>
                    ${ownEconomyControls(opts, `data-key="${escAttr(uuid)}"`)}
                </div>`;
        }).join('');

        const specsByLid = new Map(getDeployableSpecs(target).map((/** @type {any} */ spec) => [spec.lid, spec]));

        const depRowsLid = uiMarkerLids.map((/** @type {any} */ lidEntry) =>
        {
            const opts = getExtraDeployableOpts(target, lidEntry.lid) || {};
            const spec = specsByLid.get(lidEntry.lid);
            const img = spec?.img || lidEntry.img || 'icons/svg/hazard.svg';
            return `
                <div style="background:var(--la-plate);border-left:3px solid var(--primary-color);" title="${escAttr(lidEntry.lid)}">
                    <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;">
                        ${iconHtml(img, 22)}
                        <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${spec ? escAttr(spec.name ?? lidEntry.name) : lidEntry.name}</span>
                        ${spec ? `<span style="font-size:0.78em;color:var(--primary-color);text-transform:uppercase;">${localize('LA.extras.custom')}</span>` : ''}
                        <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Range override">R<input type="number" class="la-extras-dep-lid-range" data-lid="${escAttr(lidEntry.lid)}" value="${opts.range ?? ''}" min="0" max="99" style="width:42px;height:22px;font-size:0.85em;"></label>
                        <label style="font-size:0.78em;color:var(--la-ink-dim);display:flex;align-items:center;gap:2px;" title="Count override">C<input type="number" class="la-extras-dep-lid-count" data-lid="${escAttr(lidEntry.lid)}" value="${opts.count ?? ''}" min="1" max="20" style="width:42px;height:22px;font-size:0.85em;"></label>
                        ${showTier ? tierGateControl(opts.tier, `data-lid="${escAttr(lidEntry.lid)}"`) : ''}
                        ${spec ? `<span class="la-extras-modify-dep-spec" data-lid="${escAttr(lidEntry.lid)}" title="Modify" style="cursor:pointer;color:var(--la-ink-dim);padding:2px 6px;"><i class="fas fa-pen"></i></span>` : ''}
                        <span class="la-extras-remove-dep-lid" data-lid="${escAttr(lidEntry.lid)}" title="Remove" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>
                    </div>
                    ${ownEconomyControls(opts, `data-key="${escAttr(lidEntry.lid)}"`)}
                </div>`;
        }).join('');

        const depRows = (depRowsUuid + depRowsLid)
            || '<div style="padding:8px;text-align:center;color:var(--la-ink-dim);font-size:0.82em;font-style:italic;">No deployables added via this dialog.</div>';

        const overlayHosts = isItem
            ? [target]
            : [
                ...((target.system?.actions ?? []).length ? [target] : []),
                ...[...(target.items ?? [])].filter((/** @type {any} */ ownedItem) => (ownedItem.system?.actions ?? []).length),
            ];

        const nativeActionRows = overlayHosts.flatMap((/** @type {any} */ hostItem) =>
        {
            const overlays = getActionOverlays(hostItem);

            // A deployable's own activation behaves like an action and is named after the actor.
            const ownActivation = (!isItem && hostItem === target && target.system?.activation)
                ? [{ name: target.name, activation: target.system.activation }]
                : [];

            return [...ownActivation, ...(hostItem.system?.actions ?? [])].map((/** @type {any} */ action) =>
            {
                const overlay = overlays[action.name];

                const mark = overlay
                    ? `<span style="font-size:0.78em;color:var(--primary-color);text-transform:uppercase;">${overlay.laCombat}</span>`
                    : '';

                return `
                <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;background:var(--la-plate);border-left:3px solid ${overlay ? 'var(--primary-color)' : 'transparent'};">
                    <span style="flex:1;font-size:0.9em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${action.name}${isItem ? '' : ` <span style="color:var(--la-ink-dim);font-size:0.85em;">${hostItem.name}</span>`}</span>
                    ${mark}
                    <span class="la-extras-edit-overlay" data-item-id="${escAttr(hostItem.id)}" data-name="${escAttr(action.name)}" title="Attack / damage" style="cursor:pointer;color:var(--la-ink-dim);padding:2px 6px;"><i class="fas fa-pen"></i></span>
                    ${overlay ? `<span class="la-extras-remove-overlay" data-item-id="${escAttr(hostItem.id)}" data-name="${escAttr(action.name)}" title="Remove combat" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>` : ''}
                </div>`;
            });
        }).join('');

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
                ${nativeActionRows ? `
                <div>
                    <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">Action Combat</div>
                    <div class="lancer-scroll" style="margin-top:4px;max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${nativeActionRows}</div>
                </div>` : ''}
                <div>
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div style="font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink-dim);font-weight:bold;">Extra Deployment Actors</div>
                        <button class="la-extras-dep-new" type="button" style="box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:26px;line-height:1;padding:0 12px;font-size:0.82em;background:var(--primary-color);color:#fff;border:none;cursor:pointer;"><i class="fas fa-plus"></i> Add</button>
                    </div>
                    <div class="lancer-scroll" style="margin-top:4px;max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${depRows}</div>
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
                    <div style="display:flex;align-items:center;">
                        <span class="la-extras-drawer-back" title="${localize('LA.extras.back')}" style="display:none;cursor:pointer;color:var(--la-ink-dim);padding:0 6px 0 0;"><i class="fas fa-arrow-left"></i></span>
                        <div class="la-extras-drawer-title" style="font-size:0.82em;text-transform:uppercase;letter-spacing:1px;color:var(--la-ink);font-weight:bold;">New Action</div>
                    </div>
                    <span class="la-extras-drawer-close" title="${localize('LA.common.close')}" style="cursor:pointer;color:var(--la-ink-dim);font-size:1.3em;line-height:1;padding:0 4px;">&times;</span>
                </div>
                <div class="la-extras-editor-action" style="flex:1 1 auto;min-height:0;flex-direction:column;">
                    <div class="la-extras-action-fields" style="flex:1 1 auto;min-height:0;overflow-y:auto;padding-right:2px;">
                    <div class="la-extras-act-basics">
                    <div class="la-extras-act-grid" style="display:grid;grid-template-columns:34px 1fr 1fr;gap:6px;align-items:center;">
                        <span class="la-extras-act-icon" title="Click to change icon" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${iconHtml(actIcon, 22)}</span>
                        <input type="text" class="la-extras-act-name" placeholder="${localize('LA.common.name')}" style="height:26px;padding:2px 6px;font-size:0.9em;">
                        <select class="la-extras-act-act" style="height:26px;padding:2px 6px;font-size:0.9em;">${actOptions}</select>
                    </div>
                    <textarea class="la-extras-act-detail" placeholder="${localize('LA.extras.detailOptional')}" rows="2" style="margin-top:4px;width:100%;font-size:0.85em;padding:4px;box-sizing:border-box;"></textarea>
                    <div class="la-extras-act-limits" style="margin-top:4px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;"><input type="checkbox" class="la-extras-act-loading"> Loading</label>
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Limited <input type="number" class="la-extras-act-uses" placeholder="—" min="1" max="99" style="width:46px;height:22px;font-size:0.85em;"></label>
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Recharge <input type="number" class="la-extras-act-recharge" placeholder="—" min="2" max="6" style="width:42px;height:22px;font-size:0.85em;"></label>
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Per Turn <input type="number" class="la-extras-act-perturn" placeholder="—" min="1" max="9" style="width:42px;height:22px;font-size:0.85em;"></label>
                        <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Per Round <input type="number" class="la-extras-act-perround" placeholder="—" min="1" max="9" style="width:42px;height:22px;font-size:0.85em;"></label>
                        ${showTier ? tierGateControl(null, 'data-role="act-add"') : ''}
                    </div>
                    </div>
                    <div class="la-extras-overlay-note" style="display:none;margin-top:2px;padding:6px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 4%);font-size:0.8em;color:var(--la-ink-dim);">Attack or damage attached to this action. The action itself is untouched.</div>
                    <div class="la-extras-combat" style="margin-top:6px;padding:6px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 4%);font-size:0.8em;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="color:var(--la-ink-dim);text-transform:uppercase;letter-spacing:0.5px;">Combat</span>
                            <div class="la-extras-combat-seg" style="display:flex;flex:1;border:1px solid var(--la-edge);background:var(--la-plate);">
                                ${COMBAT_MODES.map(([value, label], idx) => `<label style="position:relative;flex:1;display:flex;align-items:center;justify-content:center;padding:2px 0;cursor:pointer;${idx < COMBAT_MODES.length - 1 ? 'border-right:1px solid var(--la-edge);' : ''}"><input type="radio" name="la-extras-combat-mode" value="${value}"${value ? '' : ' checked'} style="position:absolute;opacity:0;pointer-events:none;">${label}</label>`).join('')}
                            </div>
                        </div>
                        <div class="la-extras-combat-fields">
                            <div class="la-extras-combat-attack" style="margin-top:5px;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;">
                                <label style="display:flex;align-items:center;gap:3px;">Acc<input type="number" class="la-extras-act-acc" value="0" style="width:38px;height:22px;"></label>
                                <label style="display:flex;align-items:center;gap:3px;">Diff<input type="number" class="la-extras-act-diff" value="0" style="width:38px;height:22px;"></label>
                                <label style="display:flex;align-items:center;gap:3px;">Bonus<input type="number" class="la-extras-act-atkbonus" value="0" style="width:38px;height:22px;"></label>
                                <label style="margin-left:auto;display:flex;align-items:center;gap:3px;"><input type="checkbox" class="la-extras-act-melee"> Melee</label>
                            </div>
                            <div style="margin-top:5px;display:grid;grid-template-columns:repeat(3,1fr);gap:4px 6px;">
                                ${COMBAT_TAGS.map(([lid, label, modes]) => `<label data-modes="${modes}" style="display:flex;align-items:center;gap:3px;"><input type="checkbox" class="la-extras-wtag" value="${lid}"> ${label}</label>`).join('')}
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
                    </div>
                    <div style="flex:0 0 auto;margin-top:8px;text-align:right;">
                        <button class="la-extras-act-add" style="background:var(--primary-color);color:#fff;border:none;padding:4px 14px;cursor:pointer;font-size:0.85em;font-weight:bold;">Add Action</button>
                    </div>
                </div>
                <div class="la-extras-editor-dep" style="display:none;flex:1 1 auto;min-height:0;flex-direction:column;">
                    <input type="text" class="la-extras-dep-search" placeholder="${localize('LA.common.searchActors')}" style="flex:0 0 auto;width:100%;height:26px;padding:2px 8px;font-size:0.9em;box-sizing:border-box;">
                    <div class="la-extras-dep-pick-list lancer-scroll" style="flex:1 1 auto;min-height:0;margin-top:6px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${depActorRows}</div>
                    <button class="la-extras-dep-find-lid" type="button" style="flex:0 0 auto;margin-top:8px;width:100%;height:28px;padding:2px 10px;font-size:0.85em;background:var(--primary-color);color:#fff;border:none;cursor:pointer;"><i class="fas fa-rocket"></i> Add by LID</button>
                    <button class="la-extras-dep-new-spec" type="button" style="flex:0 0 auto;margin-top:6px;width:100%;height:28px;padding:2px 10px;font-size:0.85em;background:var(--primary-color);color:#fff;border:none;cursor:pointer;"><i class="fas fa-plus"></i> ${localize('LA.extras.newDeployable')}</button>
                </div>
                <div class="la-extras-editor-depspec" style="display:none;flex:1 1 auto;min-height:0;flex-direction:column;">
                    <div style="flex:1 1 auto;min-height:0;overflow-y:auto;padding-right:2px;">
                        <div style="display:grid;grid-template-columns:34px 1fr 1fr;gap:6px;align-items:center;">
                            <span class="la-extras-spec-icon" title="Click to change icon" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--la-edge);background:color-mix(in srgb, var(--la-plate), var(--la-ink) 6%);">${iconHtml('icons/svg/dice-target.svg', 22)}</span>
                            <input type="text" class="la-extras-spec-name" placeholder="${localize('LA.common.name')}" style="height:26px;padding:2px 6px;font-size:0.9em;">
                            <select class="la-extras-spec-type" style="height:26px;padding:2px 6px;font-size:0.9em;">${DEPLOYABLE_TYPES.map(type => `<option value="${type}">${type}</option>`).join('')}</select>
                        </div>
                        <input type="text" class="la-extras-spec-lid" placeholder="${localize('LA.extras.specLidPlaceholder')}" style="margin-top:4px;width:100%;height:22px;padding:2px 6px;font-size:0.78em;box-sizing:border-box;">
                        <div style="${SPEC_BOX}">
                            <div style="color:var(--la-ink-dim);text-transform:uppercase;letter-spacing:0.5px;">${localize('LA.extras.specStats')}</div>
                            <div style="margin-top:5px;display:grid;grid-template-columns:repeat(2,1fr);gap:4px 12px;">
                                ${SPEC_STATS.map(([key, label, placeholder]) => `<label style="display:flex;align-items:center;justify-content:space-between;gap:3px;">${label}<input type="text" class="la-extras-spec-stat" data-key="${key}" placeholder="${placeholder}" style="width:${key === 'hp' ? 52 : 38}px;height:22px;"></label>`).join('')}
                            </div>
                        </div>
                        <div style="${SPEC_BOX}">
                            <div style="color:var(--la-ink-dim);text-transform:uppercase;letter-spacing:0.5px;">${localize('LA.extras.specActivation')}</div>
                            <div style="margin-top:5px;display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;">
                                ${SPEC_ACTIVATIONS.map(([key, label]) => `<span>${label}</span><select class="la-extras-spec-act" data-key="${key}" style="height:22px;">${key === 'activation' ? '' : '<option value="">—</option>'}${actOptions}</select>`).join('')}
                            </div>
                        </div>
                        <textarea class="la-extras-spec-detail" placeholder="${localize('LA.extras.detailOptional')}" rows="3" style="margin-top:6px;width:100%;font-size:0.85em;padding:4px;box-sizing:border-box;"></textarea>
                        <input type="text" class="la-extras-spec-tags" placeholder="${localize('LA.extras.specTags')}" style="margin-top:4px;width:100%;height:22px;padding:2px 6px;font-size:0.82em;box-sizing:border-box;">
                        <div style="${SPEC_BOX}">
                            <div style="display:flex;align-items:center;gap:6px;"><span style="color:var(--la-ink-dim);">${localize('LA.extras.specActions')}</span><span class="la-extras-spec-action-add" title="${localize('LA.extras.addAction')}" style="cursor:pointer;color:var(--primary-color);"><i class="fas fa-plus"></i></span></div>
                            <div class="la-extras-spec-actions" style="margin-top:3px;display:flex;flex-direction:column;gap:3px;"></div>
                        </div>
                        <div class="la-extras-spec-own" style="margin-top:6px;"></div>
                        ${showTier ? `<div style="margin-top:6px;display:flex;align-items:center;gap:8px;font-size:0.82em;"><span style="color:var(--la-ink-dim);">${localize('LA.extras.specTier')}</span><span class="la-extras-spec-tier">${tierGateControl(null, 'data-role="spec-add"')}</span></div>` : ''}
                    </div>
                    <div class="la-extras-spec-paste-box" style="display:none;flex:0 0 auto;margin-top:6px;">
                        <textarea class="la-extras-spec-paste" rows="5" placeholder="${localize('LA.extras.pastePlaceholder')}" style="width:100%;font-size:0.78em;padding:4px;box-sizing:border-box;"></textarea>
                        <div class="la-extras-spec-paste-warn" style="display:none;margin-top:4px;padding:6px 8px;background:rgba(200,120,40,0.1);border-left:2px solid #c87828;font-size:0.78em;color:var(--la-ink-dim);"></div>
                        <div style="margin-top:4px;text-align:right;"><button type="button" class="la-extras-spec-fill" style="${SPEC_BUTTON}">${localize('LA.extras.fillForm')}</button></div>
                    </div>
                    <div style="flex:0 0 auto;margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                        <button type="button" class="la-extras-spec-paste-open" style="${SPEC_SMALL_BUTTON}"><i class="fas fa-paste"></i> ${localize('LA.extras.pasteJson')}</button>
                        <button type="button" class="la-extras-spec-copy" style="${SPEC_SMALL_BUTTON}"><i class="fas fa-copy"></i> ${localize('LA.extras.copyJson')}</button>
                    </div>
                    <div style="flex:0 0 auto;margin-top:8px;text-align:right;"><button type="button" class="la-extras-spec-save" style="${SPEC_BUTTON}">${localize('LA.extras.addDeployable')}</button></div>
                </div>
                <div class="la-extras-editor-bar" style="display:none;flex:0 0 auto;">
                    <div style="display:grid;grid-template-columns:1fr 34px;gap:6px;align-items:center;">
                        <input type="text" class="la-extras-bar-label" placeholder="${localize('LA.common.label')}" maxlength="14" style="height:26px;padding:2px 6px;font-size:0.9em;">
                        <input type="color" class="la-extras-bar-color" value="#66cc66" style="width:32px;height:26px;padding:0;cursor:pointer;">
                    </div>
                    <div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                        <input type="number" class="la-extras-bar-val" placeholder="${localize('LA.common.value')}" value="1" style="height:26px;padding:2px 6px;font-size:0.9em;">
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
        const map = { ...(getLAFlag(target,'extraDeployableOpts') || {}) };

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
        await setLAFlag(target,'extraDeployableOpts', map);
    };

    let floatingDrawer = null;
    let drawerFollow = null;
    /** @type {any} */
    const dialogOpts = { width: 480, height: 'auto', top: 450, left: 150, classes: ['lancer-dialog-base', 'lancer-no-title'] };

    const dlg = new Dialog({
        title: localize('LA.dialogTitle.extras'),
        content: `<div class="la-extras-body" style="position:relative;overflow:visible;">${renderContent()}</div>`,
        buttons: {
            save: {
                label: localize('LA.common.save'),
                callback: (html) => commitAllInputs(html),
            },
        },
        default: 'save',
        render: (html) =>
        {
            const wire = () =>
            {
                const drawer = html.find('.la-extras-drawer');
                const drawerFind = (/** @type {string} */ sel) => drawer.find(sel);
                drawerFind('.la-extras-act-icon').on('click', () =>
                {
                    new FilePicker({
                        type: 'image',
                        current: actIcon,
                        callback: (path) =>
                        {
                            actIcon = path;
                            drawerFind('.la-extras-act-icon').html(iconHtml(path, 22));
                        },
                    }).render(true);
                });

                const applyCombatMode = () =>
                {
                    const mode = String(drawerFind('input[name="la-extras-combat-mode"]:checked').val() ?? '');
                    drawerFind('.la-extras-combat-seg label').each((/** @type {number} */ _i, /** @type {any} */ el) =>
                    {
                        const on = !!el.querySelector('input')?.checked;
                        el.style.background = on ? 'var(--primary-color)' : '';
                        el.style.color = on ? '#fff' : '';
                    });
                    // Restore the real display value, not '': these rows carry an inline display:flex.
                    drawerFind('.la-extras-combat-fields').css('display', mode ? 'block' : 'none');
                    drawerFind('.la-extras-combat-attack').css('display', mode === 'attack' ? 'flex' : 'none');
                    drawerFind('.la-extras-wtag').each((/** @type {number} */ _i, /** @type {any} */ el) =>
                    {
                        const label = el.closest('label');
                        const on = String(label?.dataset.modes ?? '').split(' ').includes(mode);

                        if (label)
                            label.style.display = on ? 'flex' : 'none';
                        if (!on)
                            el.checked = false;
                    });
                };

                drawerFind('input[name="la-extras-combat-mode"]').on('change', applyCombatMode);

                const fillActionForm = (/** @type {any} */ src) =>
                {
                    drawerFind('.la-extras-act-name').val(src.name ?? '');
                    drawerFind('.la-extras-act-act').val(src.activation ?? 'Quick');
                    drawerFind('.la-extras-act-detail').val(src.detail ?? '');
                    actIcon = src.icon || 'icons/svg/dice-target.svg';
                    drawerFind('.la-extras-act-icon').html(iconHtml(actIcon, 22));
                    const tags = src.tags ?? [];
                    const hasLid = (/** @type {string} */ lid) => tags.some((/** @type {any} */ tag) => tag.lid === lid);
                    /** @type {any} */ (drawerFind('.la-extras-act-loading')[0]).checked = hasLid('tg_loading');
                    drawerFind('.la-extras-act-uses').val(src.uses?.max ?? '');
                    drawerFind('.la-extras-act-recharge').val(src.recharge ?? '');
                    drawerFind('.la-extras-act-perturn').val(src.usesPerTurn?.max ?? '');
                    drawerFind('.la-extras-act-perround').val(src.usesPerRound?.max ?? '');
                    drawerFind(`input[name="la-extras-combat-mode"][value="${src.laCombat ?? ''}"]`).prop('checked', true);
                    /** @type {any} */ (drawerFind('.la-extras-act-melee')[0]).checked = src.attack_type === 'Melee';
                    drawerFind('.la-extras-act-acc').val(src.accuracy ?? 0);
                    drawerFind('.la-extras-act-diff').val(src.difficulty ?? 0);
                    drawerFind('.la-extras-act-atkbonus').val(src.attack_bonus ?? 0);
                    drawerFind('.la-extras-wtag').each((/** @type {number} */ _i, /** @type {any} */ el) =>
                    {
                        el.checked = tags.some((/** @type {any} */ tag) => tag.lid === el.value);
                    });

                    const dmgList = src.damage ?? [];
                    drawerFind('.la-extras-dmg-rows').html(dmgList.length
                        ? dmgList.map((/** @type {any} */ dmgEntry) => dmgRowHtml(dmgEntry.val, dmgEntry.type)).join('')
                        : dmgRowHtml());

                    const rangeList = src.range ?? [];
                    drawerFind('.la-extras-range-rows').html(rangeList.length
                        ? rangeList.map((/** @type {any} */ rangeEntry) => rangeRowHtml(rangeEntry.val, rangeEntry.type)).join('')
                        : rangeRowHtml());
                    editingName = src.name;
                    drawerFind('.la-extras-act-add').text(localize('LA.extras.saveChanges'));
                    applyCombatMode();
                };

                const clearActionForm = () =>
                {
                    editingName = null;
                    drawerFind('.la-extras-act-name').val('');
                    drawerFind('.la-extras-act-act').val('Quick');
                    drawerFind('.la-extras-act-detail').val('');
                    actIcon = 'icons/svg/dice-target.svg';
                    drawerFind('.la-extras-act-icon').html(iconHtml(actIcon, 22));
                    /** @type {any} */ (drawerFind('.la-extras-act-loading')[0]).checked = false;
                    drawerFind('.la-extras-act-uses, .la-extras-act-recharge, .la-extras-act-perturn, .la-extras-act-perround').val('');
                    drawerFind('input[name="la-extras-combat-mode"][value=""]').prop('checked', true);
                    /** @type {any} */ (drawerFind('.la-extras-act-melee')[0]).checked = false;
                    drawerFind('.la-extras-act-acc, .la-extras-act-diff, .la-extras-act-atkbonus').val(0);
                    drawerFind('.la-extras-wtag').each((/** @type {number} */ _i, /** @type {any} */ el) =>
                    {
                        el.checked = false;
                    });
                    drawerFind('.la-extras-dmg-rows').html(dmgRowHtml());
                    drawerFind('.la-extras-range-rows').html(rangeRowHtml());
                    drawerFind('.la-extras-act-add').text('Add Action');
                    applyCombatMode();
                };

                const openDrawer = (/** @type {string} */ type, /** @type {string} */ title, /** @type {string|null} */ specMode = null) =>
                {
                    if (drawer[0] && drawer[0].parentElement !== document.body)
                        document.body.appendChild(/** @type {any} */ (drawer[0]));
                    floatingDrawer = drawer[0];
                    setDepActionMode(type === 'action' ? specMode : null);
                    drawerFind('.la-extras-drawer-title').text(title);
                    drawerFind('.la-extras-editor-action, .la-extras-editor-dep, .la-extras-editor-bar, .la-extras-editor-depspec').css('display', 'none');
                    drawerFind('.la-extras-editor-' + type).css('display', type === 'bar' ? 'block' : 'flex');
                    const appEl = html.find('.la-extras-body')[0]?.closest('.app, .window-app, .application, dialog');
                    const drawerWidth = 300;

                    const place = () =>
                    {
                        const rect = appEl ? appEl.getBoundingClientRect() : null;
                        const viewportWidth = globalThis.innerWidth || 1920;
                        const openLeft = !!rect && (rect.right + drawerWidth + 12 > viewportWidth) && (rect.left - drawerWidth - 12 >= 0);
                        drawer.css({
                            top: rect ? (rect.top + 14) + 'px' : '',
                            left: rect ? (openLeft ? (rect.left - drawerWidth + 6) : (rect.right - 6)) + 'px' : '',
                            height: rect ? (rect.height - 28) + 'px' : '',
                            'box-shadow': (openLeft ? '6px' : '-6px') + ' 0 16px rgba(0,0,0,0.45)',
                        });
                        return openLeft;
                    };

                    const appZ = appEl ? Number.parseInt(globalThis.getComputedStyle(appEl).zIndex, 10) : Number.NaN;
                    const behindZ = Number.isFinite(appZ) ? appZ - 1 : 90;
                    drawer.css({
                        position: 'fixed',
                        width: drawerWidth + 'px',
                        'margin-left': '0',
                        'z-index': String(behindZ),
                        opacity: '0',
                        'pointer-events': 'none',
                    });

                    const openLeft = place();
                    drawer.css({ transform: 'translateX(' + (openLeft ? '100%' : '-100%') + ')' });
                    /** @type {any} */ (drawer[0]).getBoundingClientRect();
                    drawer.css({ transform: 'translateX(0)', opacity: '1', 'pointer-events': 'auto' });
                    // Foundry drags the window by rewriting its inline style; track it so the drawer follows.
                    drawerFollow?.disconnect();

                    if (appEl)
                    {
                        drawerFollow = new MutationObserver(() => place());
                        drawerFollow.observe(appEl, { attributes: true, attributeFilter: ['style'] });
                    }
                };

                const closeDrawer = () =>
                {
                    editingName = null;
                    overlayEditing = null;
                    drawerFollow?.disconnect();
                    drawerFollow = null;
                    drawer.css({ transform: 'translateX(-100%)', opacity: '0', 'pointer-events': 'none' });
                };

                const setOverlayMode = (/** @type {boolean} */ on) =>
                {
                    drawerFind('.la-extras-act-basics').css('display', on ? 'none' : '');
                    drawerFind('.la-extras-overlay-note').css('display', on ? 'block' : 'none');
                    drawerFind('input[name="la-extras-combat-mode"][value=""]').closest('label').css('display', on ? 'none' : 'flex');
                    drawerFind('.la-extras-act-add').text(localize(on ? 'LA.extras.saveCombat' : 'LA.extras.addAction'));
                    applyCombatMode();
                };

                const setDepActionMode = (/** @type {string|null} */ mode) =>
                {
                    const native = mode === 'native';

                    if (!mode)
                    {
                        depActionIndex = null;
                        specExtraIndex = null;
                    }

                    drawerFind('.la-extras-act-icon').css('display', native ? 'none' : 'inline-flex');
                    drawerFind('.la-extras-act-limits').css('display', native ? 'none' : 'flex');
                    drawerFind('.la-extras-combat').css('display', native ? 'none' : '');
                    drawerFind('.la-extras-act-grid').css('grid-template-columns', native ? '1fr 1fr' : '34px 1fr 1fr');
                    drawerFind('.la-extras-drawer-back').css('display', mode ? 'inline' : 'none');
                };

                const specTitle = () => localize(specEditingLid ? 'LA.extras.editDeployableTitle' : 'LA.extras.newDeployableTitle');

                const specActionRow = (/** @type {any} */ action, /** @type {number} */ index, /** @type {string} */ kind, /** @type {string} */ mark) => `
                        <div style="display:flex;align-items:center;gap:6px;">
                            ${kind === 'extra' ? iconHtml(action.icon || 'icons/svg/dice-target.svg', 16) : ''}
                            <span style="flex:1;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escAttr(action.name ?? '')} <span style="color:var(--la-ink-dim);">[${escAttr(action.activation ?? '')}]</span></span>
                            ${mark ? `<span style="color:var(--primary-color);text-transform:uppercase;">${escAttr(mark)}</span>` : ''}
                            <span class="la-extras-spec-action-edit" data-kind="${kind}" data-index="${index}" title="Modify" style="cursor:pointer;color:var(--la-ink-dim);padding:0 4px;"><i class="fas fa-pen"></i></span>
                            <span class="la-extras-spec-action-del" data-kind="${kind}" data-index="${index}" title="Remove" style="cursor:pointer;color:#a33;padding:0 4px;"><i class="fas fa-times"></i></span>
                        </div>`;

                const renderSpecActions = () =>
                {
                    const rows = [
                        ...specActions.map((/** @type {any} */ action, index) => specActionRow(action, index, 'native', 'lcp')),
                        ...specExtraActions.map((/** @type {any} */ action, index) => specActionRow(action, index, 'extra', action.laCombat ?? '')),
                    ].join('');

                    drawerFind('.la-extras-spec-actions').html(rows || `<div style="color:var(--la-ink-dim);font-style:italic;">${localize('LA.extras.specNoActions')}</div>`);
                };

                const fillSpecForm = (/** @type {any} */ spec, /** @type {string|null} */ editLid) =>
                {
                    specBase = foundry.utils.deepClone(spec ?? {});
                    specEditingLid = editLid;
                    specIcon = spec?.img || null;
                    drawerFind('.la-extras-spec-icon').html(iconHtml(specIcon || 'icons/svg/dice-target.svg', 22));
                    drawerFind('.la-extras-spec-name').val(spec?.name ?? '');
                    drawerFind('.la-extras-spec-type').val(DEPLOYABLE_TYPES.find(type => type.toLowerCase() === String(spec?.type ?? '').toLowerCase()) ?? 'Deployable');
                    drawerFind('.la-extras-spec-lid').val(spec?.lid ?? '');
                    for (const [key] of SPEC_STATS)
                        drawerFind(`.la-extras-spec-stat[data-key="${key}"]`).val(spec?.[key] ?? '');
                    for (const [key] of SPEC_ACTIVATIONS)
                        drawerFind(`.la-extras-spec-act[data-key="${key}"]`).val(specActivationValue(spec?.[key]) || (key === 'activation' ? 'Quick' : ''));
                    drawerFind('.la-extras-spec-detail').val(spec?.detail ?? '');
                    drawerFind('.la-extras-spec-tags').val(specTagsText(spec?.tags));
                    specActions = foundry.utils.deepClone(spec?.actions ?? []);
                    specExtraActions = foundry.utils.deepClone(spec?.extraActions ?? []);
                    renderSpecActions();
                    const ownHost = drawerFind('.la-extras-spec-own');
                    ownHost.html(ownEconomyControls(editLid ? (getExtraDeployableOpts(target, editLid) ?? {}) : {}, '', 0));
                    bindOwnEconomy(ownHost, null);
                    const tierHost = drawerFind('.la-extras-spec-tier');

                    if (tierHost.length)
                    {
                        tierHost.html(tierGateControl(editLid ? getExtraDeployableOpts(target, editLid)?.tier : null, 'data-role="spec-add"'));
                        bindTierGate(tierHost, null);
                    }

                    drawerFind('.la-extras-spec-paste-box').css('display', 'none');
                    drawerFind('.la-extras-spec-paste-warn').css('display', 'none');
                    drawerFind('.la-extras-spec-save').text(localize(editLid ? 'LA.extras.saveChanges' : 'LA.extras.addDeployable'));
                };

                const readSpecForm = () =>
                {
                    const spec = foundry.utils.deepClone(specBase ?? {});
                    spec.name = String(drawerFind('.la-extras-spec-name').val() ?? '').trim();
                    spec.type = String(drawerFind('.la-extras-spec-type').val() ?? 'Deployable');
                    const lid = String(drawerFind('.la-extras-spec-lid').val() ?? '').trim();
                    if (lid)
                        spec.lid = lid;
                    else
                        delete spec.lid;
                    if (specIcon)
                        spec.img = specIcon;
                    else
                        delete spec.img;

                    for (const [key] of SPEC_STATS)
                    {
                        const raw = String(drawerFind(`.la-extras-spec-stat[data-key="${key}"]`).val() ?? '').trim();
                        if (raw === '')
                            delete spec[key];
                        else
                            spec[key] = Number.isFinite(Number(raw)) ? Number(raw) : raw;
                    }

                    for (const [key] of SPEC_ACTIVATIONS)
                    {
                        const value = String(drawerFind(`.la-extras-spec-act[data-key="${key}"]`).val() ?? '');
                        if (value)
                            spec[key] = value;
                        else
                            delete spec[key];
                    }

                    const detail = String(drawerFind('.la-extras-spec-detail').val() ?? '');
                    if (detail)
                        spec.detail = detail;
                    else
                        delete spec.detail;

                    const tags = specTagsFromText(drawerFind('.la-extras-spec-tags').val());
                    if (tags.length)
                        spec.tags = tags;
                    else
                        delete spec.tags;
                    if (specActions.length)
                        spec.actions = foundry.utils.deepClone(specActions);
                    else
                        delete spec.actions;
                    if (specExtraActions.length)
                        spec.extraActions = foundry.utils.deepClone(specExtraActions);
                    else
                        delete spec.extraActions;
                    return spec;
                };

                const editDepAction = (/** @type {number} */ index) =>
                {
                    clearActionForm();
                    overlayEditing = null;
                    setOverlayMode(false);
                    const action = specActions[index];

                    if (action)
                    {
                        drawerFind('.la-extras-act-name').val(action.name ?? '');
                        drawerFind('.la-extras-act-act').val(specActivationValue(action.activation) || 'Quick');
                        drawerFind('.la-extras-act-detail').val(action.detail ?? '');
                        drawerFind('.la-extras-act-add').text(localize('LA.extras.saveChanges'));
                    }

                    openDrawer('action', action?.name || localize('LA.extras.addAction'), 'native');
                    depActionIndex = action ? index : -1;
                };

                const editSpecExtra = (/** @type {number} */ index) =>
                {
                    clearActionForm();
                    overlayEditing = null;
                    setOverlayMode(false);
                    const action = specExtraActions[index];
                    if (action)
                        fillActionForm(action);
                    openDrawer('action', action?.name || localize('LA.extras.addAction'), 'extra');
                    specExtraIndex = action ? index : -1;
                };

                drawerFind('.la-extras-drawer-back').on('click', () => openDrawer('depspec', specTitle()));
                drawerFind('.la-extras-dep-new-spec').on('click', () =>
                {
                    fillSpecForm({}, null);
                    openDrawer('depspec', specTitle());
                });
                html.find('.la-extras-modify-dep-spec').on('click', (/** @type {any} */ ev) =>
                {
                    const lid = String($(ev.currentTarget).data('lid') ?? '');
                    const spec = getDeployableSpecs(target).find((/** @type {any} */ candidate) => candidate.lid === lid);

                    if (!spec)
                        return;
                    fillSpecForm(spec, lid);
                    openDrawer('depspec', specTitle());
                });
                drawerFind('.la-extras-spec-icon').on('click', () =>
                {
                    new FilePicker({
                        type: 'image',
                        current: specIcon ?? '',
                        callback: (path) =>
                        {
                            specIcon = path;
                            drawerFind('.la-extras-spec-icon').html(iconHtml(path, 22));
                        },
                    }).render(true);
                });
                drawerFind('.la-extras-spec-action-add').on('click', () => editSpecExtra(-1));
                drawerFind('.la-extras-spec-actions').on('click', '.la-extras-spec-action-edit', (/** @type {any} */ ev) =>
                {
                    const index = Number($(ev.currentTarget).data('index'));
                    if ($(ev.currentTarget).data('kind') === 'extra')
                        editSpecExtra(index);
                    else
                        editDepAction(index);
                });
                drawerFind('.la-extras-spec-actions').on('click', '.la-extras-spec-action-del', (/** @type {any} */ ev) =>
                {
                    const index = Number($(ev.currentTarget).data('index'));
                    if ($(ev.currentTarget).data('kind') === 'extra')
                        specExtraActions.splice(index, 1);
                    else
                        specActions.splice(index, 1);
                    renderSpecActions();
                });
                drawerFind('.la-extras-spec-paste-open').on('click', () =>
                {
                    const box = drawerFind('.la-extras-spec-paste-box');
                    box.css('display', box.css('display') === 'none' ? 'block' : 'none');
                });
                drawerFind('.la-extras-spec-fill').on('click', () =>
                {
                    const warn = drawerFind('.la-extras-spec-paste-warn');
                    let parsed;

                    try
                    {
                        parsed = JSON.parse(String(drawerFind('.la-extras-spec-paste').val() ?? ''));
                    }
                    catch (error)
                    {
                        warn.text(localizeFormat('LA.extras.specJsonInvalid', { error: error.message })).css('display', 'block');
                        return;
                    }

                    if (Array.isArray(parsed))
                        parsed = parsed[0];

                    if (!parsed || typeof parsed !== 'object' || !parsed.name)
                    {
                        warn.text(localize('LA.extras.specJsonNoName')).css('display', 'block');
                        return;
                    }

                    fillSpecForm(parsed, specEditingLid);
                });
                drawerFind('.la-extras-spec-copy').on('click', async () =>
                {
                    try
                    {
                        await navigator.clipboard.writeText(JSON.stringify(readSpecForm(), null, 2));
                        ui.notifications.info(localize('LA.notify.copiedToClipboard'));
                    }
                    catch
                    {
                        ui.notifications.warn(localize('LA.notify.failedToCopyToClipboard'));
                    }
                });
                drawerFind('.la-extras-spec-save').on('click', async () =>
                {
                    const spec = readSpecForm();

                    if (!spec.name)
                    {
                        ui.notifications.warn(localize('LA.notify.deployableNeedsAName'));
                        return;
                    }

                    if (specEditingLid && !spec.lid)
                        spec.lid = specEditingLid;
                    if (specEditingLid && spec.lid !== specEditingLid)
                        await removeDeployableSpec(target, specEditingLid);

                    const lid = await addDeployableSpec(target, spec);
                    const gate = drawerFind('.la-tier-gate[data-role="spec-add"]')[0];
                    const own = readOwnEconomy(drawerFind('.la-extras-spec-own .la-own-economy')[0]);

                    if (lid)
                        await setExtraDeployableOpts(target, lid, { ...own, ...(gate ? { tier: readTierGate(gate) } : {}) });
                    rerender();
                });
                drawerFind('.la-extras-drawer-close').on('click', () => closeDrawer());
                html.find('.la-extras-act-new').on('click', () =>
                {
                    clearActionForm();
                    overlayEditing = null;
                    setOverlayMode(false);
                    openDrawer('action', 'New Action');
                });
                html.find('.la-extras-edit-overlay').on('click', (ev) =>
                {
                    const itemId = $(ev.currentTarget).data('item-id');
                    const name = String($(ev.currentTarget).data('name') ?? '');
                    const hostItem = (isItem || itemId === target.id) ? target : target.items?.get(itemId);

                    if (!hostItem || !name)
                        return;
                    clearActionForm();
                    const overlay = getActionOverlay(hostItem, name);
                    if (overlay)
                        fillActionForm({ ...overlay, name });
                    drawerFind('input[name="la-extras-combat-mode"][value="' + (overlay?.laCombat ?? 'attack') + '"]').prop('checked', true);
                    overlayEditing = { item: hostItem, name };
                    setOverlayMode(true);
                    openDrawer('action', name);
                });
                html.find('.la-extras-remove-overlay').on('click', async (ev) =>
                {
                    const itemId = $(ev.currentTarget).data('item-id');
                    const name = String($(ev.currentTarget).data('name') ?? '');
                    const hostItem = (isItem || itemId === target.id) ? target : target.items?.get(itemId);

                    if (!hostItem || !name)
                        return;
                    await removeActionOverlay(hostItem, name);
                    rerender();
                });
                html.find('.la-extras-dep-new').on('click', () => openDrawer('dep', 'Add Deployable'));
                html.find('.la-extras-bar-new').on('click', () => openDrawer('bar', 'Add Bar'));
                drawerFind('.la-extras-dep-search').on('input', (/** @type {any} */ ev) =>
                {
                    const query = String($(ev.currentTarget).val() ?? '').toLowerCase().trim();
                    drawerFind('.la-extras-dep-pick-row').each((/** @type {any} */ _i, /** @type {any} */ el) =>
                    {
                        const name = String($(el).data('name') ?? '').toLowerCase();
                        $(el).toggle(!query || name.includes(query));
                    });
                });
                drawerFind('.la-extras-dep-pick-row').on('click', async (/** @type {any} */ ev) =>
                {
                    const uuid = $(ev.currentTarget).data('uuid');
                    const doc = /** @type {any} */ (await fromUuid(uuid));

                    if (doc?.documentName !== 'Actor')
                        return;
                    await addExtraDeploymentActor(target, doc);
                    const cur = getLAFlag(target,'extraDeployableActorsViaUI') || [];
                    if (!cur.includes(doc.uuid))
                        await setLAFlag(target,'extraDeployableActorsViaUI', [...cur, doc.uuid]);
                    rerender();
                });
                drawerFind('.la-extras-dmg-add').on('click', () => drawerFind('.la-extras-dmg-rows').append(dmgRowHtml()));
                drawerFind('.la-extras-range-add').on('click', () => drawerFind('.la-extras-range-rows').append(rangeRowHtml()));
                drawerFind('.la-extras-dmg-rows').on('click', '.la-extras-dmg-del', (/** @type {any} */ ev) =>
                {
                    const rows = drawerFind('.la-extras-dmg-row');
                    if (rows.length > 1)
                        $(ev.currentTarget).closest('.la-extras-dmg-row').remove();
                    else
                        rows.find('.la-extras-act-dmgval').val('');
                });
                drawerFind('.la-extras-range-rows').on('click', '.la-extras-range-del', (/** @type {any} */ ev) =>
                {
                    const rows = drawerFind('.la-extras-range-row');
                    if (rows.length > 1)
                        $(ev.currentTarget).closest('.la-extras-range-row').remove();
                    else
                        rows.find('.la-extras-act-rangeval').val('');
                });
                html.find('.la-extras-modify-action').on('click', (/** @type {any} */ ev) =>
                {
                    const name = $(ev.currentTarget).data('name');
                    const src = (getActorActions(target) || []).find((/** @type {any} */ action) => action.name === name && action._addedViaExtrasUI === true);

                    if (src)
                    {
                        fillActionForm(src);
                        openDrawer('action', 'Edit Action');
                    }
                });
                html.find('.la-extras-act-add').on('click', async () =>
                {
                    if (depActionIndex !== null)
                    {
                        const actionName = String(drawerFind('.la-extras-act-name').val() ?? '').trim();

                        if (!actionName)
                        {
                            ui.notifications.warn(localize('LA.notify.actionNeedsAName'));
                            return;
                        }

                        const action = {
                            ...(specActions[depActionIndex] ?? {}),
                            name: actionName,
                            activation: String(drawerFind('.la-extras-act-act').val() ?? 'Quick'),
                            detail: String(drawerFind('.la-extras-act-detail').val() ?? '')
                        };

                        if (depActionIndex >= 0)
                            specActions[depActionIndex] = action;
                        else
                            specActions.push(action);
                        renderSpecActions();
                        openDrawer('depspec', specTitle());
                        return;
                    }

                    const name = overlayEditing ? overlayEditing.name : String(drawerFind('.la-extras-act-name').val() ?? '').trim();

                    if (!name)
                    {
                        ui.notifications.warn(localize('LA.notify.actionNeedsAName'));
                        return;
                    }

                    const activation = String(drawerFind('.la-extras-act-act').val() ?? 'Quick');
                    const detail = String(drawerFind('.la-extras-act-detail').val() ?? '');
                    const loading = /** @type {HTMLInputElement} */ (drawerFind('.la-extras-act-loading')[0])?.checked === true;
                    const usesRaw = drawerFind('.la-extras-act-uses').val();
                    const usesMax = usesRaw ? Math.max(1, Number(usesRaw)) : 0;
                    const rechargeRaw = drawerFind('.la-extras-act-recharge').val();
                    const recharge = rechargeRaw ? Math.min(6, Math.max(2, Number(rechargeRaw))) : 0;
                    const perTurnRaw = drawerFind('.la-extras-act-perturn').val();
                    const perTurn = perTurnRaw ? Math.max(1, Number(perTurnRaw)) : 0;
                    const perRoundRaw = drawerFind('.la-extras-act-perround').val();
                    const perRound = perRoundRaw ? Math.max(1, Number(perRoundRaw)) : 0;
                    /** @type {any} */
                    const entry = { name, activation, detail, icon: actIcon, _addedViaExtrasUI: true };
                    const addGate = drawerFind('.la-tier-gate[data-role="act-add"]')[0];
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

                    const combatMode = String(drawerFind('input[name="la-extras-combat-mode"]:checked').val() ?? '');

                    if (combatMode === 'attack' || combatMode === 'damage')
                    {
                        entry.laCombat = combatMode;
                        drawerFind('.la-extras-wtag').each((/** @type {number} */ _i, /** @type {any} */ el) =>
                        {
                            if (el.checked)
                                tags.push({ lid: String($(el).val()), val: '' });
                        });

                        // A damage roll reads none of these, so don't carry them onto the entry.
                        if (combatMode === 'attack')
                        {
                            const acc = Number(drawerFind('.la-extras-act-acc').val() ?? 0);
                            const diff = Number(drawerFind('.la-extras-act-diff').val() ?? 0);
                            const atkBonus = Number(drawerFind('.la-extras-act-atkbonus').val() ?? 0);

                            if (acc)
                                entry.accuracy = acc;
                            if (diff)
                                entry.difficulty = diff;
                            if (atkBonus)
                                entry.attack_bonus = atkBonus;
                            entry.attack_type = /** @type {HTMLInputElement} */ (drawerFind('.la-extras-act-melee')[0])?.checked ? 'Melee' : 'Ranged';
                        }

                        const damage = [];
                        drawerFind('.la-extras-dmg-row').each((/** @type {number} */ _i, /** @type {any} */ rowEl) =>
                        {
                            const dmgVal = String($(rowEl).find('.la-extras-act-dmgval').val() ?? '').trim();
                            if (dmgVal)
                                damage.push({ val: dmgVal, type: String($(rowEl).find('.la-extras-act-dmgtype').val() ?? 'Kinetic') });
                        });
                        if (damage.length)
                            entry.damage = damage;

                        const range = [];
                        drawerFind('.la-extras-range-row').each((/** @type {number} */ _i, /** @type {any} */ rowEl) =>
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

                    if (specExtraIndex !== null)
                    {
                        if (specExtraIndex >= 0)
                            specExtraActions[specExtraIndex] = entry;
                        else
                            specExtraActions.push(entry);
                        editingName = null;
                        renderSpecActions();
                        openDrawer('depspec', specTitle());
                        return;
                    }

                    if (overlayEditing)
                    {
                        const { laCombat, accuracy, difficulty, attack_bonus, attack_type, damage, range } = entry;
                        await setActionOverlay(overlayEditing.item, overlayEditing.name, {
                            laCombat: laCombat ?? 'attack',
                            accuracy: accuracy ?? null,
                            difficulty: difficulty ?? null,
                            attack_bonus: attack_bonus ?? null,
                            attack_type: attack_type ?? null,
                            damage: damage ?? null,
                            range: range ?? null,
                            tags: tags.filter((/** @type {any} */ tag) => !['tg_loading', 'tg_limited', 'tg_recharge', 'tg_turn', 'tg_round'].includes(tag.lid)),
                        });
                        overlayEditing = null;
                        rerender();
                        return;
                    }

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
                    await removeExtraActions(target, (/** @type {any} */ action) => action.name === name && action._addedViaExtrasUI === true);
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
                drawerFind('.la-extras-dep-find-lid').on('click', () =>
                {
                    openDeployablePicker({
                        onPick: async (entry) =>
                        {
                            await addExtraDeploymentLids(target, entry.lid);
                            const cur = getLAFlag(target,'extraDeployableLidsViaUI') || [];
                            if (!cur.some((/** @type {any} */ lidItem) => (typeof lidItem === 'string' ? lidItem : lidItem?.lid) === entry.lid))
                                await setLAFlag(target,'extraDeployableLidsViaUI', [...cur, { lid: entry.lid, name: entry.name, img: entry.img }]);
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

                    if (getDeployableSpecs(target).some((/** @type {any} */ spec) => spec.lid === lid))
                    {
                        await removeDeployableSpec(target, lid);
                        rerender();
                        return;
                    }

                    const cur = getLAFlag(target,'extraDeployables') || [];
                    await setLAFlag(target,'extraDeployables', cur.filter((/** @type {string} */ existingLid) => existingLid !== lid));
                    const marker = getLAFlag(target,'extraDeployableLidsViaUI') || [];
                    await setLAFlag(target,'extraDeployableLidsViaUI', marker.filter((/** @type {any} */ lidItem) => (typeof lidItem === 'string' ? lidItem : lidItem?.lid) !== lid));
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
                        const list = foundry.utils.deepClone(getLAFlag(target,'extraActions') || []);
                        const entry = list.find((/** @type {any} */ action) => action.name === actionName && action._addedViaExtrasUI === true);

                        if (entry)
                        {
                            if (tier)
                                entry.tier = tier;
                            else
                                delete entry.tier;
                            await setLAFlag(target,'extraActions', list);
                        }

                        return;
                    }

                    const barId = gate.getAttribute('data-bar-id');

                    if (barId)
                    {
                        const records = foundry.utils.deepClone(getLAFlag(target,'extraBarTemplates') || []);
                        const record = records.find((/** @type {any} */ candidate) => candidate.id === barId);

                        if (record)
                        {
                            record.entry = record.entry ?? {};
                            if (tier)
                                record.entry.tier = tier;
                            else
                                delete record.entry.tier;
                            await setLAFlag(target,'extraBarTemplates', records);
                        }

                        return;
                    }

                    const key = gate.getAttribute('data-uuid') || gate.getAttribute('data-lid');
                    if (key)
                        await setExtraDeployableOpts(target, key, { tier });
                });
                bindOwnEconomy(html, async (opts, row) =>
                {
                    const key = row.dataset.key;
                    if (key)
                        await setExtraDeployableOpts(target, key, opts);
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
                            const cur = getLAFlag(target,'extraDeployableActorsViaUI') || [];
                            if (!cur.includes(doc.uuid))
                                await setLAFlag(target,'extraDeployableActorsViaUI', [...cur, doc.uuid]);
                            rerender();
                        }
                    }
                    catch
                    { /* ignore */ }
                });
                html.find('.la-extras-bar-add').on('click', async () =>
                {
                    const label = String(drawerFind('.la-extras-bar-label').val() ?? '').trim() || 'Extra';
                    const initialValue = Number(drawerFind('.la-extras-bar-val').val()) || 0;
                    const max = Math.max(1, Number(drawerFind('.la-extras-bar-max').val()) || 1);
                    const color = String(drawerFind('.la-extras-bar-color').val() ?? '#66cc66');

                    const created = await addExtraBar(target, {
                        label,
                        valueSource: { kind: 'manual', value: initialValue },
                        maxSource: { kind: 'manual', value: max },
                        color: { kind: 'solid', stops: [color] },
                    });

                    if (!created)
                        ui.notifications?.warn(localize('LA.notify.couldNotAddExtraBar'));
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
                drawerFollow?.disconnect();
                drawerFollow = null;

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
            drawerFollow?.disconnect();
            drawerFollow = null;

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
