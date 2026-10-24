import { getLAFlags } from '../tools/flag-utils.js';
import { MODULE_ID } from '../tools/constants.js';
import { isExecutorGM } from '../tools/misc-tools.js';
import { effectStack } from './flagged-effects.js';

const TURN_LABELS = new Set(['start', 'end']);
const ROUND_LABELS = new Set(['roundStart', 'roundEnd']);
const COMBAT_BOUND_LABELS = new Set(['encounter', 'start', 'end', 'roundStart', 'roundEnd']);

let _clock = Promise.resolve();

export function onCombatClock(task)
{
    _clock = _clock.then(task).catch(err => console.error(`${MODULE_ID} | combat clock`, err));
    return _clock;
}

export function normalizeDuration(duration)
{
    const out = { ...(duration ?? {}) };
    const raw = String(out.label ?? '').trim();
    const roundCount = /^(\d+)\s*rounds?$/i.exec(raw);
    if (!raw || raw === 'unlimited')
        out.label = 'indefinite';
    else if (raw === 'round' || roundCount)
    {
        out.label = 'roundEnd';
        if (roundCount && !out.rounds)
            out.rounds = Number(roundCount[1]);
    }
    if (TURN_LABELS.has(out.label) && !Number.isFinite(Number(out.turns)))
        out.turns = 1;
    return out;
}

export function combatForScene(scene)
{
    const combats = game.combats?.filter(combat => !combat.scene || combat.scene.id === scene?.id) ?? [];
    return combats.find(combat => combat.id === game.combat?.id) ?? combats.find(combat => combat.started) ?? combats[0] ?? null;
}

