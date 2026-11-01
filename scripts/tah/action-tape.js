import { getLAFlag } from '../tools/flag-utils.js';
import { localize, localizeFormat, escapeHtml } from '../tools/string-utils.js';
import { currentTurnKey } from '../bonuses/duration-builders.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { getActivationIcon } from '../tools/misc-tools.js';
import { weaponTypeIcon, getDeployableIcon } from './item-helpers.js';
import { socketRequestWithAck } from '../socket.js';
import { TAPE_FLAG, applyTapeOp } from './tape-store.js';
import { MODULE_ID } from '../tools/constants.js';
import { getChipMoved, getMoveDataList, boostBandUsed, removeBoostCast } from '../movement/move-tracking.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { planChangesUndo, removeAppliedEffects } from './tape-changes.js';
import { EXTRA_USED_KEYS, actionExtrasUsed, extrasUsedUpdate, settleSlots } from '../combat/action-extras.js';

/** Colour per action type. Quick, full, move, protocol and reaction match ACTION_DEFS in combat-bar.js. */
export const TAPE_COLORS = {
    quick:      '#ff9800',
    full:       '#e65100',
    move:       '#4caf50',
    protocol:   '#00e5e5',
    free:       '#4ed6b8',
    reaction:   '#be51ed',
    quicktech:  '#56d6d6',
    fulltech:   '#0f8f8f',
    invade:     '#7a7aff',
    overcharge: '#eb4034',
    attack:     '#dfe4ea',
    other:      '#9fb0c0'
};

const MOVE_NAMES = new Set(['boost', 'move', 'standing up', 'fall', 'teleport']);

const _rowIcons = new Map();

/**
 * Icon the HUD draws for a named action row. Filled as the HUD builds its rows, so the tape always
 * shows the same file the row does instead of a second guess at it.
 * @param {string} actionName
 * @param {string|null|undefined} icon
 */
export function noteRowIcon(actionName, icon)
{
    const key = String(actionName ?? '').toLowerCase().trim();
    if (key && icon)
        _rowIcons.set(key, icon);
}

/**
 * Action type key for the tape, from an activation string plus the action name.
 * @param {string|null|undefined} activation
 * @param {string|null|undefined} actionName
 * @returns {string} A key of TAPE_COLORS.
 */
export function tapeType(activation, actionName)
{
    const name = String(actionName ?? '').toLowerCase().trim();
    if (name.startsWith('overcharge'))
        return 'overcharge';
    if (MOVE_NAMES.has(name))
        return 'move';

    const normalized = String(activation ?? '').toLowerCase().replaceAll(/[\s-]+/g, '_');
    if (normalized.includes('invade'))
        return 'invade';
    if (normalized.includes('tech'))
        return normalized.includes('full') ? 'fulltech' : 'quicktech';
    if (normalized.includes('protocol'))
        return 'protocol';
    if (normalized.includes('reaction'))
        return 'reaction';
    if (normalized.includes('free'))
        return 'free';
    if (normalized.includes('full'))
        return 'full';
    if (normalized.includes('quick'))
        return 'quick';
    return 'other';
}

/**
 * Icon path for the tape, resolved the way the item's own HUD row resolves it.
 * @param {any} item
 * @param {{name?: string, activation?: string, tech_attack?: boolean}|null} action
 * @param {any} [deployable]
 * @returns {string|null} Icon path, or null when nothing fits.
 */
export function tapeIcon(item, action, deployable = null)
{
    const row = _rowIcons.get(String(action?.name ?? '').toLowerCase().trim());
    if (row)
        return row;

    if (deployable)
        return getDeployableIcon(deployable);

    const type = String(item?.type ?? '');
    const isWeapon = type.includes('weapon')
        || (type === 'npc_feature' && String(item?.system?.type ?? '').toLowerCase() === 'weapon');
    if (isWeapon)
        return weaponTypeIcon(item);

    return getActivationIcon(action ?? {}) ?? item?.img ?? null;
}

/**
 * The combatant for a token in the running combat.
 * @param {any} token
 * @returns {any|null}
 */
export function combatantFor(token)
{
    const tokenId = token?.document?.id ?? token?.id ?? null;
    if (!tokenId || !game.combat?.active)
        return null;
    return game.combat.combatants.find(/** @param {any} entry */ entry => entry.tokenId === tokenId) ?? null;
}

/**
 * Every action the token has taken this combat, oldest first.
 * @param {any} token
 * @returns {Array<any>}
 */
export function getTape(token)
{
    return getLAFlag(combatantFor(token), TAPE_FLAG, []) ?? [];
}

