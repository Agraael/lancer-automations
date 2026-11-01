import { linkTierGate } from '../../interactive/deployables.js';
import { isLancerActor as isLancerCombatant, resolvePilot } from '../../utils/lancer-token.js';
import { setTokenFlag } from '../../socket.js';
import { isExecutorGM } from '../../tools/misc-tools.js';
import * as altFlags from '../../integrations/alt-sheets-flags.js';
import {
    MODULE_ID,
    SETTING_AUTO_INJECT_TALENTS, SETTING_AUTO_INJECT_BOND_XP,
    SETTING_AUTO_INJECT_TALENT_COLOR, SETTING_AUTO_INJECT_TALENT_WIDTH, SETTING_AUTO_INJECT_TALENT_FEEDBACK,
    SETTING_AUTO_INJECT_CUSTOM_FLAGS,
    FLAG_EXTRAS, FLAG_AUTO_KEYS, FLAG_TEMPLATES,
    DEFAULT_EXTRA_BAR_ICON,
} from './config.js';
import { _isActorScannedByUser } from './rules.js';
import { getModuleSetting } from '../../tools/settings-utils.js';
import { getLAFlag, setLAFlag } from '../../tools/flag-utils.js';
import { localize, localizeFormat } from '../../tools/string-utils.js';

// Accepts Token (placeable), TokenDocument, scene-local token id, or uuid. Returns TokenDocument or null.
async function _resolveTokenDocument(arg)
{
    if (!arg)
        return null;
    if (typeof arg === 'string')
    {
        try
        {
            if (arg.includes('.'))
            {
                const doc = /** @type {any} */ (await fromUuid(arg));
                return doc?.documentName === 'Token' ? doc : (doc?.token ?? null);
            }
            for (const scene of game.scenes)
            {
                const tokenDoc = scene.tokens.get(arg);
                if (tokenDoc)
                    return tokenDoc;
            }
            return canvas?.tokens?.get(arg)?.document ?? null;
        }
        catch
        {
            return null;
        }
    }
    return /** @type {any} */ (arg).document ?? arg;
}

// Actor paths, plus "items.{id}.{rest}" (an actor item, e.g. the frame) for auto-injected counter bars
// and "pilotItems.{id}.{rest}" (talents: the mech's pilot items, else the actor's own items).
function _readActorPath(actor, path)
{
    if (!actor || !path)
        return undefined;
    let match = /^items\.([^.]+)\.(.+)$/.exec(path);
    if (match)
    {
        const item = actor.items?.get?.(match[1]);
        if (!item)
            return undefined;
        return foundry.utils.getProperty(item, match[2]);
    }
    match = /^pilotItems\.([^.]+)\.(.+)$/.exec(path);
    if (match)
    {
        const pilot = resolvePilot(actor) ?? actor;
        const item = pilot?.items?.get?.(match[1]);
        if (!item)
            return undefined;
        return foundry.utils.getProperty(item, match[2]);
    }
    return foundry.utils.getProperty(actor, path);
}

// Resolve visibility from the 3-mode field. Falls back to legacy ownerOnly, then 'scanned'.
export function _resolveExtraBarVisibility(actor, entry)
{
    let mode = entry?.visibility;
    if (!mode)
        mode = entry?.ownerOnly === true ? 'owner' : entry?.ownerOnly === false ? 'all' : 'scanned';
    if (mode === 'all')
        return true;
    if (game.user?.isGM || actor?.isOwner)
        return true;
    if (mode === 'owner')
        return false;
    // 'scanned': own-side actors always reveal to non-owners (no scan concept); NPC/deployable need a scan.
    if (actor?.type === 'pilot' || actor?.type === 'mech')
        return true;
    return _isActorScannedByUser(actor, game.user);
}

export function _resolveExtraBarValues(actor, entry)
{
    const read = (src) =>
    {
        if (!src)
            return 0;
        if (src.kind === 'manual')
            return Number(src.value) || 0;
        if (src.kind === 'path' && actor)
            return Number(_readActorPath(actor, src.path)) || 0;
        return 0;
    };
    const value = read(entry?.valueSource);
    const rawMax = read(entry?.maxSource);
    const max = rawMax > 0 ? rawMax : (entry?.segmented ? Math.max(1, Number(entry?.segments) || 1) : 1);
    const ownerOk = _resolveExtraBarVisibility(actor, entry);
    return { value, max, ownerOk };
}

