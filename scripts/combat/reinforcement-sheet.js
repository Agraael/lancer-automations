import { MODULE_ID } from '../tools/constants.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { isExecutorGM } from '../utils/lancer-token.js';
import { getTemplateFolder } from '../tools/template-actors.js';
import { getReinforcements, isPlanChange, replaceReinforcementToken } from './reinforcements.js';

const COPY_FLAG = 'reinforcementCopy';
const SAVE_DELAY_MS = 250;

/** @type {Map<string, { actorId: string, combatId: string, timer: ReturnType<typeof setTimeout>|null, closing: boolean }>} */
const copies = new Map();

const copyFlag = actor => (actor?.documentName === 'Actor' ? getLAFlag(actor, COPY_FLAG) : null);

function planEntryOf(entryId, combatId)
{
    const combat = game.combats.get(combatId);
    const entry = combat ? getReinforcements(combat).find(other => other.id === entryId) : null;
    return entry ? { entry, combat } : null;
}

async function baseActorFor(entry)
{
    return game.actors.get(entry.tokenData.actorId) ?? (entry.actorUuid ? await fromUuid(entry.actorUuid) : null);
}

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

function sameData(first, second)
{
    if (Array.isArray(first) || Array.isArray(second))
        return Array.isArray(first) && Array.isArray(second) && first.length === second.length && first.every((value, index) => sameData(value, second[index]));
    if (isPlainObject(first) && isPlainObject(second))
    {
        const keys = Object.keys(first);
        return keys.length === Object.keys(second).length && keys.every(key => key in second && sameData(first[key], second[key]));
    }
    return first === second;
}

function diffData(before, after)
{
    const diff = {};

    for (const [key, value] of Object.entries(after ?? {}))
    {
        const prior = before?.[key];
        if (isPlainObject(value))
        {
            const inner = diffData(isPlainObject(prior) ? prior : {}, value);
            if (Object.keys(inner).length)
                diff[key] = inner;
        }
        else if (!sameData(prior, value))
            diff[key] = value;
    }
    return diff;
}

function withoutStats(record)
{
    const clean = foundry.utils.deepClone(record);
    delete clean._stats;
    return clean;
}

function collectionDelta(baseList = [], copyList = [])
{
    const remaining = new Map(baseList.map(record => [record._id, withoutStats(record)]));
    const delta = [];

    for (const record of copyList)
    {
        const clean = withoutStats(record);
        const before = remaining.get(record._id);
        remaining.delete(record._id);
        if (!before || !sameData(before, clean))
            delta.push(clean);
    }

    for (const id of remaining.keys())
        delta.push({ _id: id, _tombstone: true });
    return delta;
}

function actorDelta(base, copy)
{
    const before = base.toObject();
    const after = copy.toObject();
    const flags = foundry.utils.deepClone(after.flags ?? {});
    if (flags[MODULE_ID])
        delete flags[MODULE_ID][COPY_FLAG];

    const delta = {
        system: diffData(before.system, after.system),
        items: collectionDelta(before.items, after.items),
        effects: collectionDelta(before.effects, after.effects),
        flags: diffData(before.flags, flags),
    };
    if (after.name !== before.name)
        delta.name = after.name;
    if (after.img !== before.img)
        delta.img = after.img;
    return delta;
}

async function saveCopy(entryId)
{
    const record = copies.get(entryId);
    if (!record)
        return;
    if (record.timer)
        clearTimeout(record.timer);
    record.timer = null;

    const found = planEntryOf(entryId, record.combatId);
    const copy = game.actors.get(record.actorId);
    const base = found ? await baseActorFor(found.entry) : null;
    if (!found || !copy || !base)
        return;

    const tokenData = foundry.utils.deepClone(found.entry.tokenData);
    const kept = { ...tokenData.delta };
    for (const key of ['name', 'img', 'system', 'items', 'effects', 'flags'])
        delete kept[key];
    tokenData.delta = { ...kept, ...actorDelta(base, copy) };
    await replaceReinforcementToken(entryId, tokenData, found.combat, { undo: false });
}

