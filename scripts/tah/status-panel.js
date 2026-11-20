/* global $, game, CONFIG */

import { removeGlobalBonus, removeConstantBonus, getBonusIcon, getBonusIconImage, getBonusDetailString, getBonusUsesInfo, isBonusRemovalPending, getV3DefenseRows, setItemBonusOff, isItemBonusOff, itemAttachmentOrigin } from '../bonuses/genericBonuses.js';
import { getBonusConditionHint, getBonusConditionLines, getBonusFrequencyLabel, hasLambdaGate } from '../bonuses/bonus-condition.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag, getLAFlags } from '../tools/flag-utils.js';
import { MODULE_ID, CUSTOM_STATUS_ICON } from '../tools/constants.js';
import { applyEffectsToTokens, effectStack, roundBadgeColor, statusBadge, isUsageEffect, isCustomStatusEffect } from '../bonuses/flagged-effects.js';
import { durationFieldsHtml, setupDurationUI, getDurationConfig, createDurationMarks } from '../bonuses/duration-widget.js';
import { hasPermanentEntry, remainingRounds } from '../bonuses/duration-clock.js';
import { isAutoEnabled } from '../fx/statusFX.js';
import { playUiSound } from './sound.js';
import { tahScale, laHudRenderIcon } from './item-helpers.js';
import { HudPanel } from './hud-panel.js';
import { openCursorMenu } from './cursor-menu.js';
import { localize, localizeFormat, escapeHtml } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { sourceName, remainingTurns, bonusText, showStatusTooltip, moveStatusTooltip, effectTooltipData, statusConfigText } from '../bonuses/status-tooltip.js';
import { v3ConditionLabel } from '../tools/v3-condition.js';
import { STATUS_GROUP_ORDER, NPC_TIER_IDS, statusGroupKey } from './status-groups.js';
import { getStoredPresets } from '../bonuses/effect-manager-widgets.js';

function getBonusDetailStr(/** @type {any} */ bonus)
{
    if (bonus.type === 'multi' && Array.isArray(bonus.bonuses))
        return bonus.bonuses.map(getBonusDetailStr).join(' | ');
    return getBonusDetailString(bonus);
}

/**
 * @param {any[]} effects
 * @returns {boolean} true when any of them is flagged permanent
 */
export function isPermanentEffect(effects)
{
    for (const effect of (effects ?? []))
    {
        const laFlags = getLAFlags(effect);
        const duration = laFlags?.duration ?? /** @type {any} */ (effect.flags)?.['csm-lancer-qol']?.duration;

        if (laFlags ? hasPermanentEntry(effect) : duration?.label === 'permanent')
            return true;
    }

    return false;
}

// A permanent effect is meant to stay, so dropping one asks first.
export async function confirmPermanentRemoval(label, effects)
{
    if (!isPermanentEffect(effects))
        return true;
    return await openCursorMenu({
        head: `${escapeHtml(label)} is permanent`,
        rows: [
            { value: true, label: localize('LA.common.remove'), glyph: '✕', cls: 'la-menu-popup-danger' },
            { value: false, label: localize('LA.common.keep') },
        ],
    }) === true;
}

export function setEffectStack(effect, value)
{
    return effect.update({ 'flags.statuscounter.value': value, 'flags.statuscounter.visible': value > 1 });
}

let _lastSearchQuery = '';
let _lastDurationLabel = null;

const BG_DEFAULT = 'var(--la-plate)';
const BG_HOVER   = 'color-mix(in srgb, var(--la-plate), #000 12%)';
// Row text: plate ink when inactive (flips with the plate), dark on the light active/permanent bg.
const FG_DEFAULT = 'var(--la-ink)';
const FG_ACTIVE  = '#111';
const PRESET_KINDS = ['standard', 'custom', 'bonus'];

function sectionCountHtml(count)
{
    return count ? `<span class="la-hud-section-count"> · ${count}</span>` : '';
}

const STAT_DRIVEN_STATUSES = {
    dangerzone: { auto: 'dangerZone' },
    burn: { auto: 'burn', value: actor => actor?.system?.burn },
    overshield: { auto: 'overshield', value: actor => actor?.system?.overshield?.value },
    infection: { auto: 'infection', value: actor => actor?.system?.infection },
    cascading: { auto: 'cascading' },
    core_power_active: {},
};

function leastPositive(values)
{
    const positive = values.filter(value => value > 0);
    return positive.length ? Math.min(...positive) : 0;
}

function tileBadgesHtml(effects)
{
    const instances = effects.length;
    const uses = effects.reduce((sum, effect) => sum + effectStack(effect), 0);
    const turns = leastPositive(effects.map(remainingTurns));
    const rounds = turns > 0 ? 0 : leastPositive(effects.map(remainingRounds));
    const parts = [];
    const tinted = (color) => `color:${color}; border-color:color-mix(in srgb, ${color} 55%, #000);`;

    if (turns > 0)
        parts.push(`<span class="la-tile-badge la-tile-badge--turns">${turns}</span>`);
    else if (rounds > 0)
        parts.push(`<span class="la-tile-badge la-tile-badge--turns" style="${tinted(roundBadgeColor())}">${rounds}</span>`);

    const badge = statusBadge({ instances, uses, usage: effects.some(isUsageEffect) });

    if (badge)
    {
        parts.push(`<span class="la-tile-badge la-tile-badge--stack" style="${tinted(badge.color)}">${badge.count}</span>`);
        if (badge.uses !== null)
            parts.push(`<span class="la-tile-badge la-tile-badge--uses" style="${tinted(badge.usesColor)}">${badge.uses}</span>`);
    }

    if (isPermanentEffect(effects))
        parts.push('<span class="la-tile-badge la-tile-badge--perm"><i class="fas fa-lock"></i></span>');
    return parts.join('');
}