// Enumerates talent rank + frame core counters; returns items.{id}.rest-style paths.
function _enumerateAutoCounters(actor)
{
    const out = [];
    if (!actor)
        return out;
    const pilot = resolvePilot(actor) ?? actor;
    const talentItems = pilot?.items
        ? [...pilot.items.values()].filter(/** @type {any} */ item => item.type === 'talent')
        : [];
    for (const talent of talentItems)
    {
        const lid = /** @type {any} */ (talent).system?.lid ?? talent.id;
        const ranks = /** @type {any} */ (talent).system?.ranks ?? [];
        const currRank = /** @type {any} */ (talent).system?.curr_rank ?? ranks.length;
        const lastIdx = Math.min(currRank, ranks.length);
        // Counters keyed by lid/name supersede across ranks: keep only the highest rank.
        const byKey = new Map();
        for (let rankIdx = 0; rankIdx < lastIdx; rankIdx++)
        {
            const counters = ranks[rankIdx]?.counters ?? [];
            for (let counterIdx = 0; counterIdx < counters.length; counterIdx++)
            {
                const counter = counters[counterIdx];
                const key = counter?.lid || counter?.name || `r${rankIdx}c${counterIdx}`;
                byKey.set(key, { rankIdx, counterIdx, counter });
            }
        }
        for (const { rankIdx, counterIdx, counter } of byKey.values())
        {
            out.push({
                autoKey: `talent:${lid}:r${rankIdx}:c${counterIdx}`,
                label: counter?.name ?? 'Counter',
                valuePath: `pilotItems.${talent.id}.system.ranks.${rankIdx}.counters.${counterIdx}.value`,
                maxPath: `pilotItems.${talent.id}.system.ranks.${rankIdx}.counters.${counterIdx}.max`,
            });
        }
    }
    const frame = actor.system?.loadout?.frame?.value;
    const csCounters = frame?.system?.core_system?.counters ?? [];
    for (let counterIdx = 0; counterIdx < csCounters.length; counterIdx++)
    {
        const counter = csCounters[counterIdx];
        const lid = frame.system?.lid ?? frame.id;
        out.push({
            autoKey: `frame:${lid}:c${counterIdx}`,
            label: counter?.name ?? 'Core Counter',
            valuePath: `items.${frame.id}.system.core_system.counters.${counterIdx}.value`,
            maxPath: `items.${frame.id}.system.core_system.counters.${counterIdx}.max`,
        });
    }
    return out;
}

