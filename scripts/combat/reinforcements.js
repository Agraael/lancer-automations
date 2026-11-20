import { MODULE_ID } from '../tools/constants.js';
import { getLAFlag, setLAFlag } from '../tools/flag-utils.js';
import { escapeHtml, localize, localizeFormat } from '../tools/string-utils.js';
import { isExecutorGM } from '../utils/lancer-token.js';
import { startPickCard } from '../interactive/pick-card.js';
import { ARRIVAL_FLAG } from '../fx/arrival-fx.js';
import { getWorldClocks, removeWorldClock, setWorldClockValue } from '../tools/world-clocks.js';
import { clearLeaving, leaveRow, leaveUnits, leavingCombatants } from './leave-battlefield.js';
import { tfTeamsColorSides } from '../tools/token-factions-utils.js';

const PLAN_FLAG = 'reinforcements';
const CLOCKS_FLAG = 'reinforcementClocks';
const SEARCH_RINGS = 8;
const UNDO_LIMIT = 50;

export const VISIBILITIES = ['secret', 'exact', 'full'];
export const VISIBILITY_ICONS = { secret: 'fa-hexagon-xmark', exact: 'fa-hexagon', full: 'fa-hexagon-image' };

export const teamLabelKey = state => `LA.reinforcement.teamVis.${tfTeamsColorSides() ? 'team' : 'disposition'}.${state}`;

let flagCutCount = 0;

const FLAG_POLE_PATH = '<path d="M2.6 1.2V15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
const FLAG_CLOTH = 'M2.6 1.2H15.2L13.2 5.9L15.2 10.6H2.6Z';

export function teamHiddenIcon()
{
    const id = `la-flag-cut-${++flagCutCount}`;
    return `<svg class="la-flag-q" viewBox="0 0 16 16" aria-hidden="true"><mask id="${id}"><rect width="16" height="16" fill="#fff"/>`
        + '<text x="8.3" y="9.75" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="9.6" fill="#000">?</text></mask>'
        + `${FLAG_POLE_PATH}<path d="${FLAG_CLOTH}" fill="currentColor" mask="url(#${id})"/></svg>`;
}

export function teamShownIcon()
{
    return `<svg class="la-flag-q" viewBox="0 0 16 16" aria-hidden="true">${FLAG_POLE_PATH}<path d="${FLAG_CLOTH}" fill="currentColor"/></svg>`;
}

let arrivalCard = null;

const drafts = new WeakMap();
const undoStack = [];
const landedEntryIds = new Set();

export function getReinforcements(combat = game.combat)
{
    const plan = combat ? getLAFlag(combat, PLAN_FLAG) : null;
    return Array.isArray(plan) ? plan : [];
}

export function draftToken(entry)
{
    let draft = drafts.get(entry.tokenData);
    if (!draft)
    {
        draft = new CONFIG.Token.documentClass(entry.tokenData, { parent: game.scenes.get(entry.sceneId) ?? null });
        drafts.set(entry.tokenData, draft);
    }
    return draft;
}

function savePlan(combat, plan)
{
    return setLAFlag(combat, PLAN_FLAG, plan);
}

function planBefore(combat, ids)
{
    const plan = getReinforcements(combat);
    return ids.map(id => [id, foundry.utils.deepClone(plan.find(entry => entry.id === id) ?? null)]);
}

function pushUndo(combat, before)
{
    if (!before.length)
        return;
    undoStack.push({ combatId: combat.id, before, tokenHistory: canvas.tokens?.history?.length ?? 0 });
    if (undoStack.length > UNDO_LIMIT)
        undoStack.shift();
}

function dropUndo(combatId)
{
    undoStack.splice(0, undoStack.length, ...undoStack.filter(record => record.combatId !== combatId));
}

export function canUndoReinforcement()
{
    const last = undoStack.at(-1);
    return !!last && game.combats.has(last.combatId) && (canvas.tokens?.history?.length ?? 0) <= last.tokenHistory;
}

export async function undoReinforcement()
{
    const last = undoStack.pop();
    const combat = last ? game.combats.get(last.combatId) : null;
    if (!combat)
        return;

    const plan = [...getReinforcements(combat)];
    for (const [id, entry] of last.before)
    {
        const index = plan.findIndex(other => other.id === id);
        if (!entry)
        {
            if (index >= 0)
                plan.splice(index, 1);
        }
        else if (index >= 0)
            plan[index] = entry;
        else if (!landedEntryIds.has(id))
            plan.push(entry);
    }
    await savePlan(combat, plan);
}

