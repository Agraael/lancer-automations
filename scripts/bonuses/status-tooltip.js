// Shared status tooltip. The canvas icon hover and the status wheel render the same markup so an
// effect reads identically wherever it is hovered.
import { getGlobalBonuses, getBonusDetailString, getBonusUsesInfo, itemAttachmentOrigin, attachmentOrigin, getBonusIcon } from './genericBonuses.js';
import { linkedBonusConditionLines, linkedBonusFrequencyLabel, linkedBonusHasLambdaGate } from './bonus-condition.js';
import { getLAFlags } from '../tools/flag-utils.js';
import { effectStack, isUsageEffect, roundBadgeColor, iconGroupOf } from './flagged-effects.js';
import { durationEntries, roundsLeft, ANY_TURN_LABELS } from './duration-clock.js';
import { localize, escapeHtml } from '../tools/string-utils.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { VALUE_STATUS_PATHS } from '../utils/lancer-token.js';

const VALUE_STATUS_COLORS = { burn: '#d74242', overshield: '#60a5fa', infection: '#1a8a3a' };

/**
 * @typedef {Object} StatusTooltipData
 * @property {string} name
 * @property {number} [count]
 * @property {number|null} [value] - Current Burn, Overshield or Infection.
 * @property {string} [valueColor]
 * @property {string} [core] - Name of the frame's core power.
 * @property {string} [duration]
 * @property {string} [bonus]
 * @property {string} [frequency] - How often the bonus may apply, empty when unlimited.
 * @property {string[]} [conditional] - Gate lines of the linked bonus, non-empty means gated.
 * @property {string} [source] - Name of the item or actor it comes from.
 * @property {'hand'|'automation'|'unknown'|null} [origin]
 * @property {boolean} [off] - A data bonus switched off on this token.
 * @property {boolean} [replaced]
 * @property {string} [condition]
 * @property {boolean} [conditionMet]
 * @property {string} [description] - Trusted HTML, comes from effect/status config.
 */

/** Shortest turn-based entry, null when the effect has none. */
function bestTurnEntry(effect)
{
    if (!getLAFlags(effect))
        return null;
    let best = null;
    for (const entry of durationEntries(effect))
    {
        if ((entry.label === 'end' || entry.label === 'start' || ANY_TURN_LABELS.has(entry.label)) && Number(entry.turns) > 0)
        {
            if (!best || Number(entry.turns) < best.turns)
                best = { label: entry.label, turns: Number(entry.turns) };
        }
    }
    return best;
}

/** Turns left, 0 when the effect has no turn-based duration. Same value the gold token badge draws. */
export function remainingTurns(effect)
{
    return bestTurnEntry(effect)?.turns ?? 0;
}

/** Same value the blue token badge draws: the stack total, or the instance count for charge carriers. */
export function instanceCount(actor, effect)
{
    if (!actor || !effect?.name)
        return 0;
    const group = iconGroupOf(actor, effect);
    if (group.some(isUsageEffect))
        return group.length;
    return group.reduce((total, entry) => total + effectStack(entry), 0);
}

