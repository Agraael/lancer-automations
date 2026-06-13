/* global console, ChatMessage, Dialog, fromUuid, game, ui, renderTemplate, $ */

import { socketRequestWithAck } from '../socket.js';

const TPL = {
    menu:      'modules/lancer-automations/templates/rest-menu.html',
    emergency: 'modules/lancer-automations/templates/rest-emergency.html',
};

const REPAIR_ICON = 'systems/lancer/assets/icons/white/repair.svg';

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

/** Mechs owned by currently-connected non-GM players, excluding `selfMech`. */
async function _getAlliedMechs(selfMech) {
    const allies = [];
    const seen = new Set();
    const users = game.users?.contents ?? [];
    for (const u of users) {
        if (!u.active || u.isGM)
            continue;
        const char = u.character;
        if (!char)
            continue;
        let mech = null;
        if (char.type === 'mech')
            mech = char;
        else if (char.type === 'pilot' && char.system?.active_mech?.id) {
            try {
                mech = /** @type {any} */ (await fromUuid(char.system.active_mech.id));
            } catch { /* ignore */ }
        }
        if (!mech || mech.id === selfMech.id || seen.has(mech.id))
            continue;
        seen.add(mech.id);
        const r = mech.system?.repairs ?? {};
        allies.push({
            actorId: mech.id,
            uuid: mech.uuid,
            name: mech.name,
            img: mech.img,
            ownerName: u.name,
            value: r.value ?? 0,
            max: r.max ?? 0,
        });
    }
    return allies;
}

async function _setAllyRepairs(allyActorId, newValue) {
    const actor = game.actors.get(allyActorId);
    if (!actor)
        return false;
    if (game.user.isGM || actor.isOwner) {
        await actor.update({ 'system.repairs.value': newValue });
        return true;
    }
    await socketRequestWithAck('updateActorSystem', {
        actorId: allyActorId,
        data: { 'system.repairs.value': newValue },
    });
    return true;
}

function _structureRepairRate(mech) {
    const base = mech?.system?.structure_repair_cost ?? 2;
    if (base <= 1)
        return base;
    const frame = mech?.system?.loadout?.frame?.value;
    const traits = frame?.system?.traits ?? [];
    const hasReplaceable = traits.some(t => /replaceable\s*parts/i.test(String(t?.name ?? '')))
        || traits.some(t => (t?.bonuses ?? []).some(b => b?.lid === 'cheap_struct'));
    return hasReplaceable ? 1 : base;
}

