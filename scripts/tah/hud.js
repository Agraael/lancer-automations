/* global $, window, game, ui, CONFIG, Hooks, fromUuid, Dialog, FilePicker */

import { laRenderWeaponBody, laRenderModBody, laRenderCoreBonusBody, laRenderCoreSystemBody, laFormatDetailHtml, laRenderActionDetail, laRenderActions, laPopupSectionLabel, laRenderDeployables, laRenderTags, laDetailPopup } from '../interactive/detail-renderers.js';
import { executeSkirmish, executeBarrage, executeFight, executeSimpleActivation, executeBasicAttack, executeDamageRoll, executeTechAttack, executeReactorMeltdown, executeReactorExplosion, executeFall, executeStandingUp, executeTeleport, getActorActionItems, hasReactionAvailable, getWeaponProfiles_WithBonus, getActorMaxThreat, getMaxWeaponRanges_WithBonus } from '../tools/misc-tools.js';
import { executeInvade, openThrowMenu, clearMovementHistory, revertMovement, resetMovementCap } from '../interactive/combat.js';
import { pickupWeaponToken, openDeployableMenu, recallDeployable, getItemDeployables, getActorDeployables, deployDeployable, reloadOneWeapon, resolveDeployable, getDeployableInfo, getDeployableInfoSync, isActionLocked, promptLinkOrUnlinkActor, consumeExtraAction } from '../interactive/deployables.js';
import { openExtrasDialog } from '../interactive/extras-dialog.js';
import { knockBackToken } from '../interactive/canvas.js';
import { delayedTokenAppearance } from '../combat/reinforcement.js';
import { isActionDisabledByStatus, isStaleStatusSource, getActionLockInfo } from '../combat/action-limits.js';
import { laHudRenderIcon, getActivationIcon, laHudItemChildren, getItemStatus, activationTheme, appendItemPips, rechargeIcon } from './item-helpers.js';
import { onHudRowHover, togglePersistentAura, isPersistentAuraActive, setPersistentAura, AURA_DEFS, deactivateRangePreview } from './hover.js';
import { resurrect } from '../tools/wreck.js';
import { buildStatsEl, resetStatsExpanded } from './stats-bar.js';
import { buildCombatBar } from './combat-bar.js';
import { activateCombatantSocket } from '../socket.js';
import { collectSearchResults, openSearchResults } from './search.js';
import { showPopupAt, toggleDetailPopup, hasAutomation } from './hud-popups.js';
import { StatusPanel } from './status-panel.js';
import { LogPanel } from './log-panel.js';
import { GlossaryPanel } from './glossary-panel.js';
import { playUiSound } from './sound.js';
import { executeGenerateScan } from '../tools/scan.js';
import { _resolveExtraBarValues, updateExtraBarValue } from './tokenStatBar.js';

async function _toggleTokenInCombat(token) {
    const tokenDoc = /** @type {any} */ (token?.document);
    if (!tokenDoc) return;
    try {
        const existing = tokenDoc.combatant;
        if (existing) {
            await existing.delete();
            return;
        }
        await tokenDoc.toggleCombatant({ active: true });
    } catch (e) {
        console.warn('lancer-automations | toggleCombatant failed', e);
    }
}

// ── Lancer-style-library palette ─────────────────────────────────────────────

const HUD_LEFT = 120;    // right of Foundry's left toolbar
const HUD_TOP  = 115;   // below Foundry's top nav bar

const ROW_MAX_WIDTH = 250;

const BG_DEFAULT   = '#f5f5f5';
const BG_HOVER     = 'color-mix(in srgb, var(--primary-color), white 85%)';
const BG_ACTIVE    = 'var(--primary-color)';
const TEXT_DEFAULT = '#111';
const TEXT_ACTIVE  = '#fff';

/** Animate a column closed (mirror of the open slide-in). */
function closeCol(col, duration = 90) {
    col.stop(true).animate({ opacity: 0, marginLeft: -10 }, duration, function () {
        $(this).hide().css('marginLeft', '').children(':not(.la-hud-col-label)').remove();
    });
}

/** Lighten a #rrggbb color by adding `amount` to each channel. */
function brighten(hex, amount = 25) {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
    return `rgb(${r},${g},${b})`;
}


const ICON_TECH_QUICK = 'systems/lancer/assets/icons/tech_quick.svg';
const ICON_TECH_FULL  = 'systems/lancer/assets/icons/tech_full.svg';

/** Build compact tag string for ammo allowed types/sizes (only shows restrictions). */
function _ammoTagsHtml(checklist, label) {
    if (!checklist)
        return '';
    const entries = Object.entries(checklist);
    const enabled = entries.filter(([, v]) => v).map(([k]) => k);
    if (enabled.length === 0 || enabled.length === entries.length)
        return '';
    return ` · ${enabled.join(', ')}`;
}

const ACTIVATION_TAGS = ['tg_quick_action', 'tg_full_action', 'tg_protocol', 'tg_reaction', 'tg_free_action'];

// ── Popup positioning ─────────────────────────────────────────────────────────

// ── Item / Category data builders ─────────────────────────────────────────────
//
// Category shape: { label, colLabel, getItems: () => Item[] }
// Item shape:     { label, childColLabel?, getChildren?: () => Item[], onClick?: () => void, onRightClick?: (rowEl) => void }


// ── LancerHUD ─────────────────────────────────────────────────────────────────

export class LancerHUD {
    constructor() {
        this._bindGen            = 0;
        this._el              = null;
        this._c2              = null;
        this._c3              = null;
        this._c4              = null;
        this._c4AnchorRow       = null;
        this._token              = null;
        this._tokens             = [];
        this._pendingCol4Refresh = null;
        this._pendingCol3Refresh = null;
        this._refreshTimer       = null;
        this._statusPanelInstance  = null;
        this._suppressRefreshDepth = 0;
        this._searchActive         = false;
        this._favoritesActive      = false;
        this._categories           = null;
        this._clickToOpen          = false;
        // Track what's currently open in each column for in-place refresh
        this._c2Category    = null;   // category whose getItems() fills c2
        this._c2AnchorRow   = null;   // c1 row that opened c2
        this._c3SourceItem  = null;   // c2 item whose getChildren() fills c3
        this._c3AnchorRow   = null;   // c2 row that opened c3
        this._c4SourceItem  = null;   // c3 item whose getChildren() fills c4
    }

    async bind(tokens) {
        const arr = Array.isArray(tokens) ? tokens : [tokens];
        this.unbind();
        const valid = arr.filter(t => t.actor?.isOwner);
        if (!valid.length)
            return;
        this._tokens = valid;
        this._token  = valid[0];
        const gen = ++this._bindGen;
        // Pre-cache deployables for the primary token only
        const actor = this._token.actor;
        const lids = [];
        for (const item of actor.items)
            for (const lid of getItemDeployables(item, actor))
                lids.push(lid);
        if (lids.length)
            await Promise.all(lids.map(lid => getDeployableInfo(lid, actor)));
        if (this._bindGen !== gen)
            return;
        this._render();
    }

    toggleSearch() {
        if (!this._el || !this._searchIcon)
            return false;
        this._searchIcon.trigger('click');
        return true;
    }

    unbind() {
        this._bindGen++;
        const el = this._el;
        for (const t of (this._tokens ?? []))
            deactivateRangePreview(t);
        this._el = this._c2 = this._c3 = this._c4 = null;
        this._c4AnchorRow = null;
        this._token   = null;
        this._tokens  = [];
        this._pendingCol3Refresh = null;
        this._pendingCol4Refresh = null;
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
        this._searchActive = false;
        this._categories   = null;
        resetStatsExpanded();
        $(document).off('mousedown.la-hud-cto');
        $(document).off('mousemove.la-hud-drag mouseup.la-hud-drag');
        $('.la-hud-popup').stop(true).animate({ opacity: 0 }, 120, function() {
            $(this).remove();
        });
        if (el)
            el.stop(true).animate({ opacity: 0, left: '-=18' }, 180, () => el.remove());
    }

    /** Suppress-counter handles for handlers that call actor.update() but must not re-render. */
    _depthCallbacks() {
        return {
            incDepth: () => this._suppressRefreshDepth++,
            decDepth: () => this._suppressRefreshDepth--,
        };
    }