/**
 * Rounds that carry at least one entry, ascending.
 * @param {any} token
 * @returns {number[]}
 */
export function tapeRounds(token)
{
    return [...new Set(getTape(token).map(entry => entry.round))].sort((left, right) => left - right);
}

/**
 * Combatant flags are GM-owned, so players hand the change to the executor GM.
 * @param {any} combatant
 * @param {{kind: 'append', entry: any}|{kind: 'patch', id: string, data: any}|{kind: 'remove', id: string}} op
 * @returns {Promise<any>}
 */
async function sendTapeOp(combatant, op)
{
    if (game.user.isGM)
        return applyTapeOp(combatant, op);
    return socketRequestWithAck('combatAction', {
        method: 'tapeOp',
        combatId: game.combat.id,
        combatantId: combatant.id,
        op
    });
}

/**
 * Append one action to the token's tape. No-op out of combat.
 * @param {any} token
 * @param {{id?: string, name: string, activation?: string, item?: any, deployable?: any, icon?: string|null, type?: string, tracker?: {before: any, after: any}|null, move?: boolean, moveKind?: 'move'|'free'|'forced', boost?: boolean, changes?: any}} action
 * @returns {Promise<string|null>} The entry id, shared with the Battle Log event of the same action.
 */
export async function recordAction(token, action)
{
    const combatant = combatantFor(token);
    if (!combatant || !action?.name)
        return null;
    const entry = {
        id: action.id ?? foundry.utils.randomID(),
        name: action.name,
        type: action.type ?? tapeType(action.activation, action.name),
        icon: action.icon
            ?? tapeIcon(action.item ?? null, { name: action.name, activation: action.activation }, action.deployable ?? null),
        activation: action.activation ?? '',
        round: game.combat.round ?? 1,
        turn: currentTurnKey(),
        at: Date.now()
    };
    if (action.tracker)
        entry.tracker = action.tracker;
    if (action.move)
    {
        entry.move = true;
        entry.moveKind = action.moveKind ?? 'move';
    }
    if (action.boost)
        entry.boost = true;
    if (action.changes)
        entry.changes = action.changes;
    await sendTapeOp(combatant, { kind: 'append', entry });
    return entry.id;
}

const _undoBusy = new Set();
const _undoneChips = new Set();

export function wasUndone(id)
{
    return !!id && _undoneChips.has(id);
}

Hooks.on('lancer-automations.movementHistoryCleared', (token) =>
{
    settleMoveChips(token, []).catch(err => console.warn('lancer-automations | settleMoveChips failed', err));
});

export function currentTurnChips(token)
{
    const turn = currentTurnKey();
    return getTape(token).filter(entry => entry.turn === turn);
}

export function ordnanceWindowClosed(token)
{
    const combatant = combatantFor(token);
    if (!combatant || game.combat?.combatant?.id !== combatant.id)
        return false;
    return currentTurnChips(token).some(entry => entry.type !== 'protocol' && entry.moveKind !== 'forced');
}

export async function settleMoveChips(token, remainingMoves)
{
    const emptied = currentTurnChips(token).filter(entry => entry.move && !remainingMoves.some(move => move.chipId === entry.id));
    for (const entry of emptied.reverse())
    {
        const { update } = trackerRefund(token, entry);
        if (Object.keys(update).length)
            await token.actor.update(update);
        await removeTapeEntry(token, entry.id);
    }
}

export async function patchTapeEntry(token, id, data)
{
    const combatant = combatantFor(token);
    if (!combatant || !id)
        return;
    await sendTapeOp(combatant, { kind: 'patch', id, data });
}

export async function noteTriggerResults(token, id, trackerBefore, effects, removed)
{
    const after = token?.actor?.system?.action_tracker ?? {};
    const data = {};
    const budget = actionBudget(after) - actionBudget(trackerBefore);
    if (budget > 0)
        data.grant = { budget };
    if (!trackerBefore?.reaction && after.reaction)
        data.grant = { ...(data.grant ?? {}), reaction: true };
    if (effects?.length)
        data.effects = effects;
    if (removed?.length)
        data.removed = removed;
    if (Object.keys(data).length)
        await patchTapeEntry(token, id, data);
}

async function restoreRemovedEffects(removed)
{
    for (const record of removed ?? [])
    {
        const parent = record?.parentUuid ? await fromUuid(record.parentUuid) : null;
        if (!parent?.createEmbeddedDocuments || !record.data)
            continue;
        if (game.user.isGM || parent.isOwner)
            await parent.createEmbeddedDocuments('ActiveEffect', [record.data]);
        else
            await socketRequestWithAck('createActorEffects', { uuid: record.parentUuid, effects: [record.data] });
    }
}

