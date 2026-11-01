/* global $, window, game, ui, Hooks */

import { HudCategories, rankText } from './hud-categories.js';
import { getTokenDispositionInfo, activationSpendKind } from '../tools/misc-tools.js';
import { armFreeUse } from './tape-changes.js';
import { isForceFreeMovement } from '../movement/keybindings.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { rankParts } from '../utils/lancer-token.js';
import { MODULE_ID } from '../tools/constants.js';
import { getItemDeployables, getDeployableInfo } from '../interactive/deployables.js';
import { eventMatchesKeybind } from '../interactive/keybindings.js';
import { laHudRenderIcon, laHudSizeMark, laHudStripeStyle, applyStripeStyle, markRightClick, HUD_ICON_SIZE, HUD_WEAPON_ICON_SIZE, tahScale, slideInCol, capColumnItems } from './item-helpers.js';
import { onHudRowHover, deactivateRangePreview, cleanupDetachedRangePreviews, transferRangePreviewOwner } from './hover.js';
import { setFavoriteWheel, openFavoritePopup, favKeyOf, legacyFavKeyOf, favoriteWheelOf, applyFavMark, clearFavMark, collectFavorites } from './favorites.js';
import { buildStatsEl, resetStatsExpanded } from './stats-bar.js';
import { effectTileEntries, effectTilesHtml, ensureEffectTileStyle } from './effect-tiles.js';
import { effectTooltipData, showStatusTooltip, moveStatusTooltip } from '../bonuses/status-tooltip.js';
import { buildPortrait, buildPortraitRail, resolvePortraitSrc } from './portrait.js';
import { buildCombatBar } from './combat-bar.js';
import { buildActionTape, noteRowIcon } from './action-tape.js';
import { collectSearchResults, openSearchResults } from './search.js';
import { showPopupAt, hasAutomation } from './hud-popups.js';
import { StatusPanel } from './status-panel.js';
import { LogPanel } from './log-panel.js';
import { GlossaryPanel } from './glossary-panel.js';
import { BondPanel } from './bond-panel.js';
import { playUiSound } from './sound.js';
import { localize, escapeHtml } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { inkOn } from '../tools/color-utils.js';
import { BG_DEFAULT, BG_ACTIVE, TEXT_DEFAULT, TEXT_ACTIVE } from './hud-palette.js';
import { buildValueCell, refreshToggleCells, refreshValueCells, activateValueCell } from './value-cells.js';
import { getNarrativeLinkedActor, getNarrativeRoster, openNarrativePilotMenu, openNarrativeLinkDialog } from './narrative-roster.js';

async function _toggleTokenInCombat(token)
{
    const tokenDoc = /** @type {any} */ (token?.document);
    if (!tokenDoc)
        return;
    try
    {
        const existing = tokenDoc.combatant;
        if (existing)
        {
            await existing.delete();
            return;
        }
        await tokenDoc.toggleCombatant({ active: true });
    }
    catch (e)
    {
        console.warn('lancer-automations | toggleCombatant failed', e);
    }
}


const HUD_LEFT = 120;    // right of Foundry's left toolbar
const HUD_TOP  = 115;   // below Foundry's top nav bar
const PORTRAIT_TOP_RATIO = 0.5;

/** Animate a column closed (mirror of the open slide-in). */
function closeCol(col, duration = 90)
{
    col.stop(true).animate({ opacity: 0, marginLeft: -10 }, duration, function ()
    {
        $(this).hide().css('marginLeft', '').children(':not(.la-hud-col-label)').remove();
        cleanupDetachedRangePreviews();
    });
}

const KB_MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);
const FREE_USE_KINDS = new Set(['quick', 'full', 'reaction']);
const PLAIN_ATTACK_CUE = 'attack';
const PANEL_SCROLL = '.la-hud-glossary-list, .la-hud-log-list, .la-hud-bond-body';

// Profile switches from anywhere (TAH row, popup dot, sheet) refresh an open weapon popup in place.
Hooks.on('updateItem', (item, changes) =>
{
    if (!foundry.utils.hasProperty(changes, 'system.selected_profile_index'))
        return;
    const popup = $(document.querySelectorAll('.la-hud-weapon-popup'));
    if (popup.length && popup.data('weapon-id') === item.id)
        popup.data('laRebuild')?.();
});

/** Toggle .la-dark on <html> from the actual --la-plate luminance, so CSS can flip icon
    filters for a dark panel. Read via a probe + canvas so any colour format resolves to bytes. */
