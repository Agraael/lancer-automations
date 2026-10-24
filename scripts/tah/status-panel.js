/* global $, game, CONFIG */

import { removeGlobalBonus, removeConstantBonus, getBonusIcon, getBonusDetailString, getBonusUsesInfo, isBonusRemovalPending, getV3DefenseRows, setV3DefenseOff } from '../bonuses/genericBonuses.js';
import { getBonusConditionHint } from '../bonuses/bonus-condition.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag, getLAFlags } from '../tools/flag-utils.js';
import { MODULE_ID } from '../tools/constants.js';
import { applyEffectsToTokens, effectStack } from '../bonuses/flagged-effects.js';
import { durationFieldsHtml, setupDurationUI, getDurationConfig, createDurationMarks } from '../bonuses/duration-widget.js';
import { hasPermanentEntry } from '../bonuses/duration-clock.js';
import { playUiSound } from './sound.js';
import { tahScale, laHudRenderIcon } from './item-helpers.js';
import { HudPanel } from './hud-panel.js';
import { openCursorMenu } from './cursor-menu.js';
import { localize, escapeHtml } from '../tools/string-utils.js';
import { durationText, sourceName } from '../bonuses/status-tooltip.js';
import { v3ConditionLabel } from '../tools/v3-condition.js';

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