    /** Debounced full refresh. Coalesces rapid updates into one render. */
    scheduleRefresh(delay = 100) {
        if (this._suppressRefreshDepth > 0)
            return;
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refresh(), delay);
    }

    /** In-place stats bar refresh. Does not collapse sub-columns. */
    updateStatsInPlace() {
        if (!this._actor || !this._el)
            return;
        this._el.find('#la-hud-stats').replaceWith(buildStatsEl(this._actor, this._token));
        this._updateCombatBar();
    }

    _updateCombatBar() {
        if (!this._actor || !this._token || !this._el) {
            return;
        }
        const existing = this._el.find('#la-combat-bar');
        const newBar = buildCombatBar(this._actor, this._token);
        if (existing.length && newBar) {
            existing.replaceWith(newBar);
        } else if (existing.length && !newBar) {
            existing.stop(true).animate({ opacity: 0, marginTop: -existing.outerHeight() }, 150, function () {
                $(this).remove();
            });
        } else if (!existing.length && newBar) {
            const statsEl = this._el.find('#la-hud-stats');
            if (statsEl.length) {
                const h = 30;
                newBar.css({ overflow: 'hidden', opacity: 0, marginTop: -h });
                statsEl.after(newBar);
                newBar.animate({ opacity: 1, marginTop: 0 }, 200);
            }
        }
    }

    refresh() {
        if (!this._token || this._suppressRefreshDepth > 0)
            return;
        // Status panel open: sync rows in-place, never close + reopen.
        if (this._statusPanelInstance?.isVisible) {
            this.updateStatsInPlace();
            this._statusPanelInstance.syncRows();
            return;
        }
        // Detail popup open: refresh visible columns in-place, no full rebuild.
        if ($('.la-hud-popup').length) {
            this.updateStatsInPlace();
            this._refreshColumnsInPlace();
            return;
        }
        const openPath = this._saveOpenPath();
        const el = this._el;
        this._el = this._c2 = this._c3 = this._c4 = null;
        this._c4AnchorRow = null;
        if (el)
            el.stop(true).remove();
        this._render(false);
        this._restoreOpenPath(openPath);
    }

    get _actor() {
        return this._token?.actor;
    }

    // ── Render ────────────────────────────────────────────────────────────────

    _render(animate = true) {
        if (!this._actor)
            return;

        const categories = this._buildCategories();
        this._categories = categories;
        const clickToOpen      = game.settings.get('lancer-automations', 'tah.clickToOpen')      ?? false;
        const hoverCloseDelay  = (game.settings.get('lancer-automations', 'tah.hoverCloseDelay') ?? 2) * 1000;
        this._clickToOpen = clickToOpen;

        const actor = this._actor;
        const tokenName = this._tokens.length > 1
            ? `${this._tokens.length} TOKENS`
            : (this._token.name ?? actor.name ?? '');
        // Resolve disposition / team (only if setting is on)
        let _dispColor = null;
        let _dispLabel = null;
        if (game.settings.get('lancer-automations', 'tah.showDisposition')) {
            try {
                const tfActive = game.modules.get('token-factions')?.active;
                const tfAdvanced = tfActive && game.settings.get('token-factions', 'color-from') === 'advanced-factions';
                if (tfAdvanced) {
                    const teamId = this._token.document.getFlag?.('token-factions', 'team')
                        || this._token.actor?.prototypeToken?.flags?.['token-factions']?.team;
                    if (teamId) {
                        const teams = game.settings.get('token-factions', 'team-setup') || [];
                        const team = teams.find(t => t.id === teamId);
                        if (team) {
                            _dispColor = team.color;
                            _dispLabel = team.name;
                        }
                    }
                }
            } catch { /* ignore */ }
            if (!_dispColor) {
                const disp = this._token.document.disposition;
                const dispMap = {
                    [CONST.TOKEN_DISPOSITIONS.HOSTILE]: { color: '#e53935', label: 'Hostile' },
                    [CONST.TOKEN_DISPOSITIONS.NEUTRAL]: { color: '#f9a825', label: 'Neutral' },
                    [CONST.TOKEN_DISPOSITIONS.FRIENDLY]: { color: '#43a047', label: 'Friendly' },
                    [CONST.TOKEN_DISPOSITIONS.SECRET]: { color: '#7e57c2', label: 'Secret' },
                };
                const d = dispMap[disp] ?? { color: '#888', label: 'Unknown' };
                _dispColor = d.color;
                _dispLabel = d.label;
            }
        }

        const titleEl = $(`<div class="la-hud-token-title"><span class="la-hud-token-name">${tokenName}</span></div>`);

        // Combat toggle icon (left of token name)
        const inCombat = this._token.inCombat;
        const combatToggle = $(`<span class="la-combat-toggle${inCombat ? ' la-combat-toggle--in' : ''}" title="${inCombat ? 'Remove from combat' : 'Add to combat'}"><i class="fas fa-swords"></i></span>`);
        combatToggle.on('mouseenter', () => playUiSound('statusHover'));
        combatToggle.on('click', async () => {
            const targets = (this._tokens?.length ? this._tokens : [this._token]).filter(Boolean);
            const wantActive = !this._token.inCombat;
            for (const t of targets) {
                if (!!t.inCombat === wantActive)
                    continue;
                await _toggleTokenInCombat(t);
            }
            const nowInCombat = this._token.inCombat;
            combatToggle.toggleClass('la-combat-toggle--in', nowInCombat);
            combatToggle.attr('title', nowInCombat ? 'Remove from combat' : 'Add to combat');
            this._updateCombatBar();
        });
        titleEl.find('.la-hud-token-name').before(combatToggle);

        const statsEl = buildStatsEl(actor, this._token);
        const combatBar = buildCombatBar(actor, this._token);

        const c1 = this._makeCol('Menu');
        c1.css('width', '180px');
        // ── Search icon + input ──────────────────────────────────────────────────
        const menuLabel = c1.find('.la-hud-col-label');
        menuLabel.css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
        const searchIcon = $(`<span class="la-hud-search-toggle" title="Search">⌕</span>`);
        menuLabel.append(searchIcon);
        const favIcon = $(`<div class="la-hud-fav-tab" title="Favorites"><div class="la-hud-fav-icon">★</div></div>`);
        this._favIconPositioner = () => {
            const c1Pos = c1.position();
            const labelPos = menuLabel.position();
            if (!c1Pos || !labelPos)
                return;
            const c1Bottom = c1Pos.top + c1.outerHeight();
            const labelTop = c1Pos.top + labelPos.top;
            favIcon.css({
                top: `${labelTop}px`,
                left: `${c1Pos.left + c1.outerWidth() + 6}px`,
                height: `${c1Bottom - labelTop}px`,
            });
            favIcon.find('.la-hud-fav-icon').css({ height: `${menuLabel.outerHeight()}px` });
        };
        const searchBar = $(`<input type="text" class="la-hud-search-bar" placeholder="Search…">`);
        menuLabel.after(searchBar);
        this._favIcon = favIcon;
        this._searchIcon = searchIcon;
        this._searchBar = searchBar;
        if (combatBar) {
            c1.prepend(combatBar);
        }
        c1.prepend(statsEl);
        c1.prepend(titleEl);

        // c1 must exist in DOM before we can measure it below, so build hud first
        const savedPos = game.settings.get('lancer-automations', 'tah.position');
        const startLeft = savedPos?.left ?? HUD_LEFT;
        const startTop  = savedPos?.top  ?? HUD_TOP;
        const hud = $(`<div id="la-hud" style="left:${startLeft}px;top:${startTop}px;"></div>`);
        if (animate)
            hud.css({ opacity: 0, left: startLeft - 18 });
        hud.append(c1);
        $('body').append(hud);
        this._el = hud;
        if (animate)
            hud.animate({ opacity: 1, left: startLeft }, 350);

        // Lock / drag / reset controls
        let unlocked = false;
        const lockBtn = $(`<span class="la-hud-lock" title="Unlock to drag">🔒</span>`);
        const resetBtn = $(`<span class="la-hud-reset" title="Reset position">↺</span>`);
        titleEl.append(lockBtn).append(resetBtn);

        // Disposition / team stripe. Appended last to sit at the far right edge.
        if (_dispColor && _dispLabel) {
            const _r = parseInt(_dispColor.slice(1, 3), 16) || 0;
            const _g = parseInt(_dispColor.slice(3, 5), 16) || 0;
            const _b = parseInt(_dispColor.slice(5, 7), 16) || 0;
            const _textColor = (_r * 0.299 + _g * 0.587 + _b * 0.114) > 150 ? '#111' : '#fff';
            const dispDetail = $(`<div class="la-disp-detail" style="background:${_dispColor};"><span class="la-disp-detail__label" style="color:${_textColor};">${_dispLabel.toUpperCase()}</span></div>`);
            const dispToggle = $(`<div class="la-disp-toggle" style="background:${_dispColor};"><span class="la-disp-toggle__chevron" style="color:${_textColor};">▶</span></div>`);
            titleEl.append(dispToggle);
            titleEl.append(dispDetail);
            let _dispExpanded = false;
            const openDisp = () => {
                if (_dispExpanded) {
                    return;
                }
                _dispExpanded = true;
                dispDetail.stop(true).css({ display: 'flex', width: 0, opacity: 0, overflow: 'hidden' })
                    .animate({ width: dispDetail.prop('scrollWidth'), opacity: 1 }, 150, function () {
                        $(this).css({ width: '', overflow: '' });
                    });
                dispToggle.find('span').text('◀');
            };
            const closeDisp = () => {
                if (!_dispExpanded) {
                    return;
                }
                _dispExpanded = false;
                dispDetail.stop(true).css('overflow', 'hidden').animate({ width: 0, opacity: 0 }, 120, function () {
                    $(this).css({ display: 'none', width: '', opacity: '', overflow: '' });
                });
                dispToggle.find('span').text('▶');
            };
            dispToggle.on('mouseenter', () => {
                playUiSound('statusHover'); openDisp();
            });
            dispToggle.on('mouseleave', closeDisp);
            dispDetail.on('mouseenter', openDisp);
            dispDetail.on('mouseleave', closeDisp);
            dispToggle.on('click', (ev) => {
                ev.stopPropagation();
                if (_dispExpanded) {
                    closeDisp();
                } else {
                    openDisp();
                }
            });
        }

        // Title bar hover/click. Must be after lockBtn/resetBtn creation.
        const nameSpan = titleEl.find('.la-hud-token-name');
        nameSpan.on('mouseenter', () => {
            playUiSound('statusHover');
            nameSpan.css({ color: 'var(--primary-color)', cursor: 'pointer' });
        });
        nameSpan.on('mouseleave', () => {
            nameSpan.css({ color: '', cursor: '' });
        });
        nameSpan.on('click', () => {
            actor.sheet?.render(true);
        });
        titleEl.on('mouseenter', () => {
            lockBtn.css('opacity', unlocked ? 0.9 : 0.4);
        });
        titleEl.on('mouseleave', () => {
            if (!unlocked)
                lockBtn.css('opacity', 0);
        });
        titleEl.on('contextmenu', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
        });

        lockBtn.on('click', (ev) => {
            ev.stopPropagation();
            unlocked = !unlocked;
            lockBtn.text(unlocked ? '🔓' : '🔒').css('opacity', unlocked ? 0.9 : 0).attr('title', unlocked ? 'Lock position' : 'Unlock to drag');
            resetBtn.css('opacity', unlocked ? 0.6 : 0);
            hud.css('cursor', unlocked ? 'grab' : '');
        });

        resetBtn.on('click', (ev) => {
            ev.stopPropagation();
            game.settings.set('lancer-automations', 'tah.position', null);
            hud.animate({ left: HUD_LEFT, top: HUD_TOP }, 200);
        });

        let dragStart = null;
        hud.on('mousedown', (ev) => {
            if (!unlocked || ev.button !== 0)
                return;
            if ($(ev.target).closest('.la-hud-col').length && !$(ev.target).closest('.la-hud-lock, .la-hud-reset').length)
                return; // don't drag from menu items
            ev.preventDefault();
            dragStart = { x: ev.clientX, y: ev.clientY, left: parseInt(hud.css('left')), top: parseInt(hud.css('top')) };
            hud.css('cursor', 'grabbing');
        });
        $(document).on('mousemove.la-hud-drag', (ev) => {
            if (!dragStart)
                return;
            const dx = ev.clientX - dragStart.x;
            const dy = ev.clientY - dragStart.y;
            hud.css({ left: dragStart.left + dx, top: dragStart.top + dy });
        });
        $(document).on('mouseup.la-hud-drag', () => {
            if (!dragStart)
                return;
            dragStart = null;
            hud.css('cursor', unlocked ? 'grab' : '');
            const pos = { left: parseInt(hud.css('left')), top: parseInt(hud.css('top')) };
            game.settings.set('lancer-automations', 'tah.position', pos);
        });

        // c2/c3/c4 are absolutely positioned. They never affect c1's layout.
        const c2 = this._makeCol('');
        const c3 = this._makeCol('');
        const c4 = this._makeCol('');
        c1.css({ position: 'relative', zIndex: 4 });
        // Pin absolute children to c1's actual y instead of hud's padding edge. In v13 some root
        // CSS shifts hud's padding/margin so `top:0` no longer matches c1's normal-flow top.
        const c1Top = () => c1.position()?.top ?? 0;
        c2.css({ position: 'absolute', top: c1Top(), left: c1.outerWidth(), display: 'none', zIndex: 3 });
        c3.css({ position: 'absolute', top: c1Top(), left: 0,               display: 'none', zIndex: 2 });
        c4.css({ position: 'absolute', top: c1Top(), left: 0,               display: 'none', zIndex: 1 });
        hud.append(c2, c3, c4);
        hud.append(favIcon);
        requestAnimationFrame(() => this._favIconPositioner?.());
        // c1 height/width changes when search bar opens, combat bar toggles, or rows expand/collapse.
        // Reposition the floating favorites tab on every change.
        try {
            this._favResizeObserver?.disconnect();
            this._favResizeObserver = new ResizeObserver(() => this._favIconPositioner?.());
            this._favResizeObserver.observe(c1[0]);
        } catch { /* ResizeObserver unsupported */ }
        this._c2 = c2;
        this._c3 = c3;
        this._c4 = c4;

        for (const cat of categories) {
            let catCount = 0;
            if (cat.getItems && !cat.isStatusPanel && !cat.isLogPanel) {
                try {
                    catCount = cat.getItems()?.length ?? 0;
                } catch { /* ignore */ }
            }
            const row = this._makeRow(cat.label, true, null, null, null, null, catCount);
            const openCat = () => {
                this._searchActive = false;
                _cancelCollapse();
                playUiSound();
                if (/** @type {any} */ (cat).isStatusPanel) {
                    if (row.hasClass('la-hud-active') && this._statusPanelInstance?.isVisible) {
                        if (clickToOpen) {
                            this._statusPanelInstance.close(); _clearC1Active();
                        }
                        return;
                    }
                    if (this._logPanelInstance?.isVisible)
                        this._logPanelInstance.close();
                    this._setActive(c1, row, true);
                    closeCol(c2, 80); closeCol(c3, 80); closeCol(c4, 80);
                    this._statusPanelInstance.open(row);
                    return;
                }
                if (row.hasClass('la-hud-active') && c2.is(':visible')) {
                    if (clickToOpen) {
                        closeCol(c2); closeCol(c3); closeCol(c4); _clearC1Active();
                    }
                    return;
                }
                if (this._statusPanelInstance?.isVisible)
                    this._statusPanelInstance.close();
                if (this._logPanelInstance?.isVisible)
                    this._logPanelInstance.close();
                this._setActive(c1, row, true);
                closeCol(c3, 80);
                closeCol(c4, 80);
                this._c2Category = cat; this._c2AnchorRow = row;
                this._c3SourceItem = null; this._c4SourceItem = null;
                {
                    const _cl = /** @type {any} */ (cat).colLabel;
                    c2.find('.la-hud-col-label').text(typeof _cl === 'function' ? _cl() : _cl);
                }
                this._openCol(c2, /** @type {any} */ (cat).getItems(), row);
                c2.stop(true).css({ opacity: 0, marginLeft: -10, pointerEvents: 'none' }).show().animate({ opacity: 1, marginLeft: 0 }, 140, function() {
                    $(this).css('pointerEvents', '');
                });
            };
            if (clickToOpen) {
                row.on('mouseenter', () => {
                    _cancelCollapse();
                    if (!row.hasClass('la-hud-active'))
                        row.css({ background: BG_HOVER });
                });
                row.on('mouseleave', () => {
                    if (!row.hasClass('la-hud-active'))
                        row.css({ background: row.data('restingBg') ?? BG_DEFAULT });
                });
                row.on('click', openCat);
            } else {
                row.on('mouseenter', openCat);
            }
            c1.append(row);
        }

        // ── Safe-zone collapse: fires only when mouse leaves ALL visible columns ──
        let _leaveTimer = null;
        const _clearC1Active = () => {
            c1.find('.la-hud-row').each(function() {
                const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: r.data('restingColor') ?? TEXT_DEFAULT }).removeClass('la-hud-active');
            });
        };
        const _scheduleCollapse = () => {
            clearTimeout(_leaveTimer);
            _leaveTimer = setTimeout(() => {
                if (this._searchActive)
                    return;
                closeCol(c2);
                closeCol(c3);
                closeCol(c4);
                this._statusPanelInstance?.close();
                this._logPanelInstance?.close();
                this._glossaryPanelInstance?.close();
                _clearC1Active();
                $('.la-hud-popup').stop(true).animate({ opacity: 0 }, 120, function() {
                    $(this).remove();
                });
            }, hoverCloseDelay);
        };
        const _cancelCollapse = () => clearTimeout(_leaveTimer);
        this._scheduleCollapse = _scheduleCollapse;
        this._cancelCollapse   = _cancelCollapse;
        this._clearC1Active    = _clearC1Active;
        this._statusPanelInstance = new StatusPanel({
            actor: this._actor,
            token: this._token,
            tokens: this._tokens,
            el:    hud,
            cancelCollapse:  _cancelCollapse,
            scheduleCollapse: clickToOpen ? () => {} : _scheduleCollapse,
            incDepth: () => this._suppressRefreshDepth++,
            decDepth: () => this._suppressRefreshDepth--,
        });
        this._logPanelInstance = new LogPanel({
            actor: this._actor,
            token: this._token,
            el:    hud,
            cancelCollapse:  _cancelCollapse,
            scheduleCollapse: clickToOpen ? () => {} : _scheduleCollapse,
        });
        this._glossaryPanelInstance = new GlossaryPanel({
            el:    hud,
            cancelCollapse:  _cancelCollapse,
            scheduleCollapse: clickToOpen ? () => {} : _scheduleCollapse,
        });
        hud.on('mouseleave', () => {
            if (!clickToOpen)
                _scheduleCollapse();
        }).on('mouseenter', _cancelCollapse);
        if (!clickToOpen) {
            c2.on('mouseleave', _scheduleCollapse).on('mouseenter', _cancelCollapse);
            c3.on('mouseleave', _scheduleCollapse).on('mouseenter', _cancelCollapse);
            c4.on('mouseleave', _scheduleCollapse).on('mouseenter', _cancelCollapse);
            // Leaving any c1 category row toward the header area schedules collapse
            c1.on('mouseleave', '.la-hud-row', _scheduleCollapse);
        } else {
            c2.on('mouseenter', _cancelCollapse);
            c3.on('mouseenter', _cancelCollapse);
            c4.on('mouseenter', _cancelCollapse);
            // Click outside the HUD to collapse
            $(document).on('mousedown.la-hud-cto', (ev) => {
                if (!this._el)
                    return;
                if (!$.contains(this._el[0], /** @type {Element} */ (/** @type {unknown} */ (ev.target))) && !$(ev.target).closest('.la-hud-popup, .la-hud-popup-bridge').length) {
                    closeCol(c2); closeCol(c3); closeCol(c4);
                    this._statusPanelInstance?.close();
                    this._logPanelInstance?.close();
                    this._glossaryPanelInstance?.close();
                    _clearC1Active();
                    $('.la-hud-popup').stop(true).animate({ opacity: 0 }, 120, function() {
                        $(this).remove();
                    });
                }
            });
        }
        // Title / stats / menu-label area. Hovering it closes open columns.
        titleEl.on('mouseenter', () => {
            _clearC1Active();
            if (!clickToOpen)
                _scheduleCollapse();
        });
        statsEl.on('mouseenter', () => {
            _clearC1Active();
            if (!clickToOpen)
                _scheduleCollapse();
        });
        menuLabel.on('mouseenter', () => {
            _clearC1Active();
            if (!clickToOpen)
                _scheduleCollapse();
        });

        // ── Search toggle + live-filter ──────────────────────────────────────────
        searchIcon.on('click', (ev) => {
            ev.stopPropagation();
            playUiSound('details');
            if (searchBar.is(':visible')) {
                searchBar.val('').slideUp(120);
                searchIcon.css('opacity', '0.55');
                this._searchActive = false;
                closeCol(c2); closeCol(c3); closeCol(c4);
            } else {
                searchBar.css({ display: 'none' }).slideDown(120, () => searchBar.trigger('focus'));
                searchIcon.css('opacity', '1');
            }
        });
        const runSearch = () => {
            const q = String(searchBar.val()).trim().toLowerCase();
            if (!q) {
                this._searchActive = false;
                closeCol(c2);
                return;
            }
            this._searchActive = true;
            _cancelCollapse();
            openSearchResults(c2, collectSearchResults(q, this._categories), { el: this._el, makeRow: (...a) => this._makeRow(...a), token: this._token, brighten });
        };
        searchBar.on('input', runSearch);
        searchBar.on('mouseenter click', () => {
            if (String(searchBar.val()).trim())
                runSearch();
        });
        searchBar.on('keydown', (ev) => {
            if (ev.key === 'Escape') {
                searchIcon.trigger('click');
                return;
            }
            const bindings = /** @type {any[]} */ (game.keybindings.get('lancer-automations', 'tah.toggleSearch') ?? []);
            const match = bindings.some(b => {
                if (b.key !== ev.code)
                    return false;
                const mods = b.modifiers ?? [];
                return ev.altKey   === mods.includes('Alt')
                    && ev.ctrlKey  === mods.includes('Control')
                    && ev.shiftKey === mods.includes('Shift');
            });
            if (match) {
                ev.preventDefault();
                ev.stopPropagation();
                searchIcon.trigger('click');
            }
        });
        searchBar.on('focus', () => _cancelCollapse());

        // ── Favorites tab ────────────────────────────────────────────────────────
        const openFavorites = () => {
            if (searchBar.is(':visible'))
                searchIcon.trigger('click');
            _cancelCollapse();
            playUiSound();
            this._c2Category = null; this._c2AnchorRow = null;
            this._c3SourceItem = null; this._c4SourceItem = null;
            closeCol(c3, 80); closeCol(c4, 80);
            openSearchResults(c2, this._collectFavorites(), { el: this._el, makeRow: (...a) => this._makeRow(...a), token: this._token, brighten });
            c2.find('.la-hud-col-label').text('Favorites');
        };
        const favIconInner = favIcon.find('.la-hud-fav-icon');
        const isFavoritesOpen = () => c2.is(':visible') && c2.find('.la-hud-col-label').text() === 'Favorites';
        let favHovering = false;
        const applyFavStyle = () => {
            const open = isFavoritesOpen();
            favIconInner
                .toggleClass('la-hud-fav-icon--open', open)
                .toggleClass('la-hud-fav-icon--hover', favHovering && !open);
        };
        const isOverFavIcon = (ev) => {
            const r = favIconInner[0]?.getBoundingClientRect();
            if (!r)
                return false;
            return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        };
        const enterFav = () => {
            if (favHovering)
                return;
            favHovering = true;
            _cancelCollapse();
            applyFavStyle();
            if (!clickToOpen)
                openFavorites();
        };
        const leaveFav = () => {
            if (!favHovering)
                return;
            favHovering = false;
            applyFavStyle();
        };
        const favObserver = new MutationObserver(() => applyFavStyle());
        favObserver.observe(c2[0], { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
        favIconInner.on('mouseenter', enterFav);
        favIconInner.on('mouseleave', leaveFav);
        if (this._favDocHandlers) {
            document.removeEventListener('mousemove', this._favDocHandlers.move);
            if (this._favDocHandlers.click)
                document.removeEventListener('click', this._favDocHandlers.click, true);
        }
        const docMoveHandler = (ev) => {
            if (!this._el)
                return;
            const over = isOverFavIcon(ev);
            if (over)
                enterFav();
            else
                leaveFav();
        };
        document.addEventListener('mousemove', docMoveHandler);
        let docClickHandler = null;
        if (clickToOpen) {
            docClickHandler = (ev) => {
                if (!this._el)
                    return;
                if (isOverFavIcon(ev)) {
                    ev.stopPropagation();
                    openFavorites();
                }
            };
            document.addEventListener('click', docClickHandler, true);
        }
        this._favDocHandlers = { move: docMoveHandler, click: docClickHandler };
    }

    // ── Multi-token intersection filter ──────────────────────────────────────

    _filterIntersect(items) {
        if (this._tokens.length <= 1)
            return items;
        const others = this._tokens.slice(1).map(t => t.actor);
        return items.filter(item => {
            if (item.isSectionLabel || item.inputCell)
                return true;
            const lid = item.hoverData?.item?.system?.lid;
            if (!lid)
                return true; // universal action (Basic Attack, Stabilize, etc.)
            return others.every(a => /** @type {any} */ (a).items.some(i => i.system?.lid === lid));
        });
    }

    // ── Item-building helpers ─────────────────────────────────────────────────

    /** Returns a status-kind marker for destroyed/unavailable items. The renderer maps it to a striped style. */
    _statusColors(/** @type {any} */ status) {
        return {
            statusKind: status.destroyed ? 'destroyed' : status.unavailable ? 'unavailable' : null,
        };
    }

    /** Builds the standard effect + description + tags HTML for a system/item detail popup body. */
    _bodyHtml(/** @type {any} */ sys) {
        const text = sys?.effect || sys?.description || '';
        const effect = text ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;margin-bottom:4px;">${laFormatDetailHtml(text)}</div>` : '';
        return laRenderTags(sys?.tags ?? []) + effect;
    }

    /** Factory for executeSimpleActivation rows. Wires onClick / broadcast / right-click popup. */
    _simpleItem(label, icon, action, detail) {
        return this._lockable({
            label,
            icon,
            onClick:      () => executeSimpleActivation(this._actor, { title: action.name, action, detail }),
            broadcastFn:  (_t, a) => executeSimpleActivation(a, { title: action.name, action, detail }),
            onRightClick: this._actionPopup({ ...action, detail }),
        }, action.name);
    }

    _lockable(item, actionName) {
        const origClick = item.onClick;
        const origBroadcast = item.broadcastFn;
        const sources = /** @type {Record<string,string[]>} */(this._actor?.getFlag('lancer-automations', 'lockedActions'))?.[actionName] ?? [];
        const byOther = sources.some(s => !isStaleStatusSource(s));
        const byStatus = isActionDisabledByStatus(this._actor, actionName);
        if (byStatus) item.statusKind = 'unavailable';
        else if (byOther) item.softDisabled = true;
        item.onClick = () => {
            if (isActionDisabledByStatus(this._actor, actionName)
                || (/** @type {Record<string,string[]>} */(this._actor?.getFlag('lancer-automations', 'lockedActions'))?.[actionName] ?? [])
                    .some(s => !isStaleStatusSource(s))) {
                ui.notifications.warn(`${actionName} is locked on ${this._actor.name}. Firing anyway.`);
            }
            return origClick?.();
        };
        if (origBroadcast)
            item.broadcastFn = origBroadcast;
        return item;
    }

    // anchorRow: parent row this column aligns with vertically.

    _openCol(col, items, anchorRow, { reposition = true } = {}) {
        const filteredItems = this._filterIntersect(items);
        col.children(':not(.la-hud-col-label)').remove();
        // Use page-relative offset minus hud offset so the result is correct
        // regardless of which column anchorRow lives in (c1 or c2).
        if (reposition && anchorRow && this._el) {
            const aOff = anchorRow.offset();
            const eOff = this._el.offset();
            if (aOff && eOff)
                col.css({ top: aOff.top - eOff.top - 22 });
        }

        if (!filteredItems.length) {
            col.append(`<div class="la-hud-muted la-hud-muted--empty">Empty</div>`);
            return;
        }

        for (const item of filteredItems) {
            if (item.isSectionLabel) {
                const iconHtml = item.icon ? laHudRenderIcon(item.icon) : '';
                col.append(`<div class="la-hud-section-label">${iconHtml}${item.label}</div>`);
                continue;
            }
            if (item.inputCell) {
                const hasMax  = item.max != null;
                const noColor = !!item.noColor;
                const min     = item.min ?? (hasMax ? 0 : -Infinity);
                const max     = item.max ?? Infinity;
                const iconHtml = item.icon ? laHudRenderIcon(item.icon) : '';
                const valColor = (v) => noColor ? '#111' : hasMax ? (v <= 0 ? '#c33' : v < max ? '#cc7700' : '#3a9e6e') : '#111';
                const restingBg = (v) => noColor ? BG_DEFAULT : hasMax ? (v <= 0 ? '#ffcccc' : v < max ? '#ffe5b4' : BG_DEFAULT) : BG_DEFAULT;
                const borderColor = (v) => noColor ? 'var(--primary-color)' : hasMax ? (v <= 0 ? '#cc3333' : v < max ? '#cc7700' : 'var(--primary-color)') : 'var(--primary-color)';
                let cell;
                if (item.subtype === 'increment') {
                    let cur = item.getValue();
                    const valText = item.formatValue ? () => item.formatValue(cur) : () => hasMax ? `${cur}/${max}` : `${cur}`;
                    cell = $(`<div class="la-hud-cell" style="background:${restingBg(cur)};border-left-color:${borderColor(cur)};">${iconHtml}<span class="la-hud-clip"><span class="la-hud-pan">${item.name}</span></span><div class="la-hud-cell__buttons"><span class="la-dec-btn la-hud-cell__btn">◄</span><span class="la-inc-val la-hud-cell__val" style="color:${valColor(cur)};">${valText()}</span><span class="la-inc-btn la-hud-cell__btn">►</span></div></div>`);
                    const step = item.step ?? 1;
                    const suppress = () => {
                        this._suppressRefreshDepth++; setTimeout(() => this._suppressRefreshDepth--, 300);
                    };
                    const updateDisplay = () => {
                        const c = valColor(cur);
                        cell.data('restingValColor', c);
                        if (!cell.is(':hover'))
                            cell.find('.la-inc-val').css('color', c);
                        cell.find('.la-inc-val').text(valText());
                        cell.data('restingBg', restingBg(cur)).css('borderLeftColor', borderColor(cur));
                    };
                    cell.find('.la-dec-btn').on('click', (ev) => {
                        ev.stopPropagation(); if (cur <= min)
                            return; playUiSound('toggle'); suppress(); cur = Math.max(min, cur - step); item.onValueChanged(cur); updateDisplay();
                    });
                    cell.find('.la-inc-btn').on('click', (ev) => {
                        ev.stopPropagation(); if (cur >= max)
                            return; playUiSound('toggle'); suppress(); cur = Math.min(max, cur + step); item.onValueChanged(cur); updateDisplay();
                    });
                    cell.data('restingBg', restingBg(cur));
                    cell.data('restingValColor', valColor(cur));
                } else if (item.subtype === 'toggle') {
                    let on = !!item.getValue();
                    const onColor = 'var(--primary-color)';
                    const offColor = '#666';
                    const switchHtml = `<span class="la-toggle-switch" style="background:${on ? onColor : offColor};"><span class="la-toggle-knob" style="left:${on ? '14px' : '1px'};"></span></span>`;
                    cell = $(`<div class="la-hud-cell">${iconHtml}<span class="la-hud-clip"><span class="la-hud-pan">${item.name}</span></span>${switchHtml}</div>`);
                    cell.find('.la-toggle-switch').on('click', async (ev) => {
                        ev.stopPropagation();
                        playUiSound('toggle');
                        on = !on;
                        const sw = cell.find('.la-toggle-switch');
                        sw.css('background', on ? onColor : offColor);
                        sw.find('.la-toggle-knob').css('left', on ? '14px' : '1px');
                        this._suppressRefreshDepth++;
                        try {
                            await item.onToggle(on);
                        } finally {
                            this._suppressRefreshDepth--;
                        }
                    });
                    cell.data('restingBg', BG_DEFAULT);
                } else {
                    cell = $(`<div class="la-hud-cell">${iconHtml}<span class="la-hud-clip"><span class="la-hud-pan">${item.name}</span></span><input type="number" class="la-type-val la-hud-cell__input" value="${item.getValue()}"></div>`);
                    cell.find('.la-type-val').on('change', (ev) => {
                        ev.stopPropagation(); playUiSound('toggle'); const v = Number.parseInt(/** @type {HTMLInputElement} */(ev.target).value, 10); if (!Number.isNaN(v))
                            item.onValueChanged(v);
                    }).on('click mousedown', (ev) => ev.stopPropagation());
                    cell.data('restingBg', BG_DEFAULT);
                }
                cell.on('mouseenter', () => {
                    this._cancelCollapse?.();
                    cell.css({ background: BG_ACTIVE, color: TEXT_ACTIVE });
                    cell.find('.la-inc-val').css('color', TEXT_ACTIVE);
                    cell.find('.la-hud-cell__btn').css('color', TEXT_ACTIVE);
                    playUiSound('hover');
                    const clip = cell.find('.la-hud-clip')[0]; const pan = cell.find('.la-hud-pan')[0];
                    if (clip && pan) {
                        const overflow = pan.scrollWidth - clip.clientWidth; if (overflow > 4)
                            $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                    }
                });
                cell.on('mouseleave', () => {
                    cell.css({ background: cell.data('restingBg') ?? BG_DEFAULT, color: '' });
                    cell.find('.la-inc-val').css('color', cell.data('restingValColor') ?? '');
                    cell.find('.la-hud-cell__btn').css('color', '');
                    cell.find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
                });
                if (item.onRightClick) {
                    cell.attr('title', 'Right click for details');
                    cell.on('contextmenu', ev => {
                        ev.preventDefault();
                        playUiSound('details');
                        item.onRightClick(cell);
                    });
                }
                col.append(cell);
                continue;
            }
            const rawChildren = item.getChildren ? item.getChildren() : null;
            const hasChildren = rawChildren !== null || !!item.isLogPanel || !!item.isGlossaryPanel;
            const childCount = hasChildren && rawChildren ? rawChildren.length : 0;
            const row = this._makeRow(item.label, hasChildren, item.icon, item.activation ?? null, item.badge ?? null, item.badgeColor ?? null, childCount);
            const isFavoritable = !item.isSectionLabel && !!item.onClick && !!this._favKey(item);
            if (isFavoritable && this._isFavorite(item))
                this._applyFavStyle(row);
            row.on('contextmenu', async (ev) => {
                if (!ev.ctrlKey)
                    return;
                ev.preventDefault();
                ev.stopImmediatePropagation();
                if (!isFavoritable) {
                    this._showQuickTip(ev.clientX, ev.clientY, "Can't favorite this");
                    return;
                }
                const nowFav = await this._toggleFavorite(item);
                playUiSound('toggle');
                if (nowFav)
                    this._applyFavStyle(row);
                else
                    this._clearFavStyle(row);
            });

            // if (hasChildren && rawChildren !== null && !rawChildren.length)
            //     row.css({ opacity: 0.9 });

            const _stripeStyle = (() => {
                if (item.softDisabled)
                    return {
                        bg: 'repeating-linear-gradient(45deg, #3a3a3a 0 6px, #2f2f2f 6px 12px)',
                        hoverBg: 'repeating-linear-gradient(45deg, #555 0 6px, #444 6px 12px)',
                        border: '#666',
                        color: '#bbb',
                        hoverColor: '#ddd'
                    };
                if (item.statusKind === 'destroyed')
                    return {
                        bg: 'repeating-linear-gradient(45deg, #5a2222 0 6px, #4a1c1c 6px 12px)',
                        hoverBg: 'repeating-linear-gradient(45deg, #7a3535 0 6px, #6a2828 6px 12px)',
                        border: '#a04444',
                        color: '#e0b0b0',
                        hoverColor: '#f0c8c8'
                    };
                if (item.statusKind === 'unavailable')
                    return {
                        bg: 'repeating-linear-gradient(45deg, #5a4422 0 6px, #4a3818 6px 12px)',
                        hoverBg: 'repeating-linear-gradient(45deg, #7a5c30 0 6px, #6a4c25 6px 12px)',
                        border: '#a07744',
                        color: '#e0c8a0',
                        hoverColor: '#f0d8b8'
                    };
                return null;
            })();
            if (_stripeStyle) {
                row.data('restingBg', _stripeStyle.bg);
                row.data('restingBorder', _stripeStyle.border);
                row.data('hoverBg', _stripeStyle.hoverBg);
                row.data('restingColor', _stripeStyle.color);
                row.data('hoverColor', _stripeStyle.hoverColor);
                row.css({ background: _stripeStyle.bg, borderLeftColor: _stripeStyle.border, color: _stripeStyle.color });
                if (item.softDisabled)
                    row.css({ cursor: 'not-allowed' });
                // Keep leading icon visible on dark stripes: flip whatever invert state laHudRenderIcon left.
                const _leadingIcon = row.children('img').first();
                if (_leadingIcon.length) {
                    const _styleAttr = _leadingIcon.attr('style') || '';
                    const _wasInverted = _styleAttr.includes('invert(1)');
                    _leadingIcon.css({ filter: _wasInverted ? 'none' : 'invert(1)', opacity: '0.55' });
                }
            } else if (item.highlightBg) {
                const borderColor = item.highlightBorderColor ?? '#3a78b5';
                row.data('restingBg', item.highlightBg);
                row.data('restingBorder', borderColor);
                row.data('hoverBg', brighten(item.highlightBg));
                row.css({ background: item.highlightBg, borderLeftColor: borderColor });
            }

            // Subtle automation hint: tiny rightward triangle attached to the left status bar (same color as the bar).
            if (hasAutomation(item.hoverData?.item ?? item.hoverData?.action?.name ?? item.label)) {
                row.css('position', 'relative');
                const _tickColor = _stripeStyle ? _stripeStyle.color : 'var(--primary-color)';
                row.append(`<span class="la-hud-auto-tick" style="position:absolute;left:3px;top:50%;transform:translateY(-50%);width:0;height:0;border-left:4px solid ${_tickColor};border-top:3px solid transparent;border-bottom:3px solid transparent;pointer-events:none;"></span>`);
            }

            // Hover sound on leaf rows (and Log / Glossary) only in hover-mode. Click-to-open
            // mode plays sound on click, not on hover, matching other rows.
            if ((!hasChildren || item.isLogPanel || item.isGlossaryPanel) && !this._clickToOpen)
                row.on('mouseenter', () => playUiSound('hover'));

            if (col !== this._c4 && !this._clickToOpen) {
                row.on('mouseenter', () => {
                    $('.la-hud-popup').remove();
                    if (item.isLogPanel) {
                        if (this._statusPanelInstance?.isVisible)
                            this._statusPanelInstance.close();
                        if (this._glossaryPanelInstance?.isVisible)
                            this._glossaryPanelInstance.close();
                        col.find('.la-hud-active').each(function() {
                            const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: r.data('restingColor') ?? TEXT_DEFAULT }).removeClass('la-hud-active');
                        });
                        closeCol(this._c3, 80);
                        closeCol(this._c4, 80);
                        this._logPanelInstance?.open(row);
                        return;
                    }
                    if (item.isGlossaryPanel) {
                        if (this._statusPanelInstance?.isVisible)
                            this._statusPanelInstance.close();
                        if (this._logPanelInstance?.isVisible)
                            this._logPanelInstance.close();
                        col.find('.la-hud-active').each(function() {
                            const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: r.data('restingColor') ?? TEXT_DEFAULT }).removeClass('la-hud-active');
                        });
                        closeCol(this._c3, 80);
                        closeCol(this._c4, 80);
                        this._glossaryPanelInstance?.open(row);
                        return;
                    }
                    if (this._logPanelInstance?.isVisible)
                        this._logPanelInstance.close();
                    if (this._glossaryPanelInstance?.isVisible)
                        this._glossaryPanelInstance.close();
                    if (col === this._c2 && !hasChildren) {
                        col.find('.la-hud-active').each(function() {
                            const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: r.data('restingColor') ?? TEXT_DEFAULT }).removeClass('la-hud-active');
                        });
                        closeCol(this._c3, 80);
                        closeCol(this._c4, 80);
                    } else if (col === this._c3 && !hasChildren) {
                        col.find('.la-hud-active').each(function() {
                            const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: r.data('restingColor') ?? TEXT_DEFAULT }).removeClass('la-hud-active');
                        });
                        closeCol(this._c4, 80);
                    }
                });
            }

            // Click-to-open mode: Log / Glossary panels don't register the hover handler above,
            // so they need an explicit click binding (hover-mode rows above already handle them).
            if (this._clickToOpen && (item.isLogPanel || item.isGlossaryPanel)) {
                row.on('click', () => {
                    playUiSound('open');
                    $('.la-hud-popup').remove();
                    // Behave like a normal row: clear sibling actives in this column, mark self active,
                    // close any child column drilldowns and the other panel.
                    col.find('.la-hud-active').each(function() {
                        const r = $(this);
                        r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: r.data('restingColor') ?? TEXT_DEFAULT })
                            .removeClass('la-hud-active');
                    });
                    this._setActive(col, row);
                    this._statusPanelInstance?.close();
                    closeCol(this._c3, 80);
                    closeCol(this._c4, 80);
                    if (item.isLogPanel) {
                        this._glossaryPanelInstance?.close();
                        this._logPanelInstance?.open(row);
                    } else {
                        this._logPanelInstance?.close();
                        this._glossaryPanelInstance?.open(row);
                    }
                });
            }
            if (item.onClick) {
                row.on('click', async () => {
                    playUiSound('open');
                    if (!item.keepOpen) {
                        row.trigger('mouseleave');
                        closeCol(this._c2);
                        closeCol(this._c3);
                        closeCol(this._c4);
                        this._clearC1Active();
                    }
                    const multi = this._tokens.length > 1 && item.broadcastFn;
                    if (multi) {
                        // Fire primary + every other token concurrently, none awaiting the others.
                        Promise.resolve(item.onClick()).catch(e => console.error('[TAH primary]', e));
                        for (const t of this._tokens.slice(1)) {
                            Promise.resolve(item.broadcastFn(t, t.actor))
                                .catch(e => console.error('[TAH broadcast]', e));
                        }
                    } else {
                        if (item.keepOpen && item.refreshCol4)
                            this._suppressRefreshDepth++;
                        try {
                            await item.onClick();
                        } finally {
                            if (item.keepOpen && item.refreshCol4) {
                                this._suppressRefreshDepth--;
                                if (col === this._c3)
                                    this._openCol(this._c3, item.refreshCol4(), anchorRow, { reposition: false });
                                else if (this._c4AnchorRow)
                                    this._openCol(this._c4, item.refreshCol4(), this._c4AnchorRow, { reposition: false });
                            }
                        }
                    }
                });
            }
            if (item.onRightClick) {
                row.attr('title', 'Right click for details');
                row.on('contextmenu', ev => {
                    ev.preventDefault();
                    playUiSound('details');
                    if (item.keepOpen && item.refreshCol4) {
                        if (col === this._c3)
                            this._pendingCol3Refresh = { fn: item.refreshCol4, anchor: anchorRow };
                        else
                            this._pendingCol4Refresh = { fn: item.refreshCol4, anchor: this._c4AnchorRow };
                    }
                    item.onRightClick(row);
                });
            }
            if (item.hoverData) {
                const hd = item.hoverData;
                const token = this._token;
                row.on('mouseenter', () => onHudRowHover({ ...hd, token, isEntering: true,  isLeaving: false }));
                row.on('mouseleave', () => onHudRowHover({ ...hd, token, isEntering: false, isLeaving: true  }));
            }
            if (hasChildren && !item.isLogPanel && !item.isGlossaryPanel) {
                const openChild = () => {
                    if (col === this._c2 && row.hasClass('la-hud-active') && this._c3.is(':visible')) {
                        if (this._clickToOpen) {
                            closeCol(this._c3);
                            closeCol(this._c4);
                            row.css({ background: row.data('restingBg') ?? BG_DEFAULT, color: row.data('restingColor') ?? TEXT_DEFAULT }).removeClass('la-hud-active');
                        } else {
                            this._cancelCollapse();
                        }
                        return;
                    }
                    if (col === this._c3 && row.hasClass('la-hud-active') && this._c4.is(':visible')) {
                        if (this._clickToOpen) {
                            closeCol(this._c4);
                            row.css({ background: row.data('restingBg') ?? BG_DEFAULT, color: row.data('restingColor') ?? TEXT_DEFAULT }).removeClass('la-hud-active');
                        } else {
                            this._cancelCollapse();
                        }
                        return;
                    }
                    this._setActive(col, row);
                    playUiSound();
                    // Close any panels (log / glossary / status) before drilling into a new child column.
                    this._logPanelInstance?.close();
                    this._glossaryPanelInstance?.close();
                    this._statusPanelInstance?.close();
                    const freshChildren = item.getChildren ? item.getChildren() : rawChildren;
                    if (col === this._c2) {
                        closeCol(this._c4, 80);
                        this._openChildCol(col, this._c3, item, freshChildren, row);
                    } else if (col === this._c3) {
                        this._c4AnchorRow = row;
                        this._openChildCol(this._c3, this._c4, item, freshChildren, row);
                    }
                };
                if (this._clickToOpen)
                    row.on('click', openChild);
                else
                    row.on('mouseenter', openChild);
            }

            col.append(row);
        }

        const maxItems = game.settings.get('lancer-automations', 'tah.maxColumnItems') ?? 0;
        if (maxItems > 0 && filteredItems.length > maxItems) {
            const ROW_H = 32; // approx row height including 2px gap
            const LABEL_H = 22;
            col.css({ maxHeight: `${LABEL_H + ROW_H * maxItems}px`, overflowY: 'auto' });
        } else {
            col.css({ maxHeight: '', overflowY: '' });
        }
    }

    /** Open a child column positioned to the right of parentCol and animate it in. */
    _openChildCol(/** @type {any} */ parentCol, /** @type {any} */ childCol, /** @type {any} */ item, /** @type {any} */ children, /** @type {any} */ row) {
        if (childCol === this._c3) {
            this._c3SourceItem = item;
            this._c3AnchorRow = row;
            this._c4SourceItem = null;
        } else if (childCol === this._c4) {
            this._c4SourceItem = item;
        }
        childCol.find('.la-hud-col-label').text(item.childColLabel ?? '');
        childCol.css({ left: parentCol.position().left + parentCol.outerWidth() });
        this._openCol(childCol, children, row);
        childCol.stop(true).css({ opacity: 0, marginLeft: -10, pointerEvents: 'none' })
            .show().animate({ opacity: 1, marginLeft: 0 }, 140, function() {
                $(this).css('pointerEvents', '');
            });
    }

    // ── Category / item builders ──────────────────────────────────────────────

    // ── Category list (order = HUD order) ──────────────────────────────────
    _buildCategories() {
        const types        = this._tokens.map(t => t.actor?.type);
        const isMech       = types.every(t => t === 'mech');
        const isDeployable = types.every(t => t === 'deployable');
        const isPilot      = types.every(t => t === 'pilot');
        const isNpc        = types.every(t => t === 'npc');
        return [
            this._catActions(),
            ...(isDeployable ? [] : [this._catWeapons()]),
            this._catTech(),
            ...(isDeployable || isPilot ? [] : [this._catDeployables()]),
            ...(isDeployable || isPilot ? [] : [this._catResources()]),
            ...(isMech ? [this._catSystems()] : isNpc ? [this._catNpcSystems()] : isPilot ? [this._catPilotGear()] : []),
            ...(isMech ? [this._catFrame()]   : isNpc ? [this._catNpcFrame()]   : isPilot ? [this._catPilot()] : []),
            ...(isMech ? [this._catTalents()] : []),
            this._catSkills(),
            this._catUtility(),
            this._catStatuses(),
            this._catMacros(),
        ];
    }

    _catActions() {
        const actor        = this._actor;
        const isDeployable = actor.type === 'deployable';

        if (isDeployable)
            return this._catActionsDeployable(actor);
        if (actor.type === 'pilot')
            return this._catActionsPilot(actor);

        return {
            label: 'Actions',
            colLabel: 'Actions',
            getItems: () => [
                {
                    label: 'Basic',
                    childColLabel: actor.type === 'mech' ? 'Action' : 'Quick',
                    getChildren: () => [
                        ...(actor.type === 'mech' ? [
                            this._lockable({ label: 'Overcharge', icon: 'systems/lancer/assets/icons/overcharge.svg', onClick: () => /** @type {any} */ (actor.beginOverchargeFlow()), broadcastFn: (_t, a) => /** @type {any} */ (a).beginOverchargeFlow(), onRightClick: this._actionPopup({ name: 'Overcharge', activation: 'Free', detail: 'Each time you OVERCHARGE, the next time you OVERCHARGE deals more self-heat. The sequence is 1d3 heat, 1d6 heat, 1d6+4 heat. It resets on a FULL REPAIR.' }) }, 'Overcharge'),
                            { isSectionLabel: true, label: 'Quick' },
                        ] : []),
                        ...(/** @type {any} */ (this._catQuickActions().getItems().find(i => i.label === 'Basic'))?.getChildren?.() ?? []),
                        { isSectionLabel: true, label: 'Full' },
                        ...(/** @type {any} */ (this._catFullAction().getItems().find(i => i.label === 'Basic'))?.getChildren?.() ?? []),
                    ],
                },
                { label: 'Attacks', childColLabel: 'Attacks', getChildren: () => this._catAttacks().getItems() },
                { label: 'Quick Actions', childColLabel: 'Quick Actions',    getChildren: () => this._getActionsByActivation(actor, 'Quick', 'Actions') },
                { label: 'Full Actions',  childColLabel: 'Full Actions',     getChildren: () => this._getActionsByActivation(actor, 'Full', 'Actions') },
                { label: 'Reaction',      childColLabel: 'Reaction', getChildren: () => this._catReactions().getItems() },
                { label: 'Protocol',      childColLabel: 'Protocol', getChildren: () => this._catProtocols().getItems() },
                { label: 'Free Actions',  childColLabel: 'Free Actions',     getChildren: () => this._catFreeActions().getItems() },
                ...(() => {
                    const deactItems = actor.items.filter(i =>
                        i.flags?.['lancer-automations']?.activeStateData?.active
                        || (i.system?.tags ?? []).some(t => t.lid === 'tg_deactivate')
                    );
                    return [{
                        label: 'Deactivate',
                        childColLabel: 'Deactivate',
                        getChildren: () => deactItems.map(item => {
                            const asd = item.flags?.['lancer-automations']?.activeStateData;
                            const label = `<span style="color:#e8a030;font-size:0.7em;vertical-align:middle;">●</span> ${asd?.endActionDescription || `Deactivate ${item.name}`}`;
                            const activation = asd?.endAction || 'Protocol';
                            return {
                                label,
                                icon: getActivationIcon(activation),
                                hoverData: { actor, item, action: { name: label, activation }, category: 'Actions' },
                                onClick: () => {
                                    const si = /** @type {any} */ (item);
                                    si.beginActivationFlow?.();
                                },
                                onRightClick: this._actionPopup({ name: label, activation, detail: item.system?.effect || '' }, item),
                            };
                        })
                    }];
                })(),
            ],
        };
    }

    _catResources() {
        return {
            label: 'Resources',
            // One source → use its name as the col header; two or more → "Resources".
            colLabel: () => {
                const c = this._resourceItems().length > 0;
                const e = this._resourceExtras().length > 0;
                const a = this._ammoItems().length > 0;
                const sum = (c ? 1 : 0) + (e ? 1 : 0) + (a ? 1 : 0);
                if (sum === 1) return c ? 'Resources' : e ? 'Extra' : 'Ammo';
                return 'Resources';
            },
            getItems: () => {
                const counters = this._resourceItems();
                const extras = this._resourceExtras();
                const ammo = this._ammoItems();
                const out = [];
                let pushed = false;
                const append = (rows, label) => {
                    if (!rows.length) return;
                    if (pushed) out.push({ isSectionLabel: true, label });
                    out.push(...rows);
                    pushed = true;
                };
                append(counters, 'Resources');
                append(extras, 'Extra');
                append(ammo, 'Ammo');
                return out;
            },
        };
    }

    _catActionsDeployable(/** @type {any} */ actor) {
        const sys = actor.system;
        const items = [];

        // Main activation action (the deployable itself)
        if (sys.activation) {
            const deployAction = { name: actor.name, activation: sys.activation, detail: sys.detail ?? '' };
            items.push({
                label: 'Activation',
                icon: getActivationIcon(sys.activation),
                hoverData: { actor, item: null, action: deployAction, category: 'Actions' },
                onClick: () => executeSimpleActivation(actor, { title: actor.name, action: deployAction, detail: sys.detail ?? '' }),
                onRightClick: this._actionPopup(deployAction),
            });
        }

        // Recall action (no dialog, just deletes this token).
        if (sys.recall != null) {
            items.push({
                label: 'Recall',
                icon: getActivationIcon(sys.recall),
                onClick: () => this._token.document.delete(),
            });
        }

        // All actions from system.actions
        for (const action of (sys.actions ?? [])) {
            items.push({
                label: action.name,
                icon: getActivationIcon(action.activation),
                hoverData: { actor, item: null, action, category: 'Actions' },
                onClick: () => executeSimpleActivation(actor, { title: action.name, action, detail: action.detail ?? '' }),
                onRightClick: this._actionPopup(action),
            });
        }

        return {
            label: 'Actions',
            colLabel: 'Actions',
            getItems: () => items,
        };
    }

    _catActionsPilot(/** @type {any} */ actor) {
        const ap = a => this._actionPopup(a);
        const token = this._token;
        const showAHIS = game.settings.get('lancer-automations', 'tah.showAidHandleInteractSqueeze') ?? true;
        const basicQuick = () => [
            this._simpleItem('Boost',    'modules/lancer-automations/icons/speedometer.svg', { name: 'Boost',    activation: 'Quick'          }, 'When you BOOST, you move at least 1 space, up to your SPEED. This allows you to make an extra movement, on top of your standard move. Certain talents and systems can only be used when you BOOST, not when you make a standard move.'),
            this._simpleItem('Hide',     'systems/lancer/assets/icons/status_hidden.svg',    { name: 'Hide',     activation: 'Quick'          }, 'Obscure your position, becoming HIDDEN and unable to be identified, precisely located, or targeted directly by attacks or hostile actions.'),
            this._simpleItem('Search',   'modules/lancer-automations/icons/search.svg',      { name: 'Search',   activation: 'Quick'          }, 'Choose a character within your SENSORS that you suspect is HIDDEN and make a contested SYSTEMS check against their AGILITY. This can be used to reveal characters within RANGE 5. Once a HIDDEN character has been found, they immediately lose HIDDEN.'),
            ...(showAHIS ? [this._simpleItem('Interact', 'modules/lancer-automations/icons/click.svg',       { name: 'Interact', activation: 'Protocol/Quick' }, 'Manipulate an object in some way, such as pushing a button, knocking it over, or ripping out wires. You may only Interact 1/turn. If no hostile characters are adjacent to the object, you automatically succeed. Otherwise, make a contested skill check.')] : []),
            this._simpleItem('Prepare',  'modules/lancer-automations/icons/light-bulb.svg',  { name: 'Prepare',  activation: 'Quick'          }, 'Prepare any other Quick Action and specify a valid trigger in the form "When X then Y". Until the start of your next turn, when it is triggered, you can take this action as a Reaction. While holding a Prepared Action, you may not move or perform any other actions or Reactions.'),
            { label: 'Reload', icon: 'modules/lancer-automations/icons/reload.svg', onClick: () => reloadOneWeapon(token), broadcastFn: (t) => reloadOneWeapon(t), onRightClick: ap({ name: 'Reload', activation: 'Quick', detail: 'Reload one Loading weapon.' }) },
        ];
        const basicFull = () => [
            this._simpleItem('Disengage', 'modules/lancer-automations/icons/disengage.svg', { name: 'Disengage', activation: 'Full' }, 'Until the end of your current turn, you ignore engagement and your movement does not provoke reactions.'),
            this._simpleItem('Mount',     'modules/lancer-automations/icons/thrust.svg',    { name: 'Mount',     activation: 'Full' }, 'You can MOUNT as a full action. You must be adjacent your mech to MOUNT.\nAdditionally, you can also MOUNT willing allied mechs or vehicles. When you do so, move into the same space and then move with them.'),
            this._simpleItem('Jockey',    'modules/lancer-automations/icons/rope-dart.svg',     { name: 'Jockey',    activation: 'Full' }, 'To JOCKEY, you must be adjacent to a mech. As a full action, make a contested skill check using GRIT. The mech contests with HULL. On a success, climb onto the mech, sharing its space.\nChoose one: DISTRACT (mech is IMPAIRED and SLOWED), SHRED (deal 2 heat), or DAMAGE (deal 4 kinetic damage).'),
        ];
        return {
            label: 'Actions',
            colLabel: 'Actions',
            getItems: () => [
                {
                    label: 'Basic',
                    childColLabel: 'Quick',
                    getChildren: () => [
                        ...basicQuick(),
                        { isSectionLabel: true, label: 'Full' },
                        ...basicFull(),
                    ],
                },
                { label: 'Attacks', childColLabel: 'Attacks', getChildren: () => this._catAttacks().getItems() },
                { label: 'Quick Actions', childColLabel: 'Quick Actions', getChildren: () => this._getActionsByActivation(actor, 'Quick', 'Actions') },
                { label: 'Full Actions',  childColLabel: 'Full Actions',  getChildren: () => this._getActionsByActivation(actor, 'Full',  'Actions') },
                { label: 'Reaction',      childColLabel: 'Reaction',      getChildren: () => this._catReactions().getItems() },
                { label: 'Protocol',      childColLabel: 'Protocol',      getChildren: () => this._catProtocols().getItems() },
                { label: 'Free Actions',  childColLabel: 'Free Actions',  getChildren: () => this._catFreeActions().getItems() },
            ],
        };
    }

    _catDeployables() {
        const actor = this._actor;
        const token = this._token;

        // Mechs: equipped items only (systems + frame + weapons). NPCs: all actor.items.
        // Loadout entries can be raw ID strings or {id,status,value} objects; handle both.
        let equippedItems;
        if (actor.type === 'mech') {
            const loadout = actor.system?.loadout ?? {};
            const getId = (/** @type {any} */ s) => (typeof s === 'string' ? s : s?.id) ?? null;
            const equippedIds = new Set([
                ...(loadout.systems ?? []).map(getId),
                getId(loadout.frame),
                ...(loadout.weapon_mounts ?? []).flatMap((/** @type {any} */ m) =>
                    (m.slots ?? []).map((/** @type {any} */ sl) => getId(sl.weapon))
                ),
            ].filter(Boolean));
            equippedItems = [...actor.items].filter((/** @type {any} */ i) => equippedIds.has(i.id));
        } else {
            equippedItems = [...actor.items];
        }
        const deployableRows = [];
        for (const item of equippedItems) {
            const lids = getItemDeployables(item, actor);
            for (const lid of lids) {
                const depInfo = getDeployableInfoSync(lid, actor);
                const label = depInfo?.name ?? lid;
                const icon  = getActivationIcon({ activation: depInfo?.activation }) ?? 'systems/lancer/assets/icons/deployable.svg';
                deployableRows.push({
                    label,
                    icon,
                    hoverData: { actor, item, action: null, category: 'Deployables' },
                    onClick: () => deployDeployable(actor, lid, item, true),
                    onRightClick: async (/** @type {any} */ row) => {
                        let dep = null;
                        if (!dep) {
                            const resolved = await resolveDeployable(lid, actor);
                            dep = resolved.deployable;
                        }
                        if (!dep)
                            return;
                        const srcType = item.system?.type ?? '';
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: dep.name, subtitle: `Deployable · ${item.name}${srcType ? ` (${srcType})` : ''}`, bodyHtml: laRenderDeployables([dep]), theme: 'deployable', item, row });
                    },
                });
            }
        }
        for (const lid of getActorDeployables(actor)) {
            const depInfo = getDeployableInfoSync(lid, actor);
            const name = depInfo?.name ?? lid;
            const label = `<span style="color:#e8a030;font-size:0.7em;vertical-align:middle;">●</span> ${name}`;
            const icon  = getActivationIcon({ activation: depInfo?.activation }) ?? 'systems/lancer/assets/icons/deployable.svg';
            deployableRows.push({
                label,
                icon,
                hoverData: { actor, item: null, action: null, category: 'Deployables' },
                onClick: () => deployDeployable(actor, lid, null, false),
                onRightClick: async (/** @type {any} */ row) => {
                    const resolved = await resolveDeployable(lid, actor);
                    const dep = resolved.deployable;
                    if (!dep)
                        return;
                    this._showItemPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: dep.name, subtitle: 'Extra Deployable', bodyHtml: laRenderDeployables([dep]), theme: 'deployable', item: null, row });
                },
            });
        }

        return {
            label: 'Deployables',
            colLabel: 'Tools',
            getItems: () => [
                { label: 'Deploy Item', icon: 'systems/lancer/assets/icons/deployable.svg', onClick: () => openDeployableMenu(actor) },
                { label: 'Recall Item', icon: 'modules/lancer-automations/icons/up-card.svg',     onClick: () => recallDeployable(token) },
                {
                    label: 'Link/Unlink Actor',
                    icon: 'modules/lancer-automations/icons/linked-rings.svg',
                    onClick: () => promptLinkOrUnlinkActor(token),
                },
                ...(deployableRows.length ? [{ isSectionLabel: true, label: 'Deployables' }, ...deployableRows] : []),
            ],
        };
    }

    _catAttacks() {
        const actor = this._actor;
        const token = this._token;
        const ap = a => this._actionPopup(a);
        return {
            label: 'Attacks',
            colLabel: 'Attacks',
            getItems: () => this._enrichHoverData([
                ...(actor.type === 'mech' || actor.type === 'npc' ? [
                    this._lockable({ label: 'Skirmish',          icon: 'mdi mdi-hexagon-slice-3', onClick: () => executeSkirmish(actor),    broadcastFn: (t, a) => executeSkirmish(a),    onRightClick: ap({ name: 'Skirmish',          activation: 'Quick', detail: 'When you SKIRMISH, you attack with a single weapon MOUNT. \r \n To SKIRMISH, choose a mount and a valid target within RANGE (or THREAT), then make an attack with the primary weapon on that mount. \r &bull; You may also attack with an AUXILIARY weapon on the same mount. That weapon does not deal bonus damage. \r &bull; SUPERHEAVY weapons are too cumbersome to use in a SKIRMISH, and can only be fired as part of a BARRAGE.' }) }, 'Skirmish'),
                    this._lockable({ label: 'Barrage',           icon: 'mdi mdi-hexagon-slice-6', onClick: () => executeBarrage(actor),     broadcastFn: (t, a) => executeBarrage(a),     onRightClick: ap({ name: 'Barrage',           activation: 'Full',  detail: 'When you BARRAGE, you attack with two weapon MOUNTS, or with one SUPERHEAVY weapon. \r \n To BARRAGE, choose your mounts (or one SUPERHEAVY) and either one target or different targets within range, then make an attack with the primary weapon on each mount. \r &bull; You may also attack with an AUXILIARY weapon on each mount that was fired, so long as it has not yet been fired this action. These AUXILIARY weapons do not deal bonus damage. \r &bull; SUPERHEAVY weapons can only be fired as part of a BARRAGE.' }) }, 'Barrage'),
                    this._simpleItem('Ram',     'mdi mdi-hexagon-slice-3', { name: 'Ram',     activation: 'Quick' }, 'When you RAM, you make a melee attack with the aim of knocking a target down or back. \r \n To RAM, make a melee attack against an adjacent character the same SIZE or smaller than you. On a success, your target is knocked PRONE and you may also choose to knock them back by one space, directly away from you.'),
                    this._simpleItem('Grapple', 'mdi mdi-hexagon-slice-3', { name: 'Grapple', activation: 'Quick' }, 'When you GRAPPLE, you grab hold of a target to overpower them. \r \n To GRAPPLE, choose an adjacent character and make a melee attack. On a hit: \r &bull; both characters become ENGAGED; \r &bull; neither can BOOST or take reactions while grappled; \r &bull; the smaller becomes IMMOBILIZED and is dragged when the larger moves. If same SIZE, contested HULL check at start of turn decides who is larger. \r \n A GRAPPLE ends when adjacency breaks, the attacker ends it as a free action, or the defender wins a contested HULL check as a quick action.'),
                    this._lockable({ label: 'Improvised Attack', icon: 'mdi mdi-hexagon-slice-6', onClick: () => executeBasicAttack(actor), broadcastFn: (t, a) => executeBasicAttack(a), onRightClick: ap({ name: 'Improvised Attack', activation: 'Full',  detail: 'When you make an IMPROVISED ATTACK, you attack with a rifle butt, fist, or another improvised melee weapon. You can use anything from the butt of a weapon to a slab of concrete or a length of hull plating &mdash; the flavor of the attack is up to you! \r \n To make an IMPROVISED ATTACK, make a melee attack against an adjacent target. On a success, they take 1d6 kinetic damage.' }) }, 'Improvised Attack'),
                ] : []),
                ...(actor.type === 'pilot' ? [
                    this._lockable({ label: 'Fight', icon: 'modules/lancer-automations/icons/crossed-slashes.svg', onClick: () => executeFight(actor), broadcastFn: (t, a) => executeFight(a), onRightClick: ap({ name: 'Fight', activation: 'Full', detail: 'Make a melee or ranged attack with a pilot weapon.' }) }, 'Fight'),
                ] : []),
                { isSectionLabel: true, label: 'Tools' },
                { label: 'Basic Attack',  icon: 'systems/lancer/assets/icons/mech_weapon.svg', onClick: () => executeBasicAttack(actor), broadcastFn: (t, a) => executeBasicAttack(a) },
                { label: 'Damage',        icon: 'systems/lancer/assets/icons/melee.svg',       onClick: () => executeDamageRoll(token, [...(game.user?.targets ?? [])], '0', 'Kinetic') },
                { label: 'Throw Weapon',  icon: 'systems/lancer/assets/icons/thrown.svg',      onClick: () => openThrowMenu(actor),    broadcastFn: (t, a) => openThrowMenu(a) },
                { label: 'Pickup Weapon', icon: 'modules/lancer-automations/icons/pickup.svg', onClick: () => pickupWeaponToken(token), broadcastFn: (t) => pickupWeaponToken(t), keepOpen: true },
            ], { actor, category: 'Attacks' }),
        };
    }

    _catWeapons() {
        const actor = this._actor;
        const allMounts = () => {
            const mounts = actor?.system?.loadout?.weapon_mounts ?? [];
            const hasWeapon = m => !m.bracing && (m.slots ?? []).some(s => s.weapon?.id);
            return [...mounts].sort((a, b) => (hasWeapon(a) ? 0 : 1) - (hasWeapon(b) ? 0 : 1));
        };
        const firstMountName = () => {
            const first = allMounts()[0];
            return first ? `${first.type} Mount` : 'Mounts';
        };
        return {
            label: 'Weapons',
            colLabel: actor?.type === 'npc' || actor?.type === 'pilot' ? 'Weapons' : firstMountName(),
            getItems: () => {
                if (actor?.type === 'npc')
                    return actor.items.filter(i => i.type === 'npc_feature' && i.system.type === 'Weapon').map(w => this._weaponItem(w, null, null));
                if (actor?.type === 'pilot')
                    return actor.items.filter(i => i.type === 'pilot_weapon').map(w => this._weaponItem(w, null, null));
                const MUTED = 'color:#888;font-style:italic;';
                const result = [];
                allMounts().forEach((mount, idx) => {
                    if (idx > 0)
                        result.push({ label: `${mount.type} Mount` || `Mount ${idx + 1}`, isSectionLabel: true });
                    if (mount.bracing) {
                        result.push({ label: `<span style="${MUTED}">Locked</span>` });
                        return;
                    }
                    // A Flex mount with a Main (or larger) weapon has no remaining capacity
                    const flexBlocked = mount.type === 'Flex' && (mount.slots ?? []).some(s => {
                        if (!s.weapon?.id)
                            return false;
                        const w = actor.items.get(s.weapon.id);
                        return w && (w.system?.size ?? '').toLowerCase() !== 'aux';
                    });
                    (mount.slots ?? []).forEach(slot => {
                        if (slot.weapon?.id) {
                            const weapon = actor.items.get(slot.weapon.id);
                            const mod    = slot.mod?.id ? actor.items.get(slot.mod.id) : null;
                            if (weapon)
                                result.push(this._weaponItem(weapon, mod, mount));
                        } else if (!flexBlocked) {
                            result.push({ label: `<span style="${MUTED}">Empty</span>` });
                        }
                    });
                });
                return result;
            },
        };
    }

    _catTech() {
        const actor = this._actor;
        const ap = a => this._actionPopup(a);
        if (actor.type === 'deployable' || actor.type === 'pilot') {
            return {
                label: 'Tech',
                colLabel: 'Tech',
                getItems: () => [
                    ...this._catInvades().getItems(),
                    ...this._getActionsByActivation(actor, 'Quick Tech', 'Tech'),
                    ...this._getActionsByActivation(actor, 'Full Tech', 'Tech'),
                ],
            };
        }
        return {
            label: 'Tech',
            colLabel: 'Tech',
            getItems: () => [
                {
                    label: 'Basic',
                    childColLabel: 'Quick Tech',
                    getChildren: () => this._enrichHoverData([
                        this._lockable({ label: 'Basic Tech', icon: ICON_TECH_QUICK, onClick: () => executeTechAttack(actor, { title: 'Basic Tech', grit: actor.system?.tech_attack, attack_type: 'Tech' }), onRightClick: ap({ name: 'Basic Tech', activation: 'Quick Tech', tech_attack: true, detail: 'Roll your TECH ATTACK against one target\'s E-DEFENSE. On a success, deal 1d3 heat to the target.' }) }, 'Basic Tech'),
                        this._lockable({ label: 'Scan',       icon: 'modules/lancer-automations/icons/radar-sweep.svg', onClick: () => executeSimpleActivation(actor, { title: 'Scan',     action: { name: 'Scan',     activation: 'Quick' }, detail: 'Choose a character within SENSORS and line of sight. Make a tech attack against them. On a success, you discover all of their statistics (HP, Heat, Armor, Speed, Evasion, E-Defense, and all talent ranks, system and weapon loadouts, traits, and core systems).' }), onRightClick: ap({ name: 'Scan',     activation: 'Quick Tech', tech_attack: true, detail: 'Choose a character within SENSORS and line of sight. Make a tech attack against them. On a success, you discover all of their statistics (HP, Heat, Armor, Speed, Evasion, E-Defense, and all talent ranks, system and weapon loadouts, traits, and core systems).' }) }, 'Scan'),
                        this._lockable({ label: 'Lock On',    icon: 'systems/lancer/assets/icons/white/condition_lockon.svg', onClick: () => executeSimpleActivation(actor, { title: 'Lock On',  action: { name: 'Lock On',  activation: 'Quick' }, detail: 'Choose a character within SENSORS and line of sight. They gain the LOCK ON condition. Any character making an attack against a character with LOCK ON may choose to gain +1 Accuracy on that attack and then clear the LOCK ON condition after that attack resolves.' }),  onRightClick: ap({ name: 'Lock On',  activation: 'Quick Tech', tech_attack: true, detail: 'Choose a character within SENSORS and line of sight. They gain the LOCK ON condition. Any character making an attack against a character with LOCK ON may choose to gain +1 Accuracy on that attack and then clear the LOCK ON condition after that attack resolves.' }) }, 'Lock On'),
                        this._lockable({ label: 'Bolster',    icon: 'modules/lancer-automations/icons/upgrade.svg', onClick: () => executeSimpleActivation(actor, { title: 'Bolster',  action: { name: 'Bolster',  activation: 'Quick' }, detail: 'Choose a character within SENSORS. They receive +2 Accuracy on the next skill check or save they make between now and the end of their next turn. Characters can only benefit from one BOLSTER at a time.' }),                                                              onRightClick: ap({ name: 'Bolster',  activation: 'Quick Tech', tech_attack: true, detail: 'Choose a character within SENSORS. They receive +2 Accuracy on the next skill check or save they make between now and the end of their next turn. Characters can only benefit from one BOLSTER at a time.' }) }, 'Bolster'),
                        this._lockable({ label: 'Invade',     icon: 'modules/lancer-automations/icons/cpu-shot.svg', onClick: () => executeInvade(actor),                                                                                                                                                                                                                                                                                                                                                                       onRightClick: ap({ name: 'Invade',   activation: 'Full Tech',  tech_attack: true, detail: 'Make a tech attack against a target. On success, choose one of the available Invade options.' }) }, 'Invade'),
                    ], { actor, category: 'Tech' }),
                },
                { label: 'Invades',    childColLabel: 'Invades',    getChildren: () => this._catInvades().getItems() },
                { label: 'Quick Tech', childColLabel: 'Quick Tech', getChildren: () => this._getActionsByActivation(actor, 'Quick Tech', 'Tech') },
                { label: 'Full Tech',  childColLabel: 'Full Tech',  getChildren: () => this._getActionsByActivation(actor, 'Full Tech', 'Tech') },
            ],
        };
    }

    _catInvades() {
        const actor = this._actor;
        return {
            label: 'Invades',
            colLabel: 'Invades',
            getItems: () => this._getInvadeOptions(actor).map(opt => ({
                label: opt.destroyed ? this._destroyedLabel(opt.name) : opt.name,
                icon: 'modules/lancer-automations/icons/cpu-shot.svg',
                ...this._statusColors(opt),
                hoverData: { actor, item: opt.item ?? null, action: opt.action ?? { name: opt.name, activation: 'Invade' }, category: 'Tech' },
                onClick: () => executeInvade(actor, opt),
                onRightClick: (row) => this._buildInvadePopup(opt, row),
            })),
        };
    }

    _catQuickActions() {
        const actor = this._actor;
        const ap = a => this._actionPopup(a);
        const showAHIS = game.settings.get('lancer-automations', 'tah.showAidHandleInteractSqueeze') ?? true;
        const basicChildren = () => {
            const items = [
                this._simpleItem('Boost',     'modules/lancer-automations/icons/speedometer.svg',  { name: 'Boost',     activation: 'Quick'          }, 'When you BOOST, you move at least 1 space, up to your SPEED. This allows you to make an extra movement, on top of your standard move. Certain talents and systems can only be used when you BOOST, not when you make a standard move.'),
                ...(showAHIS && actor.type !== 'npc' ? [this._simpleItem('Aid', 'modules/lancer-automations/icons/medical-pack.svg', { name: 'Aid', activation: 'Quick' }, 'You assist a mech so it can Stabilize more easily. Choose an adjacent character. On their next turn, they may Stabilize as a quick action. They can choose to take this action even if they normally would not be able to take actions (for example, by being affected by the Stunned condition).')] : []),
                this._simpleItem('Hide',      'systems/lancer/assets/icons/status_hidden.svg',     { name: 'Hide',      activation: 'Quick'          }, 'Obscure the position of your mech, becoming HIDDEN and unable to be identified, precisely located, or be targeted directly by attacks or hostile actions.'),
                this._simpleItem('Search',    'modules/lancer-automations/icons/search.svg',       { name: 'Search',    activation: 'Quick'          }, 'Choose a character within your SENSORS that you suspect is HIDDEN and make a contested SYSTEMS check against their AGILITY. This can be used to reveal characters within RANGE 5. Once a HIDDEN character has been found, they immediately lose HIDDEN.'),
                this._simpleItem('Shut Down', 'systems/lancer/assets/icons/status_shutdown.svg',   { name: 'Shut Down', activation: 'Quick'          }, 'When you SHUT DOWN, your mech powers off to end tech effects and cool down. \r \n As a quick action, your mech takes the SHUT DOWN status: \r &bull; all heat is cleared, as is EXPOSED; \r &bull; cascading NHPs return to normal; \r &bull; tech-caused statuses (LOCK ON, etc.) immediately end; \r &bull; the mech gains IMMUNITY to all tech actions and attacks; \r &bull; the mech is STUNNED indefinitely. \r \n The only way to remove SHUT DOWN is to BOOT UP.'),
                ...(showAHIS ? [this._simpleItem('Handle',    'modules/lancer-automations/icons/hand-truck.svg',   { name: 'Handle',    activation: 'Protocol/Quick' }, 'As a protocol or quick action, start to handle an adjacent object or willing character by lifting or dragging them. Mechs can drag characters or objects up to twice their SIZE but are SLOWED while doing so. They can also lift characters or objects of equal or lesser SIZE overhead but are IMMOBILIZED while doing so.')] : []),
                ...(showAHIS ? [this._simpleItem('Interact',  'modules/lancer-automations/icons/click.svg',        { name: 'Interact',  activation: 'Protocol/Quick' }, 'Manipulate an object in some way, such as pushing a button, knocking it over, or ripping out wires. You may only Interact 1/turn. If no hostile characters are adjacent to the object, you automatically succeed. Otherwise, make a contested skill check.')] : []),
                this._simpleItem('Prepare',   'modules/lancer-automations/icons/light-bulb.svg',   { name: 'Prepare',   activation: 'Quick'          }, 'Prepare any other Quick Action and specify a valid trigger in the form "When X then Y". Until the start of your next turn, when it is triggered, you can take this action as a Reaction. While holding a Prepared Action, you may not move or perform any other actions or Reactions.'),
                ...(actor.type !== 'npc' ? [this._simpleItem('Eject',     'modules/lancer-automations/icons/parachute.svg',    { name: 'Eject',     activation: 'Quick'          }, 'EJECT as a quick action, flying 6 spaces in the direction of your choice; however, this is a single-use system for emergency use only – it leaves your mech IMPAIRED. Your mech remains IMPAIRED and you cannot EJECT again until your next FULL REPAIR.')] : []),
                this._lockable({ label: 'Standing Up', icon: 'modules/lancer-automations/icons/underhand.svg', onClick: () => executeStandingUp(this._token), broadcastFn: (_t, a) => executeStandingUp(a.getActiveTokens()?.[0]), onRightClick: ap({ name: 'Standing Up', activation: 'Movement', detail: 'Stand up instead of taking your standard move. Removes Prone and grants +Speed movement.' }) }, 'Standing Up'),
            ];
            if (actor.type === 'mech')
                items.push({ label: 'Self Destruct', icon: 'modules/lancer-automations/icons/time-bomb.svg', onClick: () => /** @type {any} */ (executeReactorMeltdown(actor)), broadcastFn: (_t, a) => executeReactorMeltdown(a), onRightClick: ap({ name: 'Self Destruct', activation: 'Quick', detail: 'When you SELF DESTRUCT, you overload your reactor in a final, catastrophic play. \r \n As a quick action, initiate a reactor meltdown. The mech explodes at the end of your next turn, or at the end of one of your turns within the following two rounds (your choice): \r &bull; the mech is annihilated, killing anyone inside; \r &bull; a BURST 2 explosion deals 4d6 explosive damage; \r &bull; characters caught who succeed on an AGILITY save take half damage.' }) });
            return this._enrichHoverData(items, { actor, category: 'Actions' });
        };
        return {
            label: 'Quick Actions',
            colLabel: 'Quick Actions',
            getItems: () => [{ label: 'Basic', childColLabel: 'Basic', getChildren: basicChildren }, ...this._getActionsByActivation(actor, 'Quick', 'Actions')],
        };
    }

    _catFullAction() {
        const actor = this._actor;
        const ap = a => this._actionPopup(a);
        const basicChildren = () => {
            const items = [
                this._simpleItem('Boot Up',   'modules/lancer-automations/icons/boot.svg',      { name: 'Boot Up',   activation: 'Full' }, 'You can BOOT UP a mech that you are piloting as a full action, clearing SHUT DOWN and restoring your mech to a powered state.'),
                this._simpleItem('Disengage', 'modules/lancer-automations/icons/disengage.svg', { name: 'Disengage', activation: 'Full' }, 'Until the end of your current turn, you ignore engagement and your movement does not provoke reactions.'),
                ...(actor.type !== 'npc' ? [this._simpleItem('Dismount',  'modules/lancer-automations/icons/dismount.svg',  { name: 'Dismount',  activation: 'Full' }, 'When you DISMOUNT, you climb off of a mech. You can DISMOUNT as a full action. When you DISMOUNT, you are placed in an adjacent space – if there are no free spaces, you cannot DISMOUNT. Additionally, you can also DISMOUNT willing allied mechs or vehicles you have MOUNTED.')] : []),
            ];
            if (actor.type === 'mech' || actor.type === 'npc')
                items.push({ label: 'Stabilize', icon: 'systems/lancer/assets/icons/repair.svg', onClick: () => /** @type {any} */ (actor.beginStabilizeFlow()), broadcastFn: (_t, a) => /** @type {any} */ (a).beginStabilizeFlow(), onRightClick: ap({ name: 'Stabilize', activation: 'Full', detail: 'To STABILIZE, choose ONE of these two items: \r &bull; Cool your mech (clearing all heat and ending the EXPOSED status); \r &bull; Spend ONE Repair to heal your mech to max HP. \r \n Additionally, choose ONE the following four items: \r &bull; Reload all LOADING weapons on your mech; \r &bull; Clear any burn on your mech; \r &bull; Clear ONE condition from yourself NOT caused by your own systems/talents (etc); \r &bull; Clear ONE condition from an ADJACENT ally NOT caused by their own systems/talents (etc).' }) });
            return this._enrichHoverData(items, { actor, category: 'Actions' });
        };
        return {
            label: 'Full Action',
            colLabel: 'Full Action',
            getItems: () => [{ label: 'Basic', childColLabel: 'Basic', getChildren: basicChildren }, ...this._getActionsByActivation(actor, 'Full', 'Actions')],
        };
    }

    _catReactions() {
        const actor = this._actor;
        return {
            label: 'Reactions',
            colLabel: 'Reactions',
            getItems: () => {
                const reactionAvail = hasReactionAvailable(actor);
                const unavailBg = '#ffe5b4';
                const unavailBorder = '#cc7700';
                const noBrace     = actor.type === 'deployable' || actor.type === 'pilot' || actor.type === 'npc';
                const noOverwatch = actor.type === 'deployable';
                const items = [
                    ...(noBrace ? [] : [
                        { ...this._simpleItem('Brace',     'modules/lancer-automations/icons/brace.svg', { name: 'Brace',     activation: 'Reaction' }, 'You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.'), highlightBg: reactionAvail ? null : unavailBg, highlightBorderColor: reactionAvail ? null : unavailBorder },
                    ]),
                    ...(noOverwatch ? [] : [
                        { ...this._simpleItem('Overwatch', 'systems/lancer/assets/icons/reaction.svg',   { name: 'Overwatch', activation: 'Reaction', trigger: 'A hostile character starts any movement (including BOOST and other actions) inside one of your weapons\' THREAT.' }, 'Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move.'), highlightBg: reactionAvail ? null : unavailBg, highlightBorderColor: reactionAvail ? null : unavailBorder },
                    ]),
                    ...this._getActionsByActivation(actor, 'Reaction', 'Actions'),
                ];
                if (!reactionAvail)
                    items.forEach(item => {
                        if (item.highlightBg !== '#ffcccc') {
                            item.highlightBg = unavailBg; item.highlightBorderColor = unavailBorder;
                        }
                    });
                return this._enrichHoverData(items, { actor, category: 'Actions' });
            },
        };
    }

    _catProtocols() {
        const actor = this._actor;
        const ap = a => this._actionPopup(a);
        return {
            label: 'Protocols',
            colLabel: 'Protocols',
            getItems: () => this._enrichHoverData([
                ...this._getActionsByActivation(actor, 'Protocol', 'Actions'),
            ], { actor, category: 'Actions' }),
        };
    }

    _catFreeActions() {
        const actor = this._actor;
        const showAHIS = game.settings.get('lancer-automations', 'tah.showAidHandleInteractSqueeze') ?? true;
        return {
            label: 'Free Actions',
            colLabel: 'Free Actions',
            getItems: () => this._enrichHoverData([
                ...(showAHIS && actor.type !== 'deployable' ? [this._simpleItem('Squeeze', 'modules/lancer-automations/icons/contract.svg', { name: 'Squeeze', activation: 'Free' }, 'A character may squeeze as a free action, treating themselves as one Size smaller for the purposes of movement. While squeezing, the character is additionally treated as Prone. The character may stop squeezing as a free action while in a space able to accommodate their normal Size.')] : []),
                ...this._getActionsByActivation(actor, 'Free', 'Actions'),
            ], { actor, category: 'Actions' }),
        };
    }

    _catSkills() {
        const actor = this._actor;
        const isNpc = actor.type === 'npc';

        const statDefs = [
            { key: 'hull', label: 'Hull' },
            { key: 'agi',  label: 'Agility' },
            { key: 'sys',  label: 'Systems' },
            { key: 'eng',  label: 'Engineering' },
            { key: 'grit', label: 'Grit' },
            { key: 'tier', label: 'Tier' },
        ];
        const statsItems = statDefs
            .filter(s => actor.system[s.key] !== undefined)
            .map(s => ({
                label: s.label,
                badge: (actor.system[s.key] >= 0 ? '+' : '') + actor.system[s.key],
                badgeColor: '#777',
                hoverData: { actor, item: null, action: { name: s.label }, category: 'Skills' },
                onClick:     () => /** @type {any} */ (actor).beginStatFlow(`system.${s.key}`),
                broadcastFn: (_t, a) => /** @type {any} */ (a)?.beginStatFlow?.(`system.${s.key}`),
            }));

        const skillItems = [];
        if (!isNpc) {
            const pilot = actor.system.pilot?.value ?? actor;
            const skills = pilot.items?.filter(i => i.type === 'skill') ?? [];
            for (const skill of skills) {
                const bonus = (skill.system.curr_rank ?? 0) * 2;
                const skillName = skill.name;
                skillItems.push({
                    label: skill.name,
                    badge: `+${bonus}`,
                    badgeColor: '#777',
                    icon: skill.img ?? null,
                    hoverData: { actor, item: skill, action: { name: skill.name }, category: 'Skills' },
                    onClick:     () => skill.beginSkillFlow?.(),
                    broadcastFn: (_t, a) => {
                        const p = /** @type {any} */ (a)?.system?.pilot?.value ?? a;
                        const s2 = p?.items?.find(i => i.type === 'skill' && i.name === skillName);
                        return s2?.beginSkillFlow?.();
                    },
                });
            }
            // Generic untrained trigger (1d20+0), like alternative sheets' "Other Skill".
            skillItems.push({
                label: 'Other Skill',
                badge: '+0',
                badgeColor: '#777',
                icon: null,
                hoverData: { actor, item: null, action: { name: 'Other Skill' }, category: 'Skills' },
                onClick:     () => /** @type {any} */ (actor).beginStatFlow?.('system.other_skill', 'Other Skill'),
                broadcastFn: (_t, a) => /** @type {any} */ (a)?.beginStatFlow?.('system.other_skill', 'Other Skill'),
            });
        }

        if (isNpc) {
            return {
                label: 'Skills',
                colLabel: 'Skills',
                getItems: () => [
                    ...statsItems,
                ],
            };
        }

        return {
            label: 'Attributes',
            colLabel: 'Attributes',
            getItems: () => [
                { label: 'Skills',   childColLabel: 'Skills',   getChildren: () => statsItems },
                ...(skillItems.length ? [{ label: 'Triggers', childColLabel: 'Triggers', getChildren: () => skillItems }] : []),
            ],
        };
    }

    _catUtility() {
        const token = this._token;

        const actor = this._actor;
        const isMechOrNpc = actor?.type === 'mech' || actor?.type === 'npc';

        const combatItems = [
            { label: 'Start Turn',    onClick: () => {
                const c = /** @type {any} */ (token.document)?.combatant;
                if (game.combat && c)
                    activateCombatantSocket(game.combat, c);
            } },
            { label: 'End Turn',      onClick: () => /** @type {any} */ (game.combat)?.nextTurn() },
            { label: token.document.hidden ? 'Reveal Token' : 'Hide Token', onClick: () => token.document.update({ hidden: !token.document.hidden }) },
            { label: token.inCombat ? 'Remove From Combat' : 'Add To Combat', onClick: async () => {
                const targets = (this._tokens?.length ? this._tokens : [token]).filter(Boolean);
                const wantActive = !token.inCombat;
                for (const t of targets) {
                    if (!!t.inCombat === wantActive)
                        continue;
                    await _toggleTokenInCombat(t);
                }
            } },
            { label: 'Reinforcement', onClick: () => delayedTokenAppearance() },
        ];

        const gameplayItems = [
            { label: 'Full Repair',   icon: 'modules/lancer-automations/icons/auto-repair.svg',  onClick: () => /** @type {any} */ (actor)?.beginFullRepairFlow(), broadcastFn: (_t, a) => /** @type {any} */ (a).beginFullRepairFlow() },
            { label: 'Link to Token',
                icon: 'modules/lancer-automations/icons/pin.svg',
                onClick: async () => {
                    const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
                    const picked = await api?.chooseToken?.(token, { count: 1, includeSelf: false, title: 'LINK TO TOKEN', description: `Which token should ${token.name} be linked to?`, icon: 'cci cci-deployable' });
                    if (!picked || !picked.length)
                        return;
                    const target = picked[0];
                    await token.document.setFlag('lancer-automations', 'ownerActorUuid', target.actor.uuid);
                    await token.document.setFlag('lancer-automations', 'ownerName', target.actor.name ?? '');
                } },
            ...(isMechOrNpc ? [
                {
                    label: 'Structure',
                    icon: 'systems/lancer/assets/icons/macro-icons/condition_shredded.svg',
                    onClick: async () => {
                        await actor?.update({ 'system.hp.value': 0 });
                        /** @type {any} */ (actor)?.beginStructureFlow();
                    },
                },
                {
                    label: 'Overheat',
                    icon: 'systems/lancer/assets/icons/macro-icons/damage_heat.svg',
                    onClick: async () => {
                        const maxHeat = actor?.system?.heat?.max ?? 0;
                        await actor?.update({ 'system.heat.value': maxHeat });
                        /** @type {any} */ (actor)?.beginOverheatFlow();
                    },
                },
                { label: 'Suicide',          icon: 'modules/lancer-automations/icons/suicide.svg',   onClick: () => actor?.update({ 'system.structure.value': 0, 'system.stress.value': 0, 'system.hp.value': 0 }) },
                { label: 'Reactor Explosion', icon: 'modules/lancer-automations/icons/mushroom-cloud.svg', onClick: () => executeReactorExplosion(token) },
            ] : []),
            ...(token.document.getFlag('lancer-automations', 'isWreck') ? [
                { label: 'Resurrect', icon: 'modules/lancer-automations/icons/angel-outfit.svg', onClick: () => resurrect(token) },
            ] : []),
            ...(actor?.type === 'npc' ? [
                { label: 'Recharge', icon: 'modules/lancer-automations/icons/ammo-box.svg', onClick: () => /** @type {any} */ (actor).beginRechargeFlow(), broadcastFn: (_t, a) => /** @type {any} */ (a).beginRechargeFlow() },
                { label: 'Reload Weapon', icon: 'modules/lancer-automations/icons/reload.svg',       onClick: () => reloadOneWeapon(token), broadcastFn: (t) => reloadOneWeapon(t) },
            ] : []),
            { label: 'Generate Scan', icon: 'modules/lancer-automations/icons/passport.svg', onClick: () => executeGenerateScan(this._tokens?.length ? this._tokens : [token]) },
            ...(actor?.system?.overcharge_sequence ? (() => {
                const ocSeq = actor.system.overcharge_sequence.split(',').map(s => s.trim());
                return [{
                    inputCell: true,
                    subtype: 'increment',
                    name: 'Overcharge',
                    icon: 'systems/lancer/assets/icons/macro-icons/overcharge.svg',
                    noColor: true,
                    min: 0,
                    max: ocSeq.length - 1,
                    getValue: () => actor?.system?.overcharge ?? 0,
                    formatValue: (v) => ocSeq[v] ?? `${v}`,
                    onValueChanged: (newVal) => actor?.update({ 'system.overcharge': newVal }),
                }];
            })() : []),
            ...(actor?.system?.repairs ? [{
                inputCell: true,
                subtype: 'increment',
                name: 'Repairs',
                icon: 'modules/lancer-automations/icons/auto-repair.svg',
                noColor: true,
                min: 0,
                max: actor.system.repairs.max ?? actor.system.repcap ?? 0,
                getValue: () => actor?.system?.repairs?.value ?? 0,
                onValueChanged: (newVal) => actor?.update({ 'system.repairs.value': newVal }),
            }] : []),
        ];

        const capEnabled = game.settings.get('lancer-automations', 'enableMovementCapDetection')
            || game.settings.get('lancer-automations', 'enableBoostOffer');

        const ap = a => this._actionPopup(a);
        const movementItems = [
            { label: 'Knockback',      icon: 'modules/lancer-automations/icons/push.svg', onClick: () => knockBackToken([token], -1, { title: 'KNOCKBACK', description: 'Place each token at its knockback destination.' }) },
            this._lockable({ label: 'Teleport', icon: 'modules/lancer-automations/icons/teleport.svg', onClick: () => executeTeleport(token), broadcastFn: (_t, a) => executeTeleport(a.getActiveTokens()?.[0]), onRightClick: ap({ name: 'Teleport', activation: 'Movement', detail: 'Teleport to a destination within your speed range. Costs speed in movement.' }) }, 'Teleport'),
            { label: 'Fall', icon: 'modules/lancer-automations/icons/falling.svg', onClick: () => executeFall(token) },
            { label: 'Reset History',  icon: 'modules/lancer-automations/icons/trash-can.svg', onClick: () => clearMovementHistory(token, false) },
            { label: 'Revert Last Movement', icon: 'modules/lancer-automations/icons/anticlockwise-rotation.svg', onClick: () => revertMovement(token) },
            { label: 'Revert All Movements', icon: 'modules/lancer-automations/icons/backward-time.svg', onClick: () => clearMovementHistory(token, true) },
            // Move Cap editable input when cap tracking is on, otherwise just show base speed.
            ...(capEnabled ? [{
                inputCell: true,
                subtype: 'type',
                name: 'Move Cap',
                icon: 'modules/lancer-automations/icons/path-distance.svg',
                getValue: () => game.modules.get('lancer-automations')?.api?.getMovementCap(token) ?? 0,
                onValueChanged: (newVal) => {
                    const api = game.modules.get('lancer-automations')?.api;
                    if (!api)
                        return;
                    api.increaseMovementCap(token, newVal - api.getMovementCap(token));
                },
            }] : [{
                inputCell: true,
                subtype: 'type',
                name: 'Speed',
                icon: 'modules/lancer-automations/icons/path-distance.svg',
                getValue: () => actor?.system?.speed ?? 0,
                onValueChanged: () => {},
            }]),
        ];

        const _showWeaponBreakdown = (row, actor, rangeType) => {
            const items = actor?.items ?? [];
            const lines = [];
            for (const item of items) {
                if (!['mech_weapon', 'npc_feature', 'pilot_weapon'].includes(item.type))
                    continue;
                if (item.type === 'npc_feature' && item.system?.type !== 'Weapon')
                    continue;
                const profiles = item.system?.profiles ?? [{ range: item.system?.range ?? [] }];
                for (const profile of profiles) {
                    const ranges = profile.all_range ?? profile.range ?? [];
                    for (const r of ranges) {
                        if (r.type !== rangeType)
                            continue;
                        const val = parseInt(r.val) || 0;
                        if (val <= 0)
                            continue;
                        const pName = profiles.length > 1 && profile.name ? ` (${profile.name})` : '';
                        lines.push(`<li>${item.name}${pName}: <b>${val}</b></li>`);
                    }
                }
            }
            if (lines.length === 0) {
                lines.push(`<li>No ${rangeType.toLowerCase()} weapons found</li>`);
            }
            const bodyHtml = `<ul style="list-style:none;padding:0;margin:0;">${lines.join('')}</ul>`;
            this._showItemPopup({
                cssClass: 'la-hud-popup',
                dataKey: 'range-breakdown',
                dataValue: rangeType,
                title: `${rangeType} Breakdown`,
                subtitle: actor.name,
                bodyHtml,
                theme: 'system',
                row,
            });
        };

        // Ranges section: persistent aura toggles.
        const hasGAA = !!game.modules.get('grid-aware-auras')?.active;
        const threatVal = getActorMaxThreat(actor);
        const sensorVal = actor?.system?.sensor_range ?? (actor?.type === 'pilot' ? 5 : 10);
        const allRanges = getMaxWeaponRanges_WithBonus(actor);
        const maxRangeVal = Math.max(0, ...Object.entries(allRanges)
            .filter(([t]) => t !== 'Threat')
            .map(([, v]) => v));

        const rangeItems = hasGAA ? [
            {
                inputCell: true,
                subtype: 'toggle',
                name: `Threat (${threatVal})`,
                icon: 'systems/lancer/assets/icons/white/threat.svg',
                getValue: () => isPersistentAuraActive(token, 'LA_max_Threat'),
                onToggle: (on) => setPersistentAura(token, 'LA_max_Threat', on, threatVal),
            },
            {
                inputCell: true,
                subtype: 'toggle',
                name: `Sensors (${sensorVal})`,
                icon: 'systems/lancer/assets/icons/white/sensor.svg',
                getValue: () => isPersistentAuraActive(token, 'LA_Sensor'),
                onToggle: (on) => setPersistentAura(token, 'LA_Sensor', on, sensorVal),
            },
            {
                inputCell: true,
                subtype: 'toggle',
                name: `Max Reach (${maxRangeVal})`,
                icon: 'modules/lancer-automations/icons/nested-hexagons.svg',
                getValue: () => isPersistentAuraActive(token, 'LA_max_range') && !token.document?.getFlag('lancer-automations', 'weaponRangeItemId'),
                onToggle: async (on) => {
                    this._suppressRefreshDepth++;
                    try {
                        await token.document?.setFlag('lancer-automations', 'weaponRangeItemId', null);
                        await setPersistentAura(token, 'LA_max_range', on, maxRangeVal);
                    } finally {
                        this._suppressRefreshDepth--;
                    }
                },
            },
            { isSectionLabel: true, label: 'Custom' },
            {
                inputCell: true,
                subtype: 'increment',
                name: 'Size',
                icon: 'systems/lancer/assets/icons/white/aoe_burst.svg',
                noColor: true,
                min: 1,
                max: 100,
                getValue: () => token.document?.getFlag('lancer-automations', 'customMeasureSize') ?? 10,
                onValueChanged: async (newVal) => {
                    await token.document?.setFlag('lancer-automations', 'customMeasureSize', newVal);
                    if (isPersistentAuraActive(token, 'LA_custom_measure'))
                        setPersistentAura(token, 'LA_custom_measure', true, newVal);
                },
            },
            {
                inputCell: true,
                subtype: 'toggle',
                name: 'Measure',
                icon: 'systems/lancer/assets/icons/white/aoe_burst.svg',
                getValue: () => isPersistentAuraActive(token, 'LA_custom_measure'),
                onToggle: async (on) => {
                    const size = token.document?.getFlag('lancer-automations', 'customMeasureSize') ?? 10;
                    this._suppressRefreshDepth++;
                    try {
                        await setPersistentAura(token, 'LA_custom_measure', on, size);
                    } finally {
                        this._suppressRefreshDepth--;
                    }
                },
            },
        ] : [];

        return {
            label: 'Utility',
            colLabel: 'Utility',
            getItems: () => [
                { label: 'Combat',    childColLabel: 'Combat',    getChildren: () => combatItems },
                { label: 'Gameplay',  childColLabel: 'Gameplay',  getChildren: () => gameplayItems },
                { label: 'Movement',  childColLabel: 'Movement',  getChildren: () => movementItems },
                ...(rangeItems.length > 0 ? [{ label: 'Ranges', childColLabel: 'Ranges', getChildren: () => rangeItems }] : []),
                { label: 'Log', isLogPanel: true },
                { label: 'Glossary', isGlossaryPanel: true },
                { label: 'Misc',
                    childColLabel: 'Misc',
                    getChildren: () => [
                        { label: 'Vote',
                            icon: 'modules/lancer-automations/icons/vote.svg',
                            onClick: () => {
                                const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api; if (api?.openChoiceMenu)
                                    api.openChoiceMenu(); else /** @type {any} */
                                    (ui.notifications).error('Lancer Automations API not found or outdated.');
                            } },
                        { label: 'Downtime',
                            icon: 'systems/lancer/assets/icons/white/downtime.svg',
                            onClick: async () => {
                                const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api; await api?.executeDowntime?.();
                            } },
                        { label: 'Reserve',
                            icon: 'systems/lancer/assets/icons/white/reserve_mech.svg',
                            onClick: () => {
                                const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api; api?.openAddReserveDialog?.(token);
                            } },
                        { label: 'Rest',
                            icon: 'modules/lancer-automations/icons/night-sleep.svg',
                            onClick: () => {
                                const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api; api?.executeRest?.(token);
                            } },
                        { label: 'Add Extra',
                            icon: 'modules/lancer-automations/icons/files.svg',
                            onClick: () => openExtrasDialog(actor) },
                    ] },
            ],
        };
    }

    _catSystems() {
        const actor = this._actor;
        return {
            label: 'Systems',
            colLabel: 'Systems',
            getItems: () => {
                const systems = (actor.system?.loadout?.systems ?? [])
                    .map(/** @type {any} */ s => s?.value)
                    .filter(/** @type {any} */ item => !!item);
                if (!systems.length)
                    return [];
                return systems.map(item => {
                    const sys = item.system;
                    const status = getItemStatus(item);
                    const labelHtml = status.destroyed ? this._destroyedLabel(item.name) : item.name;
                    return {
                        label: labelHtml,
                        badge: status.badge ?? null,
                        badgeColor: status.badgeColor ?? null,
                        icon: item.img ?? null,
                        hoverData: { actor, item, action: null, category: 'Systems' },
                        childColLabel: item.name,
                        getChildren: () => this._systemChildren(item, actor),
                        ...this._statusColors(status),
                        onRightClick: (row) => {
                            const actionsHtml = (sys.actions ?? []).map(/** @type {any} */ a => {
                                const det = a.detail ? `<div style="font-size:0.77em;color:#bbb;margin-top:2px;">${laFormatDetailHtml(a.detail)}</div>` : '';
                                return `<div style="margin-top:6px;padding:4px;background:rgba(255,255,255,0.04);border-radius:3px;"><div style="font-size:0.78em;font-weight:bold;color:#e8a020;">[${a.activation}] ${a.name}</div>${det}</div>`;
                            }).join('');
                            const depLids = getItemDeployables(item, actor);
                            const depActors = depLids.map(lid => getDeployableInfoSync(lid, actor)).filter(Boolean);
                            const deployablesHtml = depActors.length ? laRenderDeployables(depActors) : '';
                            const ammoHtml = (sys.ammo ?? []).filter(a => a.name).map(a => {
                                const cost = a.cost ?? 1;
                                return `<div style="margin-top:4px;padding:3px 4px;background:rgba(255,255,255,0.04);border-radius:3px;">
                                    <div style="font-size:0.78em;font-weight:bold;color:#1a8a3a;">${a.name} <span style="color:#888;font-weight:normal;">Cost: ${cost}</span></div>
                                    ${a.description ? `<div style="font-size:0.75em;color:#bbb;margin-top:1px;">${a.description}</div>` : ''}
                                </div>`;
                            }).join('');
                            const ammoSection = ammoHtml ? `<div style="margin-top:4px;"><div style="font-size:0.72em;font-weight:bold;color:#888;text-transform:uppercase;margin-bottom:2px;">Ammo</div>${ammoHtml}</div>` : '';
                            const bodyHtml = this._bodyHtml(sys) + actionsHtml + deployablesHtml + ammoSection;
                            const subtitle = this._joinSubtitle(sys.type, sys.license ? `${sys.manufacturer} ${sys.license_level}` : null);
                            this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'system-id', dataValue: item.id, title: item.name, subtitle, bodyHtml, theme: 'system', item, row, postRender: p => appendItemPips(item, p) });
                        },
                    };
                });
            },
        };
    }

    _systemHasChildren(/** @type {any} */ item, /** @type {any} */ actor) {
        const sys = item.system;
        const hasActivationTag = (sys.tags ?? []).some(t => ACTIVATION_TAGS.includes(t.lid));
        if (hasActivationTag || (sys.actions ?? []).length)
            return true;
        if (this._getInvadeOptions(actor).some(opt => opt.item?.id === item.id))
            return true;
        if (getItemDeployables(item, actor).length)
            return true;
        return false;
    }

    _systemChildren(/** @type {any} */ item, /** @type {any} */ actor) {
        const sys = item.system;
        const ap = a => this._actionPopup(a);
        const children = [];
        const activationTag = (sys.tags ?? []).find(/** @type {any} */ t => ACTIVATION_TAGS.includes(t.lid));
        const sysActions = sys.actions ?? [];
        const status = getItemStatus(item);
        const childBadge = status.badge ?? null;
        const childBadgeColor = status.badgeColor ?? null;
        const childStatusKind = status.destroyed ? 'destroyed' : status.unavailable ? 'unavailable' : null;
        if (sysActions.length <= 1) {
            const single = sysActions[0] ?? null;
            const actStr = single?.activation ?? (activationTag ? activationTag.lid.replace('tg_', '').replace('_action', ' action') : 'Activation');
            children.push({
                label: single?.name ?? item.name,
                icon: (single || activationTag) ? getActivationIcon(actStr) : 'systems/lancer/assets/icons/activate.svg',
                onClick: single ? () => /** @type {any} */ (item).beginActivationFlow('system.actions.0') : () => /** @type {any} */ (item).beginSystemFlow(),
                onRightClick: single ? ap(single)
                    : activationTag ? (/** @type {any} */ row) => {
                        const subtitle = this._joinSubtitle(sys.type, sys.license ? `${sys.manufacturer} ${sys.license_level}` : null);
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'sys-activate', dataValue: item.id, title: item.name, subtitle, bodyHtml: this._bodyHtml(sys), theme: 'system', item, row, postRender: /** @type {any} */ p => appendItemPips(item, p) });
                    }
                        : ap({ name: item.name, activation: 'Activation', detail: 'Default system activation.' }),
                hoverData: { actor, item, action: { name: item.name, activation: actStr }, category: 'Systems' },
                badge: childBadge,
                badgeColor: childBadgeColor,
                statusKind: childStatusKind,
            });
        } else {
            sysActions.forEach((action, idx) => {
                children.push({
                    label: action.name,
                    icon: getActivationIcon(action),
                    onClick: () => /** @type {any} */ (item).beginActivationFlow(`system.actions.${idx}`),
                    onRightClick: ap(action),
                    hoverData: { actor, item, action, category: 'Systems' },
                    badge: childBadge,
                    badgeColor: childBadgeColor,
                    statusKind: childStatusKind,
                });
            });
        }
        const sysActionNames = new Set((sys.actions ?? []).map(/** @type {any} */ a => a.name));
        const invadeOpts = this._getInvadeOptions(actor).filter(opt => opt.item?.id === item.id && !sysActionNames.has(opt.name));
        for (const opt of invadeOpts) {
            children.push({
                label: opt.destroyed ? this._destroyedLabel(opt.name) : opt.name,
                icon: ICON_TECH_QUICK,
                ...this._statusColors(opt),
                hoverData: { actor, item: opt.item ?? null, action: opt.action ?? { name: opt.name, activation: 'Invade' }, category: 'Tech' },
                onClick: () => executeInvade(actor, opt),
                onRightClick: (/** @type {any} */ row) => this._buildInvadePopup(opt, row),
            });
        }
        const lids = getItemDeployables(item, actor);
        if (lids.length) {
            children.push({ isSectionLabel: true, label: 'Deployables' });
            for (const lid of lids) {
                const depInfo = getDeployableInfoSync(lid, actor);
                children.push({
                    label: depInfo?.name ?? lid,
                    icon:  getActivationIcon({ activation: depInfo?.activation }) ?? 'systems/lancer/assets/icons/white/deployable.svg',
                    onClick: () => deployDeployable(actor, lid, item, true),
                    onRightClick: async (/** @type {any} */ row) => {
                        let dep = null;
                        if (!dep) {
                            const resolved = await resolveDeployable(lid, actor);
                            dep = resolved.deployable;
                        }
                        if (!dep)
                            return;
                        const srcType = item.system?.type ?? '';
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: dep.name, subtitle: `Deployable · ${item.name}${srcType ? ` (${srcType})` : ''}`, bodyHtml: laRenderDeployables([dep]), theme: 'deployable', item, row });
                    },
                });
            }
        }
        // Ammo entries
        const ammoArr = sys.ammo ?? [];
        if (ammoArr.filter(a => a.name).length) {
            children.push({ isSectionLabel: true, label: 'Ammo' });
            ammoArr.forEach((ammo, idx) => {
                if (!ammo.name)
                    return;
                const cost = ammo.cost ?? 1;
                children.push({
                    label: `${ammo.name}`,
                    badge: `${cost}`,
                    badgeColor: '#1a8a3a',
                    icon: 'systems/lancer/assets/icons/ammo.svg',
                    onClick: () => {
                        const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
                        if (api?.TriggerUseAmmoFlow) {
                            api.TriggerUseAmmoFlow(item.uuid, idx);
                        } else {
                            // Fallback: use the flow dispatch
                            const flowDef = game.lancer?.flows?.get('UseAmmoFlow');
                            if (!flowDef)
                                return;
                            const FlowBase = typeof game.lancer.flows.get('StatRollFlow') === 'function'
                                ? Object.getPrototypeOf(game.lancer.flows.get('StatRollFlow')) : null;
                            if (!FlowBase)
                                return;
                            const GenericFlow = class extends FlowBase {
                                constructor(u, d) {
                                    super(u, d || {});
                                }
                            };
                            GenericFlow.steps = flowDef.steps;
                            new GenericFlow(actor.uuid, { itemUuid: item.uuid, ammoIndex: idx }).begin();
                        }
                    },
                    onRightClick: (/** @type {any} */ row) => {
                        const sizeTags = _ammoTagsHtml(ammo.allowed_sizes, 'Size');
                        const typeTags = _ammoTagsHtml(ammo.allowed_types, 'Type');
                        const bodyHtml = `${ammo.description ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${ammo.description}</div>` : ''}
                            <div style="font-size:0.75em;color:#888;margin-top:4px;">Cost: ${cost}${sizeTags}${typeTags}</div>`;
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-ammo-popup', dataKey: 'ammo-idx', dataValue: `${item.id}-${idx}`, title: ammo.name, subtitle: `Ammo · ${item.name}`, bodyHtml, theme: 'system', item, row });
                    },
                    hoverData: { actor, item, action: { name: ammo.name, activation: 'Ammo' }, category: 'Systems' },
                });
            });
        }
        return children;
    }

    _catFrame() {
        const actor = this._actor;
        return {
            label: 'Frame',
            colLabel: 'Frame',
            getItems: () => {
                const frame = actor?.system?.loadout?.frame?.value;
                if (!frame)
                    return [];
                const sys = frame.system;
                const as = actor.system;
                const frameSubtitle = this._joinSubtitle(sys.manufacturer, sys.license ? `LL${sys.license_level}` : null, ...(sys.mechtype ?? []), as.size != null ? `Size ${as.size}` : null);
                const stat = (/** @type {string} */ label, /** @type {any} */ val, /** @type {any} */ base = undefined) => {
                    const delta = (val != null && base != null && val !== base) ? (val > base ? `<span style="position:absolute;bottom:2px;right:2px;color:#3a9e6e;font-size:0.55em;line-height:1;">▲</span>` : `<span style="position:absolute;bottom:2px;right:2px;color:#c33;font-size:0.55em;line-height:1;">▼</span>`) : '';
                    return `<div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;">${delta}<span style="font-size:0.68em;color:#666;text-transform:uppercase;letter-spacing:0.05em;">${label}</span><span style="font-size:0.95em;color:#ccc;font-weight:bold;">${val ?? '—'}</span></div>`;
                };
                const statGrid5 = (/** @type {string[]} */ ...cells) => `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px 4px;padding:4px 2px;">${cells.join('')}</div>`;
                const statGrid = statGrid5;
                const repairs = as.repairs?.max ?? as.repcap;
                const ss = sys.stats ?? {};
                const currentStats = statGrid5(
                    stat('HP', as.hp?.max, ss.hp), stat('Armor', as.armor, ss.armor), stat('E-Def', as.edef, ss.edef), stat('Evasion', as.evasion, ss.evasion), stat('Heat', as.heat?.max, ss.heatcap),
                    stat('Speed', as.speed, ss.speed), stat('Sensors', as.sensor_range, ss.sensor_range), stat('Save', as.save, ss.save), stat('Tech', as.tech_attack, ss.tech_attack), stat('Repairs', repairs, ss.repcap)
                );
                const mountCounts = (sys.mounts ?? []).reduce((/** @type {any} */ acc, /** @type {any} */ m) => {
                    acc[m] = (acc[m] ?? 0) + 1;
                    return acc;
                }, {});
                const mountsHtml = Object.keys(mountCounts).length ? `<div style="font-size:0.8em;color:#888;margin-top:2px;border-top:1px solid #2a2a2a;padding-top:5px;">${Object.entries(mountCounts).map(([m, n]) => `${n > 1 ? n + '× ' : ''}${m}`).join(' · ')}</div>` : '';
                const baseStats = sys.stats ? `<details style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:4px;"><summary style="font-size:0.72em;color:#555;cursor:pointer;user-select:none;list-style:none;padding:2px 0;">▶ Base Stats</summary>${statGrid(stat('HP', sys.stats.hp), stat('Armor', sys.stats.armor), stat('E-Def', sys.stats.edef), stat('Evasion', sys.stats.evasion), stat('Heat', sys.stats.heatcap), stat('Speed', sys.stats.speed), stat('Sensors', sys.stats.sensor_range), stat('Save', sys.stats.save), stat('Tech', sys.stats.tech_attack), stat('Repairs', sys.stats.repcap))}</details>` : '';
                const rows = [
                    {
                        label: frame.name,
                        icon: 'systems/lancer/assets/icons/frame.svg',
                        onClick: () => /** @type {any} */ (frame).sheet.render(true),
                        onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'frame-id', dataValue: frame.id, title: frame.name, subtitle: frameSubtitle, bodyHtml: currentStats + mountsHtml + baseStats, theme: 'frame', item: frame, row }),
                    },
                    { label: 'Core Power',  childColLabel: 'Core Power',  getChildren: () => this._corePowerItems(frame, actor), onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'core-system', dataValue: frame.id, title: frame.system?.core_system?.name ?? 'Core System', subtitle: frame.name, bodyHtml: laRenderCoreSystemBody(frame.system?.core_system), theme: 'frame', item: frame, row }) },
                    { label: 'Traits',      childColLabel: 'Traits',      getChildren: () => this._frameTraitItems(frame, actor) },
                    { label: 'Core Bonus',  childColLabel: 'Core Bonus',  getChildren: () => this._coreBonusItems(actor) },
                ];
                const intLids = [
                    ...(frame.system?.traits ?? []).flatMap((/** @type {any} */ t) => t.integrated ?? []),
                    ...(frame.system?.core_system?.integrated ?? []),
                ];
                const intDepLids = /** @type {string[]} */ (frame.system?.core_system?.deployables ?? []);
                if (intLids.length || intDepLids.length)
                    rows.push({ label: 'Integrated', childColLabel: 'Integrated', getChildren: () => this._frameIntegratedItems(frame, actor, intLids, intDepLids) });
                rows.push({ label: 'Reserves',    childColLabel: 'Reserves',    getChildren: () => this._catReserves({ source: actor.system?.pilot?.value, typeFilter: 'Mech' }).getItems() });
                return rows;
            },
        };
    }

    _catReserves({ source, typeFilter = null, label = 'Reserves' } = {}) {
        return {
            label,
            colLabel: label,
            getItems: () => {
                const reserves = (source?.items ?? []).filter(/** @type {any} */ i => i.type === 'reserve');
                const filtered = typeFilter ? reserves.filter(/** @type {any} */ r => (r.system?.type ?? '') === typeFilter) : reserves;
                if (!filtered.length)
                    return [];
                const TYPE_ORDER  = ['Mech', 'Tactical', 'Project', 'Organization', 'Resources', 'Resource', 'Bonus'];
                const TYPE_ICON   = { Mech: 'cci cci-reserve-mech', Organization: 'mdi mdi-account-multiple', Project: 'cci cci-orbital', Resources: 'cci cci-reserve-resource', Resource: 'cci cci-reserve-resource', Tactical: 'cci cci-reserve-tac', Bonus: 'cci cci-accuracy' };
                const buckets = {};
                for (const r of filtered) {
                    const t = r.system?.type ?? 'Other';
                    (buckets[t] = buckets[t] || []).push(r);
                }
                const keys = TYPE_ORDER.filter(k => buckets[k]).concat(Object.keys(buckets).filter(k => !TYPE_ORDER.includes(k)));
                const items = [];
                const useSections = !typeFilter;
                for (const key of keys) {
                    if (useSections && keys.length > 1)
                        items.push({ isSectionLabel: true, label: key.toUpperCase() });
                    for (const r of buckets[key]) {
                        const sys = r.system ?? {};
                        const icon = TYPE_ICON[key] ?? 'cci cci-reserve-tac';
                        const consumed = sys.consumable && sys.used;
                        items.push({
                            label: consumed ? this._destroyedLabel(sys.label || r.name) : (sys.label || r.name),
                            icon,
                            badge: sys.consumable ? (sys.used ? '✗' : '✓') : null,
                            badgeColor: sys.consumable ? (sys.used ? '#c33' : '#3a9e6e') : null,
                            hoverData: { actor: source, item: r, action: null, category: 'Reserves' },
                            onClick: () => /** @type {any} */ (r).sheet.render(true),
                            onRightClick: (/** @type {any} */ row) => {
                                const bodyHtml = this._bodyHtml(sys) + laRenderActions(sys.actions ?? []);
                                this._showItemPopup({ cssClass: 'la-hud-popup la-hud-reserve-popup', dataKey: 'reserve-id', dataValue: r.id, title: sys.label || r.name, subtitle: `Reserve · ${key}`, bodyHtml, theme: 'resource', item: r, row });
                            },
                        });
                    }
                }
                return items;
            },
        };
    }

    _catPilot() {
        const actor = this._actor;
        return {
            label: 'Pilot',
            colLabel: 'Pilot',
            getItems: () => {
                const as = actor.system ?? {};
                const armor = (as.loadout?.armor ?? [])[0]?.value ?? null;

                const grit = as.grit ?? Math.floor((as.level ?? 0) / 2);
                const base = { hp: 6 + grit, armor: 0, edef: 10, evasion: 10, speed: 4 };
                const cur  = { hp: as.hp?.max, armor: as.armor, edef: as.edef, evasion: as.evasion, speed: as.speed };

                const stat = (/** @type {string} */ lbl, /** @type {any} */ val, /** @type {any} */ b = undefined) => {
                    const delta = (val != null && b != null && val !== b)
                        ? (val > b
                            ? `<span style="position:absolute;bottom:2px;right:2px;color:#3a9e6e;font-size:0.55em;line-height:1;">▲</span>`
                            : `<span style="position:absolute;bottom:2px;right:2px;color:#c33;font-size:0.55em;line-height:1;">▼</span>`)
                        : '';
                    return `<div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;">${delta}<span style="font-size:0.68em;color:#666;text-transform:uppercase;letter-spacing:0.05em;">${lbl}</span><span style="font-size:0.95em;color:#ccc;font-weight:bold;">${val ?? '—'}</span></div>`;
                };
                const grid = (/** @type {string[]} */ ...cells) => `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px 4px;padding:4px 2px;">${cells.join('')}</div>`;

                const currentStats = grid(
                    stat('HP',      cur.hp,      base.hp),
                    stat('Armor',   cur.armor,   base.armor),
                    stat('E-Def',   cur.edef,    base.edef),
                    stat('Evasion', cur.evasion, base.evasion),
                    stat('Speed',   cur.speed,   base.speed),
                );
                const haseRow = `<div style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:4px;">${grid(
                    stat('HULL', as.hull),
                    stat('AGI',  as.agi),
                    stat('SYS',  as.sys),
                    stat('ENG',  as.eng),
                    stat('Grit', grit),
                )}</div>`;
                const baseStats = `<details style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:4px;"><summary style="font-size:0.72em;color:#555;cursor:pointer;user-select:none;list-style:none;padding:2px 0;">▶ Base Stats (no armor)</summary>${grid(
                    stat('HP',      base.hp),
                    stat('Armor',   base.armor),
                    stat('E-Def',   base.edef),
                    stat('Evasion', base.evasion),
                    stat('Speed',   base.speed),
                )}</details>`;

                const pilotSubtitle = this._joinSubtitle(as.callsign, as.player_name, as.level != null ? `LL${as.level}` : null);

                const armorBody = armor
                    ? (laRenderTags(armor.system?.tags ?? []) + (armor.system?.description ? `<div style="margin-bottom:8px;font-size:0.82em;line-height:1.5;color:#bbb;">${laFormatDetailHtml(armor.system.description)}</div>` : '') + (armor.system?.effect ? `<div style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:4px;font-size:0.82em;line-height:1.5;color:#bbb;">${laFormatDetailHtml(armor.system.effect)}</div>` : '') + laRenderActions(armor.system?.actions ?? []))
                    : '<div style="font-size:0.82em;color:#bbb;line-height:1.5;">The pilot wears no armor.</div>';

                return [
                    {
                        label: actor.name,
                        icon: actor.img ?? 'systems/lancer/assets/icons/generic_item.svg',
                        onClick: () => /** @type {any} */ (actor).sheet.render(true),
                        onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'pilot-id', dataValue: actor.id, title: actor.name, subtitle: pilotSubtitle, bodyHtml: currentStats + haseRow + baseStats, theme: 'frame', item: null, row }),
                    },
                    {
                        label: armor ? armor.name : 'NO ARMOR',
                        icon: armor?.img ?? 'systems/lancer/assets/icons/role_tank.svg',
                        onClick: () => armor && /** @type {any} */ (armor).sheet.render(true),
                        onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: armor ? 'armor-id' : 'no-armor', dataValue: armor ? armor.id : actor.id, title: armor ? armor.name : 'No Armor', subtitle: 'Pilot Armor', bodyHtml: armorBody, theme: 'system', item: armor, row }),
                    },
                    ...(() => {
                        const reserveRows = this._catReserves({ source: actor }).getItems().filter(/** @type {any} */ r => !r.isSectionLabel);
                        if (!reserveRows.length)
                            return [];
                        return [{ isSectionLabel: true, label: 'RESERVES' }, ...reserveRows];
                    })(),
                ];
            },
        };
    }

    _catPilotGear() {
        const actor = this._actor;
        return {
            label: 'Gear',
            colLabel: 'Gear',
            getItems: () => {
                const gear = (actor.system?.loadout?.gear ?? [])
                    .map(/** @type {any} */ g => g?.value)
                    .filter(/** @type {any} */ item => !!item);
                if (!gear.length)
                    return [];
                return gear.map(item => {
                    const sys = item.system;
                    const status = getItemStatus(item);
                    const labelHtml = status.destroyed ? this._destroyedLabel(item.name) : item.name;
                    return {
                        label: labelHtml,
                        badge: status.badge ?? null,
                        badgeColor: status.badgeColor ?? null,
                        icon: item.img ?? null,
                        hoverData: { actor, item, action: null, category: 'Gear' },
                        childColLabel: item.name,
                        getChildren: () => this._pilotGearChildren(item, actor),
                        ...this._statusColors(status),
                        onRightClick: (/** @type {any} */ row) => {
                            const bodyHtml = this._bodyHtml(sys) + laRenderActions(sys.actions ?? []);
                            this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'gear-id', dataValue: item.id, title: item.name, subtitle: 'Pilot Gear', bodyHtml, theme: 'system', item, row, postRender: /** @type {any} */ p => appendItemPips(item, p) });
                        },
                    };
                });
            },
        };
    }

    _pilotGearChildren(/** @type {any} */ item, /** @type {any} */ actor) {
        const sys = item.system;
        const ap = a => this._actionPopup(a);
        const sysActions = sys.actions ?? [];
        const status = getItemStatus(item);
        const childBadge = status.badge ?? null;
        const childBadgeColor = status.badgeColor ?? null;
        const childStatusKind = status.destroyed ? 'destroyed' : status.unavailable ? 'unavailable' : null;

        if (sysActions.length <= 1) {
            const single = sysActions[0] ?? null;
            const actStr = single?.activation ?? 'Quick';
            return [{
                label: single?.name ?? item.name,
                icon: single ? getActivationIcon(single) : 'systems/lancer/assets/icons/activate.svg',
                onClick: single
                    ? () => /** @type {any} */ (item).beginActivationFlow('system.actions.0')
                    : () => executeSimpleActivation(actor, { title: item.name, action: { name: item.name, activation: actStr }, detail: sys.effect ?? '' }, { item }),
                onRightClick: single
                    ? ap(single)
                    : ap({ name: item.name, activation: actStr, detail: sys.effect ?? '' }),
                hoverData: { actor, item, action: single ?? { name: item.name, activation: actStr }, category: 'Gear' },
                badge: childBadge,
                badgeColor: childBadgeColor,
                statusKind: childStatusKind,
            }];
        }

        return sysActions.map((/** @type {any} */ action, /** @type {number} */ idx) => ({
            label: action.name,
            icon: getActivationIcon(action),
            onClick: () => /** @type {any} */ (item).beginActivationFlow(`system.actions.${idx}`),
            onRightClick: ap(action),
            hoverData: { actor, item, action, category: 'Gear' },
            badge: childBadge,
            badgeColor: childBadgeColor,
            statusKind: childStatusKind,
        }));
    }

    // ── NPC Class / Systems ───────────────────────────────────────────────────

    _catNpcFrame() {
        const actor = this._actor;
        return {
            label: 'Class',
            colLabel: 'Class',
            getItems: () => {
                const npcClass = /** @type {any} */ (actor.items.find(/** @type {any} */ i => i.type === 'npc_class'));
                const tier = /** @type {any} */ (actor.system)?.tier ?? 1;
                const tierClamped = Math.min(3, Math.max(1, tier));
                const tierIcon = `systems/lancer/assets/icons/npc_tier_${tierClamped}.svg`;
                if (!npcClass)
                    return [];
                const as = /** @type {any} */ (actor.system) ?? {};
                const tierIdx = Math.max(0, Math.min(2, tierClamped - 1));
                const bs = npcClass.system?.base_stats?.[tierIdx] ?? {};
                const stat = (/** @type {string} */ lbl, /** @type {any} */ val, /** @type {any} */ base = undefined) => {
                    const delta = (val != null && base != null && val !== base) ? (val > base ? `<span style="position:absolute;bottom:2px;right:2px;color:#3a9e6e;font-size:0.55em;line-height:1;">▲</span>` : `<span style="position:absolute;bottom:2px;right:2px;color:#c33;font-size:0.55em;line-height:1;">▼</span>`) : '';
                    return `<div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;">${delta}<span style="font-size:0.68em;color:#666;text-transform:uppercase;letter-spacing:0.05em;">${lbl}</span><span style="font-size:0.95em;color:#ccc;font-weight:bold;">${val ?? '—'}</span></div>`;
                };
                const grid = (/** @type {string[]} */ ...cells) => `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px 4px;padding:4px 2px;">${cells.join('')}</div>`;
                const currentStats = grid(
                    stat('HP',      as.hp?.max ?? as.hp,          bs.hp),
                    stat('Armor',   as.armor,                      bs.armor),
                    stat('E-Def',   as.edef,                       bs.edef),
                    stat('Evasion', as.evasion,                    bs.evasion),
                    stat('Heat',    as.heat?.max ?? as.heatcap,    bs.heatcap),
                    stat('Speed',   as.speed,                      bs.speed),
                    stat('Sensors', as.sensor_range,               bs.sensor_range),
                    stat('Save',    as.save,                       bs.save),
                    stat('Act.',    as.activations,                bs.activations),
                    stat('Struct',  as.structure?.max ?? as.structure, bs.structure),
                    stat('Reactor', as.stress?.max ?? as.stress,   bs.stress),
                    '<div></div>',
                    stat('Hull',    as.hull,                       bs.hull),
                    stat('Agility', as.agi,                        bs.agi),
                    stat('Systems', as.sys,                        bs.sys),
                    stat('Eng',     as.eng,                        bs.eng),
                );
                const baseStats = `<details style="margin-top:6px;border-top:1px solid #2a2a2a;padding-top:4px;"><summary style="font-size:0.72em;color:#555;cursor:pointer;user-select:none;list-style:none;padding:2px 0;">▶ Base Stats (Tier ${tierClamped})</summary>${
                    grid(
                        stat('HP',      bs.hp),
                        stat('Armor',   bs.armor),
                        stat('E-Def',   bs.edef),
                        stat('Evasion', bs.evasion),
                        stat('Heat',    bs.heatcap),
                        stat('Speed',   bs.speed),
                        stat('Sensors', bs.sensor_range),
                        stat('Save',    bs.save),
                        stat('Act.',    bs.activations),
                        stat('Struct',  bs.structure),
                        stat('Reactor', bs.stress),
                        '<div></div>',
                        stat('Hull',    bs.hull),
                        stat('Agility', bs.agi),
                        stat('Systems', bs.sys),
                        stat('Eng',     bs.eng),
                    )
                }</details>`;
                const bodyHtml = currentStats + baseStats;
                return [
                    {
                        label: npcClass.name,
                        icon: tierIcon,
                        onClick: () => /** @type {any} */ (npcClass).sheet.render(true),
                        onRightClick: (/** @type {any} */ row) => this._showItemPopup({
                            cssClass: 'la-hud-popup la-hud-npcclass-popup',
                            dataKey: 'npcclass-id',
                            dataValue: npcClass.id,
                            title: npcClass.name,
                            subtitle: this._joinSubtitle(
                                `Tier ${tierClamped}`,
                                npcClass.system?.role ? npcClass.system.role.charAt(0).toUpperCase() + npcClass.system.role.slice(1) : null,
                                as.size != null ? `Size ${as.size}` : (bs.size != null ? `Size ${bs.size}` : null),
                            ),
                            bodyHtml,
                            theme: 'frame',
                            item: npcClass,
                            row,
                        }),
                    },
                    { label: 'Templates', childColLabel: 'Templates', getChildren: () => this._npcTemplateItems(actor) },
                    { label: 'Traits',    childColLabel: 'Traits',    getChildren: () => this._npcTraitItems(actor) },
                ];
            },
        };
    }

    _npcTemplateItems(/** @type {any} */ actor) {
        const templates = actor.items.filter(/** @type {any} */ i => i.type === 'npc_template');
        return templates.map(/** @type {any} */ tmpl => ({
            label: tmpl.name,
            icon: tmpl.img ?? null,
            onClick: () => /** @type {any} */ (tmpl).sheet.render(true),
            onRightClick: (/** @type {any} */ row) => {
                const desc = tmpl.system?.description
                    ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(tmpl.system.description)}</div>` : '';
                if (!desc)
                    return;
                this._showItemPopup({
                    cssClass: 'la-hud-popup la-hud-npctemplate-popup',
                    dataKey: 'npctemplate-id',
                    dataValue: tmpl.id,
                    title: tmpl.name,
                    subtitle: 'Template',
                    bodyHtml: desc,
                    theme: 'frame',
                    item: tmpl,
                    row,
                });
            },
        }));
    }

    _npcTraitItems(/** @type {any} */ actor) {
        const traits = actor.items.filter(/** @type {any} */ i => i.type === 'npc_feature' && i.system.type === 'Trait');
        if (!traits.length)
            return [];
        return traits.map(/** @type {any} */ feat => {
            const sys = feat.system;
            return {
                label: feat.name,
                icon: feat.img ?? null,
                hoverData: { actor: this._actor, item: feat, category: 'Traits' },
                onClick: () => /** @type {any} */ (feat).beginSystemFlow(),
                broadcastFn: (_t, a) => {
                    const f = a.items.find(i => i.type === 'npc_feature' && i.system?.lid === sys.lid); if (f) /** @type {any} */
                        (f).beginSystemFlow();
                },
                onRightClick: (/** @type {any} */ row) => {
                    const tagsHtml = laRenderTags(sys.tags ?? []);
                    const effect   = sys.effect ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(sys.effect)}</div>` : '';
                    const bodyHtml = tagsHtml + effect;
                    if (!bodyHtml)
                        return;
                    const origin = sys.origin?.name ? `${sys.origin.name} · ${sys.origin.type}` : '';
                    this._showItemPopup({
                        cssClass: 'la-hud-popup la-hud-npctrait-popup',
                        dataKey: 'npctrait-id',
                        dataValue: feat.id,
                        title: feat.name,
                        subtitle: origin,
                        bodyHtml,
                        theme: 'trait',
                        item: feat,
                        row,
                    });
                },
            };
        });
    }

    _catNpcSystems() {
        const actor = this._actor;
        const ACT_LABELS = /** @type {Record<string,string>} */ ({
            tg_quick_action: 'Quick Action',
            tg_full_action:  'Full Action',
            tg_protocol:     'Protocol',
            tg_reaction:     'Reaction',
            tg_free_action:  'Free Action',
        });
        return {
            label: 'Systems',
            colLabel: 'Systems',
            getItems: () => {
                const features = actor.items.filter(/** @type {any} */ i =>
                    i.type === 'npc_feature' &&
                    (i.system.type === 'System' || i.system.type === 'Reaction')
                );
                if (!features.length)
                    return [];
                return /** @type {any[]} */ (features).map(item => {
                    const sys = item.system;
                    const status = getItemStatus(item);
                    const labelHtml = status.destroyed ? this._destroyedLabel(item.name) : item.name;
                    const actTag = (sys.tags ?? []).find(/** @type {any} */ t => ACTIVATION_TAGS.includes(t.lid));
                    const TYPE_TO_ACTIVATION = { Reaction: 'Reaction', System: null, Tech: 'Quick Tech', Trait: null, Weapon: null };
                    const activation = actTag
                        ? actTag.lid.replace('tg_', '').replace('_action', ' action')
                        : (TYPE_TO_ACTIVATION[sys.type] ?? null);
                    const actLabel = actTag ? (ACT_LABELS[actTag.lid] ?? actTag.lid) : (activation ?? null);
                    const origin = sys.origin?.name ? `${sys.origin.name} · ${sys.origin.type}` : '';
                    const npcSysChildren = () => {
                        const sysActions = /** @type {any[]} */ (sys.actions ?? []);
                        const extraActions = /** @type {any[]} */ (item.getFlag?.('lancer-automations', 'extraActions') || []);
                        const npcRightClick = (/** @type {any} */ row) => {
                            const trigger = sys.trigger ? `<div style="font-size:0.8em;color:#888;margin-bottom:4px;"><b>Trigger:</b> ${laFormatDetailHtml(sys.trigger)}</div>` : '';
                            const effect  = sys.effect  ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(sys.effect)}</div>` : '';
                            const bodyHtml = laRenderTags(sys.tags ?? []) + trigger + effect;
                            if (!bodyHtml)
                                return;
                            this._showItemPopup({ cssClass: 'la-hud-popup la-hud-npcsys-popup', dataKey: 'npcsys-id', dataValue: item.id, title: item.name, subtitle: this._joinSubtitle(actLabel ?? sys.type, origin), bodyHtml, theme: activation ? activationTheme(activation) : 'system', item, row, postRender: /** @type {any} */ p => appendItemPips(item, p) });
                        };
                        // Base system activation (always present)
                        const baseRows = [];
                        if (sysActions.length <= 1) {
                            const single = sysActions[0] ?? null;
                            const actStr = single?.activation ?? activation ?? 'Activation';
                            baseRows.push({
                                label: item.name,
                                icon: (single || activation) ? getActivationIcon(actStr) : 'systems/lancer/assets/icons/activate.svg',
                                onClick: () => /** @type {any} */ (item).beginSystemFlow(),
                                onRightClick: npcRightClick,
                                hoverData: { actor, item, action: { name: item.name, activation: actStr }, category: 'Systems' },
                            });
                        } else {
                            sysActions.forEach((action, idx) => baseRows.push({
                                label: action.name,
                                icon: getActivationIcon(action),
                                onClick: () => /** @type {any} */ (item).beginActivationFlow(`system.actions.${idx}`),
                                onRightClick: npcRightClick,
                                hoverData: { actor, item, action, category: 'Systems' },
                            }));
                        }
                        // Extra actions (from addExtraActions)
                        for (const action of extraActions) {
                            const charged = !action.recharge || action.charged !== false;
                            const eaBadge = action.recharge ? rechargeIcon(charged) : null;
                            const eaBadgeColor = action.recharge ? (charged ? '#3a9e6e' : '#c33') : null;
                            baseRows.push({
                                label: `<span style="color:#e8a030;font-size:0.7em;vertical-align:middle;">●</span> ${action.name}`,
                                badge: eaBadge,
                                badgeColor: eaBadgeColor,
                                icon: getActivationIcon(action),
                                onClick: () => executeSimpleActivation(actor, { title: action.name, action, detail: action.detail ?? '' }, { item }),
                                onRightClick: this._actionPopup(action, item),
                                hoverData: { actor, item, action, category: 'Systems' },
                            });
                        }
                        return baseRows;
                    };
                    return {
                        label: labelHtml,
                        badge: status.badge ?? null,
                        badgeColor: status.badgeColor ?? null,
                        icon: item.img ?? null,
                        ...this._statusColors(status),
                        childColLabel: item.name,
                        getChildren: npcSysChildren,
                        onRightClick: (/** @type {any} */ row) => {
                            const trigger  = sys.trigger ? `<div style="font-size:0.8em;color:#888;margin-bottom:4px;"><b>Trigger:</b> ${laFormatDetailHtml(sys.trigger)}</div>` : '';
                            const effect   = sys.effect  ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(sys.effect)}</div>` : '';
                            const tagsHtml = laRenderTags(sys.tags ?? []);
                            const bodyHtml = tagsHtml + trigger + effect;
                            if (!bodyHtml)
                                return;
                            this._showItemPopup({
                                cssClass: 'la-hud-popup la-hud-npcsys-popup',
                                dataKey: 'npcsys-id',
                                dataValue: item.id,
                                title: item.name,
                                subtitle: this._joinSubtitle(actLabel ?? sys.type, origin),
                                bodyHtml,
                                theme: activation ? activationTheme(activation) : 'system',
                                item,
                                row,
                                postRender: p => appendItemPips(item, p),
                            });
                        },
                        hoverData: { actor, item, action: activation ? { name: item.name, activation } : null, category: 'Systems' },
                    };
                });
            },
        };
    }

    _corePowerItems(/** @type {any} */ frame, /** @type {any} */ actor) {
        const cs = frame.system?.core_system;
        const coreName = cs?.active_name ?? 'Core Power';
        const coreUsed = actor.system?.core_energy === 0;
        const activeAction = cs?.active_actions?.[0];
        const passiveName = cs?.passive_name ?? '';
        const passiveActions = cs?.passive_actions ?? [];
        const counters = cs?.counters ?? [];

        const coreActivation = cs?.activation ?? activeAction?.activation ?? 'Protocol';
        const rows = /** @type {any[]} */ ([{
            label: coreName,
            icon: getActivationIcon(activeAction ?? coreActivation),
            highlightBg: coreUsed ? '#ffe5b4' : null,
            highlightBorderColor: coreUsed ? '#cc7700' : null,
            onClick: () => /** @type {any} */ (frame.beginCoreActiveFlow('system.core_system')),
            onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'core-active', dataValue: frame.id, title: coreName, subtitle: `Core Active · ${coreActivation} · ${frame.name}`, bodyHtml: `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(cs?.active_effect ?? cs?.description ?? '')}</div>`, theme: 'frame', item: frame, row }),
        }]);

        rows.push({ label: 'CHARGE', isSectionLabel: true });
        const self = this;
        rows.push({
            inputCell: true,
            subtype: 'toggle',
            name: 'Charged',
            icon: 'systems/lancer/assets/icons/corepower.svg',
            getValue: () => !coreUsed,
            onToggle: async (/** @type {boolean} */ on) => {
                await actor.update({ 'system.core_energy': on ? 1 : 0 });
                // Rebuild visible columns in place so the Core Power highlight updates
                // without collapsing sub-columns.
                setTimeout(() => self._refreshColumnsInPlace(), 0);
            },
        });

        if ((passiveName && cs?.passive_effect) || passiveActions.length) {
            rows.push({ label: 'PASSIVE', isSectionLabel: true });
            if (passiveName) {
                rows.push({
                    label: passiveName,
                    icon: 'systems/lancer/assets/icons/core_bonus.svg',
                    onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'core-passive', dataValue: frame.id, title: passiveName, subtitle: `${frame.name} · Core Passive`, bodyHtml: `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(cs?.passive_effect ?? '')}</div>${laRenderActions(cs?.passive_actions ?? [])}`, theme: 'frame', item: frame, row }),
                });
            }
            for (const action of passiveActions) {
                rows.push({ label: action.name, icon: getActivationIcon(action), onRightClick: this._actionPopup(action, frame, 'frame') });
            }
        }

        if (counters.length) {
            rows.push({ label: 'RESOURCES', isSectionLabel: true });
            counters.forEach((/** @type {any} */ counter, /** @type {number} */ cidx) => {
                const path = `system.core_system.counters.${cidx}.value`;
                rows.push(this._buildCounterRow(counter, path, frame));
            });
        }

        return rows;
    }

    _frameTraitItems(/** @type {any} */ frame, /** @type {any} */ actor) {
        const ap = a => this._actionPopup(a, frame, 'frame');
        const traits = frame.system?.traits ?? [];
        if (!traits.length)
            return [];
        return traits.map(/** @type {any} */ (trait) => ({
            label: trait.name,
            icon: 'systems/lancer/assets/icons/trait.svg',
            hoverData: { actor, item: trait, category: 'Frame Traits' },
            onClick: () => {
                const F = /** @type {any} */ (game).lancer?.flows?.get('SimpleTextFlow'); if (F)
                    new F(frame, { title: trait.name, description: trait.description }).begin();
            },
            childColLabel: trait.name,
            getChildren: () => {
                const children = [];
                for (const action of (trait.actions ?? [])) {
                    children.push({
                        label: action.name,
                        icon: getActivationIcon(action),
                        onClick: () => executeSimpleActivation(actor, { title: action.name, action, detail: action.detail ?? '' }),
                        onRightClick: ap(action),
                    });
                }
                for (const lid of (trait.deployables ?? [])) {
                    const depInfo = getDeployableInfoSync(lid, actor);
                    children.push({
                        label: depInfo?.name ?? lid,
                        icon:  getActivationIcon({ activation: depInfo?.activation }) ?? 'systems/lancer/assets/icons/white/deployable.svg',
                        onClick: () => deployDeployable(actor, lid, frame, true),
                        onRightClick: async (/** @type {any} */ row) => {
                            let dep = null;
                            if (!dep) {
                                const resolved = await resolveDeployable(lid, actor);
                                dep = resolved.deployable;
                            }
                            if (!dep)
                                return;
                            this._showItemPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: dep.name, subtitle: `Deployable · ${trait.name} (Trait)`, bodyHtml: laRenderDeployables([dep]), theme: 'deployable', item: frame, row });
                        },
                    });
                }
                for (const lid of (trait.integrated ?? [])) {
                    const intItem = /** @type {any} */ (actor.items.find(/** @type {any} */ (i) => i.system?.lid === lid));
                    if (!intItem)
                        continue;
                    if (intItem.type === 'mech_weapon' || intItem.type === 'pilot_weapon') {
                        children.push(this._weaponItem(intItem, null, null));
                    } else {
                        children.push({
                            label: intItem.name,
                            icon: intItem.img ?? null,
                            childColLabel: intItem.name,
                            getChildren: () => this._systemChildren(intItem, actor),
                        });
                    }
                }
                return children.length ? children : null;
            },
            onRightClick: (/** @type {any} */ row) => {
                const bodyHtml = trait.description
                    ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(trait.description)}</div>`
                    : '<div style="font-size:0.82em;color:#888;">No description.</div>';
                this._showItemPopup({ cssClass: 'la-hud-popup la-hud-trait-popup', dataKey: 'trait-name', dataValue: trait.name, title: trait.name, subtitle: `${frame.name} · Trait`, bodyHtml, theme: 'trait', item: frame, row });
            },
        }));
    }

    _coreBonusItems(/** @type {any} */ actor) {
        const pilotActor = actor.system?.pilot?.value;
        const bonuses = (pilotActor?.items ?? actor.items).filter(/** @type {any} */ i => i.type === 'core_bonus');
        return bonuses.map(/** @type {any} */ cb => ({
            label: cb.name,
            icon: cb.img ?? null,
            onRightClick: (/** @type {any} */ row) => {
                this._showItemPopup({ cssClass: 'la-hud-popup la-hud-cb-popup', dataKey: 'cb-id', dataValue: cb.id, title: cb.name, subtitle: 'Core Bonus', bodyHtml: laRenderCoreBonusBody(cb), theme: 'core_bonus', item: cb, row });
            },
        }));
    }

    _frameIntegratedItems(/** @type {any} */ frame, /** @type {any} */ actor, /** @type {string[]} */ lids, /** @type {string[]} */ depLids = []) {
        const items = lids
            .map(lid => /** @type {any} */ (actor.items.find(/** @type {any} */ i => i.system?.lid === lid)))
            .filter(/** @type {any} */ i => !!i);
        const rows = items.map(/** @type {any} */ intItem => {
            if (intItem.type === 'mech_weapon' || intItem.type === 'pilot_weapon')
                return this._weaponItem(intItem, null, null);
            return {
                label: intItem.name,
                icon: intItem.img ?? null,
                childColLabel: intItem.name,
                getChildren: () => this._systemChildren(intItem, actor),
                onRightClick: (/** @type {any} */ row) => {
                    this._showItemPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'system-id', dataValue: intItem.id, title: intItem.name, subtitle: `Integrated · ${frame.name}`, bodyHtml: this._bodyHtml(intItem.system), theme: 'system', item: intItem, row, postRender: p => appendItemPips(intItem, p) });
                },
            };
        });
        if (depLids.length) {
            for (const lid of depLids) {
                const depInfo = getDeployableInfoSync(lid, actor);
                rows.push(/** @type {any} */({
                    label: depInfo?.name ?? lid,
                    icon:  getActivationIcon({ activation: depInfo?.activation }) ?? 'systems/lancer/assets/icons/white/deployable.svg',
                    hoverData: { actor, item: frame, action: null, category: 'Deployables' },
                    onClick: () => deployDeployable(actor, lid, frame, true),
                    onRightClick: async (/** @type {any} */ row) => {
                        let dep = null;
                        if (!dep) {
                            const resolved = await resolveDeployable(lid, actor);
                            dep = resolved.deployable;
                        }
                        if (!dep)
                            return;
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: dep.name, subtitle: `Deployable · ${frame.name} (Core)`, bodyHtml: laRenderDeployables([dep]), theme: 'deployable', item: frame, row });
                    },
                }));
            }
        }
        return rows;
    }

    _catTalents() {
        const actor = this._actor;
        return {
            label: 'Talents',
            colLabel: 'Talents',
            getItems: () => {
                const pilot = actor?.system?.pilot?.value ?? actor;
                if (!pilot)
                    return [];
                const talents = [...pilot.items.values()].filter(i => i.type === 'talent');
                if (!talents.length)
                    return [];
                return talents.map(talent => ({
                    label: talent.name,
                    icon: talent.img ?? null,
                    onClick: () => /** @type {any} */ (talent).sheet.render(true),
                    childColLabel: talent.name,
                    hoverData: { actor, item: talent, action: null, category: 'Talents' },
                    getChildren: () => this._talentRankItems(talent),
                }));
            },
        };
    }

    _talentRankItems(talent) {
        const ranks    = talent.system.ranks ?? [];
        const currRank = talent.system.curr_rank ?? 0;
        const roman    = ['I', 'II', 'III', 'IV', 'V'];
        return Array.from({ length: currRank }, (_, i) => {
            const rank       = ranks[i];
            const rankLabel  = `${roman[i] ?? String(i + 1)}: ${rank.name}`;
            const actions    = rank.actions ?? [];
            const counters   = rank.counters ?? [];
            return {
                label: rankLabel,
                icon: talent.img ?? null,
                onClick: () => {
                    const F = /** @type {any} */ (game).lancer?.flows?.get('TalentFlow'); if (F)
                        new F(talent, { title: talent.name, rank, lvl: i }).begin();
                },
                childColLabel: rankLabel,
                getChildren: (actions.length || counters.length) ? () => this._talentRankActionItems(talent.system.ranks[i], talent, i) : undefined,
                onRightClick: (row) => {
                    const key = `${talent.id}_${i}`;
                    const desc = laFormatDetailHtml(rank.description ?? '');
                    const descHtml = desc ? `<div style="margin-bottom:8px;font-size:0.82em;line-height:1.5;color:#bbb;">${desc}</div>` : '';
                    const actionsHtml = laRenderActions(rank.actions ?? []);
                    const rankCounters = rank.counters ?? [];
                    const countersHtml = rankCounters.length
                        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('RESOURCES', '#1a3a5c')}${rankCounters.map(c =>
                            `<div style="margin-top:4px;padding:4px 6px;background:rgba(255,255,255,0.04);border-radius:3px;display:flex;justify-content:space-between;align-items:center;">
                                <span style="font-size:0.78em;font-weight:bold;color:#ccc;">${c.name}</span>
                                <span style="font-size:0.78em;color:#aaa;">${c.value ?? 0} / ${c.max ?? 0}</span>
                            </div>`).join('')}</div>`
                        : '';
                    const bodyHtml = (descHtml + actionsHtml + countersHtml) || '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
                    this._showItemPopup({ cssClass: 'la-hud-popup la-hud-talent-popup', dataKey: 'rank-key', dataValue: key, title: rankLabel, subtitle: `${talent.name} · Rank ${roman[i] ?? i + 1}`, bodyHtml, theme: 'talent', item: talent, row });
                },
            };
        });
    }

    _talentRankActionItems(rank, talent, rankIdx) {
        const actions  = rank.actions  ?? [];
        const counters = rank.counters ?? [];
        const items    = [];
        const hasBoth  = actions.length && counters.length;

        if (actions.length) {
            actions.forEach((action, actionIdx) => items.push({
                label: action.name,
                icon: getActivationIcon(action),
                onClick: () => {
                    if (action.activation === 'Invade') {
                        const opt = this._getInvadeOptions(this._actor).find(o => o.item?.id === talent.id && o.name === action.name);
                        if (opt)
                            executeInvade(this._actor, opt);
                    } else {
                        /** @type {any} */ (talent).beginActivationFlow(`system.ranks.${rankIdx}.actions.${actionIdx}`);
                    }
                },
                onRightClick: this._actionPopup(action, talent.name),
            }));
        }

        if (counters.length) {
            if (hasBoth)
                items.push({ label: 'RESOURCES', isSectionLabel: true });
            counters.forEach((counter, cidx) => {
                const path    = `system.ranks.${rankIdx}.counters.${cidx}.value`;
                items.push(this._buildCounterRow(counter, path, talent));
            });
        }

        return items;
    }

    _resourceItems() {
        const actor = this._actor;
        const pilot = actor?.system?.pilot?.value ?? actor;
        const items = [];
        const roman = ['I', 'II', 'III', 'IV', 'V'];
        for (const talent of [...pilot.items.values()].filter(/** @type {any} */ i => i.type === 'talent')) {
            const sys      = /** @type {any} */ (talent).system;
            const ranks    = sys?.ranks ?? [];
            const currRank = sys?.curr_rank ?? 0;
            Array.from({ length: currRank }, (_, rankIdx) => ranks[rankIdx]).forEach((rank, rankIdx) => {
                if (!rank)
                    return;
                const counters = rank.counters ?? [];
                counters.forEach((counter, cidx) => {
                    const path    = `system.ranks.${rankIdx}.counters.${cidx}.value`;
                    const rankLabel = `${roman[rankIdx] ?? String(rankIdx + 1)}: ${rank.name}`;
                    const onRightClick = (/** @type {any} */ row) => {
                        const key = `${/** @type {any} */ (talent).id}_${rankIdx}_${cidx}`;
                        const desc = laFormatDetailHtml(rank.description ?? '');
                        const descHtml = desc ? `<div style="margin-bottom:8px;font-size:0.82em;line-height:1.5;color:#bbb;">${desc}</div>` : '';
                        const actionsHtml = laRenderActions(rank.actions ?? []);
                        const bodyHtml = (descHtml + actionsHtml) || '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-talent-popup', dataKey: 'rank-key', dataValue: key, title: rankLabel, subtitle: `${/** @type {any} */ (talent).name} · Rank ${roman[rankIdx] ?? rankIdx + 1}`, bodyHtml, theme: 'talent', item: /** @type {any} */ (talent), row });
                    };
                    items.push(this._buildCounterRow(counter, path, /** @type {any} */ (talent), 'modules/lancer-automations/icons/perspective-dice-two.svg', onRightClick));
                });
            });
        }
        const frame = actor?.system?.loadout?.frame?.value;
        const csCounters = frame?.system?.core_system?.counters ?? [];
        csCounters.forEach((/** @type {any} */ counter, /** @type {number} */ cidx) => {
            const path = `system.core_system.counters.${cidx}.value`;
            items.push(this._buildCounterRow(counter, path, frame, 'modules/lancer-automations/icons/perspective-dice-two.svg'));
        });
        return items;
    }

    // Non-auto stat-bar extras. Auto-injected ones already show up as talent/frame counter rows.
    _resourceExtras() {
        const actor = this._actor;
        const tokenDoc = /** @type {any} */ (this._token?.document);
        const raw = (tokenDoc?.getFlag?.('lancer-automations', 'statBarExtras') ?? [])
            .filter(/** @type {any} */ e => !e?.autoKey);
        const out = [];
        for (const entry of raw) {
            const resolved = _resolveExtraBarValues(actor, entry);
            if (!resolved.ownerOk) continue;
            // max must be a number. inputCell stringifies it into `${cur}/${max}`.
            out.push({
                inputCell: true,
                subtype: 'increment',
                name: entry.label || 'Extra',
                icon: entry.icon || 'modules/lancer-automations/icons/perspective-dice-two.svg',
                step: 1,
                min: 0,
                max: resolved.max,
                getValue: () => _resolveExtraBarValues(actor, entry).value,
                onValueChanged: (newVal) => updateExtraBarValue(tokenDoc, entry.id, newVal),
                ...(entry.linkedItemUuid ? {
                    onRightClick: async () => {
                        const item = await fromUuid(entry.linkedItemUuid);
                        if (item?.sheet) item.sheet.render(true);
                        else ui.notifications?.warn(`Linked item not found: ${entry.linkedItemUuid}`);
                    },
                } : {}),
            });
        }
        return out;
    }

    _ammoItems() {
        const actor = this._actor;
        const items = [];
        const systems = actor.type === 'mech'
            ? (actor.system?.loadout?.systems ?? []).map(s => s?.value).filter(Boolean)
            : (actor.items?.filter(i => i.type === 'mech_system') ?? []);
        for (const sysItem of systems) {
            const ammoArr = sysItem.system?.ammo ?? [];
            if (!ammoArr.filter(a => a.name).length)
                continue;
            ammoArr.forEach((ammo, idx) => {
                if (!ammo.name)
                    return;
                const cost = ammo.cost ?? 1;
                items.push({
                    label: ammo.name,
                    badge: `${cost}`,
                    badgeColor: '#1a8a3a',
                    icon: 'systems/lancer/assets/icons/ammo.svg',
                    hoverData: { actor, item: sysItem, action: { name: ammo.name, activation: 'Ammo' }, category: 'Ammo' },
                    onClick: () => {
                        const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
                        if (api?.TriggerUseAmmoFlow)
                            api.TriggerUseAmmoFlow(sysItem.uuid, idx);
                    },
                    onRightClick: (/** @type {any} */ row) => {
                        const sizeTags = _ammoTagsHtml(ammo.allowed_sizes);
                        const typeTags = _ammoTagsHtml(ammo.allowed_types);
                        const bodyHtml = `${ammo.description ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${ammo.description}</div>` : ''}
                            <div style="font-size:0.75em;color:#888;margin-top:4px;">Cost: ${cost}${sizeTags}${typeTags}</div>`;
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-ammo-popup', dataKey: 'ammo-idx', dataValue: `${sysItem.id}-${idx}`, title: ammo.name, subtitle: sysItem.name, bodyHtml, theme: 'system', item: sysItem, row });
                    },
                });
            });
        }
        return items;
    }

    /** Build a single increment/decrement counter row item. */
    _buildCounterRow(/** @type {any} */ counter, path, /** @type {any} */ talent, icon = null, onRightClick = null) {
        return {
            inputCell: true,
            subtype: 'increment',
            name: counter.name,
            ...(icon ? { icon } : {}),
            ...(onRightClick ? { onRightClick } : {}),
            step: 1,
            min: 0,
            max: counter.max,
            getValue: () => counter.value,
            onValueChanged: (newVal) => talent.update({ [path]: newVal }),
        };
    }

    // ── AMMO category ────────────────────────────────────────────────────────

    _catAmmo() {
        const actor = this._actor;
        const ammoItems = [];

        // Collect all systems that have ammo
        const systems = actor.type === 'mech'
            ? (actor.system?.loadout?.systems ?? []).map(s => s?.value).filter(Boolean)
            : (actor.items?.filter(i => i.type === 'mech_system') ?? []);

        for (const item of systems) {
            const sys = item.system;
            const ammoArr = sys?.ammo ?? [];
            if (!ammoArr.filter(a => a.name).length)
                continue;

            const status = getItemStatus(item);

            ammoArr.forEach((ammo, idx) => {
                if (!ammo.name)
                    return;
                const cost = ammo.cost ?? 1;
                ammoItems.push({
                    label: ammo.name,
                    badge: `${cost}`,
                    badgeColor: '#1a8a3a',
                    icon: 'systems/lancer/assets/icons/ammo.svg',
                    ...this._statusColors(status),
                    hoverData: { actor, item, action: { name: ammo.name, activation: 'Ammo' }, category: 'Ammo' },
                    onClick: () => {
                        const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
                        if (api?.TriggerUseAmmoFlow)
                            api.TriggerUseAmmoFlow(item.uuid, idx);
                    },
                    onRightClick: (/** @type {any} */ row) => {
                        const sizeTags = _ammoTagsHtml(ammo.allowed_sizes);
                        const typeTags = _ammoTagsHtml(ammo.allowed_types);
                        const bodyHtml = `${ammo.description ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${ammo.description}</div>` : ''}
                            <div style="font-size:0.75em;color:#888;margin-top:4px;">Cost: ${cost}${sizeTags}${typeTags}</div>`;
                        this._showItemPopup({ cssClass: 'la-hud-popup la-hud-ammo-popup', dataKey: 'ammo-idx', dataValue: `${item.id}-${idx}`, title: ammo.name, subtitle: `${item.name}`, bodyHtml, theme: 'system', item, row });
                    },
                });
            });
        }

        return {
            label: 'Ammo',
            colLabel: 'Ammo',
            getItems: () => ammoItems.length ? ammoItems : [],
        };
    }

    // ── STATUSES panel ────────────────────────────────────────────────────────

    _catStatuses() {
        return { label: 'Statuses', isStatusPanel: true };
    }

    // ── MACROS panel (per-client list of Foundry macro shortcuts) ─────────────

    _catMacros() {
        return {
            label: 'Macros',
            colLabel: 'Macros',
            getItems: () => this._buildMacroItems(),
        };
    }

    _getMacroList() {
        const raw = game.settings.get('lancer-automations', 'tah.macroList');
        return Array.isArray(raw) ? raw : [];
    }

    async _saveMacroList(list) {
        await game.settings.set('lancer-automations', 'tah.macroList', list);
        Hooks.callAll('forceUpdateTokenActionHud');
    }

    // White-source SVGs render invisibly on light HUD rows; invert them to black.
    _isWhiteSvgIcon(img) {
        return !!img && img.endsWith('.svg') && (
            img.includes('/white/')
            || img.includes('modules/lancer-automations/')
            || img.startsWith('icons/svg/')
        );
    }

    _macroIconHtml(img, size = 20, invertOverride) {
        if (!img)
            return '';
        const doInvert = typeof invertOverride === 'boolean'
            ? invertOverride
            : this._isWhiteSvgIcon(img);
        const filter = doInvert ? 'invert(1)' : 'none';
        const cls = doInvert ? 'la-hud-icon la-hud-icon--white' : 'la-hud-icon la-hud-icon--dark';
        return `<img class="${cls}" src="${img}" onerror="this.onerror=null;this.src='icons/svg/dice-target.svg';" style="width:${size}px;height:${size}px;filter:${filter};margin-right:5px;vertical-align:middle;flex-shrink:0;border:none;outline:none;">`;
    }

    _buildMacroItems() {
        const list = this._getMacroList();
        /** @type {any[]} */
        const items = list.map(entry => {
            const macro = game.macros.get(entry.macroId);
            const img = entry.iconOverride ?? macro?.img ?? entry.icon;
            const name = entry.name ?? macro?.name ?? '(missing macro)';
            const iconHtml = this._macroIconHtml(img, 20, entry.iconInvert);
            // Wrap in flex span so v13 TAH's column-direction row doesn't push the icon onto a separate line.
            const labelOk = `<span style="display:inline-flex;align-items:center;gap:0;white-space:nowrap;">${iconHtml}${name}</span>`;
            if (!macro) {
                return {
                    label: `<span style="display:inline-flex;align-items:center;gap:0;white-space:nowrap;">${iconHtml}<s style="opacity:0.7">${name}</s></span>`,
                    onRightClick: (row) => this._openMacroRowPopup(entry, null, row),
                };
            }
            return {
                label: labelOk,
                onClick:      () => macro.execute(),
                onRightClick: (row) => this._openMacroRowPopup(entry, macro, row),
            };
        });
        items.push({
            label: 'Add macro...',
            icon: 'fas fa-plus',
            keepOpen: true,
            onClick: () => this._openAddMacroDialog(),
        });
        return items;
    }

    _openAddMacroDialog() {
        const list = this._getMacroList();
        const known = new Set(list.map(e => e.macroId));
        const macros = (game.macros?.contents ?? [])
            .filter(m => !known.has(m.id))
            .sort((a, b) => a.name.localeCompare(b.name));
        const rowsHtml = macros.length
            ? macros.map(m => `
                <div class="la-tah-pick" data-id="${m.id}" style="cursor:pointer;padding:4px 8px;display:flex;align-items:center;gap:8px;border-left:3px solid transparent;background:#fafafa;">
                    ${this._macroIconHtml(m.img, 22)}
                    <span style="flex:1;font-size:0.9em;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.name}</span>
                </div>`).join('')
            : '<div style="padding:12px;text-align:center;color:#888;font-size:0.85em;font-style:italic;">No macros available.</div>';
        const content = `
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">ADD MACRO</div>
                <div class="lancer-dialog-subtitle">Pick from the list. Customize the icon and name before adding.</div>
            </div>
            <input type="text" class="la-tah-search" placeholder="Search..." style="margin-top:8px;width:100%;height:26px;padding:2px 6px;font-size:0.9em;">
            <div class="la-tah-pick-list lancer-scroll" style="margin-top:4px;max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:1px;border:1px solid #ccc;background:#fff;">
                ${rowsHtml}
            </div>
            <div class="la-tah-edit" style="margin-top:8px;display:flex;align-items:center;gap:8px;padding:6px;background:#eef4ff;border:1px solid #cbd6e8;opacity:0.5;pointer-events:none;">
                <span class="la-tah-edit-icon" title="Click to change icon" style="cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid #ccc;background:#fff;flex-shrink:0;"></span>
                <input type="text" class="la-tah-edit-name" placeholder="(select a macro)" style="flex:1;height:26px;padding:2px 6px;font-size:0.9em;">
                <label class="la-tah-edit-invert-label" title="Invert SVG (white → black)" style="display:flex;align-items:center;gap:4px;font-size:0.78em;color:#666;opacity:0.4;">
                    <input type="checkbox" class="la-tah-edit-invert" disabled>Invert
                </label>
            </div>
            <div class="la-tah-macro-drop" style="margin-top:6px;padding:10px;border:1px dashed #888;text-align:center;font-size:0.85em;color:#888;">
                Drop a macro here to add it.
            </div>
        `;
        /** @type {{ id: string|null, name: string, img: string, iconOverride: string|null, invert: boolean }} */
        const state = { id: null, name: '', img: '', iconOverride: null, invert: false };
        const addEntry = async () => {
            if (!state.id)
                return;
            const cur = this._getMacroList();
            if (cur.some(e => e.macroId === state.id))
                return;
            const entry = { macroId: state.id, name: state.name, icon: state.img };
            if (state.iconOverride)
                entry.iconOverride = state.iconOverride;
            const finalImg = state.iconOverride ?? state.img;
            if (state.invert !== this._isWhiteSvgIcon(finalImg))
                entry.iconInvert = state.invert;
            cur.push(entry);
            await this._saveMacroList(cur);
        };
        const dlg = new Dialog({
            title: 'Add Macro',
            content,
            buttons: {
                add: { label: 'Add', callback: () => addEntry() },
                cancel: { label: 'Cancel' },
            },
            default: 'add',
            render: (html) => {
                const editEl     = html.find('.la-tah-edit');
                const editIcon   = html.find('.la-tah-edit-icon');
                const editName   = html.find('.la-tah-edit-name');
                const editInvert = html.find('.la-tah-edit-invert');
                const editInvertLabel = html.find('.la-tah-edit-invert-label');
                const search    = html.find('.la-tah-search');
                const refreshIconPreview = () => {
                    const img = state.iconOverride ?? state.img;
                    editIcon.html(this._macroIconHtml(img, 24, state.invert));
                    const isSvg = !!img && img.endsWith('.svg');
                    /** @type {HTMLInputElement} */ (editInvert[0]).disabled = !isSvg;
                    /** @type {HTMLInputElement} */ (editInvert[0]).checked = state.invert;
                    editInvertLabel.css('opacity', isSvg ? 1 : 0.4);
                };
                const select = (id, name, img) => {
                    state.id = id;
                    state.name = name;
                    state.img = img;
                    state.iconOverride = null;
                    state.invert = this._isWhiteSvgIcon(img);
                    refreshIconPreview();
                    editName.val(name);
                    editEl.css({ opacity: 1, pointerEvents: 'all' });
                    html.find('.la-tah-pick').css({ background: '#fafafa', borderLeftColor: 'transparent' });
                    html.find(`.la-tah-pick[data-id="${id}"]`).css({ background: '#e8f0fa', borderLeftColor: 'var(--primary-color)' });
                };
                html.find('.la-tah-pick').on('click', (ev) => {
                    const id = $(ev.currentTarget).data('id');
                    const m = game.macros.get(id);
                    if (m)
                        select(m.id, m.name, m.img);
                });
                editIcon.on('click', () => {
                    if (!state.id)
                        return;
                    new FilePicker({
                        type: 'image',
                        current: state.iconOverride ?? state.img,
                        callback: (path) => {
                            state.iconOverride = path;
                            state.invert = this._isWhiteSvgIcon(path);
                            refreshIconPreview();
                        },
                    }).render(true);
                });
                editName.on('input', () => {
                    state.name = String(editName.val() ?? '');
                });
                editInvert.on('change', () => {
                    state.invert = /** @type {HTMLInputElement} */ (editInvert[0]).checked;
                    refreshIconPreview();
                });
                search.on('input', () => {
                    const q = String(search.val() ?? '').toLowerCase().trim();
                    html.find('.la-tah-pick').each((_i, el) => {
                        const name = $(el).find('span').text().toLowerCase();
                        $(el).toggle(!q || name.includes(q));
                    });
                });
                const drop = html.find('.la-tah-macro-drop');
                drop.on('dragover', (ev) => {
                    ev.preventDefault(); drop.css('border-color', 'var(--primary-color)');
                });
                drop.on('dragleave', () => drop.css('border-color', '#888'));
                drop.on('drop', async (ev) => {
                    ev.preventDefault();
                    drop.css('border-color', '#888');
                    try {
                        const data = JSON.parse(ev.originalEvent.dataTransfer.getData('text/plain'));
                        const doc = /** @type {any} */ (await fromUuid(data?.uuid));
                        if (doc?.documentName === 'Macro')
                            select(doc.id, doc.name, doc.img);
                    } catch { /* ignore malformed drop */ }
                });
            },
        }, { width: 380, classes: ['lancer-dialog-base', 'lancer-no-title'] });
        dlg.render(true);
    }

    _openMacroRowPopup(entry, macro, anchorRow) {
        $('.la-hud-popup').remove();
        const title = macro?.name ?? entry.name ?? 'Macro';
        const subtitle = macro ? '' : 'Macro missing';
        const baseStyle = 'padding:3px 8px;cursor:pointer;font-size:0.78em;display:flex;align-items:center;gap:5px;font-family:inherit;';
        const buttons = [];
        if (macro) {
            buttons.push(`<button class="la-tah-mr-sheet" style="${baseStyle}background:#2a2a2a;border:1px solid #444;color:#ddd;"><i class="fas fa-external-link-alt"></i>Open Sheet</button>`);
        }
        buttons.push(`<button class="la-tah-mr-remove" style="${baseStyle}background:#3a1818;border:1px solid #803333;color:#ffaaaa;"><i class="fas fa-trash"></i>Remove</button>`);
        const bodyHtml = `<div style="display:flex;flex-direction:column;gap:4px;">${buttons.join('')}</div>`;
        const popup = laDetailPopup('la-hud-popup la-tah-row-popup', title, subtitle, bodyHtml, 'default');
        popup.css({ minWidth: 0, width: 'auto', maxWidth: 200 });
        popup.children().eq(0).css({ padding: '4px 8px' });
        popup.children().eq(0).find('div').first().css({ fontSize: '0.82em' });
        popup.children().eq(1).css({ padding: '4px 8px' });
        popup.find('.la-tah-mr-sheet').on('click', () => {
            macro?.sheet?.render(true);
            popup.remove();
        });
        popup.find('.la-tah-mr-remove').on('click', async () => {
            const cur = this._getMacroList().filter(e => e.macroId !== entry.macroId);
            popup.remove();
            await this._saveMacroList(cur);
        });
        this._showPopupAt(popup, anchorRow);
    }


    _weaponItem(weapon, modItem, mount = null) {
        const sys    = weapon.system;
        const status = getItemStatus(weapon);
        const labelHtml = status.destroyed ? this._destroyedLabel(weapon.name) : weapon.name;
        return {
            label: labelHtml,
            badge: status.badge ?? null,
            badgeColor: status.badgeColor ?? null,
            childColLabel: weapon.name,
            ...this._statusColors(status),
            hoverData: { actor: this._actor, item: weapon, action: null, category: 'Weapons' },
            // onClick: () => weapon.beginWeaponAttackFlow(), // moved to ATTACK row in _weaponChildren
            getChildren: () => this._weaponChildren(weapon, modItem, mount),
            onRightClick: (row) => {
                let profiles = getWeaponProfiles_WithBonus(weapon, this._actor);
                if (!profiles.length && weapon.type === 'npc_feature') {
                    const tierOverride = sys.tier_override ?? 0;
                    const tier = tierOverride > 0 ? tierOverride : (this._actor?.system?.tier ?? 1);
                    const tierIdx = Math.max(0, Math.min(2, tier - 1));
                    const atkBonus = Array.isArray(sys.attack_bonus) ? (sys.attack_bonus[tierIdx] ?? 0) : 0;
                    const atkAcc = Array.isArray(sys.accuracy) ? (sys.accuracy[tierIdx] ?? 0) : 0;
                    profiles = [{ name: null, damage: (sys.damage ?? [])[tierIdx] ?? [], range: sys.range ?? [], tags: sys.tags ?? [], effect: sys.effect || '', on_hit: sys.on_hit || '', attack_bonus: atkBonus, accuracy: atkAcc, tech_attack: sys.tech_attack ?? false, weapon_type: sys.weapon_type ?? '' }];
                }
                if (!profiles.length && weapon.type === 'pilot_weapon') {
                    profiles = [{ name: null, damage: sys.damage ?? [], range: sys.range ?? [], tags: sys.tags ?? [], effect: sys.effect || '', on_hit: sys.on_hit || '' }];
                }
                const bodyHtml = laRenderWeaponBody(profiles, {
                    actions: sys.actions ?? [],
                    modName: modItem?.name ?? null,
                    modItem: modItem ?? null,
                    activeProfileIndex: sys.selected_profile_index ?? 0,
                });
                const profileType = sys.profiles?.[sys.selected_profile_index ?? 0]?.type;
                const subtitle = this._joinSubtitle(sys.mount_type ?? sys.size, profileType ?? sys.weapon_type);
                this._showItemPopup({ cssClass: 'la-hud-popup la-hud-weapon-popup', dataKey: 'weapon-id', dataValue: weapon.id, title: weapon.name, subtitle, bodyHtml, theme: 'weapon', item: weapon, row, postRender: p => appendItemPips(weapon, p, this._depthCallbacks()) });
            },
        };
    }

    _weaponChildren(weapon, modItem, mount) {
        const sys = weapon.system;
        const actor = this._actor;
        const addHover = children => children.map(child => {
            if (child.isSectionLabel || (!child.onClick && !child._profile))
                return child;
            return { ...child, hoverData: { actor, item: weapon, action: child.action ?? { name: child.label, activation: child.activation ?? null }, category: 'Weapons', profile: child._profile ?? null } };
        });
        const addRightClicks = (children, attackLabel, bypassMountArg) => children.map(child => {
            if (child.isSectionLabel || child.onRightClick)
                return child;
            // Mod row may have no onClick; handle it first.
            if (modItem && child.label === modItem.name) {
                const ms = modItem.system;
                const subtitle = this._joinSubtitle(ms?.type, ms?.license ? `${ms.manufacturer} ${ms.license_level}` : null) || 'Weapon Mod';
                return { ...child, onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-mod-popup', dataKey: 'mod-id', dataValue: modItem.id, title: modItem.name, subtitle, bodyHtml: laRenderModBody(modItem), theme: 'mod', item: modItem, row, postRender: p => appendItemPips(modItem, p, this._depthCallbacks()) }) };
            }
            if (!child.onClick)
                return child;
            if (child.label === attackLabel) {
                const mountWeapons = (bypassMountArg?.slots ?? []).map((/** @type {any} */ s) => s.weapon?.value?.name).filter(Boolean);
                const weaponList = mountWeapons.length ? mountWeapons.join(', ') : weapon.name;
                const title = attackLabel === 'FIGHT' ? 'Fight' : attackLabel === 'BARRAGE' ? 'Barrage' : 'Skirmish';
                const body = `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${title} with: <b>${weaponList}</b></div>`;
                return { ...child, onRightClick: (/** @type {any} */ row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-action-popup', dataKey: 'action-key', dataValue: attackLabel, title, subtitle: attackLabel === 'FIGHT' ? 'Full' : attackLabel === 'BARRAGE' ? 'Full' : 'Quick', bodyHtml: body, theme: 'weapon', item: weapon, row }) };
            }
            return child;
        });
        const onActivate = (a, source) => {
            const si = /** @type {any} */ (source ?? weapon);
            // Invade on mech_weapon: TechAttackFlow rejects weapon items, use executeInvade instead
            if (a.activation === 'Invade' && si.type === 'mech_weapon') {
                const opt = this._getInvadeOptions(actor).find(o => o.name === a.name && o.item?.id === si.id)
                    ?? { name: a.name, detail: a.detail ?? '', item: si, action: a, unavailable: false, destroyed: false };
                executeInvade(actor, opt);
                return;
            }
            const sysActions = si.system?.actions ?? [];
            const sysIdx = sysActions.findIndex(sa => sa.name === a.name && sa.activation === a.activation);
            if (sysIdx >= 0) {
                si.beginActivationFlow(`system.actions.${sysIdx}`);
                return;
            }
            const profIdx = si.system?.selected_profile_index ?? 0;
            const profActions = si.system?.profiles?.[profIdx]?.actions ?? [];
            const pIdx = profActions.findIndex(pa => pa.name === a.name && pa.activation === a.activation);
            if (pIdx >= 0) {
                si.beginActivationFlow(`system.profiles.${profIdx}.actions.${pIdx}`);
                return;
            }
            executeSimpleActivation(actor, { title: a.name, action: a, detail: a.detail ?? '' }, { item: si });
        };
        const hasGAA = !!game.modules.get('grid-aware-auras')?.active;
        const rangeToggle = hasGAA ? () => {
            const token = this._token;
            const profiles = getWeaponProfiles_WithBonus(weapon, actor);
            const rangeMap = {};
            for (const p of profiles)
                for (const r of (p.range ?? [])) {
                    const type = r.type ?? 'Range';
                    const val = Number(r.val) || 0;
                    if (val > (rangeMap[type] ?? 0))
                        rangeMap[type] = val;
                }
            const weaponRange = Math.max(0, ...Object.values(rangeMap));
            if (weaponRange <= 0)
                return [];
            const RANGE_CCI = { Range: 'cci-range', Threat: 'cci-threat', Line: 'cci-line', Cone: 'cci-cone', Blast: 'cci-blast', Burst: 'cci-burst', Thrown: 'cci-thrown' };
            const rangeLabel = 'Reach: ' + Object.entries(rangeMap)
                .map(([type, val]) => `<i class="cci ${RANGE_CCI[type] ?? 'cci-range'}" style="font-size:1.1em;vertical-align:middle;"></i>${val}`)
                .join(' ');
            return [{ label: 'RANGE', isSectionLabel: true }, {
                inputCell: true,
                subtype: 'toggle',
                name: rangeLabel,
                icon: 'modules/lancer-automations/icons/nested-hexagons.svg',
                getValue: () => token?.document?.getFlag('lancer-automations', 'weaponRangeItemId') === weapon.id,
                onToggle: async (/** @type {boolean} */ on) => {
                    this._suppressRefreshDepth++;
                    try {
                        if (on) {
                            await token?.document?.setFlag('lancer-automations', 'weaponRangeItemId', weapon.id);
                            await setPersistentAura(token, 'LA_max_range', true, weaponRange);
                        } else {
                            await token?.document?.setFlag('lancer-automations', 'weaponRangeItemId', null);
                            await setPersistentAura(token, 'LA_max_range', false, weaponRange);
                        }
                    } finally {
                        this._suppressRefreshDepth--;
                    }
                },
            }];
        } : () => [];

        const patchProfileRefresh = (children, builder) => {
            for (const c of children) {
                if (c._profile)
                    c.refreshCol4 = builder;
            }
            return children;
        };

        if (actor.type === 'pilot') {
            const buildPilot = () => [...addRightClicks(addHover(laHudItemChildren(weapon, {
                defaultActions: [
                    {
                        label: 'FIGHT',
                        icon: 'systems/lancer/assets/icons/white/melee.svg',
                        onClick: () => executeFight(actor, weapon),
                        broadcastFn: (t, a) => {
                            const w = /** @type {any} */ (a).items.find(i => i.system?.lid === weapon.system?.lid); executeFight(a, w);
                        },
                    },
                    {
                        label: 'ATTACK',
                        icon: 'systems/lancer/assets/icons/mech_weapon.svg',
                        onClick: () => weapon.beginWeaponAttackFlow(),
                        broadcastFn: (t, a) => {
                            const w = /** @type {any} */ (a).items.find(i => i.system?.lid === weapon.system?.lid); if (w) /** @type {any} */
                                (w).beginWeaponAttackFlow();
                        },
                        onRightClick: (row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-action-popup', dataKey: 'action-key', dataValue: 'ATTACK', title: 'Attack', subtitle: 'Quick', bodyHtml: `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">Attack with: <b>${weapon.name}</b></div>`, theme: 'weapon', item: weapon, row }),
                    },
                ],
                modItem,
                showPopup: (popup, row) => this._showPopupAt(popup, row),
                onActivate,
            })), 'FIGHT', { slots: [{ weapon: { value: weapon } }] }), ...rangeToggle()];
            return patchProfileRefresh(buildPilot(), buildPilot);
        }
        // Mech: sys.size === "Superheavy". NPC weapons store it in sys.weapon_type ("Superheavy Rifle", etc.).
        const isSuperHeavy = (sys.size || sys.type || '').toLowerCase() === 'superheavy'
            || String(sys.weapon_type || '').toLowerCase().startsWith('superheavy');
        const bypassMount = mount ?? { slots: [{ weapon: { value: weapon } }] };
        const attackLabel = isSuperHeavy ? 'BARRAGE' : 'SKIRMISH';
        const buildMech = () => [...addRightClicks(addHover(laHudItemChildren(weapon, {
            defaultActions: [
                {
                    label: attackLabel,
                    icon: isSuperHeavy
                        ? 'mdi mdi-hexagon-slice-6'
                        : 'mdi mdi-hexagon-slice-3',
                    onClick: () => isSuperHeavy
                        ? executeBarrage(actor, bypassMount)
                        : executeSkirmish(actor, bypassMount),
                    broadcastFn: (t, a) => {
                        const bm = { slots: [{ weapon: { value: /** @type {any} */ (a).items.find(i => i.system?.lid === weapon.system?.lid) } }] };
                        return isSuperHeavy ? executeBarrage(a, bm) : executeSkirmish(a, bm);
                    },
                },
                {
                    label: 'ATTACK',
                    icon: 'systems/lancer/assets/icons/mech_weapon.svg',
                    onClick: () => weapon.beginWeaponAttackFlow(),
                    broadcastFn: (t, a) => {
                        const w = /** @type {any} */ (a).items.find(i => i.system?.lid === weapon.system?.lid); if (w) /** @type {any} */
                            (w).beginWeaponAttackFlow();
                    },
                    onRightClick: (row) => this._showItemPopup({ cssClass: 'la-hud-popup la-hud-action-popup', dataKey: 'action-key', dataValue: 'ATTACK', title: 'Attack', subtitle: 'Quick', bodyHtml: `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">Attack with: <b>${weapon.name}</b></div>`, theme: 'weapon', item: weapon, row }),
                },
            ],
            modItem,
            showPopup: (popup, row) => this._showPopupAt(popup, row),
            onActivate,
        })), attackLabel, bypassMount), ...rangeToggle()];
        return patchProfileRefresh(buildMech(), buildMech);
    }

    _getInvadeOptions(actor) {
        if (!actor)
            return [];
        const isNPC = actor.type === 'npc';
        const fragDetail = isNPC
            ? 'Target becomes IMPAIRED until the end of their next turn.'
            : 'Target becomes IMPAIRED and SLOWED until the end of their next turn.';
        const invades = (actor.type === 'deployable' || actor.type === 'pilot') ? [] : [{
            name: 'Fragment Signal',
            detail: fragDetail,
            item: null,
            action: null,
            tags: [],
            isFragmentSignal: true,
            destroyed: false,
            unavailable: false,
        }];
        const pushInvade = (name, detail, item, action, tags) => {
            const status = getItemStatus(item);
            invades.push({ name, detail, item, action, tags, isFragmentSignal: false, destroyed: status.destroyed, unavailable: status.unavailable });
        };
        if (actor.type === 'mech') {
            for (const s of (actor.system?.loadout?.systems ?? [])) {
                const item = s?.value;
                if (!item)
                    continue;
                for (const action of (item.system?.actions ?? [])) {
                    if (action.activation === 'Invade')
                        pushInvade(action.name, action.detail || '', item, action, item.system?.tags ?? []);
                }
            }
            for (const mount of (actor.system?.loadout?.weapon_mounts ?? [])) {
                for (const slot of (mount.slots ?? [])) {
                    const weapon = slot.weapon?.value;
                    if (weapon) {
                        for (const action of (weapon.system?.actions ?? [])) {
                            if (action.activation === 'Invade')
                                pushInvade(action.name, action.detail || '', weapon, action, weapon.system?.active_profile?.tags ?? weapon.system?.tags ?? []);
                        }
                    }
                    const mod = slot.mod?.value;
                    if (mod) {
                        for (const action of (mod.system?.actions ?? [])) {
                            if (action.activation === 'Invade')
                                pushInvade(action.name, action.detail || '', mod, action, mod.system?.tags ?? []);
                        }
                    }
                }
            }
            const frame = actor.system?.loadout?.frame?.value;
            if (frame) {
                for (const action of (frame.system?.core_system?.passive_actions ?? [])) {
                    if (action.activation === 'Invade')
                        pushInvade(action.name, action.detail || '', frame, action, []);
                }
            }
            // Talent ranks may also contribute Invade options (e.g. Hacker).
            // Talents live on the pilot actor, not the mech actor.
            const pilot = actor.system?.pilot?.value ?? null;
            const talentSource = pilot ?? actor;
            for (const item of talentSource.items) {
                if (/** @type {any} */ (item).type !== 'talent')
                    continue;
                const ranks = /** @type {any} */ (item).system?.ranks ?? [];
                const maxRank = /** @type {any} */ (item).system?.curr_rank ?? ranks.length;
                for (let ri = 0; ri < Math.min(maxRank, ranks.length); ri++) {
                    for (const action of (ranks[ri]?.actions ?? [])) {
                        if (action.activation === 'Invade')
                            pushInvade(action.name, action.detail || '', item, action, []);
                    }
                }
            }
        } else {
            for (const item of actor.items) {
                for (const action of (item.system?.actions ?? [])) {
                    if (action.activation === 'Invade')
                        pushInvade(action.name, action.detail || '', item, action, item.system?.tags ?? []);
                }
            }
        }
        return invades;
    }

    _actionLockReasonHtml(actionName) {
        if (!this._actor || !actionName) return '';
        const info = getActionLockInfo(this._actor, actionName);
        if (!info.statuses.length && !info.sources.length) return '';
        const statusLabel = (id) => {
            const raw = CONFIG.statusEffects?.find?.(e => e.id === id)?.name ?? id;
            const localized = game.i18n.localize(raw);
            return localized === raw && raw.includes('.') ? id : localized;
        };
        const parts = [
            ...info.statuses.map(statusLabel),
            ...info.sources
        ];
        const escape = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        return `<p class="la-hud-action-locked-reason" style="margin:0 0 6px 0;padding:4px 6px;background:rgba(160,119,68,0.18);border-left:3px solid #a07744;font-size:0.85em;color:#e0c8a0;"><strong>Locked by:</strong> ${parts.map(escape).join(', ')}</p>`;
    }

    _actionPopup(action, source = null, themeOverride = null) {
        return (/** @type {any} */ row) => {
            const sourceName = typeof source === 'string' ? source : /** @type {any} */ (source)?.name ?? null;
            const sourceType = typeof source === 'string' ? null : /** @type {any} */ (source)?.system?.type ?? null;
            const tier = (typeof source !== 'string' ? source?.parent?.system?.tier : null) ?? 1;
            const bodyHtml = this._actionLockReasonHtml(action.name) + laRenderActionDetail(action, { tier });
            const subtitleParts = [action.activation ?? ''];
            if (sourceName)
                subtitleParts.push(sourceType ? `${sourceName} (${sourceType})` : sourceName);
            const theme = themeOverride ?? activationTheme(action.activation);
            const sourceItem = typeof source === 'string' ? null : source;
            const actorForExtra = this._actor;
            this._showItemPopup({ cssClass: 'la-hud-popup la-hud-action-popup', dataKey: 'action-key', dataValue: action.name, title: action.name, subtitle: this._joinSubtitle(...subtitleParts), bodyHtml, theme, item: sourceItem ?? action.name, row, postRender: sourceItem ? p => appendItemPips(sourceItem, p, { action }) : (action._addedViaExtrasUI ? p => appendItemPips(actorForExtra, p, { action }) : (action.recharge ? p => appendItemPips(null, p, { action }) : null)) });
        };
    }

    _getActionsByActivation(actor, activationType, category = null) {
        if (!actor)
            return [];
        const coreUsed = actor.system?.core_energy === 0;
        return getActorActionItems(actor, activationType).map((/** @type {any} */ { action, sourceItem, rankIdx, _coreActive }) => {
            const status = sourceItem ? getItemStatus(sourceItem, action) : getItemStatus(action);
            // Core power spent: mark the core active entry as unavailable (orange).
            if (_coreActive && coreUsed && !status.destroyed)
                status.unavailable = true;
            // Extra-action recharge: overlay action-level charged state onto item status
            if (action.recharge && !status.destroyed) {
                const charged = action.charged !== false;
                status.badge = (status.badge ? status.badge + ' ' : '') + rechargeIcon(charged);
                status.badgeColor = charged ? (status.badgeColor ?? '#3a9e6e') : '#c33';
                if (!charged)
                    status.unavailable = true;
            }
            return {
                label: status.destroyed ? this._destroyedLabel(action.name)
                    : ((action._sourceItemId || action._addedViaExtrasUI) ? `<span style="color:#e8a030;font-size:0.7em;vertical-align:middle;">●</span> ${action.name}` : action.name),
                badge: status.badge ?? null,
                badgeColor: status.badgeColor ?? null,
                icon: _coreActive ? 'systems/lancer/assets/icons/corepower.svg' : (action.icon ?? getActivationIcon(action) ?? sourceItem?.img ?? null),
                ...this._statusColors(status),
                onClick: async () => {
                    const si = /** @type {any} */ (sourceItem);
                    if (action._addedViaExtrasUI && Array.isArray(action.tags) && action.tags.length) {
                        const ok = await consumeExtraAction(si ?? actor, action.name);
                        if (!ok)
                            return;
                    }
                    if (_coreActive)
                        si.beginCoreActiveFlow('system.core_system');
                    else if (si?.type === 'mech_system' || si?.type === 'npc_feature' || si?.type === 'pilot_gear' || si?.type === 'pilot_armor' || si?.type === 'pilot_weapon') {
                        if (si?.type === 'npc_feature' && si.system?.tech_attack && si.beginTechAttackFlow) {
                            si.beginTechAttackFlow();
                        } else {
                            const actionIdx = (si.system?.actions ?? []).findIndex(/** @type {any} */ a => a === action || a.name === action.name);
                            if (actionIdx >= 0)
                                si.beginActivationFlow(`system.actions.${actionIdx}`);
                            else if (action._sourceItemId || action.recharge !== undefined)
                                executeSimpleActivation(actor, { title: action.name, action, detail: action.detail || '' }, { item: si });
                            else if (si.beginSystemFlow)
                                si.beginSystemFlow();
                            else
                                executeSimpleActivation(actor, { title: action.name, action, detail: action.detail || '' }, { item: si });
                        }
                    } else if (si?.type === 'talent') {
                        if (action.activation === 'Invade') {
                            const opt = this._getInvadeOptions(actor).find(o => o.item?.id === si.id && o.name === action.name);
                            if (opt)
                                executeInvade(actor, opt);
                        } else {
                            const ri = rankIdx ?? 0;
                            const ai = (si.system?.ranks?.[ri]?.actions ?? []).findIndex(/** @type {any} */ a => a.name === action.name);
                            si.beginActivationFlow(`system.ranks.${ri}.actions.${Math.max(ai, 0)}`);
                        }
                    } else {
                        executeSimpleActivation(actor, { title: action.name, action, detail: action.detail || '' });
                    }
                },
                broadcastFn: (t, a) => {
                    const si = /** @type {any} */ (sourceItem);
                    if (_coreActive) {
                        const equiv = /** @type {any} */ (a).system?.loadout?.frame?.value;
                        if (equiv)
                            equiv.beginCoreActiveFlow('system.core_system');
                    } else if (si?.type === 'mech_system' || si?.type === 'npc_feature' || si?.type === 'pilot_gear' || si?.type === 'pilot_armor' || si?.type === 'pilot_weapon') {
                        const equiv = /** @type {any} */ (a).items.find(/** @type {any} */ i => i.system?.lid === si.system?.lid);
                        if (equiv) {
                            const actionIdx = (si.system?.actions ?? []).findIndex(/** @type {any} */ ac => ac === action || ac.name === action.name);
                            if (actionIdx >= 0)
                                equiv.beginActivationFlow(`system.actions.${actionIdx}`);
                            else if (action._sourceItemId || action.recharge !== undefined)
                                executeSimpleActivation(a, { title: action.name, action, detail: action.detail || '' }, { item: equiv });
                            else if (equiv.beginSystemFlow)
                                equiv.beginSystemFlow();
                            else
                                executeSimpleActivation(a, { title: action.name, action, detail: action.detail || '' }, { item: equiv });
                        }
                    } else if (si?.type === 'talent') {
                        if (action.activation === 'Invade') {
                            const opt = this._getInvadeOptions(a).find(o => o.item?.system?.lid === si.system?.lid && o.name === action.name);
                            if (opt)
                                executeInvade(a, opt);
                        } else {
                            const equiv = /** @type {any} */ (a).items.find(i => i.system?.lid === si.system?.lid);
                            if (equiv) {
                                const ri = rankIdx ?? 0;
                                const ai = (equiv.system?.ranks?.[ri]?.actions ?? []).findIndex(/** @type {any} */ ac => ac.name === action.name);
                                equiv.beginActivationFlow(`system.ranks.${ri}.actions.${ai >= 0 ? ai : 0}`);
                            }
                        }
                    } else {
                        executeSimpleActivation(a, { title: action.name, action, detail: action.detail || '' });
                    }
                },
                onRightClick: this._actionPopup(action, sourceItem),
                hoverData: { actor, item: sourceItem ?? null, action, category },
            };
        });
    }

    _showPopupAt(popup, anchorEl) {
        showPopupAt(popup, anchorEl, {
            cancelCollapse:   () => this._cancelCollapse?.(),
            scheduleCollapse: () => this._scheduleCollapse?.(),
        });
    }

    /** Thin wrapper around `toggleDetailPopup` that auto-wires `showPopupAt`. */
    _showItemPopup(opts) {
        const showFn = (p, r) => this._showPopupAt(p, r);
        const impl = toggleDetailPopup;
        impl({ ...opts, showPopupAt: showFn });
    }

    /** Join non-empty subtitle parts with the ` · ` separator. */
    _joinSubtitle(...parts) {
        return parts.filter(Boolean).join(' · ');
    }

    /**
     * Enrich HUD items with `hoverData` of the shape `{ actor, item: null, action: { name: it.label }, category }`.
     * Leaves section labels, non-clickable rows, and rows that already carry hoverData untouched.
     * @param {any[]} items
     * @param {{ actor: any, category: string }} ctx
     */
    _enrichHoverData(items, { actor, category }) {
        return items.map(/** @type {any} */ (it) =>
            it.hoverData || it.isSectionLabel || !it.onClick
                ? it
                : { ...it, hoverData: { actor, item: null, action: { name: it.label }, category } }
        );
    }

    /** Red-strike HTML for an item/action whose source item is destroyed. */
    _destroyedLabel(name) {
        return `<s class="horus--subtle" style="opacity:0.7;color:#e50000;">${name}</s>`;
    }

    /** Build the invade popup body + subtitle and open it. */
    _buildInvadePopup(opt, row) {
        const detail = laFormatDetailHtml(opt.detail);
        const bodyHtml = detail
            ? `<div style="margin:0;font-size:0.82em;line-height:1.5;">${detail}</div>`
            : '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
        const isWeapon    = opt.item?.type?.includes('weapon');
        const sourceType  = isWeapon ? ' (Weapon)' : (opt.item?.system?.type ? ` (${opt.item.system.type})` : '');
        const sourceLabel = !opt.isFragmentSignal && opt.item?.name ? ` · ${opt.item.name}${sourceType}` : '';
        const subtitle    = (opt.isFragmentSignal ? 'Fragment Signal · Quick Tech' : 'Invade · Quick Tech') + sourceLabel;
        this._showItemPopup({
            cssClass: 'la-hud-popup la-hud-invade-popup',
            dataKey: 'invade-name',
            dataValue: opt.name,
            title: opt.name,
            theme: 'invade',
            subtitle,
            bodyHtml,
            item: opt.item,
            row,
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Refresh visible column contents without touching structure, popups, or timers. */
    _refreshColumnsInPlace() {
        if (!this._c2Category?.getItems || !this._c2?.is(':visible'))
            return;
        this._openCol(this._c2, this._c2Category.getItems(), this._c2AnchorRow);

        if (!this._c3SourceItem?.getChildren || !this._c3?.is(':visible'))
            return;
        // _c3AnchorRow points to a c2 row that was just rebuilt; it's detached now, skip reposition.
        this._openCol(this._c3, this._c3SourceItem.getChildren(), null, { reposition: false });

        if (!this._c4SourceItem?.getChildren || !this._c4?.is(':visible'))
            return;
        this._openCol(this._c4, this._c4SourceItem.getChildren(), null, { reposition: false });
    }

    _saveOpenPath() {
        if (!this._el)
            return null;
        const getActiveIdx = col => {
            let idx = -1, i = 0;
            col.find('.la-hud-row').each(function() {
                if ($(this).hasClass('la-hud-active')) {
                    idx = i;
                    return false;
                }
                i++;
            });
            return idx;
        };
        const c1 = this._el.children().first();
        // Search active: don't save column state
        if (this._searchActive)
            return { searchActive: true };
        // Status panel open: c2 is hidden but c1 has an active row
        if (this._statusPanelInstance?.isVisible) {
            const c1Idx = getActiveIdx(c1);
            return c1Idx >= 0 ? { c1Idx, statusPanel: true } : null;
        }
        if (!this._c2?.is(':visible'))
            return null;
        const path = { c1Idx: getActiveIdx(c1) };
        if (path.c1Idx < 0)
            return null;
        if (this._c3?.is(':visible'))
            path.c2Idx = getActiveIdx(this._c2);
        if (this._c4?.is(':visible'))
            path.c3Idx = getActiveIdx(this._c3);
        return path;
    }

    _restoreOpenPath(path) {
        if (!path || path.searchActive || path.c1Idx < 0)
            return;
        const c1 = this._el.children().first();
        const c1Row = c1.find('.la-hud-row').eq(path.c1Idx);
        if (!c1Row.length)
            return;
        c1Row.trigger('mouseenter');
        if (path.statusPanel)
            return;
        if ((path.c2Idx ?? -1) < 0)
            return;
        const c2Row = this._c2.find('.la-hud-row').eq(path.c2Idx);
        if (!c2Row.length)
            return;
        c2Row.trigger('mouseenter');
        if ((path.c3Idx ?? -1) < 0)
            return;
        const c3Row = this._c3.find('.la-hud-row').eq(path.c3Idx);
        if (!c3Row.length)
            return;
        c3Row.trigger('mouseenter');
    }

    _makeCol(label) {
        return $(`<div class="la-hud-col lancer-scroll"><div class="la-hud-col-label">${label}</div></div>`);
    }

    _makeRow(label, hasArrow, icon = null, activation = null, badge = null, badgeColor = null, count = 0) {
        const iconHtml = icon ? laHudRenderIcon(icon) : '';
        const countHtml = hasArrow && count > 0 ? `<span class="la-hud-count">${count}</span>` : '';
        const arrow = hasArrow ? `<span class="la-hud-arrow">▶</span>` : '';
        const actHtml = activation ? `<span class="la-hud-activation">[${activation}]</span>` : '';
        const badgeHtml = badge ? `<span class="la-hud-badge" style="color:${badgeColor ?? '#3a9e6e'};">${badge}</span>` : '';
        const row = $(`<div class="la-hud-row">${iconHtml}<span class="la-hud-clip"><span class="la-hud-pan">${label}${actHtml}</span></span>${badgeHtml}${countHtml}${arrow}</div>`);
        row.on('mouseenter', () => {
            if (!row.hasClass('la-hud-active')) {
                const specialBg = row.data('hoverBg');
                if (specialBg) {
                    row.css({ background: specialBg, color: row.data('hoverColor') ?? TEXT_DEFAULT });
                } else {
                    row.css({ background: BG_ACTIVE, color: TEXT_ACTIVE });
                }
            }
            const clip = row.find('.la-hud-clip')[0];
            const pan  = row.find('.la-hud-pan')[0];
            if (clip && pan) {
                const overflow = pan.scrollWidth - clip.clientWidth;
                if (overflow > 4)
                    $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
            }
        });
        row.on('mouseleave', () => {
            if (!row.hasClass('la-hud-active')) {
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

    _collectFavorites() {
        const favs = /** @type {any} */ (game.user).getFlag('lancer-automations', 'tahFavorites') || [];
        if (!favs.length)
            return [];
        const favSet = new Set(favs);
        const results = [];
        const seen = new Set();
        const walk = (items, catLabel) => {
            for (const item of (items ?? [])) {
                if (item.isSectionLabel)
                    continue;
                if (item.onClick) {
                    const key = this._favKey(item);
                    if (key && favSet.has(key) && !seen.has(key)) {
                        seen.add(key);
                        results.push({ ...item, _catLabel: catLabel });
                    }
                }
                if (item.getChildren)
                    walk(item.getChildren(), catLabel);
            }
        };
        for (const cat of (this._categories ?? [])) {
            if (cat.isStatusPanel)
                continue;
            walk(cat.getItems?.(), cat.label);
        }
        return results;
    }

    _showQuickTip(x, y, text) {
        const tip = $(`<div style="position:fixed;left:${x + 12}px;top:${y + 12}px;background:#111;color:#fff;padding:4px 8px;border-radius:3px;font-size:0.8em;pointer-events:none;z-index:200;opacity:0;transition:opacity 0.1s;">${text}</div>`);
        $('body').append(tip);
        requestAnimationFrame(() => tip.css('opacity', 1));
        setTimeout(() => tip.css('opacity', 0), 800);
        setTimeout(() => tip.remove(), 1000);
    }

    _applyFavStyle(row) {
        row.css({ position: 'relative' });
        row.find('.la-hud-fav-mark').remove();
        row.append('<span class="la-hud-fav-mark">★</span>');
    }

    _clearFavStyle(row) {
        row.find('.la-hud-fav-mark').remove();
    }

    _favKey(item) {
        return item?.hoverData?.item?.uuid ?? item?.label ?? null;
    }

    _isFavorite(item) {
        const key = this._favKey(item);
        if (!key)
            return false;
        const favs = /** @type {any} */ (game.user).getFlag('lancer-automations', 'tahFavorites') || [];
        return favs.includes(key);
    }

    async _toggleFavorite(item) {
        const key = this._favKey(item);
        if (!key)
            return false;
        const favs = [...(/** @type {any} */ (game.user).getFlag('lancer-automations', 'tahFavorites') || [])];
        const idx = favs.indexOf(key);
        if (idx >= 0)
            favs.splice(idx, 1);
        else
            favs.push(key);
        await /** @type {any} */ (game.user).setFlag('lancer-automations', 'tahFavorites', favs);
        return idx < 0;
    }

    _setActive(col, activeRow, isCategory = false) {
        col.find('.la-hud-row').each(function() {
            const r = $(this);
            const css = { background: r.data('restingBg') ?? BG_DEFAULT, color: r.data('restingColor') ?? TEXT_DEFAULT };
            const rb  = r.data('restingBorder');
            if (rb)
                css.borderLeftColor = rb;
            r.css(css).removeClass('la-hud-active');
        });
        const specialBg = activeRow.data('hoverBg');
        if (specialBg) {
            activeRow.css({ background: specialBg, color: activeRow.data('hoverColor') ?? TEXT_DEFAULT }).addClass('la-hud-active');
        } else {
            activeRow.css({ background: BG_ACTIVE, color: TEXT_ACTIVE }).addClass('la-hud-active');
        }
    }
}
