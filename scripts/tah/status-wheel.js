import { openRadialWheel, closeRadialWheel, isRadialWheelOpen, refreshRadialWheel } from '../tools/radial-wheel.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { laHudRenderIcon } from './item-helpers.js';
import { applyEffectsToTokens } from '../bonuses/flagged-effects.js';
import { removeGlobalBonus, getBonusIcon } from '../bonuses/genericBonuses.js';
import { isPermanentEffect, confirmPermanentRemoval } from './status-panel.js';
import { effectTooltipData, bonusText, showStatusTooltip, moveStatusTooltip, remainingTurns } from '../bonuses/status-tooltip.js';

import { MODULE_ID } from '../tools/constants.js';
const ICON_SIZE = 24;
// Matches Foundry's own tooltip dwell, the wheel is swept through so an instant tip would flicker.
const TIP_DELAY_MS = 500;

const ACTIVE_BG = '#b8d4f0';
const ACTIVE_BORDER = '#1a4a7a';
const PERM_BG = '#f0e0a0';
const PERM_BORDER = '#a07020';
const BONUS_BG = '#cbb6e8';
const BONUS_BORDER = '#4a2f7a';

let _openToken = null;
let _refreshTimer = null;
let _tip = null;
let _tipTimer = null;

const hasStatusCounter = () => !!game.modules.get('statuscounter')?.active;

const getStack = (effect) => hasStatusCounter() ? (effect.getFlag?.('statuscounter', 'value') ?? 1) : 1;

function statusFavorites()
{
    return new Set(/** @type {any} */ (getModuleSetting('tah.statusFavorites')) ?? []);
}

function liveEffects(actor)
{
    return /** @type {any[]} */ ([...actor.effects]).filter(effect => !effect.disabled);
}

function effectsForStatus(actor, statusId)
{
    return liveEffects(actor).filter(effect => effect.statuses?.has(statusId));
}

function effectsForCustom(actor, name)
{
    return liveEffects(actor).filter(effect =>
        effect.getFlag?.('temporary-custom-statuses', 'originalName') === name || effect.name === name);
}

// Mirrors the cyan token badge: stacked total with statuscounter, plain effect count without it.
function totalStack(effects)
{
    if (!effects.length)
        return 0;
    return hasStatusCounter() ? effects.reduce((sum, effect) => sum + getStack(effect), 0) : effects.length;
}

// Mirrors the gold token badge.
function leastTurns(effects)
{
    const values = effects.map(remainingTurns).filter(turns => turns > 0);
    return values.length ? Math.min(...values) : 0;
}

// Favorites, then permanents, then the rest. None of the three changes when a status is toggled,
// so slots hold still while the wheel is open.
function entryRank(entry)
{
    if (entry.favorite)
        return 0;
    return entry.permanent ? 1 : 2;
}

/**
 * Starred statuses show whether applied or not. Custom statuses and bonuses have no starred
 * list, so they only appear while applied.
 */
function collectEntries(actor)
{
    const favorites = statusFavorites();
    const entries = [];

    for (const status of (/** @type {any} */ (CONFIG).statusEffects ?? []))
    {
        if (!status.id)
            continue;
        const effects = effectsForStatus(actor, status.id);
        if (!effects.length && !favorites.has(status.id))
            continue;
        entries.push({
            kind: 'status',
            key: `status:${status.id}`,
            status,
            name: game.i18n.localize(status.name ?? status.id),
            icon: status.icon ?? status.img ?? '',
            favorite: favorites.has(status.id),
            effects,
        });
    }

    const customs = new Map();
    for (const effect of liveEffects(actor))
    {
        if (!effect.getFlag?.('temporary-custom-statuses', 'isCustom'))
            continue;
        const name = effect.getFlag('temporary-custom-statuses', 'originalName') || effect.name;
        if (!customs.has(name))
            customs.set(name, { kind: 'custom', key: `custom:${name}`, name, icon: effect.img ?? '', effects: [] });
        customs.get(name).effects.push(effect);
    }
    entries.push(...customs.values());

    // Constant bonuses carry no token icon on purpose, so they stay off a ring that shows what is applied.
    for (const bonus of /** @type {any[]} */ (getLAFlag(actor,'global_bonuses') || []))
    {
        entries.push({
            kind: 'bonus',
            key: `bonus:${bonus.id}`,
            name: bonus.name ?? 'Bonus',
            icon: bonus.icon || getBonusIcon(bonus),
            bonus,
            effects: [],
        });
    }

    for (const entry of entries)
    {
        entry.active = entry.kind === 'bonus' || entry.effects.length > 0;
        entry.permanent = isPermanentEffect(entry.effects);
    }
    entries.sort((a, b) => (entryRank(a) - entryRank(b)) || a.name.localeCompare(b.name));
    return entries;
}