// GM-only, idempotent: adds counter bars, skipping autoKeys already live or tombstoned in FLAG_AUTO_KEYS so user-deleted bars stay deleted.
export async function _autoInjectCounters(tokenDoc)
{
    try
    {
        if (!isExecutorGM())
            return;
        const doc = /** @type {any} */ (tokenDoc)?.document ?? tokenDoc;
        if (!doc)
            return;
        const actor = doc.actor;
        if (!isLancerCombatant(actor))
            return;

        const existing = getLAFlag(doc,FLAG_EXTRAS) ?? [];
        const seen = getLAFlag(doc,FLAG_AUTO_KEYS) ?? {};
        const liveKeys = new Set(existing.filter(/** @type {any} */ entry => entry?.autoKey).map(/** @type {any} */ entry => entry.autoKey));

        // Talent/frame counters (gated by world setting).
        let toAddCounters = [];
        let counterStyle = null;
        if (getModuleSetting(SETTING_AUTO_INJECT_TALENTS))
        {
            counterStyle = {
                color: getModuleSetting(SETTING_AUTO_INJECT_TALENT_COLOR) || '#196161',
                widthPct: Math.max(1, Math.min(100, Number(getModuleSetting(SETTING_AUTO_INJECT_TALENT_WIDTH)) || 100)),
                feedback: !!getModuleSetting(SETTING_AUTO_INJECT_TALENT_FEEDBACK),
            };
            const counters = _enumerateAutoCounters(actor);
            toAddCounters = counters.filter(counter => !liveKeys.has(counter.autoKey) && !seen[counter.autoKey]);
        }

        // User-linked templates on the actor + items. Always processed.
        const templates = _enumerateLinkedTemplates(actor);
        const toAddTemplates = templates.filter(template => !liveKeys.has(template.autoKey) && !seen[template.autoKey]);

        // alt-sheets fraction custom flags -> derived path-bound bars.
        let toAddFlags = [];
        if (altFlags.isActive() && getModuleSetting(SETTING_AUTO_INJECT_CUSTOM_FLAGS))
        {
            toAddFlags = altFlags.listLinkedFractionFlags(actor)
                .map(flag => _buildCustomFlagBar(actor, flag))
                .filter(bar => !liveKeys.has(bar.autoKey) && !seen[bar.autoKey]);
        }

        // Bond XP bar on bonded pilots (gated by world setting).
        let toAddBondXp = [];
        if (actor.type === 'pilot' && getModuleSetting(SETTING_AUTO_INJECT_BOND_XP)
            && actor.items.some(/** @type {any} */ ownedItem => ownedItem.type === 'bond')
            && !liveKeys.has('bondXp') && !seen['bondXp'])
        {
            toAddBondXp = [{
                ..._defaultExtraBar(),
                id: foundry.utils.randomID(),
                autoKey: 'bondXp',
                label: 'XP',
                layoutMode: 'newLine',
                widthPct: 100,
                color: { kind: 'solid', stops: ['#00b8d4'] },
                icon: 'mdi mdi-head-cog-outline',
                valueSource: { kind: 'path', path: 'system.bond_state.xp.value', value: 0 },
                maxSource: { kind: 'path', path: 'system.bond_state.xp.max', value: 8 },
                segmented: true,
                showLabelInHint: false,
                hideInHint: true,
                visibility: 'scanned',
                audioTextFeedback: false,
            }];
        }

        if (!toAddCounters.length && !toAddTemplates.length && !toAddFlags.length && !toAddBondXp.length)
            return;

        const next = existing.slice();
        const seenNext = { ...seen };
        for (const counter of toAddCounters)
        {
            next.push(_buildAutoInjectedEntry(counter, counterStyle.color, counterStyle.widthPct, counterStyle.feedback));
            seenNext[counter.autoKey] = true;
        }
        for (const template of toAddTemplates)
        {
            next.push(_materializeLinkedTemplate(template));
            seenNext[template.autoKey] = true;
        }
        for (const bar of toAddFlags)
        {
            next.push(bar);
            seenNext[bar.autoKey] = true;
        }
        for (const bar of toAddBondXp)
        {
            next.push(bar);
            seenNext[bar.autoKey] = true;
        }
        await setTokenFlag(doc, MODULE_ID, FLAG_EXTRAS, next);
        await setTokenFlag(doc, MODULE_ID, FLAG_AUTO_KEYS, seenNext);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | _autoInjectCounters failed`, err);
    }
}

// Build an auto-injected entry from an enumerated counter + style settings.
function _buildAutoInjectedEntry(counter, color, widthPct, feedback = true)
{
    const base = _defaultExtraBar();
    return {
        ...base,
        id: foundry.utils.randomID(),
        autoKey: counter.autoKey,
        label: counter.label,
        layoutMode: 'newLine',
        widthPct,
        color: { kind: 'solid', stops: [color] },
        icon: DEFAULT_EXTRA_BAR_ICON,
        valueSource: { kind: 'path', path: counter.valuePath, value: 0 },
        maxSource: { kind: 'path', path: counter.maxPath, value: 1 },
        segmented: true,
        showLabelInHint: true,
        visibility: 'scanned',
        audioTextFeedback: feedback,
    };
}

// Derived bar for a fraction custom flag. Deterministic id keeps row identity across reinjects.
function _buildCustomFlagBar(actor, flag)
{
    const base = _defaultExtraBar();
    const key = altFlags.flagKeyForActor(actor);
    return {
        ...base,
        id: `laflag-${flag.id}`,
        autoKey: `flag:${key}:${flag.id}`,
        label: flag.name || 'Custom',
        layoutMode: 'newLine',
        widthPct: 100,
        color: { kind: 'solid', stops: [flag.color || '#ffffff'] },
        icon: flag.icon || DEFAULT_EXTRA_BAR_ICON,
        valueSource: { kind: 'path', path: flag.valuePath, value: 0 },
        maxSource: { kind: 'path', path: flag.maxPath, value: 1 },
        segmented: false,
        showLabelInHint: true,
        visibility: flag.showInSidebar ? 'all' : 'scanned',
    };
}

// React to alt-sheets custom-flag changes: reinject on structural change, else just redraw; refresh TAH.
export async function _onCustomFlagsChanged(actor, changes, options)
{
    const structural = altFlags.barLinkChanged(changes)
        || (!options?.laFlagValueWrite && altFlags.structuralChange(changes));
    for (const tok of actor.getActiveTokens())
    {
        if (structural && isExecutorGM())
            await _resetAutoInjectedExtras(tok.document);
        try
        {
            tok.drawBars();
        }
        catch
        { /* ignore */ }
    }
    try
    {
        Hooks.callAll('forceUpdateTokenActionHud', { patch: true });
    }
    catch
    {
        return;
    }
}

// Single setFlag write avoids read-after-write race; works without active-GM gating.
export async function _resetAutoInjectedExtras(tokenDoc)
{
    try
    {
        const doc = /** @type {any} */ (tokenDoc)?.document ?? tokenDoc;
        if (!doc)
            return false;
        const existing = getLAFlag(doc,FLAG_EXTRAS) ?? [];
        const kept = existing.filter(/** @type {any} */ entry => !entry?.autoKey);
        const fresh = [];
        const nextSeen = {};
        const actor = doc.actor;
        const isLancer = actor && ['mech', 'pilot', 'npc'].includes(actor.type);
        if (isLancer && getModuleSetting(SETTING_AUTO_INJECT_TALENTS))
        {
            const color = getModuleSetting(SETTING_AUTO_INJECT_TALENT_COLOR) || '#196161';
            const widthPct = Math.max(1, Math.min(100, Number(getModuleSetting(SETTING_AUTO_INJECT_TALENT_WIDTH)) || 100));
            const feedback = !!getModuleSetting(SETTING_AUTO_INJECT_TALENT_FEEDBACK);
            for (const counter of _enumerateAutoCounters(actor))
            {
                fresh.push(_buildAutoInjectedEntry(counter, color, widthPct, feedback));
                nextSeen[counter.autoKey] = true;
            }
        }
        if (actor)
        {
            for (const template of _enumerateLinkedTemplates(actor))
            {
                fresh.push(_materializeLinkedTemplate(template));
                nextSeen[template.autoKey] = true;
            }
            if (altFlags.isActive() && getModuleSetting(SETTING_AUTO_INJECT_CUSTOM_FLAGS))
            {
                for (const flag of altFlags.listLinkedFractionFlags(actor))
                {
                    const bar = _buildCustomFlagBar(actor, flag);
                    fresh.push(bar);
                    nextSeen[bar.autoKey] = true;
                }
            }
        }
        await setTokenFlag(doc, MODULE_ID, FLAG_EXTRAS, [...kept, ...fresh]);
        await setTokenFlag(doc, MODULE_ID, FLAG_AUTO_KEYS, nextSeen);
        return true;
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | _resetAutoInjectedExtras failed`, err);
        return false;
    }
}

