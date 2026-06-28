/* global $, game, ui, Dialog, FilePicker, fromUuid, fromUuidSync */

import {
    addExtraActions,
    getActorActions,
    removeExtraActions,
    addExtraDeploymentActor,
    removeExtraDeploymentActor,
    reloadExtraAction,
    getExtraDeployableOpts,
    setExtraDeployableOpts,
} from './deployables.js';

const ACTIVATIONS = ['Quick', 'Full', 'Free', 'Reaction', 'Protocol', 'Quick Tech', 'Full Tech', 'Invade'];

function escAttr(s) {
    return String(s).replace(/"/g, '&quot;');
}

function iconHtml(img, size = 22) {
    if (!img)
        return '';
    const isWhiteSvg = img.endsWith('.svg') && (
        img.includes('/white/')
        || img.includes('modules/lancer-automations/')
        || img.startsWith('icons/svg/')
    );
    const filter = isWhiteSvg ? 'invert(1)' : 'none';
    const safe = escAttr(img);
    return `<img src="${safe}" onerror="this.onerror=null;this.src='icons/svg/dice-target.svg';" style="width:${size}px;height:${size}px;filter:${filter};vertical-align:middle;flex-shrink:0;border:none;">`;
}

export function openExtrasDialog(actor) {
    if (!actor) {
        ui.notifications.warn("openExtrasDialog: no actor.");
        return;
    }
    let actIcon = 'icons/svg/dice-target.svg';

    const renderContent = () => {
        const allActions = getActorActions(actor) || [];
        const uiActions = allActions.filter((/** @type {any} */ a) => a._addedViaExtrasUI === true);
        const allDepUuids = new Set(actor.getFlag('lancer-automations', 'extraDeployableActors') || []);
        const uiMarkerUuids = (actor.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [])
            .filter((/** @type {string} */ u) => allDepUuids.has(u));
        const allDeployableActors = (game.actors?.contents ?? [])
            .slice()
            .sort((/** @type {any} */ a, /** @type {any} */ b) => a.name.localeCompare(b.name));

        const stateBadge = (/** @type {any} */ a) => {
            const tags = a.tags ?? [];
            const parts = [];
            if (tags.some((/** @type {any} */ t) => t.lid === 'tg_loading'))
                parts.push(a.loaded === false ? '<span style="color:#c33;">⬡</span>' : '<span style="color:#3a9e6e;">⬢</span>');
            if (tags.some((/** @type {any} */ t) => t.lid === 'tg_recharge')) {
                const charged = a.charged !== false;
                parts.push(`<span style="color:${charged ? '#3a9e6e' : '#c33'};">⟳${a.recharge ?? ''}</span>`);
            }
            if (tags.some((/** @type {any} */ t) => t.lid === 'tg_limited')) {
                const v = a.uses?.value ?? 0;
                const m = a.uses?.max ?? 0;
                parts.push(`<span style="color:${v <= 0 ? '#c33' : '#3a9e6e'};">${v}/${m}</span>`);
            }
            if (tags.some((/** @type {any} */ t) => t.lid === 'tg_turn')) {
                const v = a.usesPerTurn?.value ?? 0;
                const m = a.usesPerTurn?.max ?? 0;
                parts.push(`<span style="color:${v <= 0 ? '#c33' : '#3a9e6e'};" title="Per turn">↻${v}/${m}T</span>`);
            }
            if (tags.some((/** @type {any} */ t) => t.lid === 'tg_round')) {
                const v = a.usesPerRound?.value ?? 0;
                const m = a.usesPerRound?.max ?? 0;
                parts.push(`<span style="color:${v <= 0 ? '#c33' : '#3a9e6e'};" title="Per round">↻${v}/${m}R</span>`);
            }
            return parts.length ? `<span style="font-size:0.82em;margin-right:4px;">${parts.join(' ')}</span>` : '';
        };
        const hasResetable = (/** @type {any} */ a) => {
            const tags = a.tags ?? [];
            return tags.some((/** @type {any} */ t) => ['tg_loading', 'tg_recharge', 'tg_limited', 'tg_turn', 'tg_round'].includes(t.lid));
        };
        const actionRows = uiActions.length
            ? uiActions.map((/** @type {any} */ a) => `
                <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;background:#fafafa;border-left:3px solid transparent;">
                    ${iconHtml(a.icon || 'icons/svg/dice-target.svg', 22)}
                    <span style="flex:1;font-size:0.9em;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.name} <span style="color:#888;font-size:0.85em;">[${a.activation || ''}]</span></span>
                    ${stateBadge(a)}
                    ${hasResetable(a) ? `<span class="la-extras-reset-action" data-name="${escAttr(a.name)}" title="Reset" style="cursor:pointer;color:#666;padding:2px 6px;"><i class="fas fa-undo"></i></span>` : ''}
                    <span class="la-extras-remove-action" data-name="${escAttr(a.name)}" title="Remove" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>
                </div>`).join('')
            : '<div style="padding:8px;text-align:center;color:#888;font-size:0.82em;font-style:italic;">No actions added via this dialog.</div>';

        const depRows = uiMarkerUuids.length
            ? uiMarkerUuids.map((/** @type {string} */ uuid) => {
                const a = /** @type {any} */ (fromUuidSync(uuid));
                const name = a?.name ?? '(missing)';
                const img = a?.img ?? 'icons/svg/hazard.svg';
                const opts = getExtraDeployableOpts(actor, uuid) || {};
                return `
                    <div class="la-tah-pick" style="padding:4px 8px;display:flex;align-items:center;gap:8px;background:#fafafa;border-left:3px solid transparent;">
                        ${iconHtml(img, 22)}
                        <span style="flex:1;font-size:0.9em;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</span>
                        <label style="font-size:0.78em;color:#666;display:flex;align-items:center;gap:2px;" title="Range override">R<input type="number" class="la-extras-dep-range" data-uuid="${escAttr(uuid)}" value="${opts.range ?? ''}" min="0" max="99" style="width:42px;height:22px;font-size:0.85em;"></label>
                        <label style="font-size:0.78em;color:#666;display:flex;align-items:center;gap:2px;" title="Count override">C<input type="number" class="la-extras-dep-count" data-uuid="${escAttr(uuid)}" value="${opts.count ?? ''}" min="1" max="20" style="width:42px;height:22px;font-size:0.85em;"></label>
                        <span class="la-extras-remove-dep" data-uuid="${escAttr(uuid)}" title="Remove" style="cursor:pointer;color:#a33;padding:2px 6px;"><i class="fas fa-trash"></i></span>
                    </div>`;
            }).join('')
            : '<div style="padding:8px;text-align:center;color:#888;font-size:0.82em;font-style:italic;">No deployables added via this dialog.</div>';

        const actOptions = ACTIVATIONS.map(o => `<option value="${o}">${o}</option>`).join('');
        const depPickRowsHtml = allDeployableActors.length
            ? allDeployableActors.map((/** @type {any} */ a) => `
                <div class="la-extras-dep-pick-row" data-uuid="${escAttr(a.uuid)}" data-name="${escAttr(a.name)}" style="cursor:pointer;padding:4px 8px;display:flex;align-items:center;gap:8px;background:#fafafa;border-left:3px solid transparent;">
                    ${iconHtml(a.img, 20)}
                    <span style="flex:1;font-size:0.88em;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.name} <span style="color:#888;font-size:0.85em;">[${a.type}]</span></span>
                </div>`).join('')
            : '<div style="padding:8px;text-align:center;color:#888;font-size:0.82em;font-style:italic;">No actors in world.</div>';

        return `
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">EXTRAS</div>
                <div class="lancer-dialog-subtitle">Manage extras on ${actor.name}. Only entries created via this dialog are listed.</div>
            </div>
            <div style="margin-top:10px;font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:#666;font-weight:bold;">Extra Actions</div>
            <div class="lancer-scroll" style="margin-top:4px;max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid #ccc;background:#fff;">${actionRows}</div>
            <div style="margin-top:8px;display:grid;grid-template-columns:34px 1fr 1fr;gap:6px;align-items:center;">
                <span class="la-extras-act-icon" title="Click to change icon" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #ccc;background:#fff;">${iconHtml(actIcon, 22)}</span>
                <input type="text" class="la-extras-act-name" placeholder="Name" style="height:26px;padding:2px 6px;font-size:0.9em;">
                <select class="la-extras-act-act" style="height:26px;padding:2px 6px;font-size:0.9em;">${actOptions}</select>
            </div>
            <textarea class="la-extras-act-detail" placeholder="Detail (optional)" rows="2" style="margin-top:4px;width:100%;font-size:0.85em;padding:4px;box-sizing:border-box;"></textarea>
            <div style="margin-top:4px;display:flex;align-items:center;flex-wrap:wrap;gap:10px;">
                <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;"><input type="checkbox" class="la-extras-act-loading"> Loading</label>
                <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Limited <input type="number" class="la-extras-act-uses" placeholder="—" min="1" max="99" style="width:46px;height:22px;font-size:0.85em;"></label>
                <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Recharge <input type="number" class="la-extras-act-recharge" placeholder="—" min="2" max="6" style="width:42px;height:22px;font-size:0.85em;"></label>
                <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Per Turn <input type="number" class="la-extras-act-perturn" placeholder="—" min="1" max="9" style="width:42px;height:22px;font-size:0.85em;"></label>
                <label style="font-size:0.82em;display:flex;align-items:center;gap:4px;">Per Round <input type="number" class="la-extras-act-perround" placeholder="—" min="1" max="9" style="width:42px;height:22px;font-size:0.85em;"></label>
                <button class="la-extras-act-add" style="margin-left:auto;background:var(--primary-color);color:#fff;border:none;padding:4px 12px;cursor:pointer;font-size:0.85em;font-weight:bold;">Add Action</button>
            </div>
            <div style="margin-top:14px;font-size:0.78em;text-transform:uppercase;letter-spacing:1px;color:#666;font-weight:bold;">Extra Deployment Actors</div>
            <div class="lancer-scroll" style="margin-top:4px;max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid #ccc;background:#fff;">${depRows}</div>
            <input type="text" class="la-extras-dep-search" placeholder="Search actors..." style="margin-top:8px;width:100%;height:26px;padding:2px 6px;font-size:0.9em;">
            <div class="la-extras-dep-pick-list lancer-scroll" style="margin-top:4px;max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid #ccc;background:#fff;">${depPickRowsHtml}</div>
            <div class="la-extras-dep-drop" style="margin-top:6px;padding:8px;border:1px dashed #888;text-align:center;font-size:0.82em;color:#888;">Drop a deployable actor here to add it.</div>
        `;
    };

    const encodeKey = (k) => String(k).replace(/\./g, '$DOT$');
    const commitAllInputs = async (html) => {
        const map = { ...(actor.getFlag('lancer-automations', 'extraDeployableOpts') || {}) };
        const readOne = (sel, prop) => {
            html.find(sel).each((_i, el) => {
                const uuid = $(el).data('uuid');
                if (!uuid)
                    return;
                const k = encodeKey(uuid);
                const raw = String($(el).val() ?? '').trim();
                const val = raw === '' ? null : Number(raw);
                const cur = { ...map[k] };
                if (val == null || Number.isNaN(val))
                    delete cur[prop];
                else
                    cur[prop] = val;
                if (Object.keys(cur).length === 0)
                    delete map[k];
                else
                    map[k] = cur;
            });
        };
        readOne('.la-extras-dep-range', 'range');
        readOne('.la-extras-dep-count', 'count');
        await actor.setFlag('lancer-automations', 'extraDeployableOpts', map);
    };

    const dlg = new Dialog({
        title: 'Extras',
        content: `<div class="la-extras-body">${renderContent()}</div>`,
        buttons: {
            save: {
                label: 'Save',
                callback: (html) => commitAllInputs(html),
            },
        },
        default: 'save',
        render: (html) => {
            const wire = () => {
                html.find('.la-extras-act-icon').on('click', () => {
                    new FilePicker({
                        type: 'image',
                        current: actIcon,
                        callback: (path) => {
                            actIcon = path;
                            html.find('.la-extras-act-icon').html(iconHtml(path, 22));
                        },
                    }).render(true);
                });
                html.find('.la-extras-act-add').on('click', async () => {
                    const name = String(html.find('.la-extras-act-name').val() ?? '').trim();
                    if (!name) {
                        ui.notifications.warn('Action needs a name.');
                        return;
                    }
                    const activation = String(html.find('.la-extras-act-act').val() ?? 'Quick');
                    const detail = String(html.find('.la-extras-act-detail').val() ?? '');
                    const loading = /** @type {HTMLInputElement} */ (html.find('.la-extras-act-loading')[0])?.checked === true;
                    const usesRaw = html.find('.la-extras-act-uses').val();
                    const usesMax = usesRaw ? Math.max(1, Number(usesRaw)) : 0;
                    const rechargeRaw = html.find('.la-extras-act-recharge').val();
                    const recharge = rechargeRaw ? Math.min(6, Math.max(2, Number(rechargeRaw))) : 0;
                    const perTurnRaw = html.find('.la-extras-act-perturn').val();
                    const perTurn = perTurnRaw ? Math.max(1, Number(perTurnRaw)) : 0;
                    const perRoundRaw = html.find('.la-extras-act-perround').val();
                    const perRound = perRoundRaw ? Math.max(1, Number(perRoundRaw)) : 0;
                    /** @type {any} */
                    const entry = { name, activation, detail, icon: actIcon, _addedViaExtrasUI: true };
                    const tags = [];
                    if (loading) {
                        tags.push({ lid: 'tg_loading', name: 'Loading', val: '' });
                        entry.loaded = true;
                    }
                    if (usesMax > 0) {
                        tags.push({ lid: 'tg_limited', name: 'Limited {VAL}', val: String(usesMax) });
                        entry.uses = { value: usesMax, max: usesMax };
                    }
                    if (recharge > 0) {
                        tags.push({ lid: 'tg_recharge', name: 'Recharge {VAL}+', val: String(recharge) });
                        entry.charged = true;
                        entry.recharge = recharge;
                    }
                    if (perTurn > 0) {
                        tags.push({ lid: 'tg_turn', name: '{VAL}/turn', val: String(perTurn) });
                        entry.usesPerTurn = { value: perTurn, max: perTurn };
                    }
                    if (perRound > 0) {
                        tags.push({ lid: 'tg_round', name: '{VAL}/round', val: String(perRound) });
                        entry.usesPerRound = { value: perRound, max: perRound };
                    }
                    if (tags.length)
                        entry.tags = tags;
                    await addExtraActions(actor, entry);
                    rerender();
                });
                html.find('.la-extras-remove-action').on('click', async (ev) => {
                    const name = $(ev.currentTarget).data('name');
                    if (!name)
                        return;
                    await removeExtraActions(actor, (/** @type {any} */ a) => a.name === name && a._addedViaExtrasUI === true);
                    rerender();
                });
                html.find('.la-extras-reset-action').on('click', async (ev) => {
                    const name = $(ev.currentTarget).data('name');
                    if (!name)
                        return;
                    await reloadExtraAction(actor, name);
                    rerender();
                });
                html.find('.la-extras-dep-search').on('input', (ev) => {
                    const q = String($(ev.currentTarget).val() ?? '').toLowerCase().trim();
                    html.find('.la-extras-dep-pick-row').each((_i, el) => {
                        const name = String($(el).data('name') ?? '').toLowerCase();
                        $(el).toggle(!q || name.includes(q));
                    });
                });
                html.find('.la-extras-dep-pick-row').on('click', async (ev) => {
                    const uuid = $(ev.currentTarget).data('uuid');
                    if (!uuid)
                        return;
                    const doc = /** @type {any} */ (await fromUuid(uuid));
                    if (doc?.documentName !== 'Actor')
                        return;
                    await addExtraDeploymentActor(actor, doc);
                    const cur = actor.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [];
                    if (!cur.includes(uuid))
                        await actor.setFlag('lancer-automations', 'extraDeployableActorsViaUI', [...cur, uuid]);
                    rerender();
                });
                html.find('.la-extras-dep-pick-row').each((_i, el) => {
                    const $el = $(el);
                    $el.on('mouseenter', () => $el.css({ background: '#e8f0fa', borderLeftColor: 'var(--primary-color)' }));
                    $el.on('mouseleave', () => $el.css({ background: '#fafafa', borderLeftColor: 'transparent' }));
                });
                html.find('.la-extras-remove-dep').on('click', async (ev) => {
                    const uuid = $(ev.currentTarget).data('uuid');
                    if (!uuid)
                        return;
                    await removeExtraDeploymentActor(actor, uuid);
                    rerender();
                });
                html.find('.la-extras-dep-range').on('change', async (ev) => {
                    const uuid = $(ev.currentTarget).data('uuid');
                    if (!uuid)
                        return;
                    const raw = String($(ev.currentTarget).val() ?? '').trim();
                    const range = raw === '' ? null : Number(raw);
                    await setExtraDeployableOpts(actor, uuid, { range });
                });
                html.find('.la-extras-dep-count').on('change', async (ev) => {
                    const uuid = $(ev.currentTarget).data('uuid');
                    if (!uuid)
                        return;
                    const raw = String($(ev.currentTarget).val() ?? '').trim();
                    const count = raw === '' ? null : Number(raw);
                    await setExtraDeployableOpts(actor, uuid, { count });
                });
                const drop = html.find('.la-extras-dep-drop');
                drop.on('dragover', (ev) => { ev.preventDefault(); drop.css('border-color', 'var(--primary-color)'); });
                drop.on('dragleave', () => drop.css('border-color', '#888'));
                drop.on('drop', async (ev) => {
                    ev.preventDefault();
                    drop.css('border-color', '#888');
                    try {
                        const data = JSON.parse(ev.originalEvent.dataTransfer.getData('text/plain'));
                        const doc = /** @type {any} */ (await fromUuid(data?.uuid));
                        if (doc?.documentName === 'Actor') {
                            await addExtraDeploymentActor(actor, doc);
                            const cur = actor.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [];
                            if (!cur.includes(doc.uuid))
                                await actor.setFlag('lancer-automations', 'extraDeployableActorsViaUI', [...cur, doc.uuid]);
                            rerender();
                        }
                    } catch { /* ignore */ }
                });
            };
            const rerender = () => {
                html.find('.la-extras-body').html(renderContent());
                wire();
            };
            wire();
        },
    }, { width: 480, classes: ['lancer-dialog-base', 'lancer-no-title'] });
    dlg.render(true);
}