export function reinforcementClock(entry)
{
    return entry.clock ? getWorldClocks().find(clock => clock.lid === entry.clock) ?? null : null;
}

export function isReinforcementDue(entry, combat)
{
    if (!entry.clock)
        return entry.round <= (combat.round ?? 0);
    const clock = reinforcementClock(entry);
    return !clock || clock.value >= clock.max;
}

function trackedClocks(combat)
{
    const clocks = getLAFlag(combat, CLOCKS_FLAG);
    return Array.isArray(clocks) ? clocks : [];
}

export async function trackReinforcementClock(lid, tick, combat = game.combat)
{
    if (!gmOnly() || !combat)
        return;
    await setLAFlag(combat, CLOCKS_FLAG, [...trackedClocks(combat).filter(entry => entry.lid !== lid), { lid, tick: !!tick }]);
}

function gmOnly()
{
    if (game.user.isGM)
        return true;

    ui.notifications.warn(localize('LA.reinforcement.gmOnly'));
    return false;
}

function entryFromToken(token)
{
    const doc = token.document ?? token;
    const tokenData = doc.toObject();
    delete tokenData._id;

    return { actorUuid: game.actors.get(doc.actorId)?.uuid ?? null, tokenData, sceneId: doc.parent.id };
}

async function entryFromActor(actor, point, tokenData, scene, snap)
{
    const source = typeof actor === 'string' ? await fromUuid(actor) : actor;
    if (!source)
        return null;

    const draft = await source.getTokenDocument(tokenData, { parent: scene });
    draft.updateSource(/** @type {any} */ (CONFIG.Token.objectClass)._getDropActorPosition(draft, point, { snap }));
    const data = draft.toObject();
    delete data._id;

    return { actorUuid: source.uuid, tokenData: data, sceneId: scene.id };
}

export async function scheduleReinforcement({ actor = null, token = null, x = 0, y = 0, elevation = 0, round = null, clock = null, visibility = 'exact', teamHidden = false, tokenData = {}, snap = true, combat = game.combat, scene = canvas.scene } = {})
{
    if (!gmOnly())
        return null;

    if (!combat)
    {
        ui.notifications.warn(localize('LA.notify.youMustBeInCombatToUse'));
        return null;
    }

    const base = token ? entryFromToken(token) : await entryFromActor(actor, { x, y, elevation }, tokenData, scene, snap);
    if (!base?.actorUuid)
        return null;

    const entry = {
        id: foundry.utils.randomID(),
        ...base,
        round: round ?? (combat.round ?? 0) + 1,
        clock: clock || null,
        visibility: VISIBILITIES.includes(visibility) ? visibility : 'exact',
        teamHidden: !!teamHidden,
    };

    await savePlan(combat, [...getReinforcements(combat), entry]);
    if (token)
        await (token.document ?? token).delete();
    pushUndo(combat, [[entry.id, null]]);
    return entry.id;
}

export async function addReinforcements(entries, combat = game.combat)
{
    if (!gmOnly() || !combat || !entries.length)
        return;
    await savePlan(combat, [...getReinforcements(combat), ...entries]);
    pushUndo(combat, entries.map(entry => [entry.id, null]));
}

export async function removeReinforcements(ids, combat = game.combat)
{
    if (!gmOnly() || !combat || !ids.length)
        return;
    const before = planBefore(combat, ids);
    await savePlan(combat, getReinforcements(combat).filter(entry => !ids.includes(entry.id)));
    pushUndo(combat, before);
}

export async function removeReinforcement(id, combat = game.combat)
{
    await removeReinforcements([id], combat);
}

export async function updateReinforcements(updates, combat = game.combat)
{
    if (!gmOnly() || !combat || !updates.length)
        return;
    if (updates.some(({ changes }) => 'visibility' in changes && !VISIBILITIES.includes(changes.visibility)))
        return;

    const byId = new Map(updates.map(({ id, changes }) => [id, changes]));
    const before = planBefore(combat, [...byId.keys()]);
    await savePlan(combat, getReinforcements(combat).map(entry => (byId.has(entry.id) ? foundry.utils.mergeObject(foundry.utils.deepClone(entry), byId.get(entry.id)) : entry)));
    pushUndo(combat, before);
}

export async function updateReinforcement(id, changes, combat = game.combat)
{
    await updateReinforcements([{ id, changes }], combat);
}