// Group extras into lines respecting layoutMode + 100% width cap. Overflow wraps.
export function _groupExtrasIntoLines(extras)
{
    const lines = [];
    let currentLine = null;
    for (const extra of extras ?? [])
    {
        const widthPct = Math.max(1, Math.min(100, Number(extra?.widthPct) || 100));
        const breaks = !currentLine || extra?.layoutMode === 'newLine' || (currentLine.used + widthPct) > 100;
        if (breaks)
        {
            currentLine = { entries: [], used: 0 };
            lines.push(currentLine);
        }
        currentLine.entries.push({ entry: extra, width: widthPct });
        currentLine.used += widthPct;
    }
    return lines;
}

export function _defaultExtraBar()
{
    return {
        id: foundry.utils.randomID(),
        label: '',
        layoutMode: 'newLine',
        widthPct: 100,
        valueSource: { kind: 'path', path: 'system.hp.value', value: 0 },
        maxSource: { kind: 'path', path: 'system.hp.max', value: 1 },
        segmented: true,
        segments: 4,
        color: { kind: 'solid', stops: ['#66cc66'] },
        visibility: 'scanned',
        icon: DEFAULT_EXTRA_BAR_ICON,
        showLabelInHint: true,
        linkedItemUuid: '',
        audioTextFeedback: true,
    };
}