function scheduleSave(actor)
{
    const flag = copyFlag(actor);
    const record = flag ? copies.get(flag.entryId) : null;
    if (!record || record.closing)
        return;

    if (record.timer)
        clearTimeout(record.timer);
    record.timer = setTimeout(() => saveCopy(flag.entryId), SAVE_DELAY_MS);
}

async function finishCopy(entryId)
{
    const record = copies.get(entryId);
    if (!record || record.closing)
        return;

    record.closing = true;
    await saveCopy(entryId);
    copies.delete(entryId);
    await game.actors.get(record.actorId)?.delete();
}

async function discardCopy(entryId)
{
    const record = copies.get(entryId);
    if (!record)
        return;

    copies.delete(entryId);
    record.closing = true;
    if (record.timer)
        clearTimeout(record.timer);

    const copy = game.actors.get(record.actorId);
    if (!copy)
        return;
    await copy.sheet?.close();
    await copy.delete();
}

function showSheet(actor)
{
    const sheet = /** @type {any} */ (actor.sheet);
    sheet?.render(true);
    sheet?.bringToTop?.();
    sheet?.bringToFront?.();
}

export async function openReinforcementSheet(entry, combat)
{
    if (!game.user.isGM)
        return;

    if (entry.tokenData.actorLink)
    {
        const actor = await baseActorFor(entry);
        if (actor)
            showSheet(actor);
        return;
    }

    const open = copies.get(entry.id);
    const existing = open ? game.actors.get(open.actorId) : null;
    if (existing)
    {
        showSheet(existing);
        return;
    }

    const base = await baseActorFor(entry);
    if (!base)
        return;

    const draft = new CONFIG.Token.documentClass(foundry.utils.deepClone(entry.tokenData), { parent: game.scenes.get(entry.sceneId) ?? null });
    const synthetic = draft.delta ? foundry.documents.ActorDelta.applyDelta(draft.delta, base) : null;
    const data = (synthetic ?? base).toObject();
    delete data._id;
    data.folder = (await getTemplateFolder())?.id ?? null;
    data.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.${COPY_FLAG}`, { entryId: entry.id, combatId: combat.id, userId: game.user.id });

    const copy = await Actor.implementation.create(data, { keepEmbeddedIds: true });
    if (!copy)
        return;

    copies.set(entry.id, { actorId: copy.id, combatId: combat.id, timer: null, closing: false });
    showSheet(copy);
}

async function deleteLeftovers()
{
    if (!game.user.isGM)
        return;

    const executor = isExecutorGM();
    const stale = game.actors.filter((actor) =>
    {
        const flag = copyFlag(actor);
        return !!flag && (flag.userId === game.user.id || (executor && !game.users.get(flag.userId)?.active));
    });
    if (stale.length)
        await Actor.implementation.deleteDocuments(stale.map(actor => actor.id));
}

function onSheetClosed(app)
{
    const flag = copyFlag(app?.document ?? app?.actor ?? app?.object);
    if (flag)
        finishCopy(flag.entryId);
}

export function initReinforcementSheets()
{
    Hooks.on('updateActor', actor => scheduleSave(actor));

    for (const event of ['create', 'update', 'delete'])
    {
        Hooks.on(`${event}Item`, item => scheduleSave(item.parent));
        Hooks.on(`${event}ActiveEffect`, effect => scheduleSave(effect.parent));
    }

    Hooks.on('closeActorSheet', onSheetClosed);
    Hooks.on('closeActorSheetV2', onSheetClosed);

    Hooks.on('updateCombat', (combat, changed) =>
    {
        if (!isPlanChange(changed))
            return;
        for (const [entryId, record] of copies)
        {
            if (record.combatId === combat.id && !planEntryOf(entryId, combat.id))
                discardCopy(entryId);
        }
    });

    Hooks.on('deleteCombat', (combat) =>
    {
        for (const [entryId, record] of copies)
        {
            if (record.combatId === combat.id)
                discardCopy(entryId);
        }
    });

    deleteLeftovers();
}