function stackBadgeText(effects)
{
    const totalStack = effects.reduce((sum, effect) => sum + effectStack(effect), 0);
    const parts = [];
    if (totalStack > 1)
        parts.push(`×${totalStack}`);
    if (effects.length > 1)
        parts.push(`[${effects.length}]`);
    return parts.join(' ');
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
    }

    async _applyWithDuration(status)
    {
        const { duration, originID } = getDurationConfig(this._panel, 'la-sdur');
        await applyEffectsToTokens({
            tokens: this._tokens,
            effectNames: status.name,
            duration: { ...duration, overrideTurnOriginId: originID },
        });
    }

    close()
    {
        this._suppressCollapse?.(false);
        this._durMarks?.destroy();
        this._durMarks = null;
        $('.la-status-tooltip').remove();
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
        this._panel.find('[data-status-id]').each(function()
        {
            const rowEl = $(this);
            const statusId = rowEl.attr('data-status-id');
            const effects = /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ eff => eff.statuses?.has(statusId) && !eff.disabled);
            const nowActive = effects.length > 0;
            setRowActive(rowEl, nowActive, nowActive && isPermanentEffect(effects));
            rowEl.find('.la-status-badge').text(stackBadgeText(effects));
        });
    }

    open(anchorRow)
    {
        $('.la-status-tooltip').remove();
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

        // active first, then favorites, alphabetic within each group
        const readFavorites = () =>
        {
            return new Set(getModuleSetting('tah.statusFavorites') ?? []);
        };
        const favoriteIds = readFavorites();
        const toggleStatusFavorite = async (/** @type {string} */ sid) =>
        {
            const current = readFavorites();
            const nowFav = !current.has(sid);
            if (nowFav)
                current.add(sid);
            else
                current.delete(sid);
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
        // TCS mirrors its saved list into CONFIG, the Custom section owns those rows
        const allStatuses = (/** @type {any} */ (CONFIG).statusEffects ?? [])
            .filter(/** @type {any} */ status => status.id && !status.tcsCustom)
            .sort(/** @type {any} */ (aStatus, bStatus) =>
            {
                const aActive = activeStatusIds.has(aStatus.id);
                const bActive = activeStatusIds.has(bStatus.id);
                if (aActive !== bActive)
                    return aActive ? -1 : 1;
                const aFav = favoriteIds.has(aStatus.id);
                const bFav = favoriteIds.has(bStatus.id);
                if (aFav !== bFav)
                    return aFav ? -1 : 1;
                return (aStatus.name ?? aStatus.id).localeCompare(bStatus.name ?? bStatus.id);
            });

        const getEffectsForStatus = (/** @type {string} */ sid) =>
            /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ eff => eff.statuses?.has(sid) && !eff.disabled);

        const getStack = effectStack;

        const isActive = (/** @type {any} */ s) => getEffectsForStatus(s.id).length > 0;

        const isPermanent = (/** @type {any} */ status) => isPermanentEffect(getEffectsForStatus(status.id));

        const isCustomActive = (/** @type {string} */ name) =>
            /** @type {any[]} */ ([...actor.effects]).some(/** @type {any} */ eff =>
                (eff.getFlag?.('temporary-custom-statuses', 'originalName') === name || eff.name === name) &&
                !eff.disabled
            );

        const getStatusBadge = (/** @type {any} */ s) => stackBadgeText(getEffectsForStatus(s.id));

        const buildStatusTooltip = (/** @type {any} */ status) =>
        {
            const effects = getEffectsForStatus(status.id);
            const lines = [];
            if (status.description)
                lines.push(`<div class="la-tooltip-line">${status.description}</div>`);
            for (const eff of effects)
            {
                const laFlags = getLAFlags(eff);
                const stackCount = getStack(eff);
                let label = 'Base Effect';
                if (laFlags?.consumption)
                {
                    const trigger = laFlags.consumption?.trigger;
                    const triggerLabel = Array.isArray(trigger) ? trigger.join(', ') : trigger;
                    label = `Consume: ${typeof laFlags.consumption === 'string' ? laFlags.consumption : (triggerLabel ?? laFlags.consumption?.type ?? 'Effect')}`;
                }
                else if (laFlags?.linkedBonusId)
                    label = 'Bonus Effect';
                const stackStr = stackCount && stackCount > 1 ? ` ×${stackCount}` : '';
                if (effects.length > 1 || stackStr)
                    lines.push(`<div class="la-tooltip-label">${label}${stackStr}</div>`);
                const dur = laFlags?.duration ?? /** @type {any} */ (eff.flags)?.['csm-lancer-qol']?.duration;
                const durLabel = laFlags ? durationText(eff) : dur?.label;
                if (durLabel)
                    lines.push(`<div class="la-tooltip-duration">Duration: ${escapeHtml(durLabel)}</div>`);
            }
            return lines.length ? lines.join('') : null;
        };

        const updateRowBadge = (/** @type {any} */ rowEl, /** @type {any} */ s) =>
        {
            rowEl.find('.la-status-badge').text(getStatusBadge(s));
        };

        const showTooltip =(/** @type {any} */ rowEl, /** @type {any} */ s) =>
        {
            const body = buildStatusTooltip(s);
            if (!body)
                return null;
            const label = game.i18n.localize(s.name ?? s.id);
            const tooltipEl = $(`<div class="la-status-tooltip">
                <div class="la-status-tooltip__title">${escapeHtml(label)}</div>
                <div class="la-status-tooltip__body">${body}</div>
            </div>`);
            $('body').append(tooltipEl);
            const rect = /** @type {HTMLElement} */ (rowEl[0]).getBoundingClientRect();
            const tooltipHeight = tooltipEl.outerHeight() ?? 0;
            const top = Math.min(rect.top, window.innerHeight - tooltipHeight - 8);
            tooltipEl.css({ top, left: rect.right + 6 });
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
                    tooltipEl = showTooltip(self, spec.tooltipStatus);
                }, 600);
            }).on('mouseleave', function()
            {
                clearTimeout(tooltipTimer); tooltipTimer = null;
                tooltipEl?.remove(); tooltipEl = null;
                $(this).css(rowColors($(this).data('active'), $(this).data('permanent')));
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

        const searchBar =$(`<input type="text" class="la-status-search" placeholder="${localize('LA.tokenHud.searchStatuses')}">`);
        const searchWrap = $(`<div class="la-status-search-wrap"><i class="fas fa-search la-status-search-icon"></i></div>`);
        searchWrap.append(searchBar);

        searchBar.val(_lastSearchQuery);
        const durTool = $(durationFieldsHtml('la-sdur', this._token?.id));
        if (_lastDurationLabel && durTool.find(`#la-sdur-duration option[value="${_lastDurationLabel}"]`).length)
            durTool.find('#la-sdur-duration').val(_lastDurationLabel);
        durTool.find('#la-sdur-duration').on('change', function ()
        {
            _lastDurationLabel = String($(this).val());
        });
        const searchRow = $(`<div class="la-status-search-row"></div>`);
        const helpTip = $(`<i class="fas fa-circle-question la-status-help" data-tooltip="${localize('LA.tokenHud.statusHelp')}"></i>`);
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

        const gridEl =$(`<div class="lancer-scroll la-hud-status-grid"></div>`);
        for (const status of allStatuses)
        {
            const active = isActive(status);
            const rowEl = $(`<div class="la-hud-status-row" data-status-id="${status.id}">
                <img class="la-status-row__img" src="${escapeHtml(status.icon ?? status.img ?? '')}" onerror="this.style.display='none'">
                <span class="la-status-name">${escapeHtml(game.i18n.localize(status.name ?? status.id))}</span>
                <span class="la-status-badge">${getStatusBadge(status)}</span>
            </div>`);
            setRowActive(rowEl, active, active && isPermanent(status));
            if (favoriteIds.has(status.id))
                rowEl.css('position', 'relative').append('<span class="la-hud-fav-mark">★</span>');

            bindStatusRow(rowEl, {
                name: status.name,
                tooltipStatus: status,
                applyStatus: status,
                subtypeStatus: status,
                getEffects: () => getEffectsForStatus(status.id),
                matchesOther: (matchingEff) => matchingEff.statuses?.has(status.id) && !matchingEff.disabled,
                updateRow: () =>
                {
                    updateRowBadge(rowEl, status);
                    setRowActive(rowEl, isActive(status), isPermanent(status));
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

            gridEl.append(rowEl);
        }

        const rightEl =$(`<div class="la-hud-right-col"></div>`);

        const laApi = /** @type {any} */ (game.modules.get(MODULE_ID))?.api;
        if (laApi?.executeEffectManager)
        {
            const effectManagerBtn = $(`<button class="la-hud-util-btn">Effect Manager</button>`);
            effectManagerBtn.on('mouseenter', () => playUiSound('statusHover'));
            effectManagerBtn.on('click', () =>
            {
                playUiSound('toggle'); laApi.executeEffectManager();
            });
            rightEl.append(effectManagerBtn);
        }
        const clearBtn = $(`<button class="la-hud-util-btn la-hud-util-btn--secondary">Clear All Effects</button>`);
        clearBtn.on('mouseenter', () => playUiSound('statusHover'));
        clearBtn.on('click', async () =>
        {
            playUiSound('toggle');
            this._incDepth();
            try
            {
                const ids = /** @type {any[]} */ ([...actor.effects]).map(/** @type {any} */ eff => eff.id);
                if (ids.length)
                    await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
                gridEl.find('[data-status-id]').each(function()
                {
                    setRowActive($(this), false);
                    $(this).find('.la-status-badge').text('');
                });
            }
            finally
            {
                this._decDepth();
            }
        });
        rightEl.append(clearBtn);

        if (hasTempCustomStatuses)
        {
            const getCustomEffects = (/** @type {string} */ name) =>
                /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ e =>
                    (e.getFlag?.('temporary-custom-statuses', 'originalName') === name || e.name === name) && !e.disabled
                );

            rightEl.append($(`<div class="la-hud-panel-section-header">Custom</div>`));
            const customListEl = $(`<div class="lancer-scroll la-hud-custom-list"></div>`);
            for (const customStatus of /** @type {any[]} */ (customSaved))
            {
                const customRow = $(`<div class="la-hud-status-row">
                    <img class="la-status-row__img" src="${escapeHtml(customStatus.icon ?? '')}" onerror="this.style.display='none'">
                    <span class="la-status-name">${escapeHtml(customStatus.name)}</span>
                    <span class="la-status-badge">${stackBadgeText(getCustomEffects(customStatus.name))}</span>
                </div>`);
                setRowActive(customRow, isCustomActive(customStatus.name));

                bindStatusRow(customRow, {
                    name: customStatus.name,
                    // status-shaped so the tooltip finds the applied effects by id
                    tooltipStatus: { id: customStatus.name.slugify(), name: customStatus.name, description: customStatus.description },
                    applyStatus: customStatus,
                    subtypeStatus: { id: customStatus.name, name: customStatus.name, icon: customStatus.icon },
                    getEffects: () => getCustomEffects(customStatus.name),
                    matchesOther: (candidate) => candidate.getFlag?.('temporary-custom-statuses', 'originalName') === customStatus.name || candidate.name === customStatus.name,
                    updateRow: () =>
                    {
                        customRow.find('.la-status-badge').text(stackBadgeText(getCustomEffects(customStatus.name)));
                        setRowActive(customRow, isCustomActive(customStatus.name));
                        this.syncRows();
                    },
                    onCtrlRightClick: null,
                });

                customListEl.append(customRow);
            }
            if (!customSaved.length)
                customListEl.append($(`<div class="la-status-empty">No custom statuses</div>`));
            rightEl.append(customListEl);
        }

        const globalBonuses = /** @type {any[]} */ (getLAFlag(actor,'global_bonuses') || [])
            .filter((/** @type {any} */ bonus) => !isBonusRemovalPending(actor, bonus.id));
        const constantBonuses = /** @type {any[]} */ (getLAFlag(actor,'constant_bonuses') || []);
        const allBonuses = [
            ...globalBonuses.map((/** @type {any} */ bonus, i) => ({ bonus, kind: 'global', idx: i, off: false, inactive: false })),
            ...constantBonuses.map((/** @type {any} */ bonus, i) => ({ bonus, kind: 'constant', idx: i, off: false, inactive: false })),
            ...getV3DefenseRows(actor).map(({ bonus, off, inactive }, i) => ({ bonus, kind: 'data', idx: i, off, inactive })),
        ];
        rightEl.append($(`<div class="la-hud-panel-section-header">Bonuses</div>`));
        const bonusListEl = $(`<div class="lancer-scroll la-bonus-list"></div>`);
        if (!allBonuses.length)
            bonusListEl.append($(`<div class="la-status-empty">No bonuses</div>`));
        else
        {
            for (const { bonus, kind, off, inactive } of allBonuses)
            {
                const detail = getBonusDetailStr(bonus);
                let kindBadge = '';
                if (kind === 'constant')
                    kindBadge = ' <span class="la-bonus-row__kind">(const)</span>';
                else if (kind === 'data')
                    kindBadge = ' <span class="la-bonus-row__kind la-bonus-row__kind--data">(data)</span>';
                const source = sourceName(bonus);
                const sourceLine = source ? `<div class="la-bonus-row__src"><i class="fas fa-link"></i> ${escapeHtml(source)}</div>` : '';
                const actionIcon = kind === 'data'
                    ? `<i class="la-bonus-del la-bonus-toggle fas ${off ? 'fa-eye-slash' : 'fa-eye'}" title="${off ? 'Switch on' : 'Switch off'}"></i>`
                    : '<i class="la-bonus-del fas fa-trash" title="Delete bonus"></i>';
                const dataCondition = bonus.dataCondition ? `while ${v3ConditionLabel(bonus.dataCondition)}` : '';
                const condHint = getBonusConditionHint(bonus) || dataCondition;
                const condBadge = condHint ? ` <span class="la-bonus-row__cond${dataCondition ? ' la-bonus-row__cond--data' : ''}"><i class="fas fa-code-branch"></i></span>` : '';
                const condLine = dataCondition
                    ? `<div class="la-bonus-row__condline${inactive ? ' la-bonus-row__condline--unmet' : ''}"><i class="fas fa-code-branch"></i> ${escapeHtml(dataCondition)}</div>`
                    : '';
                const uses = getBonusUsesInfo(actor, bonus);
                const usesBadge = uses
                    ? ` <span class="la-bonus-row__uses">[${escapeHtml(uses.label)}]</span>${uses.onUse ? ' <span class="la-bonus-row__kind">[on-use]</span>' : ''}`
                    : '';
                const row = $(`<div class="la-bonus-row${off ? ' la-bonus-row--off' : ''}${inactive ? ' la-bonus-row--unmet' : ''}" title="${escapeHtml(`${bonus.name}: ${detail}`)}">
                    ${laHudRenderIcon(bonus.icon || getBonusIcon(bonus))}
                    <div class="la-bonus-row__body">
                        <b>${escapeHtml(bonus.name)}</b>${kindBadge}${condBadge}<br>
                        <span class="la-bonus-row__detail">${escapeHtml(detail)}</span>${usesBadge}${sourceLine}${condLine}
                    </div>
                    ${actionIcon}
                </div>`);
                if (condHint)
                    row.find('.la-bonus-row__cond').attr('title', condHint);
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
                        if (kind === 'data')
                        {
                            const nowOff = !row.hasClass('la-bonus-row--off');
                            await setV3DefenseOff(actor, bonus.id, nowOff);
                            row.toggleClass('la-bonus-row--off', nowOff);
                            $(ev.currentTarget).toggleClass('fa-eye', !nowOff).toggleClass('fa-eye-slash', nowOff).attr('title', nowOff ? 'Switch on' : 'Switch off');
                            return;
                        }
                        if (kind === 'global')
                            await removeGlobalBonus(actor, bonus.id);
                        else
                            await removeConstantBonus(actor, bonus.id);
                        row.remove();
                        if (!bonusListEl.children().length)
                            bonusListEl.append($(`<div class="la-status-empty">No bonuses</div>`));
                    });
                bonusListEl.append(row);
            }
        }
        rightEl.append(bonusListEl);

        const panel = $(`<div class="la-hud-status-panel"></div>`);
        const leftWrap = $(`<div class="la-status-leftwrap"></div>`);
        const header = $(`<div class="la-hud-col-label">Statuses</div>`);
        searchBar.on('input', function ()
        {
            _lastSearchQuery = String($(this).val());
            const query = _lastSearchQuery.toLowerCase().trim();
            gridEl.find('[data-status-id]').each(function ()
            {
                const name = $(this).find('.la-status-name').text().toLowerCase();
                $(this).toggle(!query || name.includes(query));
            });
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
        if (_lastSearchQuery)
            searchBar.trigger('input');
        leftWrap.append(header, searchRow, gridEl);
        panel.append(leftWrap, rightEl);

        this._mount(panel, anchorRow, { useParentCol: false, clampTop: true });
        panel.on('click', extendFade);
    }

    _openSubtypeManager(actor, statusConfig, effects, anchorRow)
    {
        if (this._subtypePanel)
        {
            this._subtypePanel.remove(); this._subtypePanel = null;
        }
        const getStack = effectStack;
        const statusName = game.i18n.localize(statusConfig.name ?? statusConfig.id);

        const panel = $(`<div class="la-hud-sub-panel"></div>`);
        const header = $(`<div class="la-hud-sub-header">${escapeHtml(statusName)} <span class="la-sub-close">✕</span></div>`);
        const body  = $(`<div></div>`);
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
                const row = $(`<div class="la-hud-sub-row" data-eid="${eff.id}">
                    <span class="la-sub-label">${label}</span>
                    <span class="la-sub-stack">×${stack}</span>
                    <span class="la-sub-minus la-sub-btn la-sub-btn--minus">−</span>
                    <span class="la-sub-plus la-sub-btn la-sub-btn--plus">+</span>
                    <span class="la-sub-del la-sub-btn la-sub-btn--del">✕</span>
                </div>`);
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
        $('body').append(panel);
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