// Polymorphic target: Token / Item / Actor / uuid / id → { kind, doc } or null.
async function _resolveTarget(target)
{
    if (!target)
        return null;
    if (typeof target === 'string')
    {
        try
        {
            if (target.includes('.'))
            {
                const doc = /** @type {any} */ (await fromUuid(target));
                if (!doc)
                    return null;
                if (doc.documentName === 'Token')
                    return { kind: 'token', doc };
                if (doc.documentName === 'Item')
                    return { kind: 'item', doc };
                if (doc.documentName === 'Actor')
                    return { kind: 'actor', doc };
                if (doc.token)
                    return { kind: 'token', doc: doc.token };
                return null;
            }
            const tokenDoc = await _resolveTokenDocument(target);
            return tokenDoc ? { kind: 'token', doc: tokenDoc } : null;
        }
        catch
        {
            return null;
        }
    }
    const documentName = /** @type {any} */ (target).documentName;
    if (documentName === 'Item')
        return { kind: 'item', doc: target };
    if (documentName === 'Actor')
        return { kind: 'actor', doc: target };
    if (documentName === 'Token')
        return { kind: 'token', doc: target };
    const inner = /** @type {any} */ (target).document;
    if (inner?.documentName === 'Token')
        return { kind: 'token', doc: inner };
    return null;
}

// Walk actor + its items for extraBarTemplates. Returns [{ autoKey, sourceUuid, entry }].
function _enumerateLinkedTemplates(actor)
{
    const out = [];
    if (!actor)
        return out;
    const actorList = getLAFlag(actor,FLAG_TEMPLATES) ?? [];
    const actorSrc = `actor:${actor.id}`;
    for (const record of actorList)
    {
        if (!record?.id || !record.entry || !linkTierGate(record.entry, actor))
            continue;
        out.push({ autoKey: `linked:${record.id}:${actorSrc}`, sourceUuid: actor.uuid, entry: record.entry });
    }
    for (const item of actor.items ?? [])
    {
        const itemList = getLAFlag(item,FLAG_TEMPLATES) ?? [];
        for (const record of itemList)
        {
            if (!record?.id || !record.entry || !linkTierGate(record.entry, actor, item))
                continue;
            out.push({ autoKey: `linked:${record.id}:${item.uuid}`, sourceUuid: item.uuid, entry: record.entry });
        }
    }
    return out;
}

function _materializeLinkedTemplate(record)
{
    const merged = foundry.utils.mergeObject(_defaultExtraBar(), record.entry ?? {}, { inplace: false });
    // Fall back to the auto-inject world settings for fields the template didn't specify.
    if (record.entry?.widthPct === undefined)
        merged.widthPct = Math.max(1, Math.min(100, Number(getModuleSetting(SETTING_AUTO_INJECT_TALENT_WIDTH)) || 100));
    if (record.entry?.color === undefined)
        merged.color = { kind: 'solid', stops: [getModuleSetting(SETTING_AUTO_INJECT_TALENT_COLOR) || '#196161'] };
    if (record.entry?.audioTextFeedback === undefined)
        merged.audioTextFeedback = !!getModuleSetting(SETTING_AUTO_INJECT_TALENT_FEEDBACK);
    merged.id = foundry.utils.randomID();
    merged.autoKey = record.autoKey;
    merged.linkedItemUuid = merged.linkedItemUuid || record.sourceUuid;
    return merged;
}

