/* global console, ChatMessage, Dialog, fromUuid, game, ui, renderTemplate, $ */

const TPL = {
    menu:      'modules/lancer-automations/templates/rest-menu.html',
    emergency: 'modules/lancer-automations/templates/rest-emergency.html',
};

const REPAIR_ICON = 'systems/lancer/assets/icons/white/repair.svg';
const ALLIED_REGEX = /Contributed (\d+) Repairs/;

async function _resolveMechAndPilot(token) {
    const actor = token?.actor;
    if (!actor)
        return { mech: null, pilot: null };
    if (actor.type === 'mech') {
        let pilot = null;
        if (actor.system.pilot?.id) {
            try {
                pilot = /** @type {any} */ (await fromUuid(actor.system.pilot.id));
            } catch { /* ignore */ }
        }
        return { mech: actor, pilot };
    }
    if (actor.type === 'pilot') {
        let mech = null;
        if (actor.system.active_mech?.id) {
            try {
                mech = /** @type {any} */ (await fromUuid(actor.system.active_mech.id));
            } catch { /* ignore */ }
        }
        return { mech, pilot: actor };
    }
    return { mech: null, pilot: null };
}

function _getAlliedRepairs() {
    const messages = game.messages.contents.slice(-5);
    let total = 0;
    for (const m of messages) {
        const c = m.content ?? '';
        if (c.includes('Rest Report') && c.includes('Contributed')) {
            const match = c.match(ALLIED_REGEX);
            if (match)
                total += parseInt(match[1], 10) || 0;
        }
    }
    return total;
}

function _snapshotMech(mech, pilot) {
    const sys = mech.system;
    /** @type {any[]} */
    const effects = mech.effects?.contents?.map((e) => ({
        id: e.id,
        name: e.name,
        img: e.img || e.icon || 'icons/svg/aura.svg',
    })) ?? [];
    /** @type {any[]} */
    const destroyedWeapons = [];
    for (const mount of sys.loadout?.weapon_mounts ?? []) {
        for (const slot of mount.slots ?? []) {
            const w = slot.weapon?.value;
            if (w?.system?.destroyed)
                destroyedWeapons.push({ id: w.id, name: w.name });
        }
    }
    /** @type {any[]} */
    const destroyedSystems = [];
    for (const s of sys.loadout?.systems ?? []) {
        const item = s?.value;
        if (item?.system?.destroyed)
            destroyedSystems.push({ id: item.id, name: item.name });
    }
    return {
        mech: {
            name: mech.name,
            img: mech.img,
            hp: { value: sys.hp?.value ?? 0, max: sys.hp?.max ?? 0 },
            heat: { value: sys.heat?.value ?? 0, max: sys.heat?.max ?? 0 },
            structure: { value: sys.structure?.value ?? 0, max: sys.structure?.max ?? 0 },
            stress: { value: sys.stress?.value ?? 0, max: sys.stress?.max ?? 0 },
            repairs: { value: sys.repairs?.value ?? 0, max: sys.repairs?.max ?? 0 },
        },
        pilot: pilot ? { name: pilot.name, callsign: pilot.system?.callsign ?? '' } : null,
        effects,
        hasEffects: effects.length > 0,
        hpDamaged: (sys.hp?.value ?? 0) < (sys.hp?.max ?? 0),
        heatNotZero: (sys.heat?.value ?? 0) > 0,
        destroyedWeapons,
        destroyedSystems,
        hasDestroyed: destroyedWeapons.length + destroyedSystems.length > 0,
        structureRate: sys.structure_repair_cost ?? 2,
        stressRate: sys.stress_repair_cost ?? 2,
        repairIcon: REPAIR_ICON,
    };
}

async function _postRestReport(mech, pilot, lines) {
    const portrait = mech.img;
    const items = lines.map((l) => `<li>${l}</li>`).join('');
    const content = `<div class="la-rest-chat">
        <div class="la-rest-chat-header">// REST REPORT //</div>
        <div class="la-rest-chat-body">
            <img class="la-rest-chat-portrait" src="${portrait}" alt="">
            <ul class="la-rest-chat-list">${items}</ul>
        </div>
    </div>`;
    await ChatMessage.create({
        content,
        speaker: { alias: pilot?.name ?? mech.name },
    });
}

async function _postReinitReport(mech, pilot) {
    const content = `<div class="la-rest-chat">
        <div class="la-rest-chat-header la-rest-chat-header-emergency">// REINITIALIZATION REPORT //</div>
        <div class="la-rest-chat-body">
            <img class="la-rest-chat-portrait" src="${mech.img}" alt="">
            <div><b>${pilot?.name ?? 'Pilot'}</b> reinitialized <b>${mech.name}</b> after catastrophic damage.</div>
        </div>
    </div>`;
    await ChatMessage.create({
        content,
        speaker: { alias: pilot?.name ?? mech.name },
    });
}