async function saveTokenData(byId, combat)
{
    const before = planBefore(combat, [...byId.keys()]);
    await savePlan(combat, getReinforcements(combat).map((entry) =>
    {
        if (!byId.has(entry.id))
            return entry;
        const data = foundry.utils.deepClone(byId.get(entry.id));
        delete data._id;
        return { ...entry, tokenData: data, edited: true };
    }));
    pushUndo(combat, before);
}

export async function editReinforcementTokens(ids, changes, combat = game.combat)
{
    if (!gmOnly() || !combat)
        return;

    const byId = new Map();
    for (const entry of getReinforcements(combat).filter(other => ids.includes(other.id)))
    {
        const draft = new CONFIG.Token.documentClass(foundry.utils.deepClone(entry.tokenData), { parent: game.scenes.get(entry.sceneId) ?? null });
        draft.updateSource(changes);
        byId.set(entry.id, draft.toObject());
    }
    if (byId.size)
        await saveTokenData(byId, combat);
}

export async function editReinforcementToken(id, changes, combat = game.combat)
{
    await editReinforcementTokens([id], changes, combat);
}

export async function replaceReinforcementToken(id, tokenData, combat = game.combat)
{
    if (!gmOnly() || !combat || !getReinforcements(combat).some(entry => entry.id === id))
        return;
    await saveTokenData(new Map([[id, tokenData]]), combat);
}