function followsStat(statusId, active)
{
    const driven = STAT_DRIVEN_STATUSES[statusId];
    return !!driven && active && (!driven.auto || isAutoEnabled(driven.auto));
}

function tileMarksHtml(actor, statusId, active)
{
    if (!followsStat(statusId, active))
        return '';

    const value = Number(STAT_DRIVEN_STATUSES[statusId].value?.(actor)) || 0;
    return `${value > 0 ? `<span class="la-status-value">${value}</span>` : ''}<span class="la-status-auto">A</span>`;
}

function paintTile(rowEl, actor, statusId, effects, holders = 0, total = 1)
{
    const iconEl = rowEl.find('.la-status-icon');
    iconEl.children('.la-tile-badge').remove();
    iconEl.append(tileBadgesHtml(effects));
    const partial = total > 1 && holders > 0 && holders < total;
    rowEl.toggleClass('la-hud-status-row--partial', partial);
    rowEl.find('.la-status-marks').html(`${tileMarksHtml(actor, statusId, effects.length > 0)}${partial ? `<span class="la-status-part">${holders}/${total}</span>` : ''}`);
}

function holderCount(tokens, statusId)
{
    return tokens.filter(token => [...(token?.actor?.effects ?? [])].some(effect => effect.statuses?.has(statusId) && !effect.disabled)).length;
}

function refreshTileState(rowEl, actor, tokens, statusId)
{
    const effects = /** @type {any[]} */ ([...actor.effects]).filter(effect => effect.statuses?.has(statusId) && !effect.disabled);
    const total = tokens.length;
    const holders = total > 1 ? holderCount(tokens, statusId) : Number(effects.length > 0);
    setRowActive(rowEl, holders > 0 || effects.length > 0, effects.length > 0 && isPermanentEffect(effects));
    paintTile(rowEl, actor, statusId, effects, holders, total);
}

// active-row colors: yellow when any active effect is permanent, blue otherwise
function rowColors(active, perm = false)
{
    return {
        background: active ? (perm ? '#f0e0a0' : '#b8d4f0') : BG_DEFAULT,
        borderLeftColor: active ? (perm ? '#a07020' : '#1a4a7a') : 'transparent',
        color: active ? FG_ACTIVE : FG_DEFAULT,
    };
}

function setRowActive(rowEl, active, perm = false)
{
    rowEl.data('active', active);
    rowEl.data('permanent', active && perm);
    rowEl.css(rowColors(active, perm));
}

export class StatusPanel extends HudPanel
{
    constructor(options)
    {
        super(options);
        const { token, tokens, incDepth, decDepth, suppressCollapse, extendCollapse } = options;
        this._tokens           = tokens ?? [token];
        this._incDepth         = incDepth;
        this._decDepth         = decDepth;
        this._suppressCollapse = suppressCollapse;
        this._extendCollapse   = extendCollapse;

        this._subtypePanel = null;
        this._durMarks     = null;
        this._afterRowSync = null;
    }

    async _applyWithDuration(status)
    {
        const { duration, originID } = getDurationConfig(this._panel, 'la-sdur');
        const customEffect = { name: status.name, icon: status.icon, isCustom: true, ...(status.description ? { description: status.description } : {}) };
        await applyEffectsToTokens({
            tokens: this._tokens,
            effectNames: status.isCustom ? customEffect : status.name,
            duration: { ...duration, overrideTurnOriginId: originID },
        });
    }

    close()
    {
        this._suppressCollapse?.(false);
        this._durMarks?.destroy();
        this._durMarks = null;
        document.querySelectorAll('.la-status-tooltip').forEach(node => node.remove());

        if (this._subtypePanel)
        {
            this._subtypePanel.remove();
            this._subtypePanel = null;
        }

        super.close();
    }

    syncRows()
    {
        if (!this._panel || !this._actor)
            return;

        const actor = this._actor;
        const tokens = this._tokens;
        this._panel.find('[data-status-id]').each(function()
        {
            refreshTileState($(this), actor, tokens, $(this).attr('data-status-id'));
        });
        this._afterRowSync?.();
    }

    open(anchorRow)
    {
        document.querySelectorAll('.la-status-tooltip').forEach(node => node.remove());
        this._resetPanel(anchorRow);
        const actor = this._actor;
        const token = this._token;

        if (!actor || !token)
            return;

        const hasTempCustomStatuses = !!game.modules.get('temporary-custom-statuses')?.active;
        const savedStatuses = hasTempCustomStatuses ? (game.settings.get('temporary-custom-statuses', 'savedStatuses') ?? []) : [];

        const activeCustomEffects = hasTempCustomStatuses
            ? /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ eff =>
                eff.getFlag?.('temporary-custom-statuses', 'isCustom') &&
                !getLAFlag(eff,'linkedBonusId')
            )
            : [];

        const customMap = new Map();
        savedStatuses.forEach(/** @type {any} */ saved => customMap.set(saved.name, { name: saved.name, icon: saved.icon, description: saved.description }));
        activeCustomEffects.forEach(/** @type {any} */ eff =>
        {
            const name = eff.getFlag?.('temporary-custom-statuses', 'originalName') || eff.name;
            if (!customMap.has(name))
                customMap.set(name, { name, icon: eff.img ?? '' });
        });

        const customSaved = [...customMap.values()];

        // favorites first, then the Lancer groups, alphabetic within each group
        const readFavorites = () =>
        {
            return new Set(getModuleSetting('tah.statusFavorites') ?? []);
        };

        const favoriteIds = readFavorites();

        const toggleStatusFavorite = async (/** @type {string} */ statusId) =>
        {
            const current = readFavorites();
            const nowFav = !current.has(statusId);

            if (nowFav)
                current.add(statusId);
            else
                current.delete(statusId);
            await game.settings.set(MODULE_ID,'tah.statusFavorites', [...current]);
            return nowFav;
        };