function actionBudget(tracker)
{
    return (tracker?.full ? 1 : 0) + (tracker?.quick ? 1 : 0);
}

function trackerSpend(record)
{
    if (!record?.before || !record?.after)
        return null;
    const extras = Object.fromEntries(EXTRA_USED_KEYS.map(key => [key, Math.max(0, (Number(record.after.extras?.[key]) || 0) - (Number(record.before.extras?.[key]) || 0))]));
    return {
        units: Math.max(0, actionBudget(record.before) - actionBudget(record.after) + extras.slots),
        reaction: !!record.before.reaction && !record.after.reaction,
        protocol: !!record.before.protocol && !record.after.protocol,
        move: (Number(record.before.move) || 0) > (Number(record.after.move) || 0),
        extras,
    };
}

function canEditTape(token)
{
    return game.user.isGM || !!token?.actor?.isOwner;
}

function trackerRefund(token, entry)
{
    const spend = trackerSpend(entry.tracker);
    const now = token.actor?.system?.action_tracker ?? {};
    const used = actionExtrasUsed(token.actor);
    const update = {};
    const back = [];
    let usedChanged = false;
    if (spend?.units)
    {
        const settled = settleSlots(token.actor, now, spend.units);
        if (settled.fields.full !== !!now.full || settled.fields.quick !== !!now.quick || settled.used.slots !== used.slots)
        {
            update['system.action_tracker.full'] = settled.fields.full;
            update['system.action_tracker.quick'] = settled.fields.quick;
            used.slots = settled.used.slots;
            usedChanged = true;
            back.push(localize(spend.units >= 2 ? 'LA.tape.back.full' : 'LA.tape.back.quick'));
        }
    }
    if (spend?.reaction && !now.reaction)
    {
        update['system.action_tracker.reaction'] = true;
        back.push(localize('LA.tape.back.reaction'));
    }
    if (spend?.extras?.reaction)
    {
        used.reaction = Math.max(0, used.reaction - spend.extras.reaction);
        usedChanged = true;
        const label = localize('LA.tape.back.reaction');
        if (!back.includes(label))
            back.push(label);
    }
    if (spend?.move && !(Number(now.move) > 0))
        update['system.action_tracker.move'] = Number(entry.tracker.before.move) || 0;
    if (usedChanged)
        Object.assign(update, extrasUsedUpdate(used));
    const otherSpend = getTape(token).some(other =>
    {
        if (other.id === entry.id || other.turn !== entry.turn)
            return false;
        const spent = trackerSpend(other.tracker);
        return !!spent && (spent.units > 0 || spent.move);
    });
    const freedProtocol = !!spend && (spend.protocol || spend.units > 0 || spend.move);
    if (freedProtocol && !now.protocol && !otherSpend)
    {
        update['system.action_tracker.protocol'] = true;
        back.push(localize('LA.tape.back.protocol'));
    }
    return { update, back };
}

function planUndo(token, entry)
{
    if (entry.type === 'move' && !entry.move && !entry.boost)
        return { reason: 'LA.tape.undoNever' };
    if (entry.turn !== currentTurnKey())
        return { reason: 'LA.tape.undoEarlierTurn' };
    if (entry.move)
    {
        const lastMovementId = token.document?._source?._movementHistory?.at(-1)?.movementId ?? null;
        if (!lastMovementId)
            return { reason: 'LA.tape.undoNoMovement' };
        const lastMove = getMoveDataList(token).find(move => move.movementId === lastMovementId);
        if (lastMove?.chipId !== entry.id)
            return { reason: 'LA.tape.undoLaterMove' };
        return { kind: 'move', label: localize('LA.tape.undoMove') };
    }
    if (entry.boost && boostBandUsed(token, entry.id))
        return { reason: 'LA.tape.undoBoostUsed' };
    const { update, back } = trackerRefund(token, entry);
    const now = token.actor?.system?.action_tracker ?? {};
    if (entry.grant?.budget)
    {
        const budgetNow = 'system.action_tracker.quick' in update
            ? (update['system.action_tracker.full'] ? 1 : 0) + (update['system.action_tracker.quick'] ? 1 : 0)
            : actionBudget(now);
        if (budgetNow < entry.grant.budget)
            return { reason: 'LA.tape.undoGrantUsed' };
        const budget = budgetNow - entry.grant.budget;
        update['system.action_tracker.full'] = budget >= 2;
        update['system.action_tracker.quick'] = budget >= 1;
    }
    if (entry.grant?.reaction && now.reaction)
        update['system.action_tracker.reaction'] = false;
    const removed = [...(entry.changes?.removedEffects ?? []), ...(entry.removed ?? [])];
    const restore = planChangesUndo(token.actor, entry.changes, entry.effects, removed);
    if (restore.reason)
        return { reason: restore.reason };
    Object.assign(update, restore.actorUpdate);
    back.push(...restore.back.map(part => localize(part)));
    const plan = { kind: 'action', update, items: restore.items, removed };
    if (!back.length)
        return { ...plan, label: localize('LA.tape.undoPlain') };
    const what = new Intl.ListFormat(game.i18n.lang, { type: 'conjunction' }).format(back);
    return { ...plan, label: localizeFormat('LA.tape.undo', { what }) };
}