export function sceneActors(scene)
{
    const seen = new Set();
    const actors = [];
    for (const tokenDoc of scene?.tokens ?? [])
    {
        const actor = tokenDoc.actor;
        if (!actor)
            continue;
        const key = tokenDoc.actorLink ? `actor:${actor.id}` : `token:${tokenDoc.id}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        actors.push(actor);
    }
    return actors;
}

function entryStack(entry)
{
    return Math.max(1, Number(entry?.stack) || 1);
}

export function entryDuration(entry)
{
    const duration = { label: entry.label };
    if (TURN_LABELS.has(entry.label))
        duration.turns = entry.turns ?? null;
    if (ROUND_LABELS.has(entry.label))
        duration.round = entry.round ?? null;
    if (entry.combatId)
        duration.combatId = entry.combatId;
    return duration;
}

export function buildEntry(duration, originID, stack, tokenDoc)
{
    const normalized = normalizeDuration(duration);
    const entry = { label: normalized.label, originID: originID ?? null, stack: entryStack({ stack }) };
    const combat = combatForScene(tokenDoc?.parent ?? canvas.scene);
    if (combat)
        entry.combatId = combat.id;
    if (TURN_LABELS.has(entry.label))
        entry.turns = Number(normalized.turns);
    else if (ROUND_LABELS.has(entry.label))
    {
        if (Number.isFinite(Number(normalized.round)))
            entry.round = Number(normalized.round);
        else if (combat)
        {
            const count = Math.max(1, Number(normalized.rounds) || 1);
            entry.round = (combat.round ?? 0) + (entry.label === 'roundEnd' ? count - 1 : count);
        }
        else
            entry.round = null;
    }
    return entry;
}

export function durationEntries(effect)
{
    const flags = getLAFlags(effect) ?? {};
    const stack = effectStack(effect);
    const stored = Array.isArray(flags.durationEntries) ? flags.durationEntries.filter(Boolean) : [];
    if (!stored.length)
        return [{ ...entryDuration(normalizeDuration(flags.duration)), turns: flags.duration?.turns ?? null, originID: flags.originID ?? null, stack }];
    const counted = stored.reduce((total, entry) => total + entryStack(entry), 0);
    return counted < stack ? [...stored, { label: 'indefinite', originID: null, stack: stack - counted }] : stored;
}

export function hasPermanentEntry(effect)
{
    return durationEntries(effect).some(entry => entry.label === 'permanent');
}

export function roundsLeft(entry)
{
    const combat = entry?.combatId ? game.combats?.get(entry.combatId) : null;
    if (!combat || !ROUND_LABELS.has(entry.label) || !Number.isFinite(Number(entry.round)))
        return null;
    const left = entry.label === 'roundEnd' ? entry.round - combat.round + 1 : entry.round - combat.round;
    return Math.max(0, left);
}

export function remainingRounds(effect)
{
    const values = durationEntries(effect).map(roundsLeft).filter(left => left !== null && left > 0);
    return values.length ? Math.min(...values) : 0;
}

function isTemplate(effect)
{
    const flags = getLAFlags(effect);
    return flags?.isItemTemplate === true || flags?.isActorTemplate === true;
}

export async function rewriteEntries(effect, transform)
{
    const before = durationEntries(effect);
    const after = [];
    let removed = 0;
    let changed = false;
    for (const entry of before)
    {
        const next = transform(entry);
        if (next === entry)
        {
            after.push(entry);
            continue;
        }
        changed = true;
        if (next)
            after.push(next);
        else
            removed += entryStack(entry);
    }
    if (!changed)
        return;
    const newStack = effectStack(effect) - removed;
    if (!after.length || newStack <= 0)
    {
        await effect.delete();
        return;
    }
    const update = {
        [`flags.${MODULE_ID}.durationEntries`]: after,
        [`flags.${MODULE_ID}.duration`]: entryDuration(after.at(-1))
    };
    if (removed > 0)
    {
        update['flags.statuscounter.value'] = newStack;
        update['flags.statuscounter.visible'] = newStack > 1;
    }
    await effect.update(update);
}

async function rewriteSceneEntries(scene, transform)
{
    for (const actor of sceneActors(scene))
    {
        for (const effect of [...actor.effects])
        {
            if (!getLAFlags(effect) || isTemplate(effect))
                continue;
            await rewriteEntries(effect, transform);
        }
    }
}

export function tickTurnEntries(effect, triggerLabel, triggeringTokenId)
{
    if (isTemplate(effect))
        return Promise.resolve();
    return rewriteEntries(effect, entry =>
    {
        if (entry.label !== triggerLabel || entry.originID !== triggeringTokenId)
            return entry;
        const turns = Number(entry.turns);
        if (!Number.isFinite(turns))
            return entry;
        return turns - 1 <= 0 ? null : { ...entry, turns: turns - 1 };
    });
}

export async function processRoundEntries(combat, newRound, phase)
{
    if (!isExecutorGM() || !combat)
        return;
    const label = phase === 'end' ? 'roundEnd' : 'roundStart';
    await rewriteSceneEntries(combat.scene ?? canvas.scene, entry =>
    {
        if (entry.label !== label || entry.combatId !== combat.id || !Number.isFinite(Number(entry.round)))
            return entry;
        const ends = phase === 'end' ? newRound > entry.round : newRound >= entry.round;
        return ends ? null : entry;
    });
}

export async function processEncounterEnd(combat)
{
    if (!isExecutorGM() || !combat)
        return;
    await rewriteSceneEntries(combat.scene ?? canvas.scene, entry =>
        (COMBAT_BOUND_LABELS.has(entry.label) && (!entry.combatId || entry.combatId === combat.id) ? null : entry));
}

export async function processOriginDeparture(combat, tokenId)
{
    if (!isExecutorGM() || !combat || !tokenId)
        return;
    await rewriteSceneEntries(combat.scene ?? canvas.scene, entry =>
    {
        if (!TURN_LABELS.has(entry.label) || entry.originID !== tokenId)
            return entry;
        return { label: 'roundEnd', round: combat.round ?? 0, combatId: combat.id, originID: entry.originID, stack: entryStack(entry) };
    });
}

function actsInCombat(combat, tokenId)
{
    return combat.combatants.some(combatant => combatant.tokenId === tokenId && !combatant.isDefeated);
}

export function resolveTurnOrigin(originID, holderDoc)
{
    const scene = holderDoc?.parent ?? canvas.scene;
    const combat = combatForScene(scene);
    if (!combat || !originID || actsInCombat(combat, originID))
        return { originID, fallback: false };
    const ownerRef = scene?.tokens?.get(originID)?.actor?.system?.owner;
    const ownerKey = typeof ownerRef === 'string' ? ownerRef : ownerRef?.id ?? null;
    const owner = ownerKey ? (fromUuidSync(ownerKey) ?? game.actors?.get(ownerKey) ?? null) : null;
    const ownerCombatant = owner ? combat.combatants.find((/** @type {any} */ combatant) => combatant.actorId === owner.id && !combatant.isDefeated) : null;
    if (ownerCombatant?.tokenId)
        return { originID: ownerCombatant.tokenId, fallback: false };
    if (holderDoc && holderDoc.id !== originID && actsInCombat(combat, holderDoc.id))
        return { originID: holderDoc.id, fallback: true };
    return { originID, fallback: false };
}