// Scoped reinject (one actor's tokens + prototype). Callers: link/unlink/update.
export async function reinjectAutoBarsForActor(actor)
{
    if (!actor)
        return 0;
    let count = 0;
    for (const scene of game.scenes ?? [])
    {
        for (const tokenDoc of scene.tokens ?? [])
        {
            if (tokenDoc.actor?.id !== actor.id)
                continue;
            if (await _resetAutoInjectedExtras(tokenDoc))
                count++;
        }
    }
    const proto = /** @type {any} */ (actor.prototypeToken ?? actor.token);
    if (proto && await _resetAutoInjectedExtras(proto))
        count++;
    return count;
}

// value: number | numeric string | delta string ("+2"/"-3"). Delta ignored if currentBase is null.
function _coerceValueOrDelta(value, currentBase)
{
    if (typeof value === 'string')
    {
        const raw = value.trim();
        const num = Number(raw);
        if (!Number.isFinite(num))
            return null;
        return (raw.startsWith('+') || raw.startsWith('-')) && currentBase !== null
            ? (Number(currentBase) || 0) + num
            : num;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * @returns {Promise<number|null>} the new value, or null on failure.
 */
export async function updateExtraBarValue(target, entryId, value)
{
    const resolved = await _resolveTarget(target);
    if (!resolved || !entryId)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: invalid target or entryId`);
        return null;
    }
    if (resolved.kind === 'token')
        return _updateExtraBarValueOnToken(resolved.doc, entryId, value);
    return _updateExtraBarValueOnTemplate(resolved.doc, entryId, value);
}

/**
 * @returns {Promise<string|null>} the new entry / template id, or null on failure.
 */
export async function addExtraBar(target, partial = {})
{
    const resolved = await _resolveTarget(target);
    if (!resolved)
    {
        console.warn(`${MODULE_ID} | addExtraBar: invalid target`);
        return null;
    }
    if (partial && typeof partial !== 'object')
    {
        console.warn(`${MODULE_ID} | addExtraBar: partial must be an object`);
        return null;
    }
    if (resolved.kind === 'token')
        return _addExtraBarToToken(resolved.doc, partial);
    return _addExtraBarToTemplate(resolved.doc, partial);
}

/**
 * @returns {Promise<boolean>} true if removed.
 */
export async function removeExtraBar(target, entryId)
{
    const resolved = await _resolveTarget(target);
    if (!resolved || !entryId)
    {
        console.warn(`${MODULE_ID} | removeExtraBar: invalid target or entryId`);
        return false;
    }
    if (resolved.kind === 'token')
        return _removeExtraBarFromToken(resolved.doc, entryId);
    return _removeExtraBarFromTemplate(resolved.doc, entryId);
}

// Token → statBarExtras entries. Item/Actor → template records [{ id, entry }].
/** @returns {Array<any>} Extra bar entries on the document */
export function getExtraBars(target)
{
    if (!target)
        return [];
    const documentName = /** @type {any} */ (target).documentName;
    if (documentName === 'Item' || documentName === 'Actor')
        return getLAFlag(target,FLAG_TEMPLATES) ?? [];
    if (documentName === 'Token')
        return getLAFlag(target,FLAG_EXTRAS) ?? [];
    const inner = /** @type {any} */ (target).document;
    if (inner?.documentName === 'Token')
        return getLAFlag(inner,FLAG_EXTRAS) ?? [];
    return [];
}

async function _updateExtraBarValueOnToken(tokenDoc, entryId, value)
{
    const extras = foundry.utils.deepClone(getLAFlag(tokenDoc,FLAG_EXTRAS) ?? []);
    const entry = extras.find(/** @type {any} */ item => item.id === entryId);
    if (!entry)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: entry ${entryId} not found on token`);
        return null;
    }
    // Custom-flag bars: the value lives in the alt-sheets flag, so write it there.
    if (entry.autoKey?.startsWith('flag:'))
    {
        const flagActor = /** @type {any} */ (tokenDoc).actor;
        const flagId = entry.autoKey.split(':')[2];
        return flagActor && flagId ? altFlags.writeFlagValue(flagActor, flagId, value) : null;
    }
    // Path-bound bars are read-only via this API (the source path owns the value).
    if (entry.valueSource?.kind !== 'manual')
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: entry ${entryId} is not manual`);
        return null;
    }
    const next = _coerceValueOrDelta(value, entry.valueSource.value);
    if (next === null)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: NaN value "${value}"`);
        return null;
    }
    entry.valueSource.value = next;
    try
    {
        await setLAFlag(tokenDoc,FLAG_EXTRAS, extras);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: setFlag failed`, err);
        return null;
    }
    return next;
}

async function _updateExtraBarValueOnTemplate(sourceDoc, templateId, value)
{
    const list = foundry.utils.deepClone(getLAFlag(sourceDoc,FLAG_TEMPLATES) ?? []);
    const record = list.find(/** @type {any} */ item => item.id === templateId);
    if (!record)
    {
        console.warn(`${MODULE_ID} | updateExtraBarValue: template ${templateId} not found`);
        return null;
    }
    const valueSource = record.entry?.valueSource ?? {};
    if (valueSource.kind === 'manual')
    {
        const next = _coerceValueOrDelta(value, valueSource.value);
        if (next === null)
            return null;
        valueSource.value = next;
        record.entry.valueSource = valueSource;
        try
        {
            await setLAFlag(sourceDoc,FLAG_TEMPLATES, list);
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | updateExtraBarValue: template setFlag failed`, err);
            return null;
        }
        const actor = sourceDoc.documentName === 'Actor' ? sourceDoc : sourceDoc.actor;
        await reinjectAutoBarsForActor(actor);
        return next;
    }
    if (valueSource.kind === 'path' && valueSource.path)
    {
        const next = _coerceValueOrDelta(value, foundry.utils.getProperty(sourceDoc, valueSource.path));
        if (next === null)
            return null;
        try
        {
            await sourceDoc.update({ [valueSource.path]: next });
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | updateExtraBarValue: path update failed`, err);
            return null;
        }
        return next;
    }
    console.warn(`${MODULE_ID} | updateExtraBarValue: template has unsupported valueSource`);
    return null;
}

async function _addExtraBarToToken(tokenDoc, partial)
{
    const extras = foundry.utils.deepClone(getLAFlag(tokenDoc,FLAG_EXTRAS) ?? []);
    const base = { ..._defaultExtraBar(), visibility: 'scanned', audioTextFeedback: true };
    const entry = foundry.utils.mergeObject(base, partial ?? {}, { inplace: false });
    if (!entry.id || extras.some(/** @type {any} */ item => item.id === entry.id))
        entry.id = foundry.utils.randomID();
    extras.push(entry);
    try
    {
        await setLAFlag(tokenDoc,FLAG_EXTRAS, extras);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | addExtraBar: setFlag failed`, err);
        return null;
    }
    return entry.id;
}