        const activeStatusIds = new Set();

        for (const eff of /** @type {any} */ (actor.effects))
        {
            if (eff.disabled)
                continue;
            for (const statusId of (eff.statuses ?? []))
                activeStatusIds.add(statusId);
        }

        const anyNpc = this._tokens.some(selected => selected?.actor?.is_npc?.());
        const statusLabel = (/** @type {any} */ status) => localize(status.name ?? status.id);

        // TCS mirrors its saved list into CONFIG, the Custom group owns those rows
        const allStatuses = (/** @type {any} */ (CONFIG).statusEffects ?? [])
            .filter(/** @type {any} */ status => status.id && !status.tcsCustom
                && (anyNpc || !NPC_TIER_IDS.has(status.id) || activeStatusIds.has(status.id)));

        const groupOrder = STATUS_GROUP_ORDER.flatMap(groupKey => (groupKey === 'favorites' ? [groupKey, 'custom'] : [groupKey]));
        const statusGroups = new Map(groupOrder.map(groupKey => [groupKey, /** @type {any[]} */ ([])]));
        for (const status of allStatuses)
            statusGroups.get(favoriteIds.has(status.id) ? 'favorites' : statusGroupKey(status.id))?.push(status);

        const gridIds = new Set(allStatuses.map(/** @type {any} */ status => status.id));
        const customEntry = (/** @type {any} */ custom) => ({ id: custom.name.slugify(), name: custom.name, icon: custom.icon || CUSTOM_STATUS_ICON, description: custom.description, isCustom: true });

        for (const custom of customSaved.map(customEntry).filter(entry => entry.id && !gridIds.has(entry.id)))
            statusGroups.get(favoriteIds.has(custom.id) ? 'favorites' : 'custom').push(custom);
        for (const members of statusGroups.values())
            members.sort((aStatus, bStatus) => statusLabel(aStatus).localeCompare(statusLabel(bStatus), game.i18n.lang));
        if (hasTempCustomStatuses)
            statusGroups.get('custom').push({ newTile: true });