async function _showEmergencyRest(mech, pilot) {
    let alliedRepairs = _getAlliedRepairs();
    const data = _snapshotMech(mech, pilot);
    data.alliedRepairs = alliedRepairs;

    const recompute = () => {
        const pilotRepairs = mech.system.repairs?.value ?? 0;
        const total = pilotRepairs + alliedRepairs;
        const required = Math.max(0, 4 - alliedRepairs);
        return { total, required, canConfirm: total >= 4 };
    };

    const content = await renderTemplate(TPL.emergency, data);
    const dlg = new Dialog({
        title: 'Emergency Recovery',
        content,
        buttons: {
            confirm: {
                icon: '<i class="fas fa-bolt"></i>',
                label: 'Reinitialize',
                callback: async () => {
                    const { canConfirm, required } = recompute();
                    if (!canConfirm) {
                        ui.notifications.warn('Not enough repairs available.');
                        return;
                    }
                    const hpMax = mech.system.hp?.max ?? mech.system.hp?.value ?? 0;
                    const repairsValue = mech.system.repairs?.value ?? 0;
                    await mech.update({
                        'system.structure.value': 1,
                        'system.stress.value': 1,
                        'system.hp.value': hpMax,
                        'system.repairs.value': Math.max(0, repairsValue - required),
                    });
                    await _postReinitReport(mech, pilot);
                    setTimeout(() => _showRegularRest(mech, pilot), 80);
                },
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'confirm',
        render: (html) => {
            const $app = html.closest('.app');
            const updateButton = () => {
                const { canConfirm, required } = recompute();
                $app.find('button[data-button="confirm"]').prop('disabled', !canConfirm);
                html.find('#la-rest-required-count').text(required);
            };
            html.find('.la-rest-allied-refresh').on('click', () => {
                alliedRepairs = _getAlliedRepairs();
                html.find('#la-rest-allied-count').text(alliedRepairs);
                updateButton();
            });
            updateButton();
            dlg.setPosition({ height: 'auto' });
        },
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 540 });
    dlg.render(true);
}

async function _showRegularRest(mech, pilot) {
    const data = _snapshotMech(mech, pilot);
    const content = await renderTemplate(TPL.menu, data);

    let resetHeat = false;
    let clearEffects = false;
    let restoreHp = false;
    let structureRestore = 0;
    let stressRestore = 0;
    /** @type {Set<number>} */
    const selectedWeapons = new Set();
    /** @type {Set<number>} */
    const selectedSystems = new Set();
    let contribute = 0;

    const cost = () => {
        let c = 0;
        if (restoreHp)
            c += 1;
        c += structureRestore * data.structureRate;
        c += stressRestore * data.stressRate;
        c += selectedWeapons.size;
        c += selectedSystems.size;
        c += contribute;
        return c;
    };

    const dlg = new Dialog({
        title: 'Rest',
        content,
        buttons: {
            confirm: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Confirm',
                callback: async () => {
                    const c = cost();
                    if (c > data.mech.repairs.value) {
                        ui.notifications.warn('Total cost exceeds available repairs.');
                        return;
                    }
                    /** @type {Record<string, any>} */
                    const updates = { 'system.repairs.value': data.mech.repairs.value - c };
                    if (resetHeat)
                        updates['system.heat.value'] = 0;
                    if (restoreHp)
                        updates['system.hp.value'] = data.mech.hp.max;
                    if (structureRestore > 0)
                        updates['system.structure.value'] = data.mech.structure.value + structureRestore;
                    if (stressRestore > 0)
                        updates['system.stress.value'] = data.mech.stress.value + stressRestore;
                    await mech.update(updates);

                    if (clearEffects && data.effects.length > 0) {
                        const ids = mech.effects.contents.map(/** @type {any} */ (e) => e.id);
                        if (ids.length)
                            await mech.deleteEmbeddedDocuments('ActiveEffect', ids);
                    }

                    /** @type {any[]} */
                    const itemUpdates = [];
                    for (const idx of selectedWeapons)
                        itemUpdates.push({ _id: data.destroyedWeapons[idx].id, 'system.destroyed': false });
                    for (const idx of selectedSystems)
                        itemUpdates.push({ _id: data.destroyedSystems[idx].id, 'system.destroyed': false });
                    if (itemUpdates.length)
                        await mech.updateEmbeddedDocuments('Item', itemUpdates);

                    /** @type {string[]} */
                    const lines = [];
                    if (resetHeat)
                        lines.push(`Cleared ${data.mech.heat.value} Heat`);
                    if (restoreHp)
                        lines.push(`Restored ${data.mech.hp.max - data.mech.hp.value} HP`);
                    if (structureRestore > 0)
                        lines.push(`Restored ${structureRestore} Structure`);
                    if (stressRestore > 0)
                        lines.push(`Restored ${stressRestore} Stress`);
                    for (const idx of selectedWeapons)
                        lines.push(`Repaired ${data.destroyedWeapons[idx].name}`);
                    for (const idx of selectedSystems)
                        lines.push(`Repaired ${data.destroyedSystems[idx].name}`);
                    if (clearEffects && data.effects.length > 0)
                        lines.push(`Cleared ${data.effects.length} status effect(s)`);
                    lines.push(`Consumed ${c} Repairs`);
                    if (contribute > 0)
                        lines.push(`Contributed ${contribute} Repairs`);

                    await _postRestReport(mech, pilot, lines);
                },
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'confirm',
        render: (html) => {
            const $app = html.closest('.app');
            const updateUi = () => {
                const c = cost();
                const over = c > data.mech.repairs.value;
                html.find('#la-rest-cost-current').text(c).toggleClass('la-rest-cost-over', over);
                $app.find('button[data-button="confirm"]').prop('disabled', over);
            };

            const renderPips = (target) => {
                const $div = html.find(`#la-rest-${target}-icons`);
                $div.empty();
                const baseValue = target === 'structure' ? data.mech.structure.value : data.mech.stress.value;
                const max = target === 'structure' ? data.mech.structure.max : data.mech.stress.max;
                const restored = target === 'structure' ? structureRestore : stressRestore;
                const current = baseValue + restored;
                const file = target === 'structure' ? 'structure.svg' : 'stress.svg';
                for (let i = 0; i < max; i++) {
                    const isRestored = i >= baseValue && i < current;
                    const isPresent = i < current;
                    const opacity = isRestored ? 0.55 : (isPresent ? 1 : 0.18);
                    const cls = isRestored ? 'la-rest-pip la-rest-pip-restored' : 'la-rest-pip';
                    $div.append(`<img class="${cls}" src="modules/lancer-automations/icons/stats/${file}" style="opacity:${opacity};" alt="">`);
                }
            };

            html.find('.lancer-toggle-card').on('click', function () {
                const action = this.dataset.action;
                const $card = $(this);
                const next = !$card.hasClass('active');
                $card.toggleClass('active', next);
                $card.find('.lancer-toggle-card-icon i')
                    .toggleClass('far fa-square', !next)
                    .toggleClass('fas fa-check-square', next);
                if (action === 'resetHeat')
                    resetHeat = next;
                else if (action === 'clearEffects')
                    clearEffects = next;
                else if (action === 'restoreHp')
                    restoreHp = next;
                updateUi();
            });

            html.find('.la-rest-step-up').on('click', function () {
                const t = this.dataset.target;
                if (t === 'structure' && data.mech.structure.value + structureRestore < data.mech.structure.max) {
                    structureRestore++;
                    renderPips('structure');
                    updateUi();
                } else if (t === 'stress' && data.mech.stress.value + stressRestore < data.mech.stress.max) {
                    stressRestore++;
                    renderPips('stress');
                    updateUi();
                }
            });
            html.find('.la-rest-step-down').on('click', function () {
                const t = this.dataset.target;
                if (t === 'structure' && structureRestore > 0) {
                    structureRestore--;
                    renderPips('structure');
                    updateUi();
                } else if (t === 'stress' && stressRestore > 0) {
                    stressRestore--;
                    renderPips('stress');
                    updateUi();
                }
            });

            html.find('.la-rest-equipment-btn').on('click', function () {
                const kind = this.dataset.kind;
                const idx = parseInt(this.dataset.index, 10);
                const set = kind === 'weapon' ? selectedWeapons : selectedSystems;
                const $btn = $(this);
                if (set.has(idx)) {
                    set.delete(idx);
                    $btn.removeClass('active');
                } else {
                    set.add(idx);
                    $btn.addClass('active');
                }
                updateUi();
            });

            html.find('#la-rest-contribute').on('input', function () {
                const v = Math.max(0, Math.min(4, parseInt(this.value, 10) || 0));
                if (parseInt(this.value, 10) !== v)
                    this.value = String(v);
                contribute = v;
                updateUi();
            });

            renderPips('structure');
            renderPips('stress');
            updateUi();
            dlg.setPosition({ height: 'auto' });
        },
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 600 });
    dlg.render(true);
}

/** @returns {Promise<void>} */
export async function executeRest(token) {
    const { mech, pilot } = await _resolveMechAndPilot(token);
    if (!mech) {
        ui.notifications.warn("No mech for this token. Pick a mech token, or a pilot with an active mech.");
        return;
    }
    const isDestroyed = (mech.system.structure?.value ?? 0) === 0 || (mech.system.stress?.value ?? 0) === 0;
    if (isDestroyed)
        await _showEmergencyRest(mech, pilot);
    else
        await _showRegularRest(mech, pilot);
}

export const RestAPI = { executeRest };