async function _addExtraBarToTemplate(sourceDoc, partial)
{
    const list = foundry.utils.deepClone(getLAFlag(sourceDoc,FLAG_TEMPLATES) ?? []);
    // Templates store ONLY user-authored fields; settings + _defaultExtraBar fill the rest at inject time.
    const entry = { ...(partial ?? {}) };
    if (!entry.valueSource)
        entry.valueSource = { kind: 'manual', value: 0 };
    if (!entry.maxSource)
        entry.maxSource = { kind: 'manual', value: 1 };
    if (entry.visibility === undefined)
        entry.visibility = 'scanned';
    const templateId = foundry.utils.randomID();
    list.push({ id: templateId, entry });
    try
    {
        await setLAFlag(sourceDoc,FLAG_TEMPLATES, list);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | addExtraBar: template setFlag failed`, err);
        return null;
    }
    const actor = sourceDoc.documentName === 'Actor' ? sourceDoc : sourceDoc.actor;
    await reinjectAutoBarsForActor(actor);
    return templateId;
}

async function _removeExtraBarFromToken(tokenDoc, entryId)
{
    const extras = foundry.utils.deepClone(getLAFlag(tokenDoc,FLAG_EXTRAS) ?? []);
    const removed = extras.find(/** @type {any} */ item => item.id === entryId);
    const next = extras.filter(/** @type {any} */ item => item.id !== entryId);
    if (next.length === extras.length)
        return false;
    try
    {
        await setLAFlag(tokenDoc,FLAG_EXTRAS, next);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | removeExtraBar: setFlag failed`, err);
        return false;
    }
    // Custom-flag bars are derived; removing the bar just unlinks it (the flag stays on the sheet).
    if (removed?.autoKey?.startsWith('flag:'))
    {
        const flagActor = /** @type {any} */ (tokenDoc).actor;
        const flagId = removed.autoKey.split(':')[2];
        if (flagActor && flagId)
        {
            try
            {
                await altFlags.setBarLink(flagActor, flagId, false);
            }
            catch
            { /* ignore */ }
        }
    }
    return true;
}