async function applyStatus(tokens, entry)
{
    if (entry.kind === 'custom')
    {
        const api = /** @type {any} */ (game.modules.get('temporary-custom-statuses'))?.api;
        if (!api)
            return;
        for (const token of tokens)
            await api.addStatus(token.actor, entry.name, entry.icon, 1);
        return;
    }
    await applyEffectsToTokens({ tokens, effectNames: entry.status.name });
}

// Acts on every effect carrying the status: the subtype manager stays a status panel affair.
async function clearStatus(tokens, entry)
{
    if (!await confirmPermanentRemoval(entry.name, entry.effects))
        return;
    for (const token of tokens)
    {
        const effects = entry.kind === 'custom'
            ? effectsForCustom(token.actor, entry.name)
            : effectsForStatus(token.actor, entry.status.id);
        if (effects.length)
            await token.actor.deleteEmbeddedDocuments('ActiveEffect', effects.map(effect => effect.id));
    }
}

async function stepStack(entry, delta)
{
    const effect = entry.effects[0];
    const next = getStack(effect) + delta;
    await effect.update({ 'flags.statuscounter.value': next, 'flags.statuscounter.visible': next > 1 });
}

async function onLeftClick(tokens, entry)
{
    if (entry.kind === 'bonus')
        return;
    if (!entry.effects.length)
    {
        await applyStatus(tokens, entry);
        return;
    }
    if (hasStatusCounter() && entry.effects.length === 1)
    {
        await stepStack(entry, 1);
        return;
    }
    await clearStatus(tokens, entry);
}

async function onRightClick(tokens, entry)
{
    if (entry.kind === 'bonus')
    {
        for (const token of tokens)
            await removeGlobalBonus(token.actor, entry.bonus.id);
        return;
    }
    if (!entry.effects.length)
    {
        await applyStatus(tokens, entry);
        return;
    }
    if (hasStatusCounter() && entry.effects.length === 1 && getStack(entry.effects[0]) > 1)
    {
        await stepStack(entry, -1);
        return;
    }
    await clearStatus(tokens, entry);
}

// laHudRenderIcon treats any non-svg path as a font class, and custom statuses can carry a png.
function iconHtml(icon)
{
    if (icon?.includes('/') && !icon.endsWith('.svg'))
        return `<img class="la-hud-icon" src="${icon}" style="width:${ICON_SIZE}px;height:${ICON_SIZE}px;">`;
    return laHudRenderIcon(icon || 'fas fa-circle-dot', ICON_SIZE);
}

function styleFor(entry)
{
    if (entry.kind === 'bonus')
        return { bg: BONUS_BG, border: BONUS_BORDER };
    if (!entry.active)
        return null;
    return entry.permanent
        ? { bg: PERM_BG, border: PERM_BORDER }
        : { bg: ACTIVE_BG, border: ACTIVE_BORDER };
}

function hideTip()
{
    clearTimeout(_tipTimer);
    _tipTimer = null;
    _tip?.remove();
    _tip = null;
}

/** Same shape the canvas icon hover uses, so an effect reads the same in both places. */
function tooltipData(entry, actor)
{
    if (entry.kind === 'bonus')
        return { name: entry.name, bonus: bonusText(entry.bonus) };
    if (entry.effects.length)
        return effectTooltipData(actor, entry.effects[0]);
    // Starred but not applied: only the status config has anything to say.
    const description = entry.status?.description ? game.i18n.localize(entry.status.description) : '';
    return { name: entry.name, description };
}