export async function undoTapeEntry(token, id)
{
    const busyKey = token?.document?.id ?? token?.id;
    if (!busyKey || _undoBusy.has(busyKey))
        return false;
    _undoBusy.add(busyKey);
    try
    {
        return await undoNow(token, id);
    }
    finally
    {
        _undoBusy.delete(busyKey);
    }
}

async function undoNow(token, id)
{
    const entry = getTape(token).find(candidate => candidate.id === id);
    if (!entry || !canEditTape(token))
        return false;
    const plan = /** @type {any} */ (planUndo(token, entry));
    if (!plan || plan.reason)
        return false;
    if (plan.kind === 'move')
    {
        await game.modules.get(MODULE_ID)?.api?.revertMovement?.(token);
        return true;
    }
    const update = { ...plan.update };
    if (entry.boost)
    {
        removeBoostCast(token, id);
        const moveSpent = currentTurnChips(token).some(other => other.id !== id && trackerSpend(other.tracker)?.move);
        update['system.action_tracker.move'] = moveSpent ? 0 : (token.actor?.system?.speed ?? 0);
    }
    if (Object.keys(update).length)
        await token.actor.update(update, { laActionExtras: true });
    for (const { item, update: itemUpdate } of plan.items ?? [])
        await item.update(itemUpdate);
    await removeAppliedEffects(entry.effects);
    await restoreRemovedEffects(plan.removed);
    _undoneChips.add(id);
    await removeTapeEntry(token, id);
    Hooks.callAll('lancer-automations.battelog.actionUndo', { token, tapeId: id });
    return true;
}

export async function revertLastAction(token)
{
    if (!canEditTape(token))
    {
        ui.notifications.warn(localizeFormat('LA.notify.cannotRevertNotOwner', { name: token?.name ?? '?' }));
        return false;
    }
    const entry = currentTurnChips(token).at(-1);
    if (!entry)
    {
        ui.notifications.info(localizeFormat('LA.notify.nothingToRevert', { name: token.name }));
        return false;
    }
    const plan = planUndo(token, entry);
    if (plan.reason)
    {
        ui.notifications.warn(localizeFormat('LA.notify.revertBlocked', { name: entry.name, reason: localize(plan.reason) }));
        return false;
    }
    return undoTapeEntry(token, entry.id);
}

function tapeMenuItems(token, id)
{
    const entry = getTape(token).find(candidate => candidate.id === id);
    if (!entry)
        return [];
    const items = [];
    const plan = planUndo(token, entry);
    if (!plan.reason)
        items.push({ name: plan.label, icon: '<i class="fas fa-rotate-left"></i>', callback: () => undoTapeEntry(token, id) });
    else if (plan.reason !== 'LA.tape.undoNever')
        items.push({ name: localizeFormat('LA.tape.undoBlocked', { reason: localize(plan.reason) }), icon: '<i class="fas fa-ban"></i>', classes: 'la-tape-menu-off', callback: () => null });
    items.push({ name: localize('LA.tape.remove'), icon: '<i class="fas fa-trash"></i>', callback: () => removeTapeEntry(token, id) });
    return items;
}

function chipInk(entry)
{
    if (entry.move && entry.moveKind === 'free')
        return getModuleSetting('speedProvider.colorFreeMovement', '#ffffff') || '#ffffff';
    if (entry.move && entry.moveKind === 'forced')
        return getModuleSetting('speedProvider.colorForceMovement', '#8B5CF6') || '#8B5CF6';
    return TAPE_COLORS[entry.type] ?? TAPE_COLORS.other;
}

const _viewRound = new Map();

/**
 * Round the tape is currently showing for a token. Follows the live round until the user pages away,
 * and snaps back as soon as the combat moves on.
 * @param {string} tokenId
 * @param {number} current
 * @returns {number}
 */