function plural(count, word)
{
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function holderTokenIds(effect)
{
    const actor = effect?.parent;
    const ids = new Set();
    if (actor?.token)
        ids.add(actor.token.id);
    for (const token of actor?.getActiveTokens?.(false, true) ?? [])
        ids.add(token.id);
    return ids;
}

function tokenName(tokenId)
{
    return canvas.tokens?.get(tokenId)?.name
        ?? game.scenes?.find(scene => scene.tokens.has(tokenId))?.tokens.get(tokenId)?.name
        ?? '';
}

function durationLine(entry, holderIds)
{
    if (entry.label === 'start' || entry.label === 'end')
    {
        const turns = Number(entry.turns);
        const count = Number.isFinite(turns) ? ` (${plural(turns, 'turn')})` : '';
        const own = !entry.originID || holderIds.has(entry.originID);
        return { text: `${entry.label === 'end' ? 'End' : 'Start'} of ${own ? 'own turn' : 'turn'}${count}`, whose: own ? null : tokenName(entry.originID), round: false };
    }
    if (ANY_TURN_LABELS.has(entry.label))
    {
        const turns = Number(entry.turns);
        const count = Number.isFinite(turns) ? ` (${plural(turns, 'turn')})` : '';
        return { text: `${entry.label === 'anyTurnEnd' ? 'End' : 'Start'} of any turn${count}`, whose: null, round: false };
    }
    if (entry.label === 'roundEnd' || entry.label === 'roundStart')
    {
        const left = roundsLeft(entry);
        const number = Number.isFinite(Number(entry.round)) && entry.round !== null ? ` ${entry.round}` : '';
        const count = left !== null ? ` (${plural(left, 'round')})` : '';
        return { text: `${entry.label === 'roundEnd' ? 'End' : 'Start'} of round${number}${count}`, whose: null, round: true };
    }
    if (entry.label === 'encounter')
        return { text: 'End of encounter', whose: null, round: false };
    if (entry.label === 'permanent')
        return { text: 'Permanent', whose: null, round: false };
    return { text: 'Indefinite', whose: null, round: false };
}

export function durationLines(effect)
{
    if (!getLAFlags(effect))
        return [];
    const holderIds = holderTokenIds(effect);
    const lines = [];
    for (const entry of durationEntries(effect))
    {
        const line = durationLine(entry, holderIds);
        const stack = Math.max(1, Number(entry.stack) || 1);
        const same = lines.find(other => other.text === line.text && other.whose === line.whose);
        if (same)
            same.stack += stack;
        else
            lines.push({ ...line, stack });
    }
    return lines;
}

export function durationText(effect)
{
    const lines = durationLines(effect);
    const counted = lines.length > 1;
    return lines.map(line => `${counted ? `×${line.stack} ` : ''}${line.text}${line.whose ? `, turn of ${line.whose}` : ''}`).join(' · ');
}

export function durationHtml(effect)
{
    const lines = durationLines(effect);
    const counted = lines.length > 1;
    const roundColor = roundBadgeColor();
    return lines.map(line =>
    {
        const style = line.round ? ` style="color:${roundColor};"` : '';
        const whose = line.whose ? `<div class="la-status-tooltip-whose">Turn of ${escapeHtml(line.whose)}</div>` : '';
        return `<div${style}>${counted ? `×${line.stack} ` : ''}${line.text}</div>${whose}`;
    }).join('');
}

/**
 * Detail line for the global bonus an effect is linked to, empty when it is not linked to one.
 * Uses are summed across the effects that collapse into one icon.
 */
export function linkedBonusText(actor, effect)
{
    const linkedBonusId = getLAFlags(effect)?.linkedBonusId;
    if (!linkedBonusId || !actor)
        return '';
    const bonuses = getGlobalBonuses(actor);
    const bonus = bonuses.find(entry => entry.id === linkedBonusId);
    if (!bonus)
        return '';
    return bonusText(bonus, actor, _collapsedUses(actor, effect, bonus, bonuses));
}

function _collapsedUses(actor, effect, bonus, bonuses)
{
    const base = getBonusUsesInfo(actor, bonus);
    if (!base || effect.flags?.statuscounter?.value == null)
        return base;
    let remaining = 0;
    let max = 0;
    for (const entry of iconGroupOf(actor, effect))
    {
        const linked = bonuses.find(candidate => candidate.id === getLAFlags(entry)?.linkedBonusId);
        if (linked?.uses === undefined)
            continue;
        remaining += effectStack(entry);
        max += Number(linked.uses) || 0;
    }
    return { label: `${remaining}/${max}`, onUse: base.onUse };
}

/** Detail line for a bonus object, with its uses when it has a count. `uses` overrides the bonus's own count. */
export function bonusText(bonus, actor = null, uses = getBonusUsesInfo(actor, bonus))
{
    if (!bonus)
        return '';
    const detail = bonus.type === 'multi' && Array.isArray(bonus.bonuses)
        ? bonus.bonuses.map(getBonusDetailString).join(' | ')
        : getBonusDetailString(bonus);
    if (!uses)
        return detail;
    return `${detail} <span class="la-status-tooltip-uses">[${uses.label}]</span>${uses.onUse ? ' [on-use]' : ''}`;
}

const ATTACHMENT_OWNERS = { mech: 'mech', pilot: 'pilot', npc: 'NPC', deployable: 'deployable' };
const ORIGIN_LINES = { hand: 'Added by hand.', automation: 'Added by automation.' };

export function itemAttachmentChips(item)
{
    if (item?.documentName !== 'Item')
        return [];
    const owner = ATTACHMENT_OWNERS[item.parent?.type] ?? 'actor';
    const bonuses = /** @type {any[]} */ (getLAFlags(item)?.bonusTemplates ?? []).map(template =>
    {
        const bonus = template.bonusData ?? {};
        const icon = bonus.icon || getBonusIcon(bonus);
        const text = bonusText(bonus, null, null);
        return { kind: 'bonus', origin: attachmentOrigin(template.addOptions?.addedViaUI), ...(String(icon).includes('/') ? { img: icon } : { icon }), title: bonus.name || text, text, tip: `${escapeHtml(text)}.` };
    });
    const statuses = /** @type {any[]} */ ([...(item.effects ?? [])])
        .filter(effect => getLAFlags(effect)?.isItemTemplate === true)
        .map(effect => ({ kind: 'status', origin: attachmentOrigin(getLAFlags(effect)?.addedViaUI), img: effect.img, title: effect.name, text: effect.name, tip: `On the ${owner} while this item is.` }));
    return [...bonuses, ...statuses];
}

export function sourceName(record)
{
    if (record?.dataSource?.name)
        return record.dataSource.name;
    const markers = record?.documentName ? getLAFlags(record) : record;
    const uuid = markers?.sourceItemUuid ?? markers?.sourceActorUuid;
    return uuid ? (/** @type {any} */ (fromUuidSync(uuid))?.name ?? '') : '';
}

function laStatusTextKey(id)
{
    const own = `LA.status.${id}.description`;
    if (game.i18n.has(own))
        return own;
    const short = `LA.statusShort.${id}`;
    return getModuleSetting('shortStatusTexts') && game.i18n.has(short) ? short : '';
}

export function statusConfigText(status)
{
    const key = laStatusTextKey(status?.id);
    if (key)
        return localize(key);
    return status?.description ? localize(status.description) : '';
}

/** Effect description, falling back to the status config it carries. */
export function descriptionHtml(effect)
{
    for (const id of effect?.statuses ?? [])
    {
        const key = laStatusTextKey(id);
        if (key)
            return localize(key);
    }
    // Foundry copies the CONFIG description onto the effect when it is applied, so an
    // applied effect carries whatever CONFIG held, key included.
    if (effect?.description)
        return localize(effect.description);
    for (const id of effect?.statuses ?? [])
    {
        const config = CONFIG.statusEffects.find(entry => entry.id === id);
        if (config?.description)
            return localize(config.description);
    }
    return '';
}

function valueStatusId(effect)
{
    return Object.keys(VALUE_STATUS_PATHS).find(statusId => effect?.statuses?.has(statusId)) ?? null;
}

function corePowerName(actor, effect)
{
    if (!effect?.statuses?.has('core_power_active'))
        return '';
    const core = actor?.system?.loadout?.frame?.value?.system?.core_system;
    return core?.active_name || core?.name || '';
}

/**
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @returns {StatusTooltipData}
 */
export function effectTooltipData(actor, effect)
{
    const valueId = valueStatusId(effect);
    return {
        name: effect?.name ?? '',
        count: instanceCount(actor, effect),
        value: valueId ? Number(foundry.utils.getProperty(actor, VALUE_STATUS_PATHS[valueId])) || 0 : null,
        valueColor: valueId ? VALUE_STATUS_COLORS[valueId] : undefined,
        core: corePowerName(actor, effect),
        duration: durationHtml(effect),
        bonus: linkedBonusText(actor, effect),
        frequency: linkedBonusFrequencyLabel(actor, effect),
        conditional: linkedBonusHasLambdaGate(actor, effect) ? linkedBonusConditionLines(actor, effect) : [],
        source: sourceName(effect),
        origin: itemAttachmentOrigin(effect),
        description: descriptionHtml(effect)
    };
}

/**
 * Appends the tooltip to the body. Caller owns removal.
 * @param {StatusTooltipData} data
 * @returns {HTMLElement}
 */
export function showStatusTooltip(data)
{
    const el = document.createElement('div');
    el.classList.add('la-status-tooltip');
    const count = data.count > 1 ? ` <span class="la-status-tooltip-count">&times;${data.count}</span>` : '';
    const value = data.value != null ? ` <span class="la-status-tooltip-value" style="color:${data.valueColor};">${data.value}</span>` : '';
    const parts = [`<div class="la-status-tooltip-name">${data.name ?? ''}${value}${count}</div>`];
    if (data.core)
        parts.push(`<div class="la-status-tooltip-core">${escapeHtml(data.core)}</div>`);
    if (data.duration)
        parts.push(`<div class="la-status-tooltip-duration">${data.duration}</div>`);
    if (data.bonus)
        parts.push(`<div class="la-status-tooltip-bonus">${data.bonus}</div>`);
    if (data.source)
        parts.push(`<div class="la-status-tooltip-source"><i class="fas fa-link"></i> ${escapeHtml(data.source)}</div>`);
    if (ORIGIN_LINES[data.origin])
        parts.push(`<div class="la-status-tooltip-meta">${ORIGIN_LINES[data.origin]}</div>`);
    if (data.condition)
        parts.push(`<div class="la-status-tooltip-cond${data.conditionMet ? '' : ' la-status-tooltip-cond--unmet'}"><i class="fas fa-code-branch"></i> ${escapeHtml(data.condition)}${data.conditionMet ? '' : ' · not met'}</div>`);
    if (data.replaced)
        parts.push('<div class="la-status-tooltip-meta">Replaced by automation.</div>');
    else if (data.off)
        parts.push('<div class="la-status-tooltip-off">Switched off. Right-click to turn it back on.</div>');
    if (data.frequency)
        parts.push(`<div class="la-status-tooltip-cond"><i class="fas fa-rotate-left"></i> ${data.frequency}</div>`);
    if (data.conditional?.length)
        parts.push('<div class="la-status-tooltip-cond"><i class="fas fa-code-branch"></i> Conditional</div>');
    if (data.description)
        parts.push(`<div class="la-status-tooltip-desc">${data.description}</div>`);
    el.innerHTML = parts.join('');
    document.body.appendChild(el);
    return el;
}

/** Places the tooltip below-right of the point, flipping when it would leave the viewport. */
export function moveStatusTooltip(el, clientX, clientY, gap = 14)
{
    if (!el)
        return;
    const rect = el.getBoundingClientRect();
    let left = clientX + gap;
    let top = clientY + gap;
    if (left + rect.width > window.innerWidth - 4)
        left = clientX - rect.width - gap;
    if (top + rect.height > window.innerHeight - 4)
        top = clientY - rect.height - gap;
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${Math.max(4, top)}px`;
}