        const getEffectsForStatus = (/** @type {string} */ statusId) =>
            /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ eff => eff.statuses?.has(statusId) && !eff.disabled);

        const getStack = effectStack;

        const statusTooltipData = (/** @type {any} */ status, /** @type {any[]} */ effects) =>
        {
            const description = statusConfigText(status);
            const autoHint = followsStat(status.id, effects.length > 0) ? localize(`LA.tokenHud.statusAuto.${status.id}`) : '';

            if (!effects.length && !description)
                return null;

            const data = effects.length ? effectTooltipData(actor, effects[0]) : { name: escapeHtml(statusLabel(status)), description };
            if (autoHint)
                data.description = `<div class="la-status-tooltip-cond">${escapeHtml(autoHint)}</div>${data.description ?? ''}`;
            return data;
        };

        const showTooltip =(/** @type {any} */ rowEl, /** @type {any} */ spec) =>
        {
            const data = spec.tooltipData();
            if (!data)
                return null;

            const tooltipEl = showStatusTooltip(data);
            const rowRect = /** @type {HTMLElement} */ (rowEl[0]).getBoundingClientRect();
            moveStatusTooltip(tooltipEl, rowRect.right, rowRect.top, 8);
            return tooltipEl;
        };

        const bindStatusRow = (rowEl, spec) =>
        {
            let tooltipEl = /** @type {any} */ (null);
            let tooltipTimer = null;
            rowEl.on('mouseenter', function()
            {
                playUiSound('statusHover');
                if (!$(this).data('active'))
                    $(this).css({ background: BG_HOVER, borderLeftColor: 'var(--la-edge)' });

                const self = $(this);
                tooltipTimer = setTimeout(() =>
                {
                    tooltipEl = showTooltip(self, spec);
                }, 500);

                const clip = self.find('.la-hud-clip')[0];
                const pan  = self.find('.la-hud-pan')[0];

                if (clip && pan)
                {
                    const overflow = pan.scrollWidth - clip.clientWidth;
                    if (overflow > 4)
                        $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                }
            }).on('mouseleave', function()
            {
                clearTimeout(tooltipTimer); tooltipTimer = null;
                tooltipEl?.remove(); tooltipEl = null;
                $(this).css(rowColors($(this).data('active'), $(this).data('permanent')));
                $(this).find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
            });

            rowEl.on('click', async () =>
            {
                playUiSound('toggle');
                const effects = spec.getEffects();

                if (effects.length > 1)
                {
                    this._openSubtypeManager(actor, spec.subtypeStatus, effects, rowEl);
                    return;
                }

                this._incDepth();

                try
                {
                    if (effects.length === 1)
                        await setEffectStack(effects[0], getStack(effects[0]) + 1);
                    else
                        await this._applyWithDuration(spec.applyStatus);
                    spec.updateRow();
                }
                finally
                {
                    this._decDepth();
                }
            });

            rowEl.on('contextmenu', async (ev) =>
            {
                ev.preventDefault();

                if (ev.ctrlKey && spec.onCtrlRightClick)
                {
                    await spec.onCtrlRightClick();
                    return;
                }

                playUiSound('toggle');
                const effects = spec.getEffects();

                if (effects.length > 1)
                {
                    this._openSubtypeManager(actor, spec.subtypeStatus, effects, rowEl);
                    return;
                }

                this._incDepth();

                try
                {
                    const stack = effects.length ? getStack(effects[0]) : 0;

                    if (!effects.length)
                        await this._applyWithDuration(spec.applyStatus);
                    else if (stack > 1)
                        await setEffectStack(effects[0], stack - 1);
                    else
                    {
                        if (!await confirmPermanentRemoval(spec.name, effects))
                            return;
                        await actor.deleteEmbeddedDocuments('ActiveEffect', [effects[0].id]);

                        for (const token of this._tokens.slice(1))
                        {
                            const tokenEff = [...token.actor.effects].find(spec.matchesOther);
                            if (tokenEff)
                                await token.actor.deleteEmbeddedDocuments('ActiveEffect', [tokenEff.id]);
                        }
                    }

                    spec.updateRow();
                }
                finally
                {
                    this._decDepth();
                }
            });
        };

        const searchBar = $(htmlToElement(`<input type="text" class="la-status-search" placeholder="${localize('LA.tokenHud.searchStatuses')}">`));
        const searchWrap = $(htmlToElement(`<div class="la-status-search-wrap"><i class="fas fa-search la-status-search-icon"></i><i class="fas fa-xmark la-status-search-clear" data-tooltip="${escapeHtml(localize('LA.tokenHud.clearSearch'))}"></i></div>`));
        searchWrap.append(searchBar);
        const sideRows = [];

        searchBar.val(_lastSearchQuery);
        const durTool = $(durationFieldsHtml('la-sdur', this._token?.id));
        const durSelect = durTool.find('#la-sdur-duration');
        const defaultDuration = String(durSelect.val());

        if (_lastDurationLabel && durTool.find(`#la-sdur-duration option[value="${_lastDurationLabel}"]`).length)
            durSelect.val(_lastDurationLabel);

        const markDuration = () => durSelect.toggleClass('la-dur-select--set', String(durSelect.val()) !== defaultDuration);
        durSelect.on('change', function ()
        {
            _lastDurationLabel = String($(this).val());
            markDuration();
        });
        markDuration();
        const searchRow = $(htmlToElement(`<div class="la-status-search-row"></div>`));
        const helpTip = htmlToElement(`<i class="fas fa-question la-status-help" data-tooltip="${localize('LA.tokenHud.statusHelp')}"></i>`);
        searchRow.append(searchWrap, durTool, helpTip);

        const refreshDurMarks = () =>
        {
            this._durMarks ??= createDurationMarks();
            const label = String(durTool.find('#la-sdur-duration').val());
            const turnBased = label === 'end' || label === 'start';
            const originToken = turnBased ? (game.canvas?.tokens?.get(String(durTool.find('#la-sdur-origin').val())) ?? null) : null;
            this._durMarks.update({ targetTokens: this._tokens, originToken });
        };

        setupDurationUI(durTool, 'la-sdur', {
            onChange: () =>
            {
                this._suppressCollapse?.(false);
                refreshDurMarks();
            },
            onPickStart: () =>
            {
                this._suppressCollapse?.(true);
                this._durMarks?.destroy();
            },
        });
        searchRow.on('click mousedown', (ev) =>
        {
            ev.stopPropagation();
            this._cancelCollapse?.();
            this._extendCollapse?.();
        });
        refreshDurMarks();

        const gridEl = $(htmlToElement(`<div class="lancer-scroll la-hud-status-grid"></div>`));
        const rowByStatus = new Map();

        const getCustomEffects = (/** @type {string} */ name) =>
            /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ eff => isCustomStatusEffect(eff, name) && !eff.disabled);

        const customTooltipData = (/** @type {any} */ status) =>
        {
            const effects = getCustomEffects(status.name);
            if (effects.length)
                return effectTooltipData(actor, effects[0]);
            return status.description ? { name: escapeHtml(status.name), description: status.description } : null;
        };

        const buildTile = (/** @type {any} */ status) =>
        {
            const rowEl = $(htmlToElement(`<div class="la-hud-status-row" data-status-id="${escapeHtml(status.id)}">
                <span class="la-status-icon"><img class="la-status-row__img" src="${escapeHtml(status.icon ?? status.img ?? '')}" onerror="this.style.display='none'"></span>
                <span class="la-status-name la-hud-clip"><span class="la-hud-pan">${escapeHtml(localize(status.name ?? status.id))}</span></span>
                <span class="la-status-marks"></span>
            </div>`));

            refreshTileState(rowEl, actor, this._tokens, status.id);
            if (favoriteIds.has(status.id))
                rowEl.css('position', 'relative').append('<span class="la-hud-fav-mark">★</span>');

            const lookup = status.isCustom
                ? {
                    tooltipData: () => customTooltipData(status),
                    subtypeStatus: { id: status.name, name: status.name, icon: status.icon },
                    getEffects: () => getCustomEffects(status.name),
                    matchesOther: (/** @type {any} */ candidate) => isCustomStatusEffect(candidate, status.name),
                }
                : {
                    tooltipData: () => statusTooltipData(status, getEffectsForStatus(status.id)),
                    subtypeStatus: status,
                    getEffects: () => getEffectsForStatus(status.id),
                    matchesOther: (/** @type {any} */ matchingEff) => matchingEff.statuses?.has(status.id) && !matchingEff.disabled,
                };

            bindStatusRow(rowEl, {
                ...lookup,
                name: statusLabel(status),
                applyStatus: status,
                updateRow: () =>
                {
                    refreshTileState(rowEl, actor, this._tokens, status.id);
                    this._afterRowSync?.();
                },
                onCtrlRightClick: async () =>
                {
                    const nowFav = await toggleStatusFavorite(status.id);
                    playUiSound('toggle');
                    rowEl.find('.la-hud-fav-mark').remove();
                    if (nowFav)
                        rowEl.css('position', 'relative').append('<span class="la-hud-fav-mark">★</span>');
                },
            });

            return rowEl;
        };

        const addNewStatus = async (/** @type {string} */ name, /** @type {any} */ newTileEl) =>
        {
            const status = customEntry({ name });
            this._incDepth();

            try
            {
                await this._applyWithDuration(status);
            }
            finally
            {
                this._decDepth();
            }

            const existing = gridEl.find(`[data-status-id="${CSS.escape(status.id)}"]`);

            if (existing.length)
                refreshTileState(existing, actor, this._tokens, status.id);
            else
            {
                const rowEl = buildTile(status);
                newTileEl.before(rowEl);
                customSection?.rows.splice(-1, 0, rowEl[0]);
            }

            this._afterRowSync?.();
        };

        const editNewStatus = (/** @type {any} */ newTileEl) =>
        {
            const nameEl = newTileEl.find('.la-status-name');
            if (!nameEl.length)
                return;

            playUiSound('toggle');
            this._suppressCollapse?.(true);
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'la-status-newtile__input';
            input.placeholder = localize('LA.tokenHud.newStatusName');
            nameEl.replaceWith(input);
            input.focus();

            const plus = newTileEl.find('.la-status-newtile__icon');
            newTileEl.addClass('la-status-newtile--editing');
            plus.attr('data-tooltip', localize('LA.common.add'));

            let finished = false;

            const finish = () =>
            {
                if (finished)
                    return;
                finished = true;
                input.replaceWith(nameEl[0]);
                newTileEl.removeClass('la-status-newtile--editing');
                plus.removeAttr('data-tooltip').off('.laNewStatus');
                this._suppressCollapse?.(false);
            };

            const submit = async () =>
            {
                const name = input.value.trim();

                if (!name)
                {
                    input.focus();
                    return;
                }

                finish();
                await addNewStatus(name, newTileEl);
            };

            plus.on('mousedown.laNewStatus', ev => ev.preventDefault());
            plus.on('click.laNewStatus', async (ev) =>
            {
                ev.stopPropagation();
                await submit();
            });

            input.addEventListener('click', ev => ev.stopPropagation());
            input.addEventListener('blur', finish);
            input.addEventListener('keydown', async (ev) =>
            {
                ev.stopPropagation();

                if (ev.key === 'Escape')
                    finish();
                else if (ev.key === 'Enter')
                    await submit();
            });
        };

        const buildNewTile = () =>
        {
            const rowEl = $(htmlToElement(`<div class="la-hud-status-row la-status-newtile">
                <span class="la-status-icon"><i class="fas fa-plus la-status-newtile__icon"></i></span>
                <span class="la-status-name la-hud-clip"><span class="la-hud-pan">${escapeHtml(localize('LA.tokenHud.newStatus'))}</span></span>
            </div>`));

            rowEl.css(rowColors(false));
            rowEl.on('mouseenter', () => playUiSound('statusHover'));
            rowEl.on('click', () => editNewStatus(rowEl));
            return rowEl;
        };

        for (const status of [...statusGroups.values()].flat())
        {
            const rowEl = status.newTile ? buildNewTile() : buildTile(status);
            gridEl.append(rowEl);
            rowByStatus.set(status, rowEl[0]);
        }

        const gridSections = [...statusGroups].filter(([, members]) => members.length).map(([groupKey, members]) =>
        {
            const rows = members.map(status => rowByStatus.get(status));
            const label = htmlToElement(`<div class="la-hud-status-section">${escapeHtml(localize(`LA.tokenHud.statusGroup.${groupKey}`))}</div>`);
            rows[0].before(label);
            return { key: groupKey, label, rows };
        });
        const customSection = gridSections.find(section => section.key === 'custom');

        let onlyActive = false;

        const applyGridFilter = () =>
        {
            const query = _lastSearchQuery.toLowerCase().trim();

            for (const section of gridSections)
            {
                let anyShown = false;

                for (const row of section.rows)
                {
                    const name = $(row).find('.la-status-name').text().toLowerCase();
                    const shown = (!query || name.includes(query)) && (!onlyActive || !!$(row).data('active'));
                    row.style.display = shown ? '' : 'none';
                    if (shown)
                        anyShown = true;
                }

                section.label.style.display = anyShown ? '' : 'none';
            }

            for (const entry of sideRows)
                entry.el.style.display = !query || entry.text.includes(query) ? '' : 'none';
            searchWrap.toggleClass('has-query', !!query);
        };

        const rightEl = $(htmlToElement(`<div class="la-hud-right-col"></div>`));

        const laApi = /** @type {any} */ (game.modules.get(MODULE_ID))?.api;

        if (laApi?.executeEffectManager)
        {
            const effectManagerBtn = $(htmlToElement(`<button class="la-hud-util-btn">Effect Manager</button>`));
            effectManagerBtn.on('mouseenter', () => playUiSound('statusHover'));
            effectManagerBtn.on('click', () =>
            {
                playUiSound('toggle'); laApi.executeEffectManager();
            });
            rightEl.append(effectManagerBtn);
        }

        const clearBtn = $(htmlToElement(`<button class="la-hud-util-btn la-hud-util-btn--secondary">Clear All Effects</button>`));
        clearBtn.on('mouseenter', () => playUiSound('statusHover'));
        clearBtn.on('click', async () =>
        {
            playUiSound('toggle');
            const allEffects = /** @type {any[]} */ ([...actor.effects]);
            if (!allEffects.length)
                return;

            const permanentCount = allEffects.filter(eff => isPermanentEffect([eff])).length;

            const head = escapeHtml(localizeFormat('LA.tokenHud.clearAllHead', { count: allEffects.length, name: token.name }))
                + (permanentCount ? `<br><small>${escapeHtml(localizeFormat('LA.tokenHud.clearAllPermanent', { count: permanentCount }))}</small>` : '');

            const confirmed = await openCursorMenu({
                head,
                rows: [
                    { value: true, label: localize('LA.common.remove'), glyph: '✕', cls: 'la-menu-popup-danger' },
                    { value: false, label: localize('LA.common.keep') },
                ],
            }) === true;

            if (!confirmed)
                return;
            this._incDepth();

            try
            {
                await actor.deleteEmbeddedDocuments('ActiveEffect', allEffects.map(eff => eff.id).filter(id => actor.effects.has(id)));
                this.syncRows();
            }
            finally
            {
                this._decDepth();
            }
        });
        rightEl.append(clearBtn);

        if (laApi?.executeEffectManager)
        {
            const storedPresets = getStoredPresets();
            const presets = PRESET_KINDS.flatMap(category => storedPresets[category].map(preset => ({ category, name: preset.name, data: preset.data ?? {} })));

            const presetIcon = (/** @type {any} */ preset) =>
            {
                if (preset.category === 'custom')
                    return preset.data['cust-icon'] || CUSTOM_STATUS_ICON;
                if (preset.category === 'bonus')
                    return getBonusIconImage({ type: preset.data['bonus-type'], subtype: preset.data['bonus-movement-subtype'] });

                const status = /** @type {any[]} */ (CONFIG.statusEffects).find(entry => entry.id === preset.data['std-effect'] || entry.name === preset.data['std-effect']);
                return status?.img ?? status?.icon ?? CUSTOM_STATUS_ICON;
            };

            rightEl.append(htmlToElement(`<div class="la-hud-panel-section-header">${escapeHtml(localize('LA.tokenHud.presets'))}${sectionCountHtml(presets.length)}</div>`));
            const presetListEl = $(htmlToElement(`<div class="lancer-scroll la-hud-preset-list"></div>`));

            for (const preset of presets)
            {
                const row = $(htmlToElement(`<div class="la-hud-status-row la-hud-status-row--compact la-hud-preset-row la-hud-preset-row--${preset.category}" data-tooltip="${escapeHtml(localize('LA.tokenHud.presetHint'))}">
                    <img class="la-status-row__img" src="${escapeHtml(presetIcon(preset))}" onerror="this.style.display='none'">
                    <span class="la-status-name la-hud-clip"><span class="la-hud-pan">${escapeHtml(preset.name)}</span></span>
                    <span class="la-status-badge">${escapeHtml(localize(`LA.tokenHud.presetKind.${preset.category}`))}</span>
                </div>`));

                const openPreset = (/** @type {boolean} */ apply) => laApi.executeEffectManager({ actor, preset: { category: preset.category, name: preset.name, apply } });

                row.on('mouseenter', () => playUiSound('statusHover'));
                row.on('click', () =>
                {
                    playUiSound('toggle');
                    openPreset(true);
                });
                row.on('contextmenu', (ev) =>
                {
                    ev.preventDefault();
                    playUiSound('toggle');
                    openPreset(false);
                });

                sideRows.push({ el: row[0], text: preset.name.toLowerCase() });
                presetListEl.append(row);
            }

            if (!presets.length)
                presetListEl.append(htmlToElement(`<div class="la-status-empty">${escapeHtml(localize('LA.tokenHud.noPresets'))}</div>`));
            rightEl.append(presetListEl);
        }

        const globalBonuses = /** @type {any[]} */ (getLAFlag(actor,'global_bonuses') || [])
            .filter((/** @type {any} */ bonus) => !isBonusRemovalPending(actor, bonus.id));

        const constantBonuses = /** @type {any[]} */ (getLAFlag(actor,'constant_bonuses') || []);

        const allBonuses = [
            ...globalBonuses.map((/** @type {any} */ bonus, i) => ({ bonus, kind: 'global', idx: i, off: isItemBonusOff(actor, bonus), inactive: false })),
            ...constantBonuses.map((/** @type {any} */ bonus, i) => ({ bonus, kind: 'constant', idx: i, off: isItemBonusOff(actor, bonus), inactive: false })),
            ...getV3DefenseRows(actor).map(({ bonus, off, inactive, replaced }, i) => ({ bonus, kind: 'data', idx: i, off, inactive, replaced })),
        ];

        const bonusHeader = $(htmlToElement(`<div class="la-hud-panel-section-header">Bonuses${sectionCountHtml(allBonuses.length)}</div>`));
        rightEl.append(bonusHeader);
        const bonusListEl = $(htmlToElement(`<div class="lancer-scroll la-bonus-list"></div>`));

        if (!allBonuses.length)
            bonusListEl.append(htmlToElement(`<div class="la-status-empty">No bonuses</div>`));
        else
        {
            for (const { bonus, kind, off, inactive, replaced } of allBonuses)
            {
                const detail = getBonusDetailStr(bonus);
                const switchable = !replaced && (kind === 'data' || !!bonus.sourceItemUuid);
                const switchClass = kind === 'data' ? 'la-bonus-toggle' : 'la-bonus-switch';

                let actionIcon = switchable
                    ? `<i class="la-bonus-del ${switchClass} fas ${off ? 'fa-toggle-off' : 'fa-toggle-on'}" title="${off ? 'Switch on' : 'Switch off'}"></i>`
                    : '<i class="la-bonus-del fas fa-trash" title="Delete bonus"></i>';

                if (replaced)
                    actionIcon = '<i class="la-bonus-swap fas fa-right-left"></i>';

                const dataCondition = bonus.dataCondition ? `while ${v3ConditionLabel(bonus.dataCondition)}` : '';
                const condHint = getBonusConditionHint(bonus) || dataCondition;
                const condMark = condHint ? `<i class="fas fa-code-branch la-bonus-row__cond${dataCondition ? ' la-bonus-row__cond--data' : ''}"></i>` : '';
                const uses = getBonusUsesInfo(actor, bonus);
                const usesBadge = uses ? `<span class="la-bonus-row__uses">${escapeHtml(uses.label)}</span>` : '';
                const origin = itemAttachmentOrigin(bonus);
                const laMark = origin ? `<span class="la-bonus-row__mark">L.A</span>${origin === 'automation' ? '<i class="fas fa-gear la-bonus-row__auto"></i>' : ''}` : '';

                const row = $(htmlToElement(`<div class="la-bonus-row la-bonus-row--${kind}${off && !replaced ? ' la-bonus-row--off' : ''}${replaced ? ' la-bonus-row--replaced' : ''}${inactive ? ' la-bonus-row--unmet' : ''}">
                    ${laHudRenderIcon(bonus.icon || getBonusIcon(bonus))}
                    <span class="la-hud-clip la-bonus-row__name"><span class="la-hud-pan">${escapeHtml(bonus.name)}</span></span>
                    ${actionIcon}
                    <span class="la-bonus-row__sub">${laMark}${condMark}<span class="la-bonus-row__detail">${escapeHtml(detail)}</span>${usesBadge}</span>
                </div>`));

                sideRows.push({ el: row[0], text: `${bonus.name} ${detail} ${sourceName(bonus)}`.toLowerCase() });
                let tipTimer = null;
                let tip = null;

                const hideBonusTip = () =>
                {
                    clearTimeout(tipTimer);
                    tipTimer = null;
                    tip?.remove();
                    tip = null;
                };

                row.on('mouseenter', () =>
                {
                    const clip = row.find('.la-hud-clip')[0];
                    const pan  = row.find('.la-hud-pan')[0];

                    if (clip && pan)
                    {
                        const overflow = pan.scrollWidth - clip.clientWidth;
                        if (overflow > 4)
                            $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                    }

                    tipTimer = setTimeout(() =>
                    {
                        tip = showStatusTooltip({
                            name: escapeHtml(bonus.name),
                            bonus: bonusText(bonus, actor),
                            source: sourceName(bonus),
                            origin,
                            condition: dataCondition,
                            conditionMet: !inactive,
                            replaced,
                            frequency: getBonusFrequencyLabel(bonus),
                            conditional: hasLambdaGate(bonus) ? getBonusConditionLines(bonus) : [],
                        });

                        const rect = row[0].getBoundingClientRect();
                        moveStatusTooltip(tip, rect.right, rect.top, 8);
                    }, 500);
                }).on('mouseleave', () =>
                {
                    hideBonusTip();
                    row.find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
                });

                const removeRow = () =>
                {
                    row.remove();
                    bonusHeader.find('.la-hud-section-count').remove();
                    bonusHeader.append(sectionCountHtml(bonusListEl.children('.la-bonus-row').length));
                    if (!bonusListEl.children().length)
                        bonusListEl.append(htmlToElement(`<div class="la-status-empty">No bonuses</div>`));
                };

                if (bonus.uses !== undefined)
                {
                    const linkedEffects = () => /** @type {any[]} */ ([...actor.effects]).filter(eff => getLAFlag(eff, 'linkedBonusId') === bonus.id && !eff.disabled);

                    const stepUses = async (delta) =>
                    {
                        const linked = linkedEffects();
                        const target = delta > 0 ? linked[0] : linked.at(-1);

                        if (!target)
                            return;
                        hideBonusTip();
                        playUiSound('toggle');
                        this._incDepth();

                        try
                        {
                            const stack = effectStack(target);

                            if (delta > 0 || stack > 1)
                            {
                                await setEffectStack(target, stack + delta);
                                row.find('.la-bonus-row__uses').text(getBonusUsesInfo(actor, bonus)?.label ?? '');
                                return;
                            }

                            if (!await confirmPermanentRemoval(bonus.name, [target]))
                                return;
                            await actor.deleteEmbeddedDocuments('ActiveEffect', [target.id]);
                            removeRow();
                        }
                        finally
                        {
                            this._decDepth();
                        }
                    };

                    row.addClass('la-bonus-row--limited');
                    row.on('click', () => stepUses(1));
                    row.on('contextmenu', (ev) =>
                    {
                        ev.preventDefault();
                        stepUses(-1);
                    });
                }

                row.find('.la-bonus-del').on('mouseenter', function()
                {
                    $(this).css('opacity', '1');
                })
                    .on('mouseleave', function()
                    {
                        $(this).css('opacity', '0.45');
                    })
                    .on('click', async (ev) =>
                    {
                        ev.stopPropagation();
                        hideBonusTip();

                        if (switchable)
                        {
                            const nowOff = !row.hasClass('la-bonus-row--off');
                            await setItemBonusOff(actor, bonus.id, nowOff);
                            row.toggleClass('la-bonus-row--off', nowOff);
                            $(ev.currentTarget).toggleClass('fa-toggle-on', !nowOff).toggleClass('fa-toggle-off', nowOff).attr('title', nowOff ? 'Switch on' : 'Switch off');
                            return;
                        }

                        if (kind === 'global')
                            await removeGlobalBonus(actor, bonus.id);
                        else
                            await removeConstantBonus(actor, bonus.id);
                        removeRow();
                    });
                bonusListEl.append(row);
            }
        }

        rightEl.append(bonusListEl);

        const panel = $(htmlToElement(`<div class="la-hud-status-panel"></div>`));
        const leftWrap = $(htmlToElement(`<div class="la-status-leftwrap"></div>`));
        const onPill = $(htmlToElement(`<button type="button" class="la-status-onpill" aria-pressed="false" data-tooltip="${escapeHtml(localize('LA.tokenHud.showOnlyOn'))}" data-tooltip-direction="UP"><span class="la-status-onpill__dot"></span><span class="la-status-onpill__text"></span></button>`));
        const header = $(htmlToElement(`<div class="la-hud-col-label">Statuses</div>`)).append(onPill);

        if (this._tokens.length > 1)
            header.append(`<span class="la-hud-section-count"> · ${escapeHtml(localizeFormat('LA.tokenHud.selectedTokens', { count: this._tokens.length }))}</span>`);

        const updateOnPill = () =>
        {
            const count = gridEl.children('[data-status-id]').toArray().filter(row => $(row).data('active')).length;
            if (!count)
                onlyActive = false;
            onPill.css('display', count ? '' : 'none').attr('aria-pressed', String(onlyActive));
            onPill.find('.la-status-onpill__text').text(localizeFormat('LA.tokenHud.statusesOn', { count }));
        };

        this._afterRowSync = () =>
        {
            updateOnPill();
            applyGridFilter();
        };

        updateOnPill();
        onPill.on('click mousedown', (ev) =>
        {
            ev.stopPropagation();
            this._cancelCollapse?.();
            this._extendCollapse?.();
        });
        onPill.on('click', () =>
        {
            playUiSound('toggle');
            onlyActive = !onlyActive;
            onPill.attr('aria-pressed', String(onlyActive));
            applyGridFilter();
        });
        searchBar.on('input', function ()
        {
            _lastSearchQuery = String($(this).val());
            applyGridFilter();
        });
        searchBar.on('keydown', (ev) =>
        {
            if (ev.key !== 'Enter')
                return;
            ev.preventDefault();
            const firstMatch = gridSections.flatMap(section => section.rows).find(row => row.style.display !== 'none');
            if (firstMatch)
                $(firstMatch).trigger('click');
        });
        searchWrap.find('.la-status-search-clear').on('click', () =>
        {
            searchBar.val('');
            _lastSearchQuery = '';
            applyGridFilter();
            searchBar.trigger('focus');
        });

        const extendFade = () =>
        {
            this._cancelCollapse?.();
            this._extendCollapse?.();
        };

        searchBar.on('click mousedown', (ev) =>
        {
            ev.stopPropagation();
            extendFade();
        });
        leftWrap.append(header, searchRow, gridEl);
        panel.append(leftWrap, rightEl);

        this._mount(panel, anchorRow, { useParentCol: false, clampTop: true });
        gridEl.css('min-height', gridEl.outerHeight() ?? 0);
        applyGridFilter();
        panel.on('click', extendFade);
    }

    _openSubtypeManager(actor, statusConfig, effects, anchorRow)
    {
        if (this._subtypePanel)
        {
            this._subtypePanel.remove(); this._subtypePanel = null;
        }

        const getStack = effectStack;
        const statusName = localize(statusConfig.name ?? statusConfig.id);

        const panel = $(htmlToElement(`<div class="la-hud-sub-panel"></div>`));
        const header = $(htmlToElement(`<div class="la-hud-sub-header">${escapeHtml(statusName)} <span class="la-sub-close">✕</span></div>`));
        const body  = $(document.createElement('div'));
        panel.append(header, body);
        header.find('.la-sub-close').on('click', () =>
        {
            panel.remove(); this._subtypePanel = null;
        });

        const refresh = () =>
        {
            const current = /** @type {any[]} */ ([...actor.effects]).filter(eff => effects.some(/** @type {any} */ orig => orig.id === eff.id));

            if (!current.length)
            {
                panel.remove(); this._subtypePanel = null; this.syncRows(); return;
            }

            body.empty();

            for (const eff of current)
            {
                const laFlags = getLAFlags(eff);
                let label = 'Base';

                if (laFlags?.consumption)
                    label = 'Consume';
                else if (laFlags?.linkedBonusId)
                    label = 'Bonus';

                const stack = getStack(eff);

                const row = $(htmlToElement(`<div class="la-hud-sub-row" data-eid="${eff.id}">
                    <span class="la-sub-label">${label}</span>
                    <span class="la-sub-stack">×${stack}</span>
                    <span class="la-sub-minus la-sub-btn la-sub-btn--minus">−</span>
                    <span class="la-sub-plus la-sub-btn la-sub-btn--plus">+</span>
                    <span class="la-sub-del la-sub-btn la-sub-btn--del">✕</span>
                </div>`));

                row.find('.la-sub-minus').on('click', async () =>
                {
                    const liveEff = /** @type {any} */ (actor.effects).get(eff.id);
                    if (!liveEff)
                        return;

                    const stack = getStack(liveEff);
                    if (stack > 1)
                        await setEffectStack(liveEff, stack - 1);
                    else
                        await actor.deleteEmbeddedDocuments('ActiveEffect', [eff.id]);
                    refresh();
                });
                row.find('.la-sub-plus').on('click', async () =>
                {
                    const liveEff = /** @type {any} */ (actor.effects).get(eff.id);
                    if (!liveEff)
                        return;
                    await setEffectStack(liveEff, getStack(liveEff) + 1);
                    refresh();
                });
                row.find('.la-sub-del').on('click', async () =>
                {
                    await actor.deleteEmbeddedDocuments('ActiveEffect', [eff.id]);
                    refresh();
                });
                body.append(row);
            }

            this.syncRows();
        };

        refresh();
        panel.on('mouseleave', this._scheduleCollapse).on('mouseenter', this._cancelCollapse);
        panel.appendTo(document.body);
        this._subtypePanel = panel;

        // Slide up from the row; fixed to body, animates like the HUD columns (opacity + position)
        const scale = tahScale();
        if (scale !== 1)
            panel.css({ transform: `scale(${scale})`, 'transform-origin': 'top left' });

        const rect     = anchorRow[0].getBoundingClientRect();
        const panelHeight = (panel.outerHeight() || 0) * scale;
        const panelWidth  = (panel.outerWidth()  || 200) * scale;
        const goAbove  = rect.top - panelHeight > 4;
        const finalTop = goAbove ? rect.top - panelHeight : rect.bottom;
        const startTop = goAbove ? rect.top           : rect.bottom - panelHeight;
        const left     = Math.min(rect.left, window.innerWidth - panelWidth - 8);
        panel.css({ position: 'fixed', top: startTop, left, zIndex: 9999, opacity: 0, width: 'fit-content' });
        panel.animate({ top: finalTop, opacity: 1 }, 250);
    }
}