async function _removeExtraBarFromTemplate(sourceDoc, templateId)
{
    const list = getLAFlag(sourceDoc,FLAG_TEMPLATES) ?? [];
    const next = list.filter(/** @type {any} */ record => record.id !== templateId);
    if (next.length === list.length)
        return false;
    try
    {
        await setLAFlag(sourceDoc,FLAG_TEMPLATES, next);
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | removeExtraBar: template setFlag failed`, err);
        return false;
    }
    const actor = sourceDoc.documentName === 'Actor' ? sourceDoc : sourceDoc.actor;
    const sourceUuid = sourceDoc.documentName === 'Actor' ? `actor:${sourceDoc.id}` : sourceDoc.uuid;
    const autoKey = `linked:${templateId}:${sourceUuid}`;
    for (const scene of game.scenes ?? [])
    {
        for (const tokenDoc of scene.tokens ?? [])
        {
            if (tokenDoc.actor?.id !== actor?.id)
                continue;
            const cur = getLAFlag(tokenDoc,FLAG_EXTRAS) ?? [];
            if (!cur.some(/** @type {any} */ entry => entry.autoKey === autoKey))
                continue;
            const pruned = cur.filter(/** @type {any} */ entry => entry.autoKey !== autoKey);
            try
            {
                await setLAFlag(tokenDoc,FLAG_EXTRAS, pruned);
                const seen = { ...(getLAFlag(tokenDoc,FLAG_AUTO_KEYS) ?? {}) };
                delete seen[autoKey];
                await setLAFlag(tokenDoc,FLAG_AUTO_KEYS, seen);
            }
            catch (err)
            {
                console.warn(`${MODULE_ID} | removeExtraBar: prune failed`, err);
            }
        }
    }
    return true;
}

export const ExtraBarsAPI = { updateExtraBarValue, addExtraBar, removeExtraBar, getExtraBars };

// Reset auto-injected bars on every scene token and every actor prototype.
export async function reinjectAutoBarsOnAllTokens()
{
    if (!game.user?.isGM)
    {
        ui.notifications?.warn(localize('LA.notify.onlyTheGmCanReinjectAutoBars'));
        return;
    }
    let sceneTokens = 0, prototypes = 0, failed = 0;
    for (const scene of game.scenes ?? [])
    {
        for (const tokenDoc of scene.tokens ?? [])
        {
            if (!isLancerCombatant(tokenDoc.actor))
                continue;
            const ok = await _resetAutoInjectedExtras(tokenDoc);
            if (ok)
                sceneTokens++; else
                failed++;
        }
    }
    for (const actor of game.actors ?? [])
    {
        if (!isLancerCombatant(actor))
            continue;
        const proto = /** @type {any} */ (actor.prototypeToken ?? actor.token);
        if (!proto)
            continue;
        const ok = await _resetAutoInjectedExtras(proto);
        if (ok)
            prototypes++; else
            failed++;
    }
    ui.notifications?.info(localizeFormat('LA.notify.reinjectedAutoBars', { tokens: sceneTokens, prototypes, failed: failed ? ` (${failed} failed)` : '' }));
}