function applyPlateThemeClass()
{
    try
    {
        const probe = document.createElement('span');
        probe.style.cssText = 'color:var(--la-plate);display:none';
        document.body.appendChild(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillStyle = resolved;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        document.documentElement.classList.toggle('la-dark', (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128);
    }
    catch
    { /* leave class as-is */ }
}

// Set the class once at startup too, so cards/dialogs that open without a fresh HUD render still get it.
Hooks.once('ready', applyPlateThemeClass);

export class LancerHUD
{
    constructor()
    {
        this._bindGen            = 0;
        this._spendHover      = null;
        this._el              = null;
        this._c2              = null;
        this._c3              = null;
        this._c4              = null;
        this._c4AnchorRow       = null;
        this._token              = null;
        this._tokens             = [];
        this._refreshTimer       = null;
        this._statusPanelInstance  = null;
        this._bondPanelInstance    = null;
        this._suppressRefreshDepth = 0;
        this._searchActive         = false;
        this._pickerSuppress       = false;
        this._collapseBonusMs      = 0;
        this._categories           = null;
        this._categoryBuilder      = null;
        this._clickToOpen          = false;
        this._narrativeMode        = false;
        this._unlocked             = false;
        this._pendingRefresh       = null;
        this._renderedTitleSig     = null;
        this._quietEl              = null;
        /** @type {HTMLElement|null} */
        this._effectTip            = null;
        // Track what's currently open in each column for in-place refresh
        this._c2Category    = null;   // category whose getItems() fills c2
        this._c2AnchorRow   = null;   // c1 row that opened c2
        this._c3SourceItem  = null;   // c2 item whose getChildren() fills c3
        this._c4SourceItem  = null;   // c3 item whose getChildren() fills c4
        this._kbCol = 1;
        this._kbIdx = 0;
        this._lastHudPointerMove = 0;
        this._kbResetTimer = null;
        this._kbBound = null;
        this._intentTimers = new Set();
        this._pointerTrail = [];
    }

    async bindNarrative()
    {
        this.unbind();
        this._narrativeMode = true;
        this._tokens = [];
        this._token = null;
        ++this._bindGen;
        this._render();
    }

    async _setNarrativeActor(uuid)
    {
        await game.settings.set(MODULE_ID, 'tah.narrativeLinkedActorUuid', uuid ?? '');
        if (this._narrativeMode)
            this.bindNarrative();
    }

    async bind(tokens)
    {
        const tokenList = Array.isArray(tokens) ? tokens : [tokens];
        this.unbind();
        const valid = tokenList.filter(token => token.actor?.isOwner);
        if (!valid.length)
            return;
        this._tokens = valid;
        this._token  = valid[0];
        const gen = ++this._bindGen;
        // Pre-cache deployables for the primary token only
        const actor = this._token.actor;
        const lids = [];
        for (const item of actor.items)
        {
            for (const lid of getItemDeployables(item, actor))
                lids.push(lid);
        }
        if (lids.length)
            await Promise.all(lids.map(lid => getDeployableInfo(lid, actor)));
        if (this._bindGen !== gen)
            return;
        this._render();
    }

    toggleSearch()
    {
        if (!this._el || !this._searchIcon)
            return false;
        this._searchIcon.trigger('click');
        return true;
    }

    toggleFavorites()
    {
        if (!this._el || !this._toggleFavorites)
            return false;
        this._toggleFavorites();
        return true;
    }

    getFavorites(wheel = 0)
    {
        return this._el ? collectFavorites(this._categories, wheel) : null;
    }

    openFavoritesColumn()
    {
        if (!this._el || !this._openFavorites)
            return false;
        this._openFavorites();
        // Opened from outside the HUD: collapse on its own unless the mouse comes in.
        this._collapseBonusMs = 2000;
        this._scheduleCollapse?.();
        return true;
    }

    toggleStatuses()
    {
        if (!this._el)
            return false;
        if (this._statusPanelInstance?.isVisible)
        {
            this._statusPanelInstance.close();
            this._clearC1Active?.();
            return true;
        }
        const catIdx = (this._categories ?? []).findIndex(cat => cat.isStatusPanel);
        if (catIdx < 0)
            return false;
        const row = this._el.children().first().find('.la-hud-row').eq(catIdx);
        if (!row.length)
            return false;
        row.trigger(getModuleSetting('tah.openMode') === 'click' ? 'click' : 'mouseenter');
        return true;
    }

    escape(context)
    {
        if (!this._el || context?.event?.defaultPrevented)
            return false;
        if (canvas.currentMouseManager || ui.menu?.rendered || ui.context?.element || foundry.nue?.Tour?.tourInProgress)
            return false;
        const popup = $(document.querySelectorAll('.la-hud-popup')).not(':animated');
        if (popup.length)
        {
            popup.animate({ opacity: 0 }, 120, function ()
            {
                $(this).remove();
            });
            return true;
        }
        if (!this._el.find('.la-hud-kbfocus').length)
            return false;
        if (this._clickToOpen)
        {
            this._kbClearFocusMark();
            this._collapseAll?.();
        }
        else
            this._kbReset();
        this._kbExitMode();
        return true;
    }

    unbind()
    {
        this._bindGen++;
        this._closeEffectTip();
        const el = this._el;
        for (const t of (this._tokens ?? []))
            deactivateRangePreview(t);
        this._el = this._c2 = this._c3 = this._c4 = null;
        this._c4AnchorRow = null;
        this._token   = null;
        this._tokens  = [];
        this._narrativeMode = false;
        this._unlocked = false;
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
        this._cancelIntent();
        this._searchActive = false;
        this._categories   = null;
        resetStatsExpanded();
        $(document).off('mousedown.la-hud-cto');
        $(document).off('mousemove.la-hud-drag mouseup.la-hud-drag');
        if (this._kbBound)
            window.removeEventListener('keydown', this._kbBound, true);
        this._spendHover = null;
        $(document).off('mousedown.la-hud-kbreset');
        clearTimeout(this._kbResetTimer);
        this._toggleFavorites = null;
        this._openFavorites = null;
        document.querySelectorAll('.la-menu-popup').forEach(node => node.remove());
        $(document.querySelectorAll('.la-hud-popup')).stop(true).animate({ opacity: 0 }, 120, function()
        {
            $(this).remove();
        });
        if (el)
            el.stop(true).animate({ opacity: 0, left: '-=18' }, 180, () => el.remove());
    }

    /** Suppress-counter handles for handlers that call actor.update() but must not re-render. */
    _depthCallbacks()
    {
        return {
            incDepth: () => this._suppressRefreshDepth++,
            decDepth: () => this._releaseDepth(),
        };
    }

    _releaseDepth()
    {
        this._suppressRefreshDepth = Math.max(0, this._suppressRefreshDepth - 1);
        if (this._suppressRefreshDepth > 0 || !this._pendingRefresh)
            return;
        const force = this._pendingRefresh === 'force';
        this._pendingRefresh = null;
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refresh({ force }), 100);
    }

    /** Debounced full refresh. Coalesces rapid updates into one render. */
    scheduleRefresh(delay = 100)
    {
        if (this._suppressRefreshDepth > 0)
        {
            this._pendingRefresh = this._pendingRefresh ?? 'patch';
            return;
        }
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refresh(), delay);
    }

    /** Repaint every rendered toggle knob from its item's getValue(). No column rebuild. */
    syncToggleCells()
    {
        refreshToggleCells();
    }

    /** Repaint every rendered increment/input cell from its item's getValue(). No column rebuild. */
    syncValueCells()
    {
        refreshValueCells();
    }

    /** In-place stats bar refresh. Does not collapse sub-columns. */
    updateStatsInPlace()
    {
        if (!this._actor || !this._el)
            return;
        this.syncValueCells();
        this._el.find('#la-hud-stats').replaceWith(buildStatsEl(this._actor, this._token));
        if (!this._narrativeMode)
        {
            this._updateCombatBar();
            this._updateActionTape();
        }
        this._updateEffectStrip();
    }

    _buildEffectStrip()
    {
        const actor = this._actor;
        if (this._narrativeMode || !actor || (this._tokens?.length ?? 0) > 1)
            return null;
        const entries = effectTileEntries(actor);
        if (!entries.length)
            return null;
        ensureEffectTileStyle();
        const strip = $(htmlToElement(`<div class="la-hud-fxtop">${effectTilesHtml(entries, { titles: false })}</div>`));
        strip.find('.la-stat-plate-tile').each((index, tile) =>
        {
            $(tile).on('mouseenter', () =>
            {
                playUiSound('statusHover');
                this._closeEffectTip();
                this._effectTip = showStatusTooltip(effectTooltipData(actor, entries[index].effect));
                const rect = tile.getBoundingClientRect();
                moveStatusTooltip(this._effectTip, rect.right, rect.top, 8);
            });
            $(tile).on('mouseleave', () => this._closeEffectTip());
        });
        return strip;
    }

    _updateEffectStrip()
    {
        if (!this._el)
            return;
        this._closeEffectTip();
        this._el.find('.la-hud-fxtop').remove();
        const strip = this._buildEffectStrip();
        if (strip)
            this._el.find('.la-hud-token-title').first().append(strip);
    }

    _closeEffectTip()
    {
        this._effectTip?.remove();
        this._effectTip = null;
    }

    _paintSpendCue()
    {
        if (!this._el)
            return;
        this._el.find('#la-combat-bar .la-action-glow').removeClass('la-action-glow');
        this._el.find('.la-free-mark').remove();
        const hover = this._spendHover;
        if (!hover)
            return;
        if (hover.kind === PLAIN_ATTACK_CUE)
        {
            if (isForceFreeMovement())
                hover.row.append(`<span class="la-free-mark la-attack-mark">${escapeHtml(localize('LA.tokenHud.attackMark'))}</span>`);
            return;
        }
        if (isForceFreeMovement() && FREE_USE_KINDS.has(hover.kind))
        {
            hover.row.append(`<span class="la-free-mark">${escapeHtml(localize('LA.tokenHud.freeMark'))}</span>`);
            return;
        }
        this._el.find(`#la-combat-bar .la-action-icon[data-action="${hover.kind}"]`).addClass('la-action-glow');
    }

    _updateActionTape()
    {
        if (!this._el)
            return;
        const existing = this._el.find('#la-action-tape');
        const newTape = this._token ? buildActionTape(this._token) : null;
        if (existing.length && newTape)
            existing.replaceWith(newTape);
        else if (existing.length)
            existing.remove();
        else if (newTape)
        {
            const anchor = this._el.find('#la-combat-bar');
            if (anchor.length)
                anchor.after(newTape);
        }
    }

    _updateCombatBar()
    {
        if (!this._actor || !this._token || !this._el)
            return;
        const existing = this._el.find('#la-combat-bar');
        const newBar = buildCombatBar(this._actor, this._token);
        if (existing.length && newBar)
            existing.replaceWith(newBar);
        else if (existing.length && !newBar)
        {
            existing.stop(true).animate({ opacity: 0, marginTop: -existing.outerHeight() }, 150, function ()
            {
                $(this).remove();
            });
        }
        else if (!existing.length && newBar)
        {
            const combatEl = this._el.find('.la-hud-combat');
            if (combatEl.length)
            {
                const rowHeight = 30;
                newBar.css({ overflow: 'hidden', opacity: 0, marginTop: -rowHeight });
                combatEl.prepend(newBar);
                newBar.animate({ opacity: 1, marginTop: 0 }, 200);
            }
        }
    }

    refresh({ force = false } = {})
    {
        if (!this._token && !this._narrativeMode)
            return;
        if (this._suppressRefreshDepth > 0)
        {
            this._pendingRefresh = force || this._pendingRefresh === 'force' ? 'force' : 'patch';
            return;
        }
        this._pendingRefresh = null;
        // Status panel open: sync rows in-place, never close + reopen.
        if (this._statusPanelInstance?.isVisible)
        {
            this.updateStatsInPlace();
            this._statusPanelInstance.syncRows();
            return;
        }
        // Same categories and title, or a detail popup open: patch the open columns in place.
        if (!force && this._el && (document.querySelector('.la-hud-popup') || this._canPatch()))
        {
            const hover = this._captureHover();
            const kb = this._captureKb();
            this._patchInPlace();
            this._restoreKb(kb);
            this._restoreHover(hover);
            return;
        }
        const openPath = this._saveOpenPath();
        const view = this._kbResultsKey();
        const viewScroll = this._c2?.scrollTop() ?? 0;
        const search = this._captureSearch();
        const panelState = this._capturePanel();
        const hover = this._captureHover();
        const kb = this._captureKb();
        const el = this._el;
        const pointerInside = !!el?.is(':hover');
        this._cancelCollapse?.();
        this._searchActive = false;
        this._el = this._c2 = this._c3 = this._c4 = null;
        this._c4AnchorRow = null;
        this._cancelIntent();
        if (el)
            el.stop(true).remove();
        this._render(false);
        this._restoreOpenPath(openPath);
        this._restoreSearch(search);
        if (view === 'favorites')
        {
            this._relistFavorites?.({ animate: false });
            this._searchActive = false;
        }
        if (view === 'favorites' || view === 'results')
            this._c2?.scrollTop(viewScroll);
        this._restorePanel(panelState);
        this._restoreKb(kb);
        this._restoreHover(hover);
        if ((openPath || view) && !pointerInside && !this._clickToOpen)
            this._scheduleCollapse?.();
    }

    _hudCols()
    {
        return [this._el?.children().first(), this._c2, this._c3, this._c4];
    }

    _captureHover()
    {
        if (!this._el?.is(':hover'))
            return null;
        const row = this._el.find('.la-hud-row:hover, .la-hud-cell:hover').last();
        if (!row.length)
            return null;
        const depth = this._hudCols().findIndex(col => !!col?.has(row[0]).length);
        return { el: row[0], key: row.attr('data-la-key'), depth, scroll: row.find('.la-hud-clip').scrollLeft() ?? 0 };
    }

    _restoreHover(hover)
    {
        if (!hover?.key || hover.depth < 0 || hover.el.isConnected)
            return;
        const row = this._rowByKey(this._hudCols()[hover.depth], hover.key);
        if (!row)
            return;
        this._quietEl = row[0];
        if (!this._el.hasClass('la-hud-kb'))
            row.data('laHoverPaint')?.();
        row.find('.la-hud-clip').scrollLeft(hover.scroll);
        const item = row.data('laItem');
        if (item?.glowMounts?.length)
            this._glowMounts(item.glowMounts, true);
        transferRangePreviewOwner(hover.el, row[0]);
    }

    _captureKb()
    {
        const mark = this._el?.find('.la-hud-kbfocus').first();
        if (!mark?.length)
            return null;
        return { el: mark[0], key: mark.attr('data-la-key'), depth: this._kbCol, mode: this._el.hasClass('la-hud-kb') };
    }

    _restoreKb(kb)
    {
        if (!kb?.key || kb.el.isConnected)
            return;
        const rows = this._kbRows(kb.depth);
        const row = rows.filter((_index, element) => element.dataset.laKey === kb.key).first();
        if (!row.length)
            return;
        this._kbCol = kb.depth;
        this._kbIdx = rows.index(row);
        row.addClass('la-hud-kbfocus');
        row.data('laHoverPaint')?.();
        if (kb.mode)
        {
            this._el.addClass('la-hud-kb');
            this._kbPaintChips(kb.depth);
        }
    }

    _captureSearch()
    {
        const bar = this._searchBar;
        if (!bar?.is(':visible'))
            return null;
        const field = /** @type {HTMLInputElement} */ (bar[0]);
        return { value: String(bar.val()), start: field.selectionStart, end: field.selectionEnd, focused: document.activeElement === field };
    }

    _restoreSearch(search)
    {
        if (!search || !this._searchBar)
            return;
        this._setSearchOpen?.(true, { animate: false });
        this._searchBar.val(search.value);
        if (search.value.trim())
            this._rerunSearch?.({ animate: false });
        if (!search.focused)
            return;
        const field = /** @type {HTMLInputElement} */ (this._searchBar[0]);
        field.focus();
        field.setSelectionRange(search.start ?? search.value.length, search.end ?? search.value.length);
    }

    _capturePanel()
    {
        const kinds = { log: this._logPanelInstance, glossary: this._glossaryPanelInstance, bond: this._bondPanelInstance };
        const kind = Object.keys(kinds).find(name => kinds[name]?.isVisible);
        if (!kind)
            return null;
        const panel = kinds[kind];
        const anchor = panel._anchor;
        const search = panel._panel.find('.la-hud-panel-search input');
        return {
            kind,
            key: anchor?.attr('data-la-key'),
            depth: this._hudCols().findIndex(col => !!anchor && !!col?.has(anchor[0]).length),
            query: search.length ? String(search.val()) : '',
            focused: search.length > 0 && document.activeElement === search[0],
            scroll: panel._panel.find(PANEL_SCROLL).first().scrollTop() ?? 0,
        };
    }

    _restorePanel(state)
    {
        if (!state?.key || state.depth < 0)
            return;
        const panel = { log: this._logPanelInstance, glossary: this._glossaryPanelInstance, bond: this._bondPanelInstance }[state.kind];
        const col = this._hudCols()[state.depth];
        const row = this._rowByKey(col, state.key);
        if (!panel || !row)
            return;
        if (this._clickToOpen)
            this._setActive(col, row);
        panel.openSilent(row);
        const search = panel._panel?.find('.la-hud-panel-search input');
        if (state.query && search?.length)
            search.val(state.query).trigger('input');
        if (state.focused && search?.length)
            search.trigger('focus');
        panel._panel?.find(PANEL_SCROLL).first().scrollTop(state.scroll);
    }

    _relinkPanels()
    {
        for (const panel of [this._logPanelInstance, this._glossaryPanelInstance, this._bondPanelInstance])
        {
            const key = panel?.isVisible ? panel._anchor?.attr('data-la-key') : null;
            if (!key || panel._anchor[0]?.isConnected)
                continue;
            const row = this._hudCols().map(col => this._rowByKey(col, key)).find(Boolean);
            if (row)
                panel._anchor = row;
        }
    }

    _canPatch()
    {
        const fresh = this._buildCategories().filter(cat => this._catHasContent(cat)).map(cat => cat.label);
        const current = (this._categories ?? []).map(cat => cat.label);
        if (fresh.length !== current.length || fresh.some((label, index) => label !== current[index]))
            return false;
        return this._titleSig() === this._renderedTitleSig;
    }

    _titleSig()
    {
        const actor = this._actor;
        const token = this._token;
        const disposition = (!this._narrativeMode && token && getModuleSetting('tah.showDisposition')) ? getTokenDispositionInfo(token) : null;
        return JSON.stringify([
            this._narrativeMode,
            this._tokens?.length ?? 0,
            token?.name ?? null,
            actor?.uuid ?? null,
            actor?.name ?? null,
            rankText(actor),
            disposition?.color ?? null,
            disposition?.label ?? null,
            !!token?.inCombat,
            resolvePortraitSrc(this._narrativeMode ? null : token, actor),
            this._narrativeMode ? getModuleSetting('tah.narrativeRosterUuids') : null,
        ]);
    }

    _catCount(cat)
    {
        if (!cat.getItems || cat.isStatusPanel || cat.isLogPanel || cat.noCount)
            return 0;
        try
        {
            return this._usableCount(this._sectionView(cat.getItems() ?? []).rows);
        }
        catch
        {
            return 0;
        }
    }

    _patchInPlace()
    {
        this.updateStatsInPlace();
        const c1 = this._el.children().first();
        for (const cat of this._categories ?? [])
        {
            const row = this._rowByKey(c1, cat.label);
            if (!row)
                continue;
            const count = this._catCount(cat);
            const countEl = row.children('.la-hud-count');
            if (count > 0 && countEl.length)
                countEl.text(count);
            else if (count > 0)
                row.children('.la-hud-arrow').before(`<span class="la-hud-count">${count}</span>`);
            else
                countEl.remove();
        }
        this._patchColumns();
    }

    _patchColumns()
    {
        const view = this._kbResultsKey();
        if (view === 'results')
            this._rerunSearch?.();
        else if (view === 'favorites')
            this._relistFavorites?.();
        else if (view === 'category')
            this._refreshColumnsInPlace();
        this._relinkPanels();
    }

    get _actor()
    {
        if (this._narrativeMode)
            return getNarrativeLinkedActor();
        return this._token?.actor;
    }

    _render(animate = true)
    {
        if (!this._actor && !this._narrativeMode)
            return;

        applyPlateThemeClass();

        const categories = this._buildCategories().filter(cat => this._catHasContent(cat));
        this._categories = categories;
        this._renderedTitleSig = this._titleSig();
        const clickToOpen      = getModuleSetting('tah.openMode') === 'click';
        const hoverCloseDelay  = (getModuleSetting('tah.hoverCloseDelay') ?? 2) * 1000;
        this._clickToOpen = clickToOpen;

        const actor = this._actor;
        const tokenName = this._narrativeMode
            ? (actor ? (actor.name ?? 'UNLINKED') : 'UNLINKED')
            : (this._tokens.length > 1
                ? `${this._tokens.length} TOKENS`
                : (this._token.name ?? actor.name ?? ''));
        // Resolve disposition / team (only if setting is on)
        let _dispColor = null;
        let _dispLabel = null;
        if (!this._narrativeMode && getModuleSetting('tah.showDisposition'))
        {
            const d = getTokenDispositionInfo(this._token) ?? { color: '#888', label: localize('LA.tokenHud.label.unknown') };
            _dispColor = d.color;
            _dispLabel = d.label;
        }

        const titleEl = $(htmlToElement(`<div class="la-hud-token-title"><span class="la-hud-token-name"><span class="la-hud-clip"><span class="la-hud-pan">${escapeHtml(tokenName)}</span></span></span></div>`));
        const setNarrativeActor = (uuid) => this._setNarrativeActor(uuid);

        if (this._narrativeMode)
        {
            const linked = !!actor;
            const linkBtn = $(htmlToElement(`<span class="la-combat-toggle la-narrative-link${linked ? ' la-narrative-link--on' : ''}" title="${linked ? 'Swap pilot (right-click to edit the roster)' : 'Link to pilot'}"><i class="fas fa-${linked ? 'link' : 'link-slash'}"></i></span>`));
            linkBtn.on('mouseenter', () => playUiSound('statusHover'));
            linkBtn.on('click', () => openNarrativePilotMenu({ setActor: setNarrativeActor, onEnter: () => this._cancelCollapse?.(), onLeave: () => this._scheduleCollapse?.() }));
            linkBtn.on('contextmenu', (event) =>
            {
                event.preventDefault();
                openNarrativeLinkDialog(setNarrativeActor);
            });
            titleEl.find('.la-hud-token-name').before(linkBtn);
        }
        else
        {
            // Combat toggle icon (left of token name)
            const inCombat = this._token.inCombat;
            const combatToggle = $(htmlToElement(`<span class="la-combat-toggle${inCombat ? ' la-combat-toggle--in' : ''}" title="${inCombat ? 'Remove from combat' : 'Add to combat'}"><i class="fas fa-swords"></i></span>`));
            combatToggle.on('mouseenter', () => playUiSound('statusHover'));
            combatToggle.on('click', async () =>
            {
                const targets = (this._tokens?.length ? this._tokens : [this._token]).filter(Boolean);
                const wantActive = !this._token.inCombat;
                for (const target of targets)
                {
                    if (!!target.inCombat === wantActive)
                        continue;
                    await _toggleTokenInCombat(target);
                }
                const nowInCombat = this._token.inCombat;
                combatToggle.toggleClass('la-combat-toggle--in', nowInCombat);
                combatToggle.attr('title', nowInCombat ? 'Remove from combat' : 'Add to combat');
                this._updateCombatBar();
                this._updateActionTape();
            });
            titleEl.find('.la-hud-token-name').before(combatToggle);
        }

        const rank = (this._tokens?.length ?? 0) > 1 ? null : rankParts(actor);
        if (rank)
            titleEl.find('.la-hud-token-name').before(`<span class="la-hud-token-rank"><span class="la-hud-rank-kind">${rank.kind}</span><span class="la-hud-rank-num">${rank.value}</span></span>`);

        const statsEl = (this._narrativeMode && !actor) ? $(document.createElement('div')) : buildStatsEl(actor, this._token);
        const combatBar = this._narrativeMode ? $(document.createElement('div')) : buildCombatBar(actor, this._token);

        const c1 = this._makeCol('Menu');
        c1.css('width', '180px');
        const menuLabel = c1.find('.la-hud-col-label');
        const menuCell = $(htmlToElement(`<span class="la-hud-menu-cell"><span class="la-hud-menu-text">Menu</span></span>`));
        const favIcon = $(htmlToElement(`<span class="la-hud-fav-icon" aria-label="Favorites">★</span>`));
        const searchIcon = $(htmlToElement(`<span class="la-hud-search-toggle" aria-label="Search">⌕</span>`));
        const searchBar = $(htmlToElement(`<input type="text" class="la-hud-search-bar" placeholder="Search…">`));
        menuCell.append(searchBar);
        menuLabel.addClass('la-hud-menu-band').empty().append(menuCell, favIcon, searchIcon);
        this._searchIcon = searchIcon;
        this._searchBar = searchBar;
        const actionTape = this._narrativeMode ? null : buildActionTape(this._token);
        const headEl = $(htmlToElement('<div class="la-hud-head"></div>')).append(titleEl);
        if (statsEl.is('#la-hud-stats'))
            headEl.append(statsEl);
        const combatEl = $(htmlToElement('<div class="la-hud-combat"></div>'));
        if (combatBar && combatBar.is('#la-combat-bar'))
            combatEl.append(combatBar);
        if (actionTape)
            combatEl.append(actionTape);
        c1.prepend(headEl, combatEl);

        // c1 must exist in DOM before we can measure it below, so build hud first
        const savedPos = getModuleSetting('tah.position');
        const startLeft = savedPos?.left ?? HUD_LEFT;

        const uiScale = tahScale();
        // Saved and default tops place the name band, a portrait pushes the HUD down by its height so the art sits above.
        let defaultBase = HUD_TOP;
        let portraitOffset = 0;
        const onPortraitMeasured = (measured) =>
        {
            const next = Math.round(measured * uiScale);
            const current = parseInt(this._el?.css('top') ?? '');
            if (Number.isFinite(current))
                this._el.css('top', `${current - portraitOffset + next}px`);
            portraitOffset = next;
        };
        const narrativeRoster = this._narrativeMode ? getNarrativeRoster() : [];
        const portrait = narrativeRoster.length > 1
            ? buildPortraitRail({
                pilots: narrativeRoster,
                activeUuid: getModuleSetting('tah.narrativeLinkedActorUuid'),
                onMeasured: onPortraitMeasured,
                onPick: setNarrativeActor,
            })
            : buildPortrait(this._narrativeMode ? null : this._token, actor, onPortraitMeasured);
        if (portrait)
        {
            titleEl.append(portrait.el);
            portraitOffset = Math.round(portrait.height * uiScale);
        }
        this._closeEffectTip();
        const effectStrip = this._buildEffectStrip();
        if (effectStrip)
            titleEl.append(effectStrip);
        const startTop = (savedPos?.top ?? defaultBase) + portraitOffset;

        const hud = $(htmlToElement(`<div id="la-hud" style="left:${startLeft}px;top:${startTop}px;"></div>`));
        if (uiScale !== 1)
            hud.css({ transform: `scale(${uiScale})`, 'transform-origin': 'top left' });
        if (animate)
            hud.css({ opacity: 0, left: startLeft - 18 });
        hud.append(c1);
        hud.appendTo(document.body);
        this._el = hud;
        // With a portrait the default top is half the no-portrait one, so the art has room above.
        if (portrait)
        {
            defaultBase = Math.round(HUD_TOP * PORTRAIT_TOP_RATIO);
            if (!savedPos)
                hud.css('top', `${defaultBase + portraitOffset}px`);
        }
        if (animate)
            hud.animate({ opacity: 1, left: startLeft }, 350);

        // Lock / drag / reset controls
        const lockBtn = $(htmlToElement(`<span class="la-hud-lock" title="Unlock to drag"><i class="fas fa-fw fa-lock"></i></span>`));
        const resetBtn = $(htmlToElement(`<span class="la-hud-reset" title="Reset position"><i class="fas fa-fw fa-rotate-left"></i></span>`));
        titleEl.append($(htmlToElement('<span class="la-hud-lockslot"></span>')).append(lockBtn, resetBtn));
        const paintLock = (/** @type {boolean} */ hovered) =>
        {
            const unlocked = this._unlocked;
            lockBtn.find('i').toggleClass('fa-lock', !unlocked).toggleClass('fa-lock-open', unlocked);
            lockBtn.css('opacity', unlocked ? 0.9 : hovered ? 0.4 : 0).attr('title', unlocked ? 'Lock position' : 'Unlock to drag');
            resetBtn.css('opacity', unlocked ? 0.6 : 0);
            hud.toggleClass('la-hud-unlocked', unlocked);
        };
        paintLock(false);

        // Disposition / team stripe. Appended last to sit at the far right edge.
        if (_dispColor && _dispLabel)
        {
            const _textColor = inkOn(_dispColor);
            const dispDetail = $(htmlToElement(`<div class="la-disp-detail" style="background:${_dispColor};"><span class="la-disp-detail__label" style="color:${_textColor};">${escapeHtml(_dispLabel.toUpperCase())}</span></div>`));
            const dispToggle = $(htmlToElement(`<div class="la-disp-toggle" style="background:${_dispColor};"><span class="la-disp-toggle__chevron" style="color:${_textColor};">▶</span></div>`));
            titleEl.append(dispToggle);
            titleEl.append(dispDetail);
            let _dispExpanded = false;
            const openDisp = () =>
            {
                if (_dispExpanded)
                    return;
                _dispExpanded = true;
                dispDetail.stop(true).css({ display: 'flex', width: 0, opacity: 0, overflow: 'hidden' })
                    .animate({ width: dispDetail.prop('scrollWidth'), opacity: 1 }, 150, function ()
                    {
                        $(this).css({ width: '', overflow: '' });
                    });
                dispToggle.find('span').text('◀');
            };
            const closeDisp = () =>
            {
                if (!_dispExpanded)
                    return;
                _dispExpanded = false;
                dispDetail.stop(true).css('overflow', 'hidden').animate({ width: 0, opacity: 0 }, 120, function ()
                {
                    $(this).css({ display: 'none', width: '', opacity: '', overflow: '' });
                });
                dispToggle.find('span').text('▶');
            };
            dispToggle.on('mouseenter', () =>
            {
                playUiSound('statusHover'); openDisp();
            });
            dispToggle.on('mouseleave', closeDisp);
            dispDetail.on('mouseenter', openDisp);
            dispDetail.on('mouseleave', closeDisp);
            dispToggle.on('click', (ev) =>
            {
                ev.stopPropagation();
                if (_dispExpanded)
                    closeDisp();
                else
                    openDisp();
            });
        }

        // Title bar hover/click. Must be after lockBtn/resetBtn creation.
        const nameSpan = titleEl.find('.la-hud-token-name');
        nameSpan.on('mouseenter', () =>
        {
            playUiSound('statusHover');
            nameSpan.css({ color: 'var(--tah-red-glyph)', cursor: 'pointer' });
            const clip = nameSpan.find('.la-hud-clip')[0];
            const pan  = nameSpan.find('.la-hud-pan')[0];
            if (clip && pan)
            {
                const overflow = pan.scrollWidth - clip.clientWidth;
                if (overflow > 4)
                    $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
            }
        });
        nameSpan.on('mouseleave', () =>
        {
            nameSpan.css({ color: '', cursor: '' });
            nameSpan.find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
        });
        nameSpan.on('click', () =>
        {
            if (this._narrativeMode && !actor)
                openNarrativeLinkDialog(setNarrativeActor);
            else
                actor?.sheet?.render(true);
        });
        titleEl.on('mouseenter', () => paintLock(true));
        titleEl.on('mouseleave', () => paintLock(false));
        titleEl.on('contextmenu', (ev) =>
        {
            ev.preventDefault(); ev.stopPropagation();
        });

        lockBtn.on('click', (ev) =>
        {
            ev.stopPropagation();
            this._unlocked = !this._unlocked;
            paintLock(true);
        });

        resetBtn.on('click', (ev) =>
        {
            ev.stopPropagation();
            if (!this._unlocked)
                return;
            game.settings.set(MODULE_ID,'tah.position', null);
            hud.animate({ left: HUD_LEFT, top: defaultBase + portraitOffset }, 200);
        });

        let dragStart = null;
        hud.on('mousedown', (ev) =>
        {
            if (!this._unlocked || ev.button !== 0)
                return;
            if ($(ev.target).closest('.la-hud-fav-icon, .la-hud-search-toggle, .la-hud-search-bar').length)
                return;
            const onHandle = $(ev.target).closest('.la-hud-col-label, .la-hud-token-title, .la-hud-lock, .la-hud-reset').length > 0;
            if (!onHandle && $(ev.target).closest('.la-hud-col').length)
                return; // rows stay clickable; drag only from the bars
            ev.preventDefault();
            dragStart = { x: ev.clientX, y: ev.clientY, left: parseInt(hud.css('left')), top: parseInt(hud.css('top')) };
            hud.css('cursor', 'grabbing');
        });
        $(document).off('mousemove.la-hud-drag mouseup.la-hud-drag');
        $(document).on('mousemove.la-hud-drag', (ev) =>
        {
            if (!dragStart)
                return;
            const dx = ev.clientX - dragStart.x;
            const dy = ev.clientY - dragStart.y;
            hud.css({ left: dragStart.left + dx, top: dragStart.top + dy });
        });
        $(document).on('mouseup.la-hud-drag', () =>
        {
            if (!dragStart)
                return;
            const moved = parseInt(hud.css('left')) !== dragStart.left || parseInt(hud.css('top')) !== dragStart.top;
            dragStart = null;
            hud.css('cursor', '');
            if (!moved)
                return;
            const pos = { left: parseInt(hud.css('left')), top: parseInt(hud.css('top')) - portraitOffset };
            game.settings.set(MODULE_ID,'tah.position', pos);
        });

        // c2/c3/c4 are absolutely positioned. They never affect c1's layout.
        const c2 = this._makeCol('');
        const c3 = this._makeCol('');
        const c4 = this._makeCol('');
        c1.css({ position: 'relative', zIndex: 4 });
        // In v13 root CSS shifts hud padding so `top:0` no longer matches c1; pin absolute children to c1's actual y.
        const c1Top = () => c1.position()?.top ?? 0;
        c2.css({ position: 'absolute', top: c1Top(), left: c1.outerWidth(), display: 'none', zIndex: 3 });
        c3.css({ position: 'absolute', top: c1Top(), left: 0,               display: 'none', zIndex: 2 });
        c4.css({ position: 'absolute', top: c1Top(), left: 0,               display: 'none', zIndex: 1 });
        hud.append(c2, c3, c4);
        this._c2 = c2;
        this._c3 = c3;
        this._c4 = c4;

        for (const cat of categories)
        {
            const row = this._makeRow(cat.label, true, cat.icon ?? null, null, null, null, this._catCount(cat));
            row.attr('data-la-key', cat.label);
            const openCat = ({ silent = false } = {}) =>
            {
                this._searchActive = false;
                _cancelCollapse();
                if (!silent)
                    playUiSound();
                if (/** @type {any} */ (cat).isStatusPanel)
                {
                    if (row.hasClass('la-hud-active') && this._statusPanelInstance?.isVisible)
                    {
                        if (clickToOpen)
                        {
                            this._statusPanelInstance.close(); _clearC1Active();
                        }
                        return;
                    }
                    this._closePanels({ except: this._statusPanelInstance });
                    this._setActive(c1, row, true);
                    closeCol(c2, 80); closeCol(c3, 80); closeCol(c4, 80);
                    if (silent)
                        this._statusPanelInstance.openSilent(row);
                    else
                        this._statusPanelInstance.open(row);
                    return;
                }
                if (row.hasClass('la-hud-active') && c2.is(':visible'))
                {
                    if (clickToOpen)
                    {
                        closeCol(c2); closeCol(c3); closeCol(c4); _clearC1Active();
                    }
                    return;
                }
                this._closePanels();
                this._setActive(c1, row, true);
                closeCol(c3, 80);
                closeCol(c4, 80);
                this._c2Category = cat; this._c2AnchorRow = row;
                this._c3SourceItem = null; this._c4SourceItem = null;
                {
                    const colLabel = /** @type {any} */ (cat).colLabel;
                    c2.find('.la-hud-col-label')
                        .attr('data-col', 'category')
                        .text(typeof colLabel === 'function' ? colLabel() : colLabel);
                }
                this._openCol(c2, /** @type {any} */ (cat).getItems(), row);
                slideInCol(c2, { silent });
                this._fitCol(c2);
            };
            row.data('laOpen', openCat);
            if (clickToOpen)
            {
                row.on('mouseenter', () =>
                {
                    _cancelCollapse();
                    playUiSound('hover');
                });
                row.on('mouseleave', () =>
                {
                    if (!row.hasClass('la-hud-active'))
                        row.css({ background: row.data('restingBg') ?? BG_DEFAULT });
                });
                row.on('click', () => openCat());
            }
            else
            {
                row.on('mouseenter', (ev) => this._withIntent(ev, c2, openCat));
                row.on('mouseleave', () => this._cancelIntent());
            }
            c1.append(row);
        }

        // Safe-zone collapse: fires only when mouse leaves ALL visible columns
        let _leaveTimer = null;
        const _clearC1Active = () =>
        {
            c1.find('.la-hud-row').each((_index, element) => this._restRow($(element)));
        };
        const _collapseAll = () =>
        {
            closeCol(c2);
            closeCol(c3);
            closeCol(c4);
            this._closePanels();
            _clearC1Active();
            $(document.querySelectorAll('.la-hud-popup')).stop(true).animate({ opacity: 0 }, 120, function()
            {
                $(this).remove();
            });
        };
        const _scheduleCollapse = () =>
        {
            clearTimeout(_leaveTimer);
            const collapseDelay = hoverCloseDelay + this._collapseBonusMs;
            this._collapseBonusMs = 0;
            _leaveTimer = setTimeout(() =>
            {
                if (this._searchActive || this._pickerSuppress)
                    return;
                _collapseAll();
            }, collapseDelay);
        };
        const _cancelCollapse = () => clearTimeout(_leaveTimer);
        this._scheduleCollapse = _scheduleCollapse;
        this._cancelCollapse   = _cancelCollapse;
        this._clearC1Active    = _clearC1Active;
        this._collapseAll      = _collapseAll;
        this._closePanels();
        const panelOptions = {
            actor: this._actor,
            token: this._token,
            el:    hud,
            cancelCollapse:  _cancelCollapse,
            scheduleCollapse: clickToOpen ? () =>
            {} : _scheduleCollapse,
        };
        this._statusPanelInstance = new StatusPanel({
            ...panelOptions,
            tokens: this._tokens,
            ...this._depthCallbacks(),
            suppressCollapse: (on) => { this._pickerSuppress = on; },
            extendCollapse: () => { this._collapseBonusMs = 1000; },
        });
        this._logPanelInstance = new LogPanel(panelOptions);
        this._glossaryPanelInstance = new GlossaryPanel(panelOptions);
        this._bondPanelInstance = new BondPanel(panelOptions);
        hud.on('mouseleave', () =>
        {
            if (!clickToOpen)
                _scheduleCollapse();
        }).on('mouseenter', _cancelCollapse);
        hud.on('mousemove', (ev) => this._trackPointer(ev));
        hud.on('mouseleave', () =>
        {
            this._quietEl = null;
        });
        hud[0].addEventListener('mouseover', (ev) =>
        {
            if (!this._quietEl)
                return;
            const target = /** @type {HTMLElement} */ (ev.target).closest?.('.la-hud-row, .la-hud-cell');
            if (target === this._quietEl)
            {
                ev.stopPropagation();
                return;
            }
            this._quietEl = null;
        }, true);
        if (!this._kbBound)
            this._kbBound = (e) => this._kbHandleKey(e);
        window.removeEventListener('keydown', this._kbBound, true);
        window.addEventListener('keydown', this._kbBound, true);
        $(document).off('mousedown.la-hud-kbreset').on('mousedown.la-hud-kbreset', (ev) =>
        {
            if (!this._el || !this._el.find('.la-hud-kbfocus').length)
                return;
            if (this._el[0] && $.contains(this._el[0], ev.target))
                return;
            if ($(ev.target).closest('.la-hud-popup, .la-hud-popup-bridge').length)
                return;
            this._kbReset();
        });
        for (const col of [c2, c3, c4])
        {
            if (!clickToOpen)
                col.on('mouseleave', _scheduleCollapse);
            col.on('mouseenter', _cancelCollapse);
        }
        $(document).off('mousedown.la-hud-cto');
        if (!clickToOpen)
        {
            // Leaving any c1 category row toward the header area schedules collapse
            c1.on('mouseleave', '.la-hud-row', _scheduleCollapse);
        }
        else
        {
            // Click outside the HUD to collapse
            $(document).on('mousedown.la-hud-cto', (ev) =>
            {
                if (!this._el)
                    return;
                if (!$.contains(this._el[0], /** @type {Element} */ (/** @type {unknown} */ (ev.target))) && !$(ev.target).closest('.la-hud-popup, .la-hud-popup-bridge, .la-menu-popup').length)
                    _collapseAll();
            });
        }
        // Title / stats / menu-label area. Hovering it closes open columns.
        const onHeaderEnter = () =>
        {
            _clearC1Active();
            if (!clickToOpen)
                _scheduleCollapse();
        };
        c1.on('mouseenter', '.la-hud-token-title, #la-hud-stats', onHeaderEnter);
        menuCell.on('mouseenter', onHeaderEnter);
        searchIcon.on('mouseenter', onHeaderEnter);

        const setSearchOpen = (/** @type {boolean} */ open, { animate = true } = {}) =>
        {
            menuLabel.toggleClass('la-hud-menu-band--search', open);
            searchIcon.css('opacity', open ? '1' : '0.55');
            searchBar.stop(true, true);
            if (open && animate)
                searchBar.fadeIn(120, () => searchBar.trigger('focus'));
            else if (open)
                searchBar.show();
            else
            {
                searchBar.trigger('blur');
                if (animate)
                    searchBar.fadeOut(120);
                else
                    searchBar.hide();
            }
        };
        this._setSearchOpen = setSearchOpen;
        searchIcon.on('click', (ev) =>
        {
            ev.stopPropagation();
            playUiSound('details');
            if (searchBar.is(':visible'))
            {
                searchBar.val('');
                setSearchOpen(false);
                this._searchActive = false;
                closeCol(c2); closeCol(c3); closeCol(c4);
            }
            else
                setSearchOpen(true);
        });
        const runSearch = ({ animate = true } = {}) =>
        {
            const q = String(searchBar.val()).trim().toLowerCase();
            if (!q)
            {
                this._searchActive = false;
                closeCol(c2);
                return;
            }
            this._searchActive = true;
            _cancelCollapse();
            this._c2Category = null; this._c2AnchorRow = null;
            this._c3SourceItem = null; this._c4SourceItem = null;
            openSearchResults(c2, collectSearchResults(q, this._categories, favKeyOf), { el: this._el, makeRow: (...rowArgs) => this._makeRow(...rowArgs), token: this._token, animate });
            this._fitCol(c2);
        };
        this._rerunSearch = runSearch;
        searchBar.on('input', () => runSearch());
        searchBar.on('mouseenter click', () =>
        {
            if (String(searchBar.val()).trim())
                runSearch();
        });
        searchBar.on('keydown', (ev) =>
        {
            if (ev.key === 'Escape')
            {
                searchIcon.trigger('click');
                return;
            }
            if (ev.key === 'Enter')
            {
                ev.preventDefault();
                if (ev.originalEvent?.repeat || this._kbResultsKey() !== 'results')
                    return;
                const resultRows = c2.find('.la-hud-row');
                const focusedRow = resultRows.filter('.la-hud-kbfocus').first();
                (focusedRow.length ? focusedRow : resultRows.first()).trigger('click');
                return;
            }
            const bindings = /** @type {any[]} */ (game.keybindings.get(MODULE_ID,'tah.toggleSearch') ?? []);
            const match = bindings.some(b =>
            {
                if (b.key !== ev.code)
                    return false;
                const mods = b.modifiers ?? [];
                return ev.altKey   === mods.includes('Alt')
                    && ev.ctrlKey  === mods.includes('Control')
                    && ev.shiftKey === mods.includes('Shift');
            });
            if (match)
            {
                ev.preventDefault();
                ev.stopPropagation();
                searchIcon.trigger('click');
            }
        });
        searchBar.on('focus', () => _cancelCollapse());

        // Favorites
        const listFavorites = ({ animate = true } = {}) =>
        {
            openSearchResults(c2, collectFavorites(this._categories), {
                el: this._el,
                makeRow: (...rowArgs) => this._makeRow(...rowArgs),
                token: this._token,
                view: 'favorites',
                animate,
                onCtrlRightClick: async (item, row, ev) =>
                {
                    if (await this._pickFavoriteWheel(item, null, ev.clientX, ev.clientY) !== null)
                        listFavorites();
                }
            });
            this._fitCol(c2);
        };
        this._relistFavorites = listFavorites;
        const openFavorites = () =>
        {
            this._searchActive = false;
            this._closePanels();
            _clearC1Active();
            _cancelCollapse();
            playUiSound();
            this._c2Category = null; this._c2AnchorRow = null;
            this._c3SourceItem = null; this._c4SourceItem = null;
            closeCol(c3, 80); closeCol(c4, 80);
            listFavorites();
        };
        this._openFavorites = openFavorites;
        const isFavoritesOpen = () => c2.is(':visible') && c2.find('.la-hud-col-label').attr('data-col') === 'favorites';
        this._toggleFavorites = () =>
        {
            if (isFavoritesOpen())
            {
                closeCol(c2, 80);
                this._c2Category = null;
                this._c2AnchorRow = null;
                return;
            }
            openFavorites();
        };
        let favHovering = false;
        const applyFavStyle = () =>
        {
            const open = isFavoritesOpen();
            favIcon
                .toggleClass('la-hud-fav-icon--open', open)
                .toggleClass('la-hud-fav-icon--hover', favHovering && !open);
        };
        const favObserver = new MutationObserver(() => applyFavStyle());
        favObserver.observe(c2[0], { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        favIcon.on('mouseenter', (ev) =>
        {
            favHovering = true;
            _cancelCollapse();
            applyFavStyle();
            if (!clickToOpen && !searchBar.is(':visible'))
                this._withIntent(ev, c2, openFavorites);
        });
        favIcon.on('mouseleave', () =>
        {
            favHovering = false;
            applyFavStyle();
            this._cancelIntent();
            if (!clickToOpen)
                _scheduleCollapse();
        });
        favIcon.on('click', (ev) =>
        {
            ev.stopPropagation();
            openFavorites();
        });
    }

    // Multi-token intersection filter

    _filterIntersect(items)
    {
        if (this._tokens.length <= 1)
            return items;
        const others = this._tokens.slice(1).map(t => t.actor);
        return items.filter(item =>
        {
            if (item.isSectionLabel || item.inputCell)
                return true;
            const lid = item.hoverData?.item?.system?.lid;
            if (!lid)
                return true; // universal action (Basic Attack, Stabilize, etc.)
            return others.every(a => /** @type {any} */ (a).items.some(i => i.system?.lid === lid));
        });
    }

    // anchorRow: parent row this column aligns with vertically.

    _sectionView(/** @type {any[]} */ items)
    {
        const kept = items.filter((item, index) => !item.isSectionLabel || (index + 1 < items.length && !items[index + 1].isSectionLabel));
        return kept[0]?.isSectionLabel ? { header: kept[0], rows: kept.slice(1) } : { header: null, rows: kept };
    }

    _hasContent(/** @type {any[]} */ items)
    {
        return this._sectionView(items).rows.some(item => !item.isSectionLabel && !item.muted);
    }

    _usableCount(/** @type {any[]} */ items)
    {
        return items.filter(item => !item.isSectionLabel && !item.muted && !item.noCount).length;
    }

    _catHasContent(/** @type {any} */ cat)
    {
        if (!cat.getItems || cat.keepPlace || cat.isStatusPanel || cat.isLogPanel)
            return true;
        try
        {
            return this._hasContent(cat.getItems() ?? []);
        }
        catch
        {
            return true;
        }
    }

    _fitCol(col)
    {
        const hudEl = this._el?.[0];
        const menuLabel = this._el?.children().first().children('.la-hud-col-label')[0];
        if (!hudEl || !menuLabel || !col?.is(':visible'))
            return;
        const scale = tahScale();
        const hudTop = hudEl.getBoundingClientRect().top;
        const menuTop = (menuLabel.getBoundingClientRect().top - hudTop) / scale;
        const bottom = (window.innerHeight - 8 - hudTop) / scale;
        const top = parseFloat(col.css('top')) || 0;
        const height = col.outerHeight();
        if (top + height <= bottom)
            return;
        col.css({ top: Math.max(menuTop, bottom - height) });
        if (height > bottom - menuTop)
            col.css({ maxHeight: `${bottom - menuTop}px`, overflowY: 'auto' });
    }

    _openCol(col, items, anchorRow, { reposition = true } = {})
    {
        const canOpen = col !== this._c4;
        const childrenOf = new Map();
        const pruned = this._filterIntersect(items).filter(item =>
        {
            if (!canOpen || !item.getChildren || item.keepPlace || this._panelFor(item))
                return true;
            const children = item.getChildren();
            childrenOf.set(item, children);
            return children === null || this._hasContent(children);
        });
        const { header: headerItem, rows: filteredItems } = this._sectionView(pruned);
        if (headerItem)
            col.find('.la-hud-col-label').text(headerItem.text ?? headerItem.label);
        col.children(':not(.la-hud-col-label)').remove();
        this._el?.find('.la-hud-row--glow').removeClass('la-hud-row--glow');
        // Page-relative offset minus HUD offset so it's correct whichever column anchorRow lives in (c1 or c2).
        if (reposition && anchorRow && this._el)
        {
            const aOff = anchorRow.offset();
            const eOff = this._el.offset();
            if (aOff && eOff)
                col.css({ top: (aOff.top - eOff.top) / tahScale() - 22 });
        }

        if (!filteredItems.length)
        {
            col.append(`<div class="la-hud-muted la-hud-muted--empty">Empty</div>`);
            return;
        }

        const keyCounts = new Map();
        for (const item of filteredItems)
        {
            if (item.isSectionLabel)
            {
                const iconHtml = item.icon ? laHudRenderIcon(item.icon) : '';
                col.append(`<div class="la-hud-section-label">${iconHtml}${item.labelHtml ?? escapeHtml(item.text ?? item.label)}</div>`);
                continue;
            }
            if (item.inputCell)
            {
                const cell = buildValueCell(item, this._depthCallbacks());
                cell.data('laHoverPaint', () => cell.css({ background: BG_ACTIVE, color: TEXT_ACTIVE }));
                cell.on('mouseenter', (ev) =>
                {
                    this._cancelCollapse?.();
                    this._withIntent(ev, this._childColOf(col), () =>
                    {
                        if (!this._clickToOpen)
                            this._onLeafHover(col);
                    });
                    cell.css({ background: BG_ACTIVE, color: TEXT_ACTIVE });
                    playUiSound('hover');
                    const clip = cell.find('.la-hud-clip')[0]; const pan = cell.find('.la-hud-pan')[0];
                    if (clip && pan)
                    {
                        const overflow = pan.scrollWidth - clip.clientWidth; if (overflow > 4)
                            $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                    }
                });
                cell.on('mouseleave', () =>
                {
                    this._cancelIntent();
                    cell.css({ background: cell.data('restingBg') ?? BG_DEFAULT, color: '' });
                    cell.find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
                });
                if (item.onRightClick)
                {
                    markRightClick(cell);
                    cell.on('contextmenu', ev =>
                    {
                        ev.preventDefault();
                        playUiSound('details');
                        item.onRightClick(cell);
                    });
                }
                if (item.indent)
                    cell.addClass('la-hud-indent');
                const cellKey = this._rowKey(item);
                if (cellKey != null)
                {
                    const seen = keyCounts.get(cellKey) ?? 0;
                    keyCounts.set(cellKey, seen + 1);
                    cell.attr('data-la-key', seen ? `${cellKey}#${seen + 1}` : cellKey);
                }
                col.append(cell);
                continue;
            }
            if (item.muted)
            {
                const slot = $(htmlToElement(`<div class="la-hud-muted la-hud-muted--empty la-hud-muted--slot">${escapeHtml(item.text ?? item.label)}</div>`));
                slot.on('mouseenter', (ev) =>
                {
                    this._cancelCollapse?.();
                    this._withIntent(ev, this._childColOf(col), () =>
                    {
                        if (!this._clickToOpen)
                            this._onLeafHover(col);
                    });
                });
                slot.on('mouseleave', () => this._cancelIntent());
                col.append(slot);
                continue;
            }
            const panel = this._panelFor(item);
            const rawChildren = childrenOf.has(item) ? childrenOf.get(item) : (canOpen && item.getChildren ? item.getChildren() : null);
            const hasChildren = canOpen && (rawChildren !== null || !!panel);
            const childCount = item.childCount ?? (hasChildren && rawChildren ? this._usableCount(this._sectionView(rawChildren).rows) : 0);
            const row = this._makeRow(item.text ?? item.label, hasChildren, item.icon, item.activation ?? null, item.badge ?? null, item.badgeTone ?? null, childCount, item.sizeLevel ?? null, item.labelHtml ?? null);
            const baseKey = this._rowKey(item);
            if (baseKey != null)
            {
                const seen = keyCounts.get(baseKey) ?? 0;
                keyCounts.set(baseKey, seen + 1);
                row.attr('data-la-key', seen ? `${baseKey}#${seen + 1}` : baseKey);
            }
            row.data('laItem', item);
            if (item.indent)
                row.addClass('la-hud-indent');
            if (item.mountKey != null)
                row.attr('data-la-mount', item.mountKey);
            if (item.glowMounts?.length)
            {
                row.on('mouseenter', () => this._glowMounts(item.glowMounts, true));
                row.on('mouseleave', () => this._glowMounts(item.glowMounts, false));
            }
            if (item.onBadgeClick)
            {
                row.find('.la-hud-badge').css('cursor', 'pointer').on('click', (ev) =>
                {
                    ev.stopPropagation();
                    item.onBadgeClick();
                });
            }
            const isFavoritable = !item.isSectionLabel && !!item.onClick && !!favKeyOf(item);
            const itemWheel = isFavoritable ? favoriteWheelOf(item) : 0;
            if (itemWheel)
                applyFavMark(row, itemWheel);
            row.on('contextmenu', async (ev) =>
            {
                if (!ev.ctrlKey)
                    return;
                ev.preventDefault();
                ev.stopImmediatePropagation();
                if (!isFavoritable)
                {
                    this._showQuickTip(ev.clientX, ev.clientY, "Can't favorite this");
                    return;
                }
                await this._pickFavoriteWheel(item, row, ev.clientX, ev.clientY);
            });

            const _stripeStyle = laHudStripeStyle(item);
            if (_stripeStyle)
            {
                applyStripeStyle(row, _stripeStyle);
                if (!_stripeStyle.light)
                    row.find('.la-hud-fav-mark').css('color', '#fff');
                if (item.softDisabled)
                    row.css({ cursor: 'not-allowed' });
            }

            // Subtle automation hint: tiny rightward triangle attached to the left status bar (same color as the bar).
            if (hasAutomation(item.hoverData?.item) || hasAutomation(item.hoverData?.action?.name ?? item.label))
            {
                row.css('position', 'relative');
                const _tickColor = _stripeStyle ? _stripeStyle.color : 'var(--primary-color)';
                row.append(`<span class="la-hud-auto-tick" style="position:absolute;left:3px;top:50%;transform:translateY(-50%);width:0;height:0;border-left:4px solid ${_tickColor};border-top:3px solid transparent;border-bottom:3px solid transparent;pointer-events:none;"></span>`);
            }

            // Hover sound on leaf rows (and Log / Glossary) in hover mode, on every row in click-to-open mode.
            if (this._clickToOpen || !hasChildren || panel)
                row.on('mouseenter', () => playUiSound('hover'));

            if (col !== this._c4 && !this._clickToOpen)
            {
                row.on('mouseleave', () => this._cancelIntent());
                row.on('mouseenter', (ev) => this._withIntent(ev, this._childColOf(col), () =>
                {
                    document.querySelectorAll('.la-hud-popup').forEach(node => node.remove());
                    if (panel)
                    {
                        if (panel.isVisible && panel._anchor?.attr('data-la-key') === row.attr('data-la-key'))
                            return;
                        this._closePanels({ except: panel });
                        this._clearActive(col);
                        closeCol(this._c3, 80);
                        closeCol(this._c4, 80);
                        panel.open(row);
                    }
                    else if (hasChildren)
                        this._closePanels({ except: this._statusPanelInstance });
                    else
                        this._onLeafHover(col);
                }));
            }

            // Log / Glossary panels skip the hover handler above, so click-to-open mode binds the click here.
            if (this._clickToOpen && panel)
            {
                row.on('click', () =>
                {
                    playUiSound('open');
                    document.querySelectorAll('.la-hud-popup').forEach(node => node.remove());
                    this._setActive(col, row);
                    this._closePanels({ except: panel });
                    closeCol(this._c3, 80);
                    closeCol(this._c4, 80);
                    panel.open(row);
                });
            }
            if (item.onClick)
            {
                const spendKind = activationSpendKind(item.spendActivation ?? item.activation ?? item.hoverData?.action?.activation ?? null);
                const cueKind = spendKind ?? (item.noRowClick ? PLAIN_ATTACK_CUE : null);
                if (cueKind)
                {
                    row.on('mouseenter', () =>
                    {
                        this._spendHover = { row, kind: cueKind };
                        this._paintSpendCue();
                    });
                    row.on('mouseleave', () =>
                    {
                        if (this._spendHover?.row === row)
                            this._spendHover = null;
                        this._paintSpendCue();
                    });
                }
                const runAction = async (_event, { free = isForceFreeMovement() } = {}) =>
                {
                    if (spendKind)
                        armFreeUse(free && FREE_USE_KINDS.has(spendKind) ? this._actor : null);
                    playUiSound(item.clickSound ?? 'open');
                    for (const t of this._tokens ?? [])
                        deactivateRangePreview(t);
                    if (!item.keepOpen)
                    {
                        row.trigger('mouseleave');
                        closeCol(this._c2);
                        closeCol(this._c3);
                        closeCol(this._c4);
                        this._closePanels();
                        this._clearC1Active();
                    }
                    const multi = this._tokens.length > 1 && item.broadcastFn;
                    if (multi)
                    {
                        // Fire primary + every other token concurrently, none awaiting the others.
                        Promise.resolve(item.onClick()).catch(e => console.error('lancer-automations | TAH primary |', e));
                        for (const t of this._tokens.slice(1))
                        {
                            Promise.resolve(item.broadcastFn(t, t.actor))
                                .catch(e => console.error('lancer-automations | TAH broadcast |', e));
                        }
                    }
                    else
                    {
                        if (item.keepOpen && item.refreshCol4)
                            this._suppressRefreshDepth++;
                        try
                        {
                            await item.onClick();
                        }
                        finally
                        {
                            if (item.keepOpen && item.refreshCol4)
                            {
                                this._releaseDepth();
                                if (col === this._c3)
                                    this._openCol(this._c3, item.refreshCol4(), anchorRow, { reposition: false });
                                else if (this._c4AnchorRow)
                                    this._openCol(this._c4, item.refreshCol4(), this._c4AnchorRow, { reposition: false });
                            }
                        }
                    }
                };
                row.data('laRunAction', runAction);
                row.data('laFreeUse', FREE_USE_KINDS.has(spendKind));
                if (!item.noRowClick)
                    row.on('click', runAction);
                else
                {
                    row.on('click', (event) =>
                    {
                        if (!isForceFreeMovement())
                            return;
                        event.stopImmediatePropagation();
                        runAction(event);
                    });
                }
            }
            if (item.onRightClick)
            {
                markRightClick(row);
                row.on('contextmenu', ev =>
                {
                    ev.preventDefault();
                    playUiSound('details');
                    item.onRightClick(row);
                });
            }
            if (item.hoverData)
            {
                const hd = item.hoverData;
                const token = this._token;
                row.on('mouseenter', () => onHudRowHover({ ...hd, token, el: row[0], isEntering: true,  isLeaving: false }));
                row.on('mouseleave', () => onHudRowHover({ ...hd, token, el: row[0], isEntering: false, isLeaving: true  }));
            }
            if (hasChildren && !panel)
            {
                const openChild = ({ silent = false } = {}) =>
                {
                    if (col === this._c2 && row.hasClass('la-hud-active') && this._c3.is(':visible'))
                    {
                        if (this._clickToOpen)
                        {
                            closeCol(this._c3);
                            closeCol(this._c4);
                            this._restRow(row);
                        }
                        else
                            this._cancelCollapse();
                        return;
                    }
                    if (col === this._c3 && row.hasClass('la-hud-active') && this._c4.is(':visible'))
                    {
                        if (this._clickToOpen)
                        {
                            closeCol(this._c4);
                            this._restRow(row);
                        }
                        else
                            this._cancelCollapse();
                        return;
                    }
                    this._setActive(col, row);
                    if (!silent)
                        playUiSound();
                    // Close any panels (log / glossary / status / bond) before drilling into a new child column.
                    this._closePanels();
                    const freshChildren = item.getChildren ? item.getChildren() : rawChildren;
                    if (col === this._c2)
                    {
                        closeCol(this._c4, 80);
                        this._openChildCol(col, this._c3, item, freshChildren, row, { silent });
                    }
                    else if (col === this._c3)
                    {
                        this._c4AnchorRow = row;
                        this._openChildCol(this._c3, this._c4, item, freshChildren, row, { silent });
                    }
                };
                row.data('laOpen', openChild);
                if (!this._clickToOpen)
                {
                    row.on('mouseenter', () =>
                    {
                        if (row.hasClass('la-hud-active') && this._childColOf(col)?.is(':visible'))
                            playUiSound();
                    });
                    row.on('mouseenter', (ev) => this._withIntent(ev, this._childColOf(col), openChild));
                    row.on('mouseleave', () => this._cancelIntent());
                }
                else if (!item.onClick || item.noRowClick)
                    row.on('click', () => openChild());
                else
                {
                    // Row click fires the action, only the arrow drills in.
                    row.find('.la-hud-arrow').addClass('la-hud-arrow--split').on('click', (ev) =>
                    {
                        ev.stopPropagation();
                        openChild();
                    });
                }
            }

            col.append(row);
        }

        capColumnItems(col, filteredItems.length);
        this._fitCol(col);
    }

    /** Open a child column positioned to the right of parentCol and animate it in. */
    _openChildCol(/** @type {any} */ parentCol, /** @type {any} */ childCol, /** @type {any} */ item, /** @type {any} */ children, /** @type {any} */ row, { silent = false } = {})
    {
        if (childCol === this._c3)
        {
            this._c3SourceItem = item;
            this._c4SourceItem = null;
        }
        else if (childCol === this._c4)
            this._c4SourceItem = item;
        childCol.find('.la-hud-col-label').attr('data-col', 'child').text(item.childColLabel ?? '');
        childCol.css({ left: parentCol.position().left / tahScale() + parentCol.outerWidth() });
        this._openCol(childCol, children, row);
        slideInCol(childCol, { silent });
        this._fitCol(childCol);
    }

    _childColOf(col)
    {
        if (col === this._c2)
            return this._c3;
        if (col === this._c3)
            return this._c4;
        return null;
    }

    _trackPointer(ev)
    {
        this._kbExitMode();
        this._lastHudPointerMove = Date.now();
        this._pointerTrail.push({ x: ev.clientX, y: ev.clientY, time: performance.now() });
        if (this._pointerTrail.length > 4)
            this._pointerTrail.shift();
    }

    _intentTarget(child)
    {
        if (child?.is(':visible'))
            return child[0];
        return this._el?.children('.la-hud-panel, .la-hud-status-panel').filter(':visible').get(0) ?? null;
    }

    _aimingAt(target)
    {
        const trail = this._pointerTrail;
        if (!target || trail.length < 2)
            return false;
        const point = trail[trail.length - 1];
        const prev = trail[0];
        if (performance.now() - point.time > 120)
            return false;
        const rect = target.getBoundingClientRect();
        if (prev.x >= rect.left || point.x >= rect.left)
            return false;
        const slope = (from, to) => (to.y - from.y) / (to.x - from.x);
        const top = { x: rect.left, y: rect.top };
        const bottom = { x: rect.left, y: rect.bottom };
        return slope(point, top) < slope(prev, top) && slope(point, bottom) > slope(prev, bottom);
    }

    _withIntent(ev, child, open)
    {
        if (!ev?.originalEvent || !this._aimingAt(this._intentTarget(child)))
        {
            open();
            return;
        }
        const timer = setTimeout(() =>
        {
            this._intentTimers.delete(timer);
            this._withIntent(ev, child, open);
        }, 180);
        this._intentTimers.add(timer);
    }

    _cancelIntent()
    {
        for (const timer of this._intentTimers)
            clearTimeout(timer);
        this._intentTimers.clear();
    }

    _buildCategories()
    {
        this._categoryBuilder ??= new HudCategories(this);
        return this._categoryBuilder._buildCategories();
    }

    _glowMounts(keys, on)
    {
        this._c2?.find('.la-hud-row[data-la-mount]').each((_index, element) =>
        {
            const rowEl = $(element);
            const lit = on && keys.includes(Number(rowEl.attr('data-la-mount'))) && !rowEl.hasClass('la-hud-active');
            rowEl.toggleClass('la-hud-row--glow', lit);
        });
    }

    _showPopupAt(popup, anchorEl)
    {
        showPopupAt(popup, anchorEl, {
            cancelCollapse:   () => this._cancelCollapse?.(),
            scheduleCollapse: () => this._scheduleCollapse?.(),
        });
    }

    // Helpers

    /** Refresh visible column contents without touching structure, popups, or timers. */
    _refreshColumnsInPlace()
    {
        if (!this._c2Category?.getItems || !this._c2?.is(':visible'))
            return;
        this._cancelIntent();
        const c3Open = !!this._c3?.is(':visible');
        const c4Open = c3Open && !!this._c4?.is(':visible');
        const activeKey = col => col?.find('.la-hud-row.la-hud-active').first().attr('data-la-key');
        const c2Key = activeKey(this._c2);
        const c3Key = activeKey(this._c3);
        const scrolls = [this._c2, this._c3, this._c4].map(col => col?.scrollTop() ?? 0);
        const relink = (col, key, fallback) =>
        {
            if (key === undefined)
                return { item: fallback?.getChildren ? fallback : null, row: null, gone: false };
            const row = this._rowByKey(col, key);
            const item = row?.data('laItem');
            if (!row || !item?.getChildren)
                return { item: null, row: null, gone: true };
            this._setActive(col, row);
            return { item, row, gone: false };
        };

        this._openCol(this._c2, this._c2Category.getItems(), this._c2AnchorRow);
        this._c2.scrollTop(scrolls[0]);
        if (!c3Open)
            return;

        const c3Link = relink(this._c2, c2Key, this._c3SourceItem);
        if (c3Link.gone)
        {
            closeCol(this._c3, 80);
            closeCol(this._c4, 80);
        }
        if (!c3Link.item)
            return;
        this._c3SourceItem = c3Link.item;
        this._c3.css({ left: this._c2.position().left / tahScale() + this._c2.outerWidth() });
        this._openCol(this._c3, c3Link.item.getChildren(), c3Link.row, { reposition: !!c3Link.row });
        this._c3.scrollTop(scrolls[1]);
        if (!c4Open)
            return;

        const c4Link = relink(this._c3, c3Key, this._c4SourceItem);
        if (c4Link.gone)
            closeCol(this._c4, 80);
        if (!c4Link.item)
            return;
        this._c4SourceItem = c4Link.item;
        if (c4Link.row)
            this._c4AnchorRow = c4Link.row;
        this._c4.css({ left: this._c3.position().left / tahScale() + this._c3.outerWidth() });
        this._openCol(this._c4, c4Link.item.getChildren(), c4Link.row, { reposition: !!c4Link.row });
        this._c4.scrollTop(scrolls[2]);
    }

    async _writeInPlace(/** @type {() => Promise<any>} */ write)
    {
        this._suppressRefreshDepth++;
        try
        {
            await write();
        }
        finally
        {
            this._releaseDepth();
        }
        this.updateStatsInPlace();
        const hover = this._captureHover();
        const kb = this._captureKb();
        this._patchColumns();
        this._restoreKb(kb);
        this._restoreHover(hover);
    }

    _saveOpenPath()
    {
        if (!this._el)
            return null;
        const getActiveKey = col => col.find('.la-hud-row.la-hud-active').first().attr('data-la-key') ?? null;
        const c1 = this._el.children().first();
        // Search active: don't save column state
        if (this._searchActive)
            return { searchActive: true };
        // Status panel open: c2 is hidden but c1 has an active row
        if (this._statusPanelInstance?.isVisible)
        {
            const c1Key = getActiveKey(c1);
            return c1Key !== null ? { c1Key, statusPanel: true } : null;
        }
        if (!this._c2?.is(':visible'))
            return null;
        const path = { c1Key: getActiveKey(c1), scrolls: [this._c2, this._c3, this._c4].map(col => col?.scrollTop() ?? 0) };
        if (path.c1Key === null)
            return null;
        if (this._c3?.is(':visible'))
            path.c2Key = getActiveKey(this._c2);
        if (this._c4?.is(':visible'))
            path.c3Key = getActiveKey(this._c3);
        return path;
    }

    _restoreOpenPath(path)
    {
        if (!path || path.searchActive || path.c1Key == null)
            return;
        const reopen = (row) => row.data('laOpen')?.({ silent: true });
        const scrolls = path.scrolls ?? [];
        const c1Row = this._rowByKey(this._el.children().first(), path.c1Key);
        if (!c1Row)
            return;
        reopen(c1Row);
        if (path.statusPanel)
            return;
        this._c2?.scrollTop(scrolls[0] ?? 0);
        const c2Row = this._rowByKey(this._c2, path.c2Key);
        if (!c2Row)
            return;
        reopen(c2Row);
        this._c3?.scrollTop(scrolls[1] ?? 0);
        const c3Row = this._rowByKey(this._c3, path.c3Key);
        if (!c3Row)
            return;
        reopen(c3Row);
        this._c4?.scrollTop(scrolls[2] ?? 0);
    }

    _rowByKey(col, key)
    {
        if (key == null || !col)
            return null;
        const row = col.find('.la-hud-row, .la-hud-cell').filter((_index, element) => element.dataset.laKey === key).first();
        return row.length ? row : null;
    }

    _kbColEl(depth)
    {
        if (depth <= 1)
            return this._el ? this._el.children().first() : null;
        if (depth === 2)
            return this._c2;
        if (depth === 3)
            return this._c3;
        return this._c4;
    }
    _kbColVisible(depth)
    {
        const col = this._kbColEl(depth);
        return !!(col && col.length && (depth === 1 || col.is(':visible')));
    }
    _kbRows(depth)
    {
        const col = this._kbColEl(depth);
        return col && col.length ? col.find('.la-hud-row, .la-hud-cell') : $();
    }
    _kbRestore(row)
    {
        if (row && row.length)
            row.triggerHandler('mouseleave'); // element's own leave handler (row or cell); no bubble, no collapse
    }
    _kbClearFocusMark()
    {
        if (!this._el)
            return;
        this._el.find('.la-hud-kbfocus').removeClass('la-hud-kbfocus');
        this._el.find('.la-hud-kb-chip').remove();
    }
    _kbLocate(row)
    {
        for (let depth = 1; depth <= 4; depth++)
        {
            if (!this._kbColVisible(depth))
                continue;
            const index = this._kbRows(depth).index(row);
            if (index >= 0)
            {
                this._kbCol = depth;
                this._kbIdx = index;
                return true;
            }
        }
        return false;
    }
    // Returns 'mark' for a live cursor, 'adopted' for the row under the pointer or the deepest open row, 'fresh' for c1/0.
    _kbEnsureFocus()
    {
        const marked = this._el ? this._el.find('.la-hud-kbfocus').first() : $();
        if (marked.length && this._kbLocate(marked))
            return 'mark';
        const hovered = this._el ? this._el.find('.la-hud-row:hover, .la-hud-cell:hover').last() : $();
        if (hovered.length && this._kbLocate(hovered))
            return 'adopted';
        for (let depth = 4; depth >= 1; depth--)
        {
            if (!this._kbColVisible(depth))
                continue;
            const active = this._kbRows(depth).filter('.la-hud-active').last();
            if (active.length && this._kbLocate(active))
                return 'adopted';
        }
        this._kbCol = 1;
        this._kbIdx = 0;
        return 'fresh';
    }
    _kbPaintChips(depth)
    {
        this._el.find('.la-hud-kb-chip').remove();
        this._kbRows(depth).slice(0, 9).each((index, element) =>
        {
            $(element).append(`<span class="la-hud-kb-chip" data-n="${index + 1}" aria-hidden="true"></span>`);
        });
    }
    _kbExitMode()
    {
        if (!this._el?.hasClass('la-hud-kb'))
            return;
        this._el.removeClass('la-hud-kb');
        this._el.find('.la-hud-kb-chip').remove();
        const hovered = this._el.find('.la-hud-row:hover, .la-hud-cell:hover').last();
        hovered.data('laHoverPaint')?.();
    }
    _kbJump(slot)
    {
        const marked = this._el.find('.la-hud-kbfocus').first();
        if (!(marked.length && this._kbLocate(marked)))
        {
            this._kbCol = 1;
            this._kbIdx = 0;
        }
        const depth = this._kbCol;
        const rows = this._kbRows(depth);
        if (slot > rows.length)
            return;
        this._kbFocusRow(depth, slot - 1);
        const row = rows.eq(slot - 1);
        if (this._clickToOpen)
        {
            if (row.find('.la-hud-arrow').length)
                this._kbDeeper();
            return;
        }
        const childDepth = depth + 1;
        const panelOpen = this._el.children('.la-hud-panel, .la-hud-status-panel').filter(':visible').length > 0;
        if (childDepth <= 4 && row.hasClass('la-hud-active') && this._kbColVisible(childDepth) && !panelOpen)
            this._kbFocusRow(childDepth, 0);
    }
    _kbFocusRow(depth, idx)
    {
        const rows = this._kbRows(depth);
        if (!rows.length)
            return;
        const clampedIdx = Math.max(0, Math.min(idx, rows.length - 1));
        const prevRow = this._kbRows(this._kbCol).eq(this._kbIdx);
        if (prevRow.length && !(this._kbCol === depth && this._kbIdx === clampedIdx))
            this._kbRestore(prevRow);
        this._kbClearFocusMark();
        this._kbCol = depth;
        this._kbIdx = clampedIdx;
        const row = rows.eq(clampedIdx);
        this._closePanels({ except: this._statusPanelInstance });
        this._kbScrollIntoView(row);
        row.triggerHandler('mouseenter'); // reopens the panel if this row is its opener
        row.addClass('la-hud-kbfocus');
        this._kbPaintChips(depth);
    }
    _kbScrollIntoView(row)
    {
        const box = row.closest('.la-hud-col')[0];
        if (!box || box.scrollHeight <= box.clientHeight)
            return;
        const scale = tahScale();
        const boxRect = box.getBoundingClientRect();
        const rowRect = row[0].getBoundingClientRect();
        const title = box.querySelector(':scope > .la-hud-col-label');
        const top = boxRect.top + (title ? title.getBoundingClientRect().height : 0);
        if (rowRect.top < top)
            box.scrollTop -= (top - rowRect.top) / scale;
        else if (rowRect.bottom > boxRect.bottom)
            box.scrollTop += (rowRect.bottom - boxRect.bottom) / scale;
    }
    _kbDeeper()
    {
        const currentRow = this._kbRows(this._kbCol).eq(this._kbIdx);
        if (currentRow.length && this._clickToOpen && !currentRow.hasClass('la-hud-active'))
            currentRow.find('.la-hud-arrow').trigger('click');
        else if (currentRow.length)
            currentRow.triggerHandler('mouseenter');
        const childDepth = this._kbCol + 1;
        if (childDepth > 4 || !this._kbRows(childDepth).length)
            return;
        this._kbFocusRow(childDepth, 0);
    }
    _kbBack()
    {
        if (this._kbCol <= 1)
            return;
        const parentDepth = this._kbCol - 1;
        const parentRows = this._kbRows(parentDepth);
        if (!parentRows.length)
            return;
        const currentRow = this._kbRows(this._kbCol).eq(this._kbIdx);
        const currentRect = currentRow.length ? currentRow[0].getBoundingClientRect() : null;
        const currentY = currentRect ? currentRect.top + currentRect.height / 2 : 0;
        currentRow.removeClass('la-hud-active'); // leaving this column: drop its highlight even if it was the path
        this._kbRestore(currentRow);
        let bestIdx = 0;
        let bestDist = Infinity;
        parentRows.each((index, element) =>
        {
            const rect = element.getBoundingClientRect();
            const dist = Math.abs(rect.top + rect.height / 2 - currentY);
            if (dist < bestDist)
            {
                bestDist = dist;
                bestIdx = index;
            }
        });
        this._kbFocusRow(parentDepth, bestIdx);
    }
    // Which column 2 is showing, from data-col because the header text is translated.
    _kbResultsKey()
    {
        return this._c2 && this._c2.is(':visible') ? (this._c2.find('.la-hud-col-label').attr('data-col') ?? '') : '';
    }
    _kbInResults()
    {
        const col = this._kbResultsKey();
        return this._kbCol === 2 && (col === 'favorites' || col === 'results');
    }
    // Above the top of the tree: an open search wins, then open results/favorites, else open favorites.
    _kbTopJump()
    {
        const clearOrigin = () =>
        {
            const originRow = this._kbRows(this._kbCol).eq(this._kbIdx);
            originRow.removeClass('la-hud-active');
            this._kbRestore(originRow);
            this._clearC1Active?.();
        };
        let col = this._kbResultsKey();
        if (col !== 'results' && this._searchBar && this._searchBar.is(':visible'))
        {
            if (!String(this._searchBar.val()).trim())
            {
                clearOrigin();
                this._kbClearFocusMark();
                this._searchBar.trigger('focus');
                return true;
            }
            this._searchBar.trigger('input');
            col = this._kbResultsKey();
        }
        if (col !== 'favorites' && col !== 'results')
        {
            if (!this._toggleFavorites)
                return false;
            this._toggleFavorites();
        }
        clearOrigin();
        if (!this._kbRows(2).length)
        {
            this._kbClearFocusMark();
            return true;
        }
        this._kbFocusRow(2, 0);
        return true;
    }
    // Leaving favorites / search results: close favorites and hand the cursor back to the first category.
    _kbExitResults()
    {
        if (this._kbResultsKey() === 'favorites')
            this._toggleFavorites?.();
        this._kbFocusRow(1, 0);
    }
    // At a column edge, continue into the child column of the sibling above/below the origin row.
    _kbEdgeJump(down)
    {
        if (this._kbCol <= 1)
            return false;
        const parentDepth = this._kbCol - 1;
        const parentRows = this._kbRows(parentDepth);
        if (!parentRows.length)
            return false;
        let originIdx = parentRows.index(parentRows.filter('.la-hud-active').first());
        if (originIdx < 0)
        {
            const currentRow = this._kbRows(this._kbCol).eq(this._kbIdx);
            const currentRect = currentRow.length ? currentRow[0].getBoundingClientRect() : null;
            const currentY = currentRect ? currentRect.top + currentRect.height / 2 : 0;
            let bestDist = Infinity;
            parentRows.each((index, element) =>
            {
                const rect = element.getBoundingClientRect();
                const dist = Math.abs(rect.top + rect.height / 2 - currentY);
                if (dist < bestDist)
                {
                    bestDist = dist;
                    originIdx = index;
                }
            });
        }
        const targetIdx = originIdx + (down ? 1 : -1);
        if (targetIdx < 0 || targetIdx >= parentRows.length)
            return false;
        if (!parentRows.eq(targetIdx).find('.la-hud-arrow').length)
            return false;
        this._kbFocusRow(parentDepth, targetIdx);
        this._kbDeeper();
        return true;
    }
    _kbActivate(rightClick)
    {
        const row = this._kbRows(this._kbCol).eq(this._kbIdx);
        if (!row.length)
            return;
        if (row.hasClass('la-hud-cell'))
        {
            activateValueCell(row, rightClick);
            return;
        }
        row.trigger(rightClick ? 'contextmenu' : 'click');
    }
    _kbReset()
    {
        if (this._clickToOpen)
            return;
        clearTimeout(this._kbResetTimer);
        this._kbResetTimer = null;
        this._kbClearFocusMark();
        closeCol(this._c2);
        closeCol(this._c3);
        closeCol(this._c4);
        this._clearC1Active?.();
        this._kbExitMode();
    }
    _kbArmInactivityReset()
    {
        clearTimeout(this._kbResetTimer);
        if (this._clickToOpen)
            return;
        const delay = (getModuleSetting('tah.keyboardNavResetDelay') ?? 5) * 1000;
        this._kbResetTimer = setTimeout(() =>
        {
            if (!this._el?.is(':hover'))
            {
                this._kbReset();
                return;
            }
            this._kbRestore(this._el.find('.la-hud-kbfocus').first());
            this._kbClearFocusMark();
            this._kbExitMode();
        }, delay);
    }
    _kbHandleKey(event)
    {
        if (!this._el)
            return;
        if (!getModuleSetting('tah.keyboardNav'))
            return;
        const focused = document.activeElement;
        const inInput = !!(focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable));
        const inHudInput = inInput && !!(this._el[0] && $.contains(this._el[0], focused));
        if (inInput && !inHudInput)
            return;
        let action = null;
        if (eventMatchesKeybind(event, 'tahNavUp'))
            action = 'up';
        else if (eventMatchesKeybind(event, 'tahNavDown'))
            action = 'down';
        else if (eventMatchesKeybind(event, 'tahNavLeft'))
            action = 'left';
        else if (eventMatchesKeybind(event, 'tahNavRight'))
            action = 'right';
        else if (eventMatchesKeybind(event, 'tahNavActivate'))
            action = 'click';
        else if (eventMatchesKeybind(event, 'tahNavContext'))
            action = 'context';
        let jump = 0;
        for (let slot = 1; slot <= 9 && !action && !jump; slot++)
        {
            if (eventMatchesKeybind(event, `tahNavRow${slot}`))
                jump = slot;
        }
        if (jump)
            action = 'jump';
        if (!action)
        {
            if (event.key === 'Escape' || KB_MODIFIER_CODES.has(event.code) || event.repeat)
                return;
            if (!inHudInput && this._el.find('.la-hud-kbfocus').length)
                this._kbReset();
            return;
        }
        if (action === 'jump' && (inInput || event.repeat))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!inHudInput && Date.now() - this._lastHudPointerMove < 350)
            return;
        this._cancelCollapse?.();
        this._el.addClass('la-hud-kb');
        if (action === 'jump')
        {
            this._kbJump(jump);
            this._kbArmInactivityReset();
            return;
        }
        if (this._kbEnsureFocus() === 'fresh')
        {
            // Fresh cursor with favorites or search results already open: enter that column first.
            const col = this._kbResultsKey();
            if ((col === 'favorites' || col === 'results') && this._kbRows(2).length)
                this._kbFocusRow(2, 0);
            else
                this._kbFocusRow(this._kbCol, this._kbIdx);
            this._kbArmInactivityReset();
            return;
        }
        if (action === 'up')
        {
            if (this._kbIdx > 0)
                this._kbFocusRow(this._kbCol, this._kbIdx - 1);
            else if (this._kbInResults())
            { /* top of favorites: stay */ }
            else if (this._kbCol === 1 || !this._kbEdgeJump(false))
                this._kbTopJump();
        }
        else if (action === 'down')
        {
            if (this._kbInResults() && this._kbIdx >= this._kbRows(2).length - 1)
                this._kbExitResults();
            else if (this._kbIdx >= this._kbRows(this._kbCol).length - 1)
                this._kbEdgeJump(true);
            else
                this._kbFocusRow(this._kbCol, this._kbIdx + 1);
        }
        else if (action === 'right')
            this._kbDeeper();
        else if (action === 'left')
        {
            if (this._kbInResults())
                this._kbExitResults();
            else
                this._kbBack();
        }
        else if (action === 'click')
            this._kbActivate(false);
        else if (action === 'context')
            this._kbActivate(true);
        this._kbArmInactivityReset();
    }

    _makeCol(label)
    {
        return $(htmlToElement(`<div class="la-hud-col lancer-scroll"><div class="la-hud-col-label">${label}</div></div>`));
    }

    _makeRow(label, hasArrow, icon = null, activation = null, badge = null, badgeTone = null, count = 0, sizeLevel = null, labelHtml = null)
    {
        if (icon && labelHtml == null && typeof label === 'string')
            noteRowIcon(label, icon);
        const mark = laHudSizeMark(sizeLevel);
        let iconHtml = icon ? laHudRenderIcon(icon, sizeLevel == null ? HUD_ICON_SIZE : HUD_WEAPON_ICON_SIZE) : '';
        if (mark)
            iconHtml = `<span class="la-hud-glyph${icon ? '' : ' la-hud-glyph--bare'}">${mark}${iconHtml}</span>`;
        const countHtml = hasArrow && count > 0 ? `<span class="la-hud-count">${count}</span>` : '';
        const arrow = hasArrow ? `<span class="la-hud-arrow">▶</span>` : '';
        const actHtml = activation ? `<span class="la-hud-activation">[${escapeHtml(activation)}]</span>` : '';
        const badgeHtml = badge ? `<span class="la-hud-badge la-hud-badge--${badgeTone ?? 'ok'}">${badge}</span>` : '';
        const row = $(htmlToElement(`<div class="la-hud-row">${iconHtml}<span class="la-hud-clip"><span class="la-hud-pan">${labelHtml ?? escapeHtml(label)}${actHtml}</span></span>${badgeHtml}${countHtml}${arrow}</div>`));
        const paintHover = () =>
        {
            if (row.hasClass('la-hud-active'))
                return;
            const specialBg = row.data('hoverBg');
            if (specialBg)
                row.css({ background: specialBg, color: row.data('hoverColor') ?? TEXT_DEFAULT });
            else
                row.css({ background: BG_ACTIVE, color: TEXT_ACTIVE });
        };
        row.data('laHoverPaint', paintHover);
        row.on('mouseenter', () =>
        {
            paintHover();
            const clip = row.find('.la-hud-clip')[0];
            const pan  = row.find('.la-hud-pan')[0];
            if (clip && pan)
            {
                const overflow = pan.scrollWidth - clip.clientWidth;
                if (overflow > 4)
                    $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
            }
        });
        row.on('mouseleave', () =>
        {
            if (!row.hasClass('la-hud-active'))
            {
                const css = { background: row.data('restingBg') ?? BG_DEFAULT, color: row.data('restingColor') ?? TEXT_DEFAULT };
                const rb  = row.data('restingBorder');
                if (rb)
                    css.borderLeftColor = rb;
                row.css(css);
            }
            row.find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
        });
        return row;
    }

    _showQuickTip(x, y, text)
    {
        const tip = $(htmlToElement(`<div style="position:fixed;left:${x + 12}px;top:${y + 12}px;background:#111;color:#fff;padding:4px 8px;border-radius:3px;font-size:0.8em;pointer-events:none;z-index:200;opacity:0;transition:opacity 0.1s;">${text}</div>`));
        tip.appendTo(document.body);
        requestAnimationFrame(() => tip.css('opacity', 1));
        setTimeout(() => tip.css('opacity', 0), 800);
        setTimeout(() => tip.remove(), 1000);
    }

    _rowKey(item)
    {
        if (item?.favKey || item?.hoverData?.item?.uuid || item?.stableKey || item?.onRightClick?.favId)
            return favKeyOf(item);
        return item?.text ?? item?.label ?? item?.name ?? (item?.pills ? `pills:${item.pills.map((/** @type {any} */ pill) => pill.label).join('|')}` : null);
    }

    // Ctrl+right-click asks which wheel, then repaints the row's mark from the answer.
    async _pickFavoriteWheel(item, row, x, y)
    {
        const chosen = await openFavoritePopup(x, y, favoriteWheelOf(item), {
            onEnter: () => this._cancelCollapse?.(),
            onLeave: () =>
            {
                if (!this._clickToOpen)
                    this._scheduleCollapse?.();
            }
        });
        if (chosen === null)
            return null;
        const key = favKeyOf(item);
        const legacy = legacyFavKeyOf(item);
        await setFavoriteWheel(key, chosen);
        if (legacy && legacy !== key)
            await setFavoriteWheel(legacy, 0);
        playUiSound('toggle');
        if (row)
        {
            clearFavMark(row);
            if (chosen)
                applyFavMark(row, chosen);
        }
        return chosen;
    }

    _panels()
    {
        return [this._statusPanelInstance, this._logPanelInstance, this._glossaryPanelInstance, this._bondPanelInstance].filter(Boolean);
    }

    _panelFor(item)
    {
        if (item.isLogPanel)
            return this._logPanelInstance;
        if (item.isGlossaryPanel)
            return this._glossaryPanelInstance;
        if (item.isBondPanel)
            return this._bondPanelInstance;
        return null;
    }

    _closePanels({ except = null } = {})
    {
        for (const panel of this._panels())
        {
            if (panel !== except)
                panel.close();
        }
    }

    _restRow(row)
    {
        row.css({ background: row.data('restingBg') ?? BG_DEFAULT, color: row.data('restingColor') ?? TEXT_DEFAULT }).removeClass('la-hud-active');
    }

    _clearActive(col)
    {
        col.find('.la-hud-active').each((_index, element) => this._restRow($(element)));
    }

    _onLeafHover(col)
    {
        this._closePanels({ except: this._statusPanelInstance });
        if (col !== this._c2 && col !== this._c3)
            return;
        this._clearActive(col);
        if (col === this._c2)
            closeCol(this._c3, 80);
        closeCol(this._c4, 80);
    }

    _setActive(col, activeRow, isCategory = false)
    {
        col.find('.la-hud-row').each(function()
        {
            const r = $(this);
            const css = { background: r.data('restingBg') ?? BG_DEFAULT, color: r.data('restingColor') ?? TEXT_DEFAULT };
            const rb  = r.data('restingBorder');
            if (rb)
                css.borderLeftColor = rb;
            r.css(css).removeClass('la-hud-active');
        });
        const specialBg = activeRow.data('hoverBg');
        if (specialBg)
            activeRow.css({ background: specialBg, color: activeRow.data('hoverColor') ?? TEXT_DEFAULT }).addClass('la-hud-active');
        else
            activeRow.css({ background: BG_ACTIVE, color: TEXT_ACTIVE }).addClass('la-hud-active');
    }
}