function _snapshotMech(mech, pilot, allies) {
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
        structureRate: _structureRepairRate(mech),
        stressRate: sys.stress_repair_cost ?? 2,
        repairIcon: REPAIR_ICON,
        allies,
        hasAllies: allies.length > 0,
        isGM: !!game.user.isGM,
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

/**
 * Wires the ally pull cards and GM grant row to mutate `pulledByAlly` / `gmGrantRef`
 * and re-runs `onChange`. Returns a function that re-renders the steppers from state.
 */
function _bindAllyControls(html, data, pulledByAlly, gmGrantRef, onChange) {
    const $cards = html.find('.la-rest-ally-card');
    const renderAlly = (allyId) => {
        const ally = data.allies.find(a => a.actorId === allyId);
        if (!ally)
            return;
        const cur = pulledByAlly.get(allyId) ?? 0;
        const $card = $cards.filter(`[data-ally-id="${allyId}"]`);
        $card.find('.la-rest-ally-pulled').text(cur);
        $card.find('.la-rest-ally-step-down').prop('disabled', cur <= 0);
        $card.find('.la-rest-ally-step-up').prop('disabled', cur >= ally.value);
        $card.toggleClass('la-rest-ally-active', cur > 0);
    };
    $cards.each(function () {
        renderAlly(this.dataset.allyId);
    });

    html.find('.la-rest-ally-step-up').on('click', function () {
        const id = this.closest('.la-rest-ally-card')?.dataset.allyId;
        const ally = data.allies.find(a => a.actorId === id);
        if (!ally)
            return;
        const cur = pulledByAlly.get(id) ?? 0;
        if (cur >= ally.value)
            return;
        pulledByAlly.set(id, cur + 1);
        renderAlly(id);
        onChange();
    });
    html.find('.la-rest-ally-step-down').on('click', function () {
        const id = this.closest('.la-rest-ally-card')?.dataset.allyId;
        const cur = pulledByAlly.get(id) ?? 0;
        if (cur <= 0)
            return;
        pulledByAlly.set(id, cur - 1);
        renderAlly(id);
        onChange();
    });

    html.find('.la-rest-grant-input').on('input', function () {
        const v = Math.max(0, parseInt(this.value, 10) || 0);
        if (parseInt(this.value, 10) !== v)
            this.value = String(v);
        gmGrantRef.value = v;
        onChange();
    });
}

function _sumPulled(pulledByAlly) {
    let s = 0;
    for (const v of pulledByAlly.values())
        s += v;
    return s;
}

async function _applyAllyPulls(data, pulledByAlly) {
    const lines = [];
    for (const [allyId, amt] of pulledByAlly.entries()) {
        if (!amt)
            continue;
        const ally = data.allies.find(a => a.actorId === allyId);
        if (!ally)
            continue;
        const newVal = Math.max(0, ally.value - amt);
        await _setAllyRepairs(allyId, newVal);
        lines.push(`${ally.name} contributed ${amt} Repair${amt > 1 ? 's' : ''}`);
    }
    return lines;
}

async function _showEmergencyRest(mech, pilot) {
    const allies = await _getAlliedMechs(mech);
    const data = _snapshotMech(mech, pilot, allies);
    /** @type {Map<string, number>} */
    const pulledByAlly = new Map();
    const gmGrantRef = { value: 0 };

    const totals = () => {
        const pulled = _sumPulled(pulledByAlly);
        const grant = gmGrantRef.value;
        const contribution = pulled + grant;
        const total = data.mech.repairs.value + contribution;
        const required = Math.max(0, 4 - contribution - data.mech.repairs.value);
        return { pulled, grant, contribution, total, required, canConfirm: total >= 4 };
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
                    const t = totals();
                    if (!t.canConfirm) {
                        ui.notifications.warn('Not enough repairs available.');
                        return;
                    }
                    const allyLines = await _applyAllyPulls(data, pulledByAlly);
                    const hpMax = mech.system.hp?.max ?? mech.system.hp?.value ?? 0;
                    const repairsValue = mech.system.repairs?.value ?? 0;
                    const fromPool = t.contribution;
                    const fromSelf = Math.max(0, 4 - fromPool);
                    await mech.update({
                        'system.structure.value': 1,
                        'system.stress.value': 1,
                        'system.hp.value': hpMax,
                        'system.repairs.value': Math.max(0, repairsValue - fromSelf),
                    });
                    await _postReinitReport(mech, pilot);
                    if (allyLines.length || t.grant > 0) {
                        const lines = [...allyLines];
                        if (t.grant > 0)
                            lines.push(`GM grant: ${t.grant} Repair${t.grant > 1 ? 's' : ''}`);
                        lines.push(`Consumed ${fromSelf} Repair${fromSelf !== 1 ? 's' : ''} from self`);
                        await _postRestReport(mech, pilot, lines);
                    }
                    setTimeout(() => _showRegularRest(mech, pilot), 80);
                },
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'confirm',
        render: (html) => {
            const $app = html.closest('.app');
            const updateUi = () => {
                const t = totals();
                html.find('#la-rest-pool-pulled').text(t.pulled);
                html.find('#la-rest-pool-grant').text(t.grant);
                html.find('#la-rest-pool-total').text(t.total);
                html.find('#la-rest-required-count').text(t.required);
                $app.find('button[data-button="confirm"]').prop('disabled', !t.canConfirm);
            };
            _bindAllyControls(html, data, pulledByAlly, gmGrantRef, updateUi);
            updateUi();
            dlg.setPosition({ height: 'auto' });
        },
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 720 });
    dlg.render(true);
}

async function _showRegularRest(mech, pilot) {
    const allies = await _getAlliedMechs(mech);
    const data = _snapshotMech(mech, pilot, allies);
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
    /** @type {Map<string, number>} */
    const pulledByAlly = new Map();
    const gmGrantRef = { value: 0 };

    const cost = () => {
        let c = 0;
        if (restoreHp)
            c += 1;
        c += structureRestore * data.structureRate;
        c += stressRestore * data.stressRate;
        c += selectedWeapons.size;
        c += selectedSystems.size;
        return c;
    };

    const pool = () => data.mech.repairs.value + _sumPulled(pulledByAlly) + gmGrantRef.value;

    const dlg = new Dialog({
        title: 'Rest',
        content,
        buttons: {
            confirm: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Confirm',
                callback: async () => {
                    const c = cost();
                    if (c > pool()) {
                        ui.notifications.warn('Total cost exceeds available repairs.');
                        return;
                    }
                    const allyLines = await _applyAllyPulls(data, pulledByAlly);
                    const grant = gmGrantRef.value;
                    const pulled = _sumPulled(pulledByAlly);
                    const newRepairs = Math.max(0, Math.min(
                        data.mech.repairs.max,
                        data.mech.repairs.value - c + pulled + grant
                    ));

                    /** @type {Record<string, any>} */
                    const updates = { 'system.repairs.value': newRepairs };
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
                    lines.push(`Consumed ${c} Repair${c !== 1 ? 's' : ''}`);
                    for (const l of allyLines)
                        lines.push(l);
                    if (grant > 0)
                        lines.push(`GM grant: ${grant} Repair${grant > 1 ? 's' : ''}`);

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
                const p = pool();
                const over = c > p;
                html.find('#la-rest-cost-current').text(c).toggleClass('la-rest-cost-over', over);
                html.find('#la-rest-cost-pool').text(p);
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

            _bindAllyControls(html, data, pulledByAlly, gmGrantRef, updateUi);

            renderPips('structure');
            renderPips('stress');
            updateUi();
            dlg.setPosition({ height: 'auto' });
        },
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 720 });
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