function buildWheelItem(entry, tokens)
{
    const stack = totalStack(entry.effects);
    const turns = leastTurns(entry.effects);
    return {
        key: entry.key,
        title: entry.name,
        current: false,
        keepOpen: true,
        customTooltip: true,
        buildContent: (el) =>
        {
            el.classList.add('lancer-sw-btn');
            el.innerHTML = iconHtml(entry.icon);
            if (turns > 0)
                el.insertAdjacentHTML('beforeend', `<span class="lancer-sw-turns">${turns}</span>`);
            if (stack > 1)
                el.insertAdjacentHTML('beforeend', `<span class="lancer-sw-stack">${stack}</span>`);
            el.onmouseenter = () =>
            {
                hideTip();
                _tipTimer = setTimeout(() =>
                {
                    _tipTimer = null;
                    _tip = showStatusTooltip(tooltipData(entry, tokens[0]?.actor));
                    const rect = el.getBoundingClientRect();
                    moveStatusTooltip(_tip, rect.right, rect.top, 8);
                }, TIP_DELAY_MS);
            };
            el.onmouseleave = () => hideTip();
        },
        styleButton: (el) =>
        {
            const style = styleFor(entry);
            if (!style)
                return;
            el.classList.add('applied');
            el.style.setProperty('--sw-bg', style.bg);
            el.style.setProperty('--sw-border', style.border);
        },
        onSelect: async () =>
        {
            await onLeftClick(tokens, entry);
            rebuild();
        },
        onRightClick: async () =>
        {
            await onRightClick(tokens, entry);
            rebuild();
        },
    };
}

function wheelItems(token)
{
    const tokens = [token];
    return collectEntries(token.actor).map(entry => buildWheelItem(entry, tokens));
}

function rebuild()
{
    if (!_openToken || !isRadialWheelOpen())
        return;
    const items = wheelItems(_openToken);
    if (!items.length)
    {
        closeRadialWheel();
        return;
    }
    refreshRadialWheel(items);
}

export function toggleStatusWheel()
{
    if (isRadialWheelOpen())
    {
        closeRadialWheel();
        return;
    }
    if (!getModuleSetting('tahEnabled'))
    {
        ui.notifications.info('Enable the Token Action HUD to use the status wheel.');
        return;
    }
    const token = canvas.tokens?.controlled?.[0] ?? null;
    if (!token?.actor)
        return;
    const items = wheelItems(token);
    if (!items.length)
    {
        ui.notifications.info('No active or starred statuses. Star some in the Token Action HUD status panel.');
        return;
    }
    _openToken = token;
    openRadialWheel({
        token,
        rootClass: 'lancer-status-wheel',
        showLabel: true,
        onClose: () =>
        {
            hideTip();
            _openToken = null;
        },
        items,
    });
}

function scheduleWheelRefresh(changedDoc)
{
    if (!_openToken)
        return;
    const actor = changedDoc?.documentName === 'ActiveEffect' ? changedDoc.parent : changedDoc;
    if (!actor || actor !== _openToken.actor)
        return;
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => rebuild(), 100);
}

Hooks.on('createActiveEffect', (effect) => scheduleWheelRefresh(effect));
Hooks.on('deleteActiveEffect', (effect) => scheduleWheelRefresh(effect));
Hooks.on('updateActiveEffect', (effect) => scheduleWheelRefresh(effect));
Hooks.on('updateActor', (actor) => scheduleWheelRefresh(actor));
Hooks.on('deleteToken', (tokenDoc) =>
{
    if (_openToken && tokenDoc.id === _openToken.id)
        closeRadialWheel();
});

Hooks.once('init', () =>
{
    game.keybindings.register(MODULE_ID, 'statusWheel', {
        name: 'Status Wheel',
        hint: 'Open a radial wheel of the statuses on the selected token plus the ones starred in the HUD.',
        editable: [{ key: 'KeyG' }],
        onDown: () =>
        {
            if (!canvas.tokens?.controlled?.length)
                return false;
            toggleStatusWheel();
            return true;
        },
        repeat: false,
        precedence: foundry.helpers.interaction.ClientKeybindings?.PRECEDENCE?.PRIORITY ?? 2
    });
});