export function isPlanChange(changed)
{
    return foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${PLAN_FLAG}`);
}

const offsetKey = offset => `${offset.i},${offset.j}`;

function footprint(doc, position = doc)
{
    return doc.getOccupiedGridSpaceOffsets({ x: position.x, y: position.y, width: doc.width, height: doc.height }).map(offsetKey);
}

function occupancy(scene)
{
    const taken = new Map();

    for (const doc of scene.tokens)
    {
        if (doc.hidden)
            continue;
        for (const key of footprint(doc))
            taken.set(key, doc.name);
    }

    return taken;
}

function blockerOf(doc, taken)
{
    const key = footprint(doc).find(cell => taken.has(cell));
    return key ? taken.get(key) : null;
}

function fitsInScene(scene, doc, position)
{
    const rect = scene.dimensions.sceneRect;
    const width = doc.width * scene.grid.sizeX;
    const height = doc.height * scene.grid.sizeY;
    return position.x >= rect.x && position.y >= rect.y && position.x + width <= rect.right + 1 && position.y + height <= rect.bottom + 1;
}

function nearestFree(scene, doc, taken)
{
    const grid = scene.grid;
    const start = grid.getOffset(doc.getCenterPoint());
    const seen = new Set([offsetKey(start)]);
    let ring = [start];

    for (let step = 0; step <= SEARCH_RINGS && ring.length; step++)
    {
        const next = [];

        for (const offset of ring)
        {
            const position = /** @type {any} */ (CONFIG.Token.objectClass)._getDropActorPosition(doc, grid.getCenterPoint(offset), { snap: true });
            if (fitsInScene(scene, doc, position) && !footprint(doc, position).some(key => taken.has(key)))
                return position;

            for (const adjacent of grid.getAdjacentOffsets(offset))
            {
                if (seen.has(offsetKey(adjacent)))
                    continue;
                seen.add(offsetKey(adjacent));
                next.push(adjacent);
            }
        }

        ring = next;
    }

    return null;
}

async function worldActor(uuid, cache)
{
    if (cache.has(uuid))
        return cache.get(uuid);

    let actor = uuid ? await fromUuid(uuid) : null;
    if (actor?.inCompendium)
        actor = await Actor.implementation.create(/** @type {any} */ (game.actors.fromCompendium(actor)), { fromCompendium: true });

    cache.set(uuid, actor ?? null);
    return actor ?? null;
}

function postLanded(entries, docs)
{
    const anyShown = entries.some(entry => entry.visibility !== 'secret');
    const art = docs.map(doc => `<img src="${escapeHtml(doc.texture.src)}" alt="">`).join('');

    ChatMessage.create(/** @type {any} */ ({
        speaker: { alias: localize('LA.reinforcement.title') },
        content: `<div class="la-reinforcement-chat"><h3>${escapeHtml(localizeFormat('LA.reinforcement.landed', { count: docs.length }))}</h3><div class="la-reinforcement-art">${art}</div></div>`,
        whisper: anyShown ? [] : ChatMessage.getWhisperRecipients('GM'),
    }));
}

export async function landReinforcements(ids, combat = game.combat)
{
    if (!gmOnly() || !combat)
        return [];

    const chosen = getReinforcements(combat).filter(entry => ids.includes(entry.id));
    const cache = new Map();
    const created = [];
    const landedIds = [];
    const sceneIds = [...new Set(chosen.map(entry => entry.sceneId))];

    for (const sceneId of sceneIds)
    {
        const scene = game.scenes.get(sceneId);
        if (!scene)
            continue;

        const taken = occupancy(scene);
        const batch = [];

        for (const entry of chosen.filter(other => other.sceneId === sceneId))
        {
            const actor = await worldActor(entry.actorUuid, cache);
            if (!actor)
                continue;

            const data = foundry.utils.deepClone(entry.tokenData);
            data.actorId = actor.id;
            const doc = new CONFIG.Token.documentClass(data, { parent: scene });

            if (blockerOf(doc, taken))
            {
                const spot = nearestFree(scene, doc, taken);
                if (spot)
                {
                    data.x = spot.x;
                    data.y = spot.y;
                    doc.updateSource({ x: spot.x, y: spot.y });
                }
            }

            for (const key of footprint(doc))
                taken.set(key, data.name);

            foundry.utils.setProperty(data, `flags.${MODULE_ID}.${ARRIVAL_FLAG}`, 'edge');
            batch.push(data);
            landedIds.push(entry.id);
        }

        if (batch.length)
            created.push(...await scene.createEmbeddedDocuments('Token', batch));
    }

    if (created.length)
        await CONFIG.Token.documentClass.createCombatants(created, { combat });

    await savePlan(combat, getReinforcements(combat).filter(entry => !landedIds.includes(entry.id)));
    landedIds.forEach(id => landedEntryIds.add(id));
    if (created.length)
        postLanded(chosen.filter(entry => landedIds.includes(entry.id)), created);
    return created;
}

async function delayReinforcements(ids, combat)
{
    if (!game.combats.has(combat.id) || !ids.length)
        return;

    const next = (combat.round ?? 0) + 1;
    await savePlan(combat, getReinforcements(combat).map(entry => (ids.includes(entry.id) ? { ...entry, round: next, clock: null } : entry)));
}

function rowFor(entry, picked)
{
    const scene = game.scenes.get(entry.sceneId);
    const doc = scene ? new CONFIG.Token.documentClass(entry.tokenData, { parent: scene }) : null;
    const blocker = doc ? blockerOf(doc, occupancy(scene)) : null;
    const where = blocker ? localizeFormat('LA.reinforcement.blocked', { name: escapeHtml(blocker) }) : localize('LA.reinforcement.landsAtSpot');

    return {
        id: entry.id,
        icon: entry.tokenData.texture?.src,
        name: escapeHtml(entry.tokenData.name),
        sub: `${localize(`LA.reinforcement.visibility.${entry.visibility}`)} · ${where}`,
        picked,
        badge: localize(picked ? 'LA.reinforcement.land' : 'LA.reinforcement.wait'),
    };
}

function cardLabel()
{
    const { due, departures, picked } = arrivalCard;
    const parts = [];
    if (due.length)
        parts.push(localizeFormat('LA.reinforcement.landCount', { count: due.filter(entry => picked.has(entry.id)).length }));
    if (departures.length)
        parts.push(localizeFormat('LA.leave.leaveCount', { count: departures.filter(combatant => picked.has(combatant.id)).length }));
    return parts.join(' · ');
}

function cardRows()
{
    const { due, departures, picked } = arrivalCard;
    const both = due.length > 0 && departures.length > 0;
    return [
        ...due.map((entry, index) => ({ ...rowFor(entry, picked.has(entry.id)), section: both && index === 0 ? localize('LA.reinforcement.arriving') : '' })),
        ...departures.map((combatant, index) => ({ ...leaveRow(combatant, picked.has(combatant.id)), section: both && index === 0 ? localize('LA.reinforcement.leaving') : '' })),
    ];
}

export function cardTexts(due, departures)
{
    if (!departures.length)
        return { title: 'LA.reinforcement.title', icon: 'fas fa-parachute-box', description: localizeFormat('LA.reinforcement.due', { count: due.length }), hint: 'LA.reinforcement.hint', cancel: 'LA.reinforcement.delayAll', cancelIcon: 'fas fa-hourglass-half' };
    if (!due.length)
        return { title: 'LA.leave.title', icon: 'fas fa-door-open', description: localizeFormat('LA.leave.due', { count: departures.length }), hint: 'LA.leave.hint', cancel: 'LA.leave.stayAll', cancelIcon: 'fas fa-hand' };
    return { title: 'LA.reinforcement.title', icon: 'fas fa-parachute-box', description: localizeFormat('LA.reinforcement.dueBoth', { arriving: due.length, leaving: departures.length }), hint: 'LA.reinforcement.hintBoth', cancel: 'LA.reinforcement.holdAll', cancelIcon: 'fas fa-hand' };
}

function addToArrivalCard(combat, due, departures)
{
    if (arrivalCard.combatId !== combat.id)
        return;

    const freshDue = due.filter(entry => !arrivalCard.due.some(other => other.id === entry.id));
    const freshDepartures = departures.filter(combatant => !arrivalCard.departures.some(other => other.id === combatant.id));
    if (!freshDue.length && !freshDepartures.length)
        return;

    arrivalCard.due.push(...freshDue);
    arrivalCard.departures.push(...freshDepartures);
    for (const item of [...freshDue, ...freshDepartures])
        arrivalCard.picked.add(item.id);
    arrivalCard.card?.refresh();
    arrivalCard.card?.setConfirm(cardLabel(), arrivalCard.picked.size > 0);
}

function openArrivalCard(combat, due, departures = [])
{
    if (arrivalCard)
    {
        addToArrivalCard(combat, due, departures);
        return;
    }

    const picked = new Set([...due, ...departures].map(item => item.id));
    arrivalCard = { combatId: combat.id, card: null, due, departures, picked };
    const texts = cardTexts(due, departures);

    startPickCard({
        title: localize(texts.title),
        icon: texts.icon,
        origin: localizeFormat('LA.reinforcement.round', { round: combat.round }),
        description: texts.description,
        hint: localize(texts.hint),
        confirmText: cardLabel(),
        confirmIcon: texts.icon,
        cancelText: localize(texts.cancel),
        cancelIcon: texts.cancelIcon,
        getRows: cardRows,
        onReady: (card) =>
        {
            arrivalCard.card = card;
        },
        onPick: (row, card) =>
        {
            if (picked.has(row.id))
                picked.delete(row.id);
            else
                picked.add(row.id);
            card.refresh();
            card.setConfirm(cardLabel(), picked.size > 0);
        },
        onConfirm: card => card.run(async () =>
        {
            await leaveUnits(combat, departures.filter(combatant => picked.has(combatant.id)));
            await clearLeaving(departures.filter(combatant => !picked.has(combatant.id)));
            await landReinforcements(due.filter(entry => picked.has(entry.id)).map(entry => entry.id), combat);
            await delayReinforcements(due.filter(entry => !picked.has(entry.id)).map(entry => entry.id), combat);
            card.finish(true);
        }),
    }).then(async (result) =>
    {
        arrivalCard = null;
        if (result !== null)
            return;
        await clearLeaving(departures);
        await delayReinforcements(due.map(entry => entry.id), combat);
    });
}

function checkArrivals(combat, departures = [])
{
    const due = getReinforcements(combat).filter(entry => isReinforcementDue(entry, combat));
    if (due.length || departures.length)
        openArrivalCard(combat, due, departures);
}

async function tickClocks(combat)
{
    for (const { lid, tick } of trackedClocks(combat))
    {
        const clock = getWorldClocks().find(other => other.lid === lid);
        if (tick && clock && clock.value < clock.max)
            await setWorldClockValue(lid, clock.value + 1);
    }
}

export function initReinforcements()
{
    Hooks.on('updateCombat', async (combat, changed) =>
    {
        if ('round' in changed)
            dropUndo(combat.id);
        if (!('round' in changed) || !isExecutorGM())
            return;

        const previous = combat.previous?.round ?? 0;
        const forward = combat.round > previous;
        if (forward && previous >= 1)
            await tickClocks(combat);
        checkArrivals(combat, forward ? leavingCombatants(combat) : []);
    });

    Hooks.on(`${MODULE_ID}.worldClockFilled`, (clock) =>
    {
        if (!isExecutorGM())
            return;
        for (const combat of game.combats)
        {
            if (getReinforcements(combat).some(entry => entry.clock === clock.lid))
                checkArrivals(combat);
        }
    });

    Hooks.on('deleteCombat', async (combat) =>
    {
        if (arrivalCard?.combatId === combat.id)
            arrivalCard.card?.finish(false);
        dropUndo(combat.id);
        if (!isExecutorGM())
            return;
        for (const { lid } of trackedClocks(combat))
            await removeWorldClock(lid);
    });
}