function viewRoundFor(tokenId, current)
{
    const stored = _viewRound.get(tokenId);
    if (!stored || stored.current !== current)
    {
        _viewRound.set(tokenId, { current, view: current });
        return current;
    }
    return stored.view;
}

/**
 * Glyph markup for a tape entry. Icon paths become tinted masks, font classes stay font classes.
 * @param {any} entry
 * @returns {string}
 */
function tapeGlyph(entry)
{
    const icon = entry?.icon;
    if (!icon)
        return '';
    if (String(icon).endsWith('.svg') || /\.(png|webp|jpe?g)$/i.test(String(icon)))
        return `<span class="la-tape-ico" style="mask-image:url('${icon}');-webkit-mask-image:url('${icon}');"></span>`;
    return `<i class="${icon} la-tape-ico-font"></i>`;
}

/**
 * The tape element for a token, or null when there is nothing to show.
 * @param {any} token
 * @returns {JQuery|null}
 */
export function buildActionTape(token)
{
    if (!token || !game.combat?.active || !combatantFor(token))
        return null;

    const current = game.combat.round ?? 1;
    const tokenId = token.document?.id ?? token.id;
    const view = viewRoundFor(tokenId, current);
    const entries = getTape(token).filter(entry => entry.round === view);
    const firstRound = Math.min(1, ...tapeRounds(token));

    const bar = $(htmlToElement(`<div id="la-action-tape" class="la-action-tape${view === current ? '' : ' la-tape-past'}"></div>`));
    const back = $(htmlToElement(`<button type="button" class="la-tape-nav" aria-label="${localize('LA.tape.previousTurn')}">◀</button>`));
    const forward = $(htmlToElement(`<button type="button" class="la-tape-nav" aria-label="${localize('LA.tape.nextTurn')}">▶</button>`));
    back.prop('disabled', view <= firstRound);
    forward.prop('disabled', view >= current);

    const page = (delta) =>
    {
        const next = Math.min(current, Math.max(firstRound, view + delta));
        _viewRound.set(tokenId, { current, view: next });
        const fresh = buildActionTape(token);
        if (fresh)
            bar.replaceWith(fresh);
    };
    back.on('click', (event) =>
    {
        event.stopPropagation(); page(-1);
    });
    forward.on('click', (event) =>
    {
        event.stopPropagation(); page(1);
    });

    bar.append(back);
    bar.append(htmlToElement(`<span class="la-tape-round">R${view}</span>`));

    const strip = $(htmlToElement(`<div class="la-tape-strip"></div>`));
    if (!entries.length)
        strip.append(htmlToElement(`<span class="la-tape-empty">${localize('LA.tape.noActions')}</span>`));
    const editable = canEditTape(token);
    const turn = currentTurnKey();
    for (const entry of entries)
    {
        const ink = chipInk(entry);
        const moved = entry.move && entry.turn === turn ? getChipMoved(token, entry.id) : null;
        const chip = $(htmlToElement(`<button type="button" class="la-tape-chip${moved !== null ? ' la-tape-chip--move' : ''}" data-entry-id="${entry.id}"`
            + ` style="--la-tape-ink:${ink};"`
            + ` data-tooltip="${escapeHtml(entry.name)}" data-tooltip-direction="UP">`
            + tapeGlyph(entry)
            + (moved !== null ? `<span class="la-tape-move">${moved}</span>` : '')
            + `</button>`));
        if (!editable)
        {
            chip.on('contextmenu', (event) =>
            {
                event.preventDefault();
                event.stopPropagation();
            });
        }
        strip.append(chip);
    }
    bar.append(strip);
    bar.append(forward);

    if (editable)
    {
        const MenuClass = /** @type {any} */ (foundry.applications.ux.ContextMenu).implementation;
        const menu = new MenuClass(bar[0], '.la-tape-chip', [], {
            jQuery: false,
            fixed: true,
            onOpen: (target) =>
            {
                menu.menuItems = tapeMenuItems(token, target.dataset.entryId);
            },
        });
    }

    setTimeout(() =>
    {
        const node = strip[0];
        if (node)
            node.scrollLeft = node.scrollWidth;
    }, 0);

    return bar;
}

/**
 * Drop one entry from the token's tape.
 * @param {any} token
 * @param {string} id
 * @returns {Promise<any|null>} The removed entry, or null when it was already gone.
 */
export async function removeTapeEntry(token, id)
{
    const combatant = combatantFor(token);
    if (!combatant)
        return null;
    const removed = getLAFlag(combatant, TAPE_FLAG, []).find(entry => entry.id === id) ?? null;
    if (!removed)
        return null;
    await sendTapeOp(combatant, { kind: 'remove', id });
    return removed;
}
