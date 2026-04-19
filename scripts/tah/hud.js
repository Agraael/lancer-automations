/* global $, window, game, CONFIG */

import { laRenderWeaponBody, laRenderModBody, laRenderCoreBonusBody, laRenderCoreSystemBody, laFormatDetailHtml, laRenderActionDetail, laRenderActions, laPopupSectionLabel, laRenderDeployables, laRenderTags } from '../interactive/detail-renderers.js';
import { executeSkirmish, executeBarrage, executeFight, executeSimpleActivation, executeBasicAttack, executeDamageRoll, executeTechAttack, executeReactorMeltdown, executeReactorExplosion, executeFall, executeStandingUp, executeTeleport, getActorActionItems, hasReactionAvailable, getWeaponProfiles_WithBonus, getActorMaxThreat, getMaxWeaponRanges_WithBonus } from '../misc-tools.js';
import { executeInvade, openThrowMenu, clearMovementHistory, revertMovement, resetMovementCap } from '../interactive/combat.js';
import { pickupWeaponToken, openDeployableMenu, recallDeployable, getItemDeployables, deployDeployable, reloadOneWeapon, resolveDeployable, getDeployableInfo, getDeployableInfoSync } from '../interactive/deployables.js';
import { knockBackToken } from '../interactive/canvas.js';
import { delayedTokenAppearance } from '../reinforcement.js';
import { laHudRenderIcon, getActivationIcon, laHudItemChildren, getItemStatus, activationTheme, appendItemPips } from './item-helpers.js';
import { onHudRowHover, togglePersistentAura, isPersistentAuraActive, setPersistentAura, AURA_DEFS, deactivateRangePreview } from './hover.js';
import { resurrect } from '../wreck.js';
import { buildStatsEl, resetStatsExpanded } from './stats-bar.js';
import { buildCombatBar } from './combat-bar.js';
import { collectSearchResults, openSearchResults } from './search.js';
import { showPopupAt, toggleDetailPopup } from './hud-popups.js';
import { StatusPanel } from './status-panel.js';
import { LogPanel } from './log-panel.js';

// ── Lancer-style-library palette ─────────────────────────────────────────────

const HUD_LEFT = 120;    // right of Foundry's left toolbar
const HUD_TOP  = 115;   // below Foundry's top nav bar

const ROW_MAX_WIDTH = 250;

const S_COL  = `display:flex;flex-direction:column;gap:2px;width:max-content;min-width:180px;max-width:${ROW_MAX_WIDTH}px;`;

const S_ITEM = [
    'box-sizing:border-box',
    'height:30px',
    'padding:6px 12px',
    'background:#f5f5f5',
    'border:2px solid #bbb',
    'border-left:3px solid var(--primary-color)',
    'font-size:1em',
    'font-weight:600',
    'color:#111',
    'cursor:pointer',
    'text-transform:uppercase',
    'letter-spacing:0.5px',
    'display:flex',
    'align-items:center',
    `max-width:${ROW_MAX_WIDTH}px`,
    'overflow:hidden',
    'user-select:none',
    'font-family:inherit',
].join(';') + ';';

const S_MUTED = [
    'padding:5px 12px',
    'background:#f5f5f5',
    'border:1px solid #ddd',
    'font-size:0.8em',
    'color:#888',
    'font-style:italic',
].join(';') + ';';

const S_COL_LABEL = [
    'padding:3px 12px 4px',
    'background:var(--primary-color)',
    'color:#fff',
    'font-size:0.68em',
    'letter-spacing:1px',
    'text-transform:uppercase',
    'font-weight:bold',
].join(';') + ';';

const BG_DEFAULT   = '#f5f5f5';
const BG_HOVER     = 'color-mix(in srgb, var(--primary-color), white 85%)';
const BG_ACTIVE    = 'var(--primary-color)';
const TEXT_DEFAULT = '#111';
const TEXT_ACTIVE  = '#fff';

/** Animate a column closed — mirrors the open slide-in (opacity + marginLeft). */
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

    /**
     * Returns `{ incDepth, decDepth }` bound to this HUD's suppress counter.
     * Pass to any out-of-column click handler (popups, pips, etc.) that calls
     * item/actor.update() and must not trigger a full HUD re-render.
     */
    _depthCallbacks() {
        return {
            incDepth: () => this._suppressRefreshDepth++,
            decDepth: () => this._suppressRefreshDepth--,
        };
    }

    /** Debounced full refresh — coalesces rapid successive updates into one render. */
    scheduleRefresh(delay = 100) {
        if (this._suppressRefreshDepth > 0)
            return;
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refresh(), delay);
    }

    /**
     * Update only the stats bar in-place (HP, heat, structure…).
     * Does NOT collapse sub-columns — safe to call on every updateActor.
     */
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
        // Status panel open — sync rows in-place, never close+reopen it
        if (this._statusPanelInstance?.isVisible) {
            this.updateStatsInPlace();
            this._statusPanelInstance.syncRows();
            return;
        }
        // Detail popup open — refresh visible columns in-place, never full re-render
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

        const S_TOKEN_TITLE = [
            'background:#1a1a1a',
            'color:#fff',
            'font-size:1em',
            'letter-spacing:1px',
            'text-transform:uppercase',
            'font-weight:bold',
            'white-space:nowrap',
            'width:max-content',
            'cursor:context-menu',
            'display:flex',
            'align-items:stretch',
        ].join(';') + ';';

        const titleEl = $(`<div style="${S_TOKEN_TITLE}"><span class="la-hud-token-name" style="padding:6px 6px 5px 12px;display:flex;align-items:center;">${tokenName}</span></div>`);

        // Combat toggle icon (left of token name)
        const inCombat = this._token.inCombat;
        const combatToggle = $(`<span class="la-combat-toggle" style="cursor:pointer;color:${inCombat ? 'var(--primary-color)' : '#555'};margin-right:4px;padding-left:8px;font-size:0.85em;flex-shrink:0;opacity:${inCombat ? 1 : 0.5};transition:color 0.15s, opacity 0.15s;display:flex;align-items:center;" title="${inCombat ? 'Remove from combat' : 'Add to combat'}"><i class="fas fa-swords"></i></span>`);
        combatToggle.on('mouseenter', () => combatToggle.css({ color: 'color-mix(in srgb, var(--primary-color), white 40%)', opacity: 1 }));
        combatToggle.on('mouseleave', () => {
            const ic = this._token.inCombat;
            combatToggle.css({ color: ic ? 'var(--primary-color)' : '#555', opacity: ic ? 1 : 0.5 });
        });
        combatToggle.on('click', async () => {
            await /** @type {any} */ (this._token.document).toggleCombatant?.(!this._token.inCombat);
            const nowInCombat = this._token.inCombat;
            combatToggle.css({ color: nowInCombat ? 'var(--primary-color)' : '#555', opacity: nowInCombat ? 1 : 0.5 });
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
        const searchIcon = $(`<span class="la-hud-search-toggle" title="Search" style="cursor:pointer;opacity:0.55;font-size:1.15em;padding-left:4px;line-height:1;flex-shrink:0;">⌕</span>`);
        menuLabel.append(searchIcon);
        const searchBar = $(`<input type="text" class="la-hud-search-bar" placeholder="Search…" style="display:none;width:100%;box-sizing:border-box;padding:4px 8px;background:#1a1a1a;color:#fff;border:0;border-bottom:2px solid var(--primary-color);font-size:0.8em;font-family:inherit;outline:none;">`);
        menuLabel.after(searchBar);
        if (combatBar) {
            c1.prepend(combatBar);
        }
        c1.prepend(statsEl);
        c1.prepend(titleEl);

        // c1 must exist in DOM before we can measure it below, so build hud first
        const savedPos = game.settings.get('lancer-automations', 'tah.position');
        const startLeft = savedPos?.left ?? HUD_LEFT;
        const startTop  = savedPos?.top  ?? HUD_TOP;
        const hud = $(`<div id="la-hud" style="position:fixed;left:${startLeft}px;top:${startTop}px;z-index:70;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));"></div>`);
        if (animate)
            hud.css({ opacity: 0, left: startLeft - 18 });
        hud.append(c1);
        $('body').append(hud);
        this._el = hud;
        if (animate)
            hud.animate({ opacity: 1, left: startLeft }, 350);

        // Lock / drag / reset controls
        let unlocked = false;
        const lockBtn = $(`<span class="la-hud-lock" title="Unlock to drag" style="cursor:pointer;font-size:0.75em;opacity:0;margin-left:auto;padding:0 2px;filter:grayscale(1) brightness(10);transition:opacity 0.15s;">🔒</span>`);
        const resetBtn = $(`<span class="la-hud-reset" title="Reset position" style="cursor:pointer;font-size:0.7em;opacity:0;margin-left:2px;padding:0 2px;color:#fff;transition:opacity 0.15s;">↺</span>`);
        titleEl.css({ display: 'flex', alignItems: 'stretch' });
        lockBtn.css({ display: 'flex', alignItems: 'center' });
        resetBtn.css({ display: 'flex', alignItems: 'center' });
        titleEl.append(lockBtn).append(resetBtn);

        // Disposition / team stripe + expanding detail — appended LAST so it's at the far right edge
        if (_dispColor && _dispLabel) {
            const _r = parseInt(_dispColor.slice(1, 3), 16) || 0;
            const _g = parseInt(_dispColor.slice(3, 5), 16) || 0;
            const _b = parseInt(_dispColor.slice(5, 7), 16) || 0;
            const _textColor = (_r * 0.299 + _g * 0.587 + _b * 0.114) > 150 ? '#111' : '#fff';
            const dispDetail = $(`<div class="la-disp-detail" style="display:none;overflow:hidden;background:${_dispColor};padding:0;white-space:nowrap;align-items:center;justify-content:center;"><span style="font-size:0.85em;letter-spacing:0.5px;color:${_textColor};font-weight:bold;margin:0 20px 0 12px;">${_dispLabel.toUpperCase()}</span></div>`);
            const dispToggle = $(`<div class="la-disp-toggle" style="cursor:pointer;user-select:none;width:10px;background:${_dispColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span style="font-size:0.55em;color:${_textColor};font-weight:bold;line-height:1;">▶</span></div>`);
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
            dispToggle.on('mouseenter', openDisp);
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

        // Title bar hover/click — must be after lockBtn/resetBtn creation
        const nameSpan = titleEl.find('.la-hud-token-name');
        nameSpan.on('mouseenter', () => {
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

        // c2 and c3 are absolutely positioned — never affect c1's layout
        const c2 = this._makeCol('');
        const c3 = this._makeCol('');
        const c4 = this._makeCol('');
        c1.css({ position: 'relative', zIndex: 4 });
        c2.css({ position: 'absolute', top: 0, left: c1.outerWidth(), display: 'none', zIndex: 3 });
        c3.css({ position: 'absolute', top: 0, left: 0,                   display: 'none', zIndex: 2 });
        c4.css({ position: 'absolute', top: 0, left: 0,                   display: 'none', zIndex: 1 });
        hud.append(c2, c3, c4);
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
                c2.find('.la-hud-col-label').text(/** @type {any} */ (cat).colLabel);
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
                const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: TEXT_DEFAULT }).removeClass('la-hud-active');
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
        hud.on('mouseleave', () => {
            if (!clickToOpen) {
                _clearC1Active();
                _scheduleCollapse();
            }
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
                    _clearC1Active();
                    $('.la-hud-popup').stop(true).animate({ opacity: 0 }, 120, function() {
                        $(this).remove();
                    });
                }
            });
        }
        // Title / stats / menu-label area is above the item list — hovering it closes open columns
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
        searchBar.on('input', () => {
            const q = String(searchBar.val()).trim().toLowerCase();
            if (!q) {
                this._searchActive = false;
                closeCol(c2); return;
            }
            this._searchActive = true;
            _cancelCollapse();
            openSearchResults(c2, collectSearchResults(q, this._categories), { el: this._el, makeRow: (...a) => this._makeRow(...a), token: this._token, brighten, S_MUTED });
        });
        searchBar.on('keydown', (ev) => {
            if (ev.key === 'Escape')
                searchIcon.trigger('click');
        });
        searchBar.on('focus', () => _cancelCollapse());
    }

    // ── Generic column populator ──────────────────────────────────────────────
    // col       — jQuery element to populate
    // items     — Item[] (see shape above)
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

    /** Returns the two highlight color props for a destroyed/unavailable status object. */
    _statusColors(/** @type {any} */ status) {
        return {
            highlightBg:          status.destroyed ? '#ffcccc' : status.unavailable ? '#ffe5b4' : null,
            highlightBorderColor: status.destroyed ? '#cc3333' : status.unavailable ? '#cc7700' : null,
        };
    }

    /** Builds the standard effect + description + tags HTML for a system/item detail popup body. */
    _bodyHtml(/** @type {any} */ sys) {
        const effect = sys?.effect ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;margin-bottom:4px;">${laFormatDetailHtml(sys.effect)}</div>` : '';
        return laRenderTags(sys?.tags ?? []) + effect;
    }

    /**
     * Factory for simple executeSimpleActivation rows.
     * Auto-generates onClick, broadcastFn, and onRightClick from one action definition.
     * @param {string} label
     * @param {string|null} icon
     * @param {{ name: string, activation: string, [key: string]: any }} action
     * @param {string} detail
     * @returns {object}
     */
    _simpleItem(label, icon, action, detail) {
        return {
            label,
            icon,
            onClick:      () => executeSimpleActivation(this._actor, { title: action.name, action, detail }),
            broadcastFn:  (_t, a) => executeSimpleActivation(a, { title: action.name, action, detail }),
            onRightClick: this._actionPopup({ ...action, detail }),
        };
    }

    // anchorRow — the parent row this column aligns with vertically

    _openCol(col, items, anchorRow, { reposition = true } = {}) {
        const filteredItems = this._filterIntersect(items);
        col.children(':not(.la-hud-col-label)').remove();
        // Use page-relative offset minus hud offset so the result is correct
        // regardless of which column anchorRow lives in (c1 or c2).
        if (reposition && anchorRow) {
            const topInHud = anchorRow.offset().top - this._el.offset().top - 18;
            col.css({ top: topInHud });
        }

        if (!filteredItems.length) {
            col.append(`<div style="${S_MUTED}height:30px;box-sizing:border-box;display:flex;align-items:center;">Empty</div>`);
            return;
        }

        for (const item of filteredItems) {
            if (item.isSectionLabel) {
                const iconHtml = item.icon ? laHudRenderIcon(item.icon) : '';
                col.append(`<div style="${S_COL_LABEL};display:flex;align-items:center;">${iconHtml}${item.label}</div>`);
                continue;
            }
            if (item.inputCell) {
                const S_BTN  = 'color:#111;cursor:pointer;font-size:0.7em;line-height:1;padding:0 3px;flex-shrink:0;user-select:none;';
                const S_LBL  = 'flex:1;overflow:hidden;min-width:0;';
                const S_PAN  = 'display:inline-block;white-space:nowrap;padding-right:8px;';
                const hasMax  = item.max != null;
                const noColor = !!item.noColor;
                const min     = item.min ?? (hasMax ? 0 : -Infinity);
                const max     = item.max ?? Infinity;
                const iconHtml = item.icon ? laHudRenderIcon(item.icon) : '';
                const valColor = (v) => noColor ? '#111' : hasMax ? (v <= 0 ? '#c33' : v < max ? '#cc7700' : '#3a9e6e') : '#111';
                const restingBg = (v) => noColor ? BG_DEFAULT : hasMax ? (v <= 0 ? '#ffcccc' : v < max ? '#ffe5b4' : BG_DEFAULT) : BG_DEFAULT;
                const borderColor = (v) => noColor ? 'var(--primary-color)' : hasMax ? (v <= 0 ? '#cc3333' : v < max ? '#cc7700' : 'var(--primary-color)') : 'var(--primary-color)';
                const S_CELL = `${S_ITEM}justify-content:space-between;gap:6px;cursor:default;min-width:220px;`;
                let cell;
                if (item.subtype === 'increment') {
                    let cur = item.getValue();
                    const valText = item.formatValue ? () => item.formatValue(cur) : () => hasMax ? `${cur}/${max}` : `${cur}`;
                    const S_VAL  = `min-width:22px;text-align:center;font-weight:600;font-size:1em;color:${valColor(cur)};`;
                    cell = $(`<div style="${S_CELL}background:${restingBg(cur)};border-left-color:${borderColor(cur)};">${iconHtml}<span class="la-hud-clip" style="${S_LBL}"><span class="la-hud-pan" style="${S_PAN}">${item.name}</span></span><div style="display:flex;align-items:center;gap:4px;"><span class="la-dec-btn" style="${S_BTN}">◄</span><span class="la-inc-val" style="${S_VAL}">${valText()}</span><span class="la-inc-btn" style="${S_BTN}">►</span></div></div>`);
                    const step = item.step ?? 1;
                    const suppress = () => {
                        this._suppressRefreshDepth++; setTimeout(() => this._suppressRefreshDepth--, 300);
                    };
                    const updateDisplay = () => {
                        cell.find('.la-inc-val').css('color', valColor(cur)).text(valText()); cell.data('restingBg', restingBg(cur)).css('borderLeftColor', borderColor(cur));
                    };
                    cell.find('.la-dec-btn').on('click', (ev) => {
                        ev.stopPropagation(); if (cur <= min)
                            return; suppress(); cur = Math.max(min, cur - step); item.onValueChanged(cur); updateDisplay();
                    });
                    cell.find('.la-inc-btn').on('click', (ev) => {
                        ev.stopPropagation(); if (cur >= max)
                            return; suppress(); cur = Math.min(max, cur + step); item.onValueChanged(cur); updateDisplay();
                    });
                    cell.data('restingBg', restingBg(cur));
                } else if (item.subtype === 'toggle') {
                    let on = !!item.getValue();
                    const onColor = 'var(--primary-color)';
                    const offColor = '#666';
                    const switchHtml = `<span class="la-toggle-switch" style="display:inline-block;width:28px;height:14px;border-radius:2px;background:${on ? onColor : offColor};position:relative;cursor:pointer;transition:background 0.15s;flex-shrink:0;"><span class="la-toggle-knob" style="position:absolute;top:1px;left:${on ? '14px' : '1px'};width:13px;height:12px;border-radius:1px;background:#fff;transition:left 0.15s;"></span></span>`;
                    cell = $(`<div style="${S_CELL}">${iconHtml}<span class="la-hud-clip" style="${S_LBL}"><span class="la-hud-pan" style="${S_PAN}">${item.name}</span></span>${switchHtml}</div>`);
                    cell.find('.la-toggle-switch').on('click', async (ev) => {
                        ev.stopPropagation();
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
                    cell = $(`<div style="${S_CELL}">${iconHtml}<span class="la-hud-clip" style="${S_LBL}"><span class="la-hud-pan" style="${S_PAN}">${item.name}</span></span><input type="number" class="la-type-val" value="${item.getValue()}" style="width:44px;text-align:center;background:#fff;border:1px solid #bbb;color:#111;font-size:0.9em;padding:2px 4px;"></div>`);
                    cell.find('.la-type-val').on('change', (ev) => {
                        ev.stopPropagation(); const v = Number.parseInt(/** @type {HTMLInputElement} */(ev.target).value, 10); if (!Number.isNaN(v))
                            item.onValueChanged(v);
                    }).on('click mousedown', (ev) => ev.stopPropagation());
                    cell.data('restingBg', BG_DEFAULT);
                }
                cell.on('mouseenter', () => {
                    this._cancelCollapse?.(); cell.css({ background: BG_HOVER });
                    const clip = cell.find('.la-hud-clip')[0]; const pan = cell.find('.la-hud-pan')[0];
                    if (clip && pan) {
                        const overflow = pan.scrollWidth - clip.clientWidth; if (overflow > 4)
                            $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                    }
                });
                cell.on('mouseleave', () => {
                    cell.css({ background: cell.data('restingBg') ?? BG_DEFAULT }); cell.find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
                });
                col.append(cell);
                continue;
            }
            const rawChildren = item.getChildren ? item.getChildren() : null;
            const hasChildren = rawChildren !== null || !!item.isLogPanel;
            const childCount = hasChildren && rawChildren ? rawChildren.length : 0;
            const row = this._makeRow(item.label, hasChildren, item.icon, item.activation ?? null, item.badge ?? null, item.badgeColor ?? null, childCount);

            // if (hasChildren && rawChildren !== null && !rawChildren.length)
            //     row.css({ opacity: 0.9 });

            if (item.highlightBg) {
                const borderColor = item.highlightBorderColor ?? '#3a78b5';
                row.data('restingBg', item.highlightBg);
                row.data('restingBorder', borderColor);
                row.data('hoverBg', brighten(item.highlightBg));
                row.css({ background: item.highlightBg, borderLeftColor: borderColor });
            }

            if (col !== this._c4 && !this._clickToOpen) {
                row.on('mouseenter', () => {
                    $('.la-hud-popup').remove();
                    if (item.isLogPanel) {
                        if (this._statusPanelInstance?.isVisible)
                            this._statusPanelInstance.close();
                        col.find('.la-hud-active').each(function() {
                            const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: TEXT_DEFAULT }).removeClass('la-hud-active');
                        });
                        closeCol(this._c3, 80);
                        closeCol(this._c4, 80);
                        this._logPanelInstance?.open(row);
                        return;
                    }
                    if (this._logPanelInstance?.isVisible)
                        this._logPanelInstance.close();
                    if (col === this._c2 && !hasChildren) {
                        col.find('.la-hud-active').each(function() {
                            const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: TEXT_DEFAULT }).removeClass('la-hud-active');
                        });
                        closeCol(this._c3, 80);
                        closeCol(this._c4, 80);
                    } else if (col === this._c3 && !hasChildren) {
                        col.find('.la-hud-active').each(function() {
                            const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: TEXT_DEFAULT }).removeClass('la-hud-active');
                        });
                        closeCol(this._c4, 80);
                    }
                });
            }

            if (item.onClick) {
                row.on('click', async () => {
                    if (!item.keepOpen) {
                        row.trigger('mouseleave');
                        closeCol(this._c2);
                        closeCol(this._c3);
                        closeCol(this._c4);
                        this._clearC1Active();
                    }
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
                    if (this._tokens.length > 1 && item.broadcastFn) {
                        for (const t of this._tokens.slice(1)) {
                            try {
                                await item.broadcastFn(t, t.actor);
                            } catch(e) {
                                console.error('[TAH broadcast]', e);
                            }
                        }
                    }
                });
            }
            if (item.onRightClick) {
                row.attr('title', 'Right click for details');
                row.on('contextmenu', ev => {
                    ev.preventDefault();
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
            if (hasChildren && !item.isLogPanel) {
                const openChild = () => {
                    if (col === this._c2 && row.hasClass('la-hud-active') && this._c3.is(':visible')) {
                        if (this._clickToOpen) {
                            closeCol(this._c3);
                            closeCol(this._c4);
                            row.css({ background: row.data('restingBg') ?? BG_DEFAULT, color: TEXT_DEFAULT }).removeClass('la-hud-active');
                        } else {
                            this._cancelCollapse();
                        }
                        return;
                    }
                    if (col === this._c3 && row.hasClass('la-hud-active') && this._c4.is(':visible')) {
                        if (this._clickToOpen) {
                            closeCol(this._c4);
                            row.css({ background: row.data('restingBg') ?? BG_DEFAULT, color: TEXT_DEFAULT }).removeClass('la-hud-active');
                        } else {
                            this._cancelCollapse();
                        }
                        return;
                    }
                    this._setActive(col, row);
                    if (col === this._c2) {
                        closeCol(this._c4, 80);
                        this._openChildCol(col, this._c3, item, rawChildren, row);
                    } else if (col === this._c3) {
                        this._c4AnchorRow = row;
                        this._openChildCol(this._c3, this._c4, item, rawChildren, row);
                    }
                };
                if (this._clickToOpen)
                    row.on('click', openChild);
                else
                    row.on('mouseenter', openChild);
            }

            col.append(row);
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

    // ── Category list — reorder these lines to reorder the HUD ──────────────
    _buildCategories() {
        const types        = this._tokens.map(t => t.actor?.type);
        const isMech       = types.every(t => t === 'mech');
        const isDeployable = types.every(t => t === 'deployable');
        const isPilot      = types.every(t => t === 'pilot');
        const isNpc        = types.every(t => t === 'npc');
        return [
            this._catAttacks(),
            ...(isDeployable ? [] : [this._catWeapons()]),
            this._catTech(),
            this._catActions(),
            ...(isDeployable || isPilot ? [] : [this._catDeployables()]),
            ...(isMech ? [this._catSystems()] : isNpc ? [this._catNpcSystems()] : []),
            ...(isMech ? [this._catFrame()]   : isNpc ? [this._catNpcFrame()]   : []),
            ...(isMech ? [this._catTalents()] : []),
            this._catSkills(),
            this._catUtility(),
            this._catStatuses(),
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
                    childColLabel: 'Quick',
                    getChildren: () => [
                        //{ isSectionLabel: true, label: 'Quick' },
                        ...(/** @type {any} */ (this._catQuickActions().getItems().find(i => i.label === 'Basic'))?.getChildren?.() ?? []),
                        { isSectionLabel: true, label: 'Full' },
                        ...(/** @type {any} */ (this._catFullAction().getItems().find(i => i.label === 'Basic'))?.getChildren?.() ?? []),
                    ],
                },
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
                { label: 'Resources', childColLabel: 'Resources', getChildren: () => (items => items.length ? items : [])(this._resourceItems()) },
                { label: 'Ammo', childColLabel: 'Ammo', getChildren: () => this._ammoItems() },
            ],
        };
    }

    _catActionsDeployable(/** @type {any} */ actor) {
        const sys = actor.system;
        const items = [];

        // Main activation action (the deployable itself)
        if (sys.activation) {
            items.push({
                label: 'Activation',
                icon: getActivationIcon(sys.activation),
                hoverData: { actor, item: null, action: { name: sys.activation, activation: sys.activation }, category: 'Actions' },
                onClick: () => executeSimpleActivation(actor, { title: sys.activation, action: { name: sys.activation, activation: sys.activation }, detail: sys.detail ?? '' }),
                onRightClick: this._actionPopup({ name: sys.activation, activation: sys.activation, detail: sys.detail ?? '' }),
            });
        }

        // Recall action (direct — no dialog, just delete this token)
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
        return {
            label: 'Actions',
            colLabel: 'Actions',
            getItems: () => [
                { label: 'Reload', icon: 'modules/lancer-automations/icons/reload.svg', onClick: () => reloadOneWeapon(token), broadcastFn: (t) => reloadOneWeapon(t), onRightClick: ap({ name: 'Reload', activation: 'Quick', detail: 'Reload one Loading weapon.' }) },
                this._simpleItem('Mount',  'systems/lancer/assets/icons/white/mech.svg', { name: 'Mount',  activation: 'Full' }, 'You can MOUNT as a full action. You must be adjacent your mech to MOUNT.\nAdditionally, you can also MOUNT willing allied mechs or vehicles. When you do so, move into the same space and then move with them.'),
                this._simpleItem('Jockey', 'modules/lancer-automations/icons/ram.svg',   { name: 'Jockey', activation: 'Full' }, 'To JOCKEY, you must be adjacent to a mech. As a full action, make a contested skill check using GRIT. The mech contests with HULL. On a success, climb onto the mech, sharing its space.\nChoose one: DISTRACT (mech is IMPAIRED and SLOWED), SHRED (deal 2 heat), or DAMAGE (deal 4 kinetic damage).'),
                ...this._getActionsByActivation(actor, 'Quick', 'Actions'),
                ...this._getActionsByActivation(actor, 'Full', 'Actions'),
                ...this._catReactions().getItems(),
                ...this._catProtocols().getItems(),
                ...this._catFreeActions().getItems(),
            ],
        };
    }

    _catDeployables() {
        const actor = this._actor;
        const token = this._token;

        // Mechs: only show deployables from equipped items (avoids unequipped systems).
        // Loadout entries can be raw ID strings or resolved {id,status,value} objects — handle both.
        // Include systems + frame + weapons so frame-integrated deployables are also shown.
        // NPCs and others: use all actor.items (no loadout concept).
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
                        toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: dep.name, subtitle: `Deployable · ${item.name}${srcType ? ` (${srcType})` : ''}`, bodyHtml: laRenderDeployables([dep]), theme: 'deployable', item, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
                    },
                });
            }
        }

        return {
            label: 'Deployables',
            colLabel: 'Tools',
            getItems: () => [
                { label: 'Deploy Item', icon: 'systems/lancer/assets/icons/deployable.svg', onClick: () => openDeployableMenu(actor) },
                { label: 'Recall Item', icon: 'modules/lancer-automations/icons/up-card.svg',     onClick: () => recallDeployable(token) },
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
            getItems: () => [
                ...(actor.type === 'mech' || actor.type === 'npc' ? [
                    { label: 'Skirmish',          icon: 'mdi mdi-hexagon-slice-3', onClick: () => executeSkirmish(actor),    broadcastFn: (t, a) => executeSkirmish(a),    onRightClick: ap({ name: 'Skirmish',          activation: 'Quick', detail: 'Make one attack with a single weapon.' }) },
                    { label: 'Barrage',           icon: 'mdi mdi-hexagon-slice-6',  onClick: () => executeBarrage(actor),     broadcastFn: (t, a) => executeBarrage(a),     onRightClick: ap({ name: 'Barrage',           activation: 'Full',  detail: 'Make two attacks, each with a different weapon, or two attacks with the same weapon. You may also make one attack with a SUPERHEAVY weapon.' }) },
                    this._simpleItem('Ram',     'mdi mdi-hexagon-slice-3', { name: 'Ram',     activation: 'Quick' }, 'Make a melee attack against an adjacent character the same SIZE or smaller than you. On a success, your target is knocked PRONE and you may also choose to knock them back by one space, directly away from you.'),
                    this._simpleItem('Grapple', 'mdi mdi-hexagon-slice-3', { name: 'Grapple', activation: 'Quick' }, 'Perform a melee attack to grapple a target, end an existing grapple, or break free from a grapple.'),
                    { label: 'Improvised Attack', icon: 'mdi mdi-hexagon-slice-6',  onClick: () => executeBasicAttack(actor), broadcastFn: (t, a) => executeBasicAttack(a), onRightClick: ap({ name: 'Improvised Attack', activation: 'Full',  detail: 'Make a melee or ranged attack using a non-weapon object or piece of terrain. On a hit, deal 1d6 AP kinetic damage.' }) },
                ] : []),
                ...(actor.type === 'pilot' ? [
                    { label: 'Fight', icon: 'systems/lancer/assets/icons/white/melee.svg', onClick: () => executeFight(actor), broadcastFn: (t, a) => executeFight(a), onRightClick: ap({ name: 'Fight', activation: 'Full', detail: 'Make a melee or ranged attack with a pilot weapon.' }) },
                ] : []),
                { isSectionLabel: true, label: 'Tools' },
                { label: 'Basic Attack',  icon: 'systems/lancer/assets/icons/mech_weapon.svg', onClick: () => executeBasicAttack(actor), broadcastFn: (t, a) => executeBasicAttack(a) },
                { label: 'Damage',        icon: 'systems/lancer/assets/icons/melee.svg',       onClick: () => executeDamageRoll(token, [...(game.user?.targets ?? [])], '0', 'Kinetic') },
                { label: 'Throw Weapon',  icon: 'systems/lancer/assets/icons/thrown.svg',      onClick: () => openThrowMenu(actor),    broadcastFn: (t, a) => openThrowMenu(a) },
                { label: 'Pickup Weapon', icon: 'modules/lancer-automations/icons/pickup.svg', onClick: () => pickupWeaponToken(token), broadcastFn: (t) => pickupWeaponToken(t), keepOpen: true },
            ].map(it => it.isSectionLabel || !it.onClick
                ? it
                : { ...it, hoverData: { actor, item: null, action: { name: it.label }, category: 'Attacks' } }),
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
                    getChildren: () => [
                        { label: 'Basic Tech', icon: ICON_TECH_QUICK, onClick: () => executeTechAttack(actor, { title: 'Basic Tech', grit: actor.system?.tech_attack, attack_type: 'Tech' }), onRightClick: ap({ name: 'Basic Tech', activation: 'Quick Tech', tech_attack: true, detail: 'Roll your TECH ATTACK against one target\'s E-DEFENSE. On a success, deal 1d3 heat to the target.' }) },
                        { label: 'Scan',       icon: ICON_TECH_QUICK, onClick: () => executeSimpleActivation(actor, { title: 'Scan',     action: { name: 'Scan',     activation: 'Quick' }, detail: 'Choose a character within SENSORS and line of sight. Make a tech attack against them. On a success, you discover all of their statistics (HP, Heat, Armor, Speed, Evasion, E-Defense, and all talent ranks, system and weapon loadouts, traits, and core systems).' }), onRightClick: ap({ name: 'Scan',     activation: 'Quick Tech', tech_attack: true, detail: 'Choose a character within SENSORS and line of sight. Make a tech attack against them. On a success, you discover all of their statistics (HP, Heat, Armor, Speed, Evasion, E-Defense, and all talent ranks, system and weapon loadouts, traits, and core systems).' }) },
                        { label: 'Lock On',    icon: ICON_TECH_QUICK, onClick: () => executeSimpleActivation(actor, { title: 'Lock On',  action: { name: 'Lock On',  activation: 'Quick' }, detail: 'Choose a character within SENSORS and line of sight. They gain the LOCK ON condition. Any character making an attack against a character with LOCK ON may choose to gain +1 Accuracy on that attack and then clear the LOCK ON condition after that attack resolves.' }),  onRightClick: ap({ name: 'Lock On',  activation: 'Quick Tech', tech_attack: true, detail: 'Choose a character within SENSORS and line of sight. They gain the LOCK ON condition. Any character making an attack against a character with LOCK ON may choose to gain +1 Accuracy on that attack and then clear the LOCK ON condition after that attack resolves.' }) },
                        { label: 'Bolster',    icon: ICON_TECH_QUICK, onClick: () => executeSimpleActivation(actor, { title: 'Bolster',  action: { name: 'Bolster',  activation: 'Quick' }, detail: 'Choose a character within SENSORS. They receive +2 Accuracy on the next skill check or save they make between now and the end of their next turn. Characters can only benefit from one BOLSTER at a time.' }),                                                              onRightClick: ap({ name: 'Bolster',  activation: 'Quick Tech', tech_attack: true, detail: 'Choose a character within SENSORS. They receive +2 Accuracy on the next skill check or save they make between now and the end of their next turn. Characters can only benefit from one BOLSTER at a time.' }) },
                        { label: 'Invade',     icon: ICON_TECH_QUICK, onClick: () => executeInvade(actor),                                                                                                                                                                                                                                                                                                                                                                       onRightClick: ap({ name: 'Invade',   activation: 'Full Tech',  tech_attack: true, detail: 'Make a tech attack against a target. On success, choose one of the available Invade options.' }) },
                    ].map(it => ({ ...it, hoverData: { actor, item: null, action: { name: it.label }, category: 'Tech' } })),
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
                label: opt.destroyed ? `<s class="horus--subtle" style="opacity:0.7;color:#e50000;">${opt.name}</s>` : opt.name,
                icon: 'modules/lancer-automations/icons/cpu-shot.svg',
                ...this._statusColors(opt),
                hoverData: { actor, item: opt.item ?? null, action: opt.action ?? { name: opt.name, activation: 'Invade' }, category: 'Tech' },
                onClick: () => executeInvade(actor, opt),
                onRightClick: (row) => {
                    const detail = laFormatDetailHtml(opt.detail);
                    const bodyHtml = detail ? `<div style="margin:0;font-size:0.82em;line-height:1.5;">${detail}</div>` : '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
                    const isWeapon = opt.item?.type?.includes('weapon');
                    const sourceType  = isWeapon ? ' (Weapon)' : (opt.item?.system?.type ? ` (${opt.item.system.type})` : '');
                    const sourceLabel = !opt.isFragmentSignal && opt.item?.name ? ` · ${opt.item.name}${sourceType}` : '';
                    const subtitle = (opt.isFragmentSignal ? 'Fragment Signal · Quick Tech' : 'Invade · Quick Tech') + sourceLabel;
                    toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-invade-popup', dataKey: 'invade-name', dataValue: opt.name, title: opt.name, theme: 'invade', subtitle, bodyHtml, item: opt.item, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
                },
            })),
        };
    }

    _catQuickActions() {
        const actor = this._actor;
        const ap = a => this._actionPopup(a);
        const basicChildren = () => {
            const items = [
                this._simpleItem('Boost',     'modules/lancer-automations/icons/speedometer.svg',  { name: 'Boost',     activation: 'Quick'          }, 'This allows you to make an extra movement, on top of your standard move. Certain talents and systems can only be used when you BOOST, not when you make a standard move.'),
                ...(actor.type !== 'npc' ? [this._simpleItem('Aid', 'modules/lancer-automations/icons/medical-pack.svg', { name: 'Aid', activation: 'Quick' }, 'You assist a mech so it can Stabilize more easily. Choose an adjacent character. On their next turn, they may Stabilize as a quick action. They can choose to take this action even if they normally would not be able to take actions (for example, by being affected by the Stunned condition).')] : []),
                this._simpleItem('Hide',      'systems/lancer/assets/icons/status_hidden.svg',     { name: 'Hide',      activation: 'Quick'          }, 'Obscure the position of your mech, becoming HIDDEN and unable to be identified, precisely located, or be targeted directly by attacks or hostile actions.'),
                this._simpleItem('Search',    'modules/lancer-automations/icons/search.svg',       { name: 'Search',    activation: 'Quick'          }, 'Choose a character within your SENSORS that you suspect is HIDDEN and make a contested SYSTEMS check against their AGILITY. This can be used to reveal characters within RANGE 5. Once a HIDDEN character has been found, they immediately lose HIDDEN.'),
                this._simpleItem('Shut Down', 'systems/lancer/assets/icons/status_shutdown.svg',   { name: 'Shut Down', activation: 'Quick'          }, 'Shut down your mech as a desperate measure, to end system attacks, regain control of AI, and cool your mech. The mech is STUNNED until rebooted via the BOOT UP action.'),
                this._simpleItem('Handle',    'modules/lancer-automations/icons/hand-truck.svg',   { name: 'Handle',    activation: 'Protocol/Quick' }, 'As a protocol or quick action, start to handle an adjacent object or willing character by lifting or dragging them. Mechs can drag characters or objects up to twice their SIZE but are SLOWED while doing so. They can also lift characters or objects of equal or lesser SIZE overhead but are IMMOBILIZED while doing so.'),
                this._simpleItem('Interact',  'modules/lancer-automations/icons/click.svg',        { name: 'Interact',  activation: 'Protocol/Quick' }, 'Manipulate an object in some way, such as pushing a button, knocking it over, or ripping out wires. You may only Interact 1/turn. If no hostile characters are adjacent to the object, you automatically succeed. Otherwise, make a contested skill check.'),
                this._simpleItem('Prepare',   'modules/lancer-automations/icons/light-bulb.svg',   { name: 'Prepare',   activation: 'Quick'          }, 'Prepare any other Quick Action and specify a valid trigger in the form "When X then Y". Until the start of your next turn, when it is triggered, you can take this action as a Reaction. While holding a Prepared Action, you may not move or perform any other actions or Reactions.'),
                this._simpleItem('Eject',     'modules/lancer-automations/icons/parachute.svg',    { name: 'Eject',     activation: 'Quick'          }, 'EJECT as a quick action, flying 6 spaces in the direction of your choice; however, this is a single-use system for emergency use only – it leaves your mech IMPAIRED. Your mech remains IMPAIRED and you cannot EJECT again until your next FULL REPAIR.'),
                { label: 'Standing Up', icon: 'modules/lancer-automations/icons/underhand.svg', onClick: () => executeStandingUp(this._token), broadcastFn: (_t, a) => executeStandingUp(a.getActiveTokens()?.[0]), onRightClick: ap({ name: 'Standing Up', activation: 'Movement', detail: 'Stand up instead of taking your standard move. Removes Prone and grants +Speed movement.' }) },
                { label: 'Teleport', icon: 'modules/lancer-automations/icons/teleport.svg', onClick: () => executeTeleport(this._token), broadcastFn: (_t, a) => executeTeleport(a.getActiveTokens()?.[0]), onRightClick: ap({ name: 'Teleport', activation: 'Movement', detail: 'Teleport to a destination within your speed range. Costs speed in movement.' }) },
            ];
            if (actor.type === 'mech')
                items.push({ label: 'Self Destruct', icon: 'modules/lancer-automations/icons/time-bomb.svg', onClick: () => /** @type {any} */ (executeReactorMeltdown(actor)), broadcastFn: (_t, a) => executeReactorMeltdown(a), onRightClick: ap({ name: 'Self Destruct', activation: 'Quick', detail: 'Trigger a reactor meltdown. Your mech will explode at the end of your next turn or immediately if you choose to EJECT.' }) });
            return items.map(it => ({ ...it, hoverData: { actor, item: null, action: { name: it.label }, category: 'Actions' } }));
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
                this._simpleItem('Dismount',  'modules/lancer-automations/icons/dismount.svg',  { name: 'Dismount',  activation: 'Full' }, 'When you DISMOUNT, you climb off of a mech. You can DISMOUNT as a full action. When you DISMOUNT, you are placed in an adjacent space – if there are no free spaces, you cannot DISMOUNT. Additionally, you can also DISMOUNT willing allied mechs or vehicles you have MOUNTED.'),
            ];
            if (actor.type === 'mech' || actor.type === 'npc')
                items.push({ label: 'Stabilize', icon: 'systems/lancer/assets/icons/repair.svg', onClick: () => /** @type {any} */ (actor.beginStabilizeFlow()), broadcastFn: (_t, a) => /** @type {any} */ (a).beginStabilizeFlow(), onRightClick: ap({ name: 'Stabilize', activation: 'Full', detail: 'To STABILIZE, choose ONE of these two items: \r &bull; Cool your mech (clearing all heat and ending the EXPOSED status); \r &bull; Spend ONE Repair to heal your mech to max HP. \r \n Additionally, choose ONE the following four items: \r &bull; Reload all LOADING weapons on your mech; \r &bull; Clear any burn on your mech; \r &bull; Clear ONE condition from yourself NOT caused by your own systems/talents (etc); \r &bull; Clear ONE condition from an ADJACENT ally NOT caused by their own systems/talents (etc).' }) });
            return items.map(it => ({ ...it, hoverData: { actor, item: null, action: { name: it.label }, category: 'Actions' } }));
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
                const isDeployable = actor.type === 'deployable' || actor.type === 'pilot';
                const items = [
                    ...(isDeployable ? [] : [
                        { ...this._simpleItem('Brace',     'modules/lancer-automations/icons/brace.svg', { name: 'Brace',     activation: 'Reaction' }, 'You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.'), highlightBg: reactionAvail ? null : unavailBg, highlightBorderColor: reactionAvail ? null : unavailBorder },
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
                return items.map(it => /** @type {any} */ (it).hoverData || /** @type {any} */ (it).isSectionLabel || !it.onClick ? it : { ...it, hoverData: { actor, item: null, action: { name: it.label }, category: 'Actions' } });
            },
        };
    }

    _catProtocols() {
        const actor = this._actor;
        const ap = a => this._actionPopup(a);
        return {
            label: 'Protocols',
            colLabel: 'Protocols',
            getItems: () => [
                ...this._getActionsByActivation(actor, 'Protocol', 'Actions'),
            ].map(it => /** @type {any} */ (it).hoverData || !it.onClick ? it : { ...it, hoverData: { actor, item: null, action: { name: it.label }, category: 'Actions' } }),
        };
    }

    _catFreeActions() {
        const actor = this._actor;
        return {
            label: 'Free Actions',
            colLabel: 'Free Actions',
            getItems: () => [
                ...(actor.type === 'mech' ? [{ label: 'Overcharge', icon: 'systems/lancer/assets/icons/overcharge.svg', onClick: () => /** @type {any} */ (actor.beginOverchargeFlow()), broadcastFn: (_t, a) => /** @type {any} */ (a).beginOverchargeFlow(), onRightClick: this._actionPopup({ name: 'Overcharge', activation: 'Free', detail: 'Each time you OVERCHARGE, the next time you OVERCHARGE in the same scene, it deals more self-heat. The sequence is 1d3 heat, 1d6 heat, 1d6+4 heat. It resets at the start of your next scene.' }) }] : []),
                ...(actor.type !== 'deployable' ? [this._simpleItem('Squeeze', 'modules/lancer-automations/icons/contract.svg', { name: 'Squeeze', activation: 'Free' }, 'A character may squeeze as a free action, treating themselves as one Size smaller for the purposes of movement. While squeezing, the character is additionally treated as Prone. The character may stop squeezing as a free action while in a space able to accommodate their normal Size.')] : []),
                ...this._getActionsByActivation(actor, 'Free', 'Actions'),
            ].map(it => /** @type {any} */ (it).hoverData || !it.onClick ? it : { ...it, hoverData: { actor, item: null, action: { name: it.label }, category: 'Actions' } }),
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
                onClick: () => /** @type {any} */ (actor).beginStatFlow(`system.${s.key}`),
            }));

        const skillItems = [];
        if (!isNpc) {
            const pilot = actor.system.pilot?.value ?? actor;
            const skills = pilot.items?.filter(i => i.type === 'skill') ?? [];
            for (const skill of skills) {
                const bonus = (skill.system.curr_rank ?? 0) * 2;
                skillItems.push({
                    label: skill.name,
                    badge: `+${bonus}`,
                    badgeColor: '#777',
                    icon: skill.img ?? null,
                    hoverData: { actor, item: skill, action: { name: skill.name }, category: 'Skills' },
                    onClick: () => skill.beginSkillFlow?.(),
                });
            }
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
            label: 'Skills',
            colLabel: 'Skills',
            getItems: () => [
                { label: 'Stats',   childColLabel: 'Stats',   getChildren: () => statsItems },
                ...(skillItems.length ? [{ label: 'Skills', childColLabel: 'Skills', getChildren: () => skillItems }] : []),
            ],
        };
    }

    _catUtility() {
        const token = this._token;

        const actor = this._actor;
        const isMechOrNpc = actor?.type === 'mech' || actor?.type === 'npc';

        const combatItems = [
            { label: 'Start Turn',    onClick: () => /** @type {any} */ (game.combat)?.activateCombatant(/** @type {any} */ (token.document)?.combatant?.id) },
            { label: 'End Turn',      onClick: () => /** @type {any} */ (game.combat)?.nextTurn() },
            { label: token.document.hidden ? 'Reveal Token' : 'Hide Token', onClick: () => token.document.update({ hidden: !token.document.hidden }) },
            { label: token.inCombat ? 'Remove From Combat' : 'Add To Combat', onClick: () => /** @type {any} */ (token.document).toggleCombatant?.(!token.inCombat) },
            { label: 'Reinforcement', onClick: () => delayedTokenAppearance() },
        ];

        const gameplayItems = [
            { label: 'Full Repair',   icon: 'modules/lancer-automations/icons/auto-repair.svg',  onClick: () => /** @type {any} */ (actor)?.beginFullRepairFlow(), broadcastFn: (_t, a) => /** @type {any} */ (a).beginFullRepairFlow() },
            { label: 'Link to Token', icon: 'modules/lancer-automations/icons/pin.svg', onClick: async () => {
                const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
                const picked = await api?.chooseToken?.(token, { count: 1, includeSelf: false, title: 'LINK TO TOKEN', description: `Which token should ${token.name} be linked to?`, icon: 'cci cci-deployable' });
                if (!picked || !picked.length) return;
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
        ];

        const hasERHistory = game.modules.get('elevationruler')?.active
            && (() => {
                try {
                    return game.settings.get('elevationruler', 'token-ruler-combat-history');
                } catch {
                    return false;
                }
            })();
        const capEnabled = game.settings.get('lancer-automations', 'enableMovementCapDetection');

        const movementItems = [
            { label: 'Knockback',      icon: 'modules/lancer-automations/icons/push.svg', onClick: () => knockBackToken([token], -1, { title: 'KNOCKBACK', description: 'Place each token at its knockback destination.' }) },
            { label: 'Fall', icon: 'modules/lancer-automations/icons/falling.svg', onClick: () => executeFall(token) },
            // History tools: reset always available, revert only with ER history.
            { label: 'Reset History',  icon: 'modules/lancer-automations/icons/trash-can.svg', onClick: () => clearMovementHistory(token, false) },
            ...(hasERHistory ? [
                { label: 'Revert Last Movement', icon: 'modules/lancer-automations/icons/anticlockwise-rotation.svg', onClick: () => revertMovement(token) },
                { label: 'Revert All Movements', icon: 'modules/lancer-automations/icons/backward-time.svg', onClick: () => clearMovementHistory(token, true) },
            ] : []),
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
            toggleDetailPopup({
                cssClass: 'la-hud-popup',
                dataKey: 'range-breakdown',
                dataValue: rangeType,
                title: `${rangeType} Breakdown`,
                subtitle: actor.name,
                bodyHtml,
                theme: 'system',
                row,
                showPopupAt: (p, r) => this._showPopupAt(p, r),
            });
        };

        // Ranges section — persistent aura toggles.
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
                    const labelHtml = status.destroyed ? `<s class="horus--subtle" style="opacity:0.7;color:#e50000;">${item.name}</s>` : item.name;
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
                            const subtitle = [sys.type, sys.license ? `${sys.manufacturer} ${sys.license_level}` : null].filter(Boolean).join(' · ');
                            toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'system-id', dataValue: item.id, title: item.name, subtitle, bodyHtml, theme: 'system', item, row, showPopupAt: (p, r) => this._showPopupAt(p, r), postRender: p => appendItemPips(item, p) });
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
        if (sysActions.length <= 1) {
            const single = sysActions[0] ?? null;
            const actStr = single?.activation ?? (activationTag ? activationTag.lid.replace('tg_', '').replace('_action', ' action') : 'Activation');
            children.push({
                label: single?.name ?? item.name,
                icon: (single || activationTag) ? getActivationIcon(actStr) : 'systems/lancer/assets/icons/activate.svg',
                onClick: single ? () => /** @type {any} */ (item).beginActivationFlow('system.actions.0') : () => /** @type {any} */ (item).beginSystemFlow(),
                onRightClick: single ? ap(single)
                    : activationTag ? (/** @type {any} */ row) => {
                        const subtitle = [sys.type, sys.license ? `${sys.manufacturer} ${sys.license_level}` : null].filter(Boolean).join(' · ');
                        toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'sys-activate', dataValue: item.id, title: item.name, subtitle, bodyHtml: this._bodyHtml(sys), theme: 'system', item, row, showPopupAt: (p, r) => this._showPopupAt(p, r), postRender: /** @type {any} */ p => appendItemPips(item, p) });
                    }
                        : ap({ name: item.name, activation: 'Activation', detail: 'Default system activation.' }),
                hoverData: { actor, item, action: { name: item.name, activation: actStr }, category: 'Systems' },
            });
        } else {
            sysActions.forEach((action, idx) => {
                children.push({
                    label: action.name,
                    icon: getActivationIcon(action),
                    onClick: () => /** @type {any} */ (item).beginActivationFlow(`system.actions.${idx}`),
                    onRightClick: ap(action),
                    hoverData: { actor, item, action, category: 'Systems' },
                });
            });
        }
        const sysActionNames = new Set((sys.actions ?? []).map(/** @type {any} */ a => a.name));
        const invadeOpts = this._getInvadeOptions(actor).filter(opt => opt.item?.id === item.id && !sysActionNames.has(opt.name));
        for (const opt of invadeOpts) {
            children.push({
                label: opt.destroyed ? `<s class="horus--subtle" style="opacity:0.7;color:#e50000;">${opt.name}</s>` : opt.name,
                icon: ICON_TECH_QUICK,
                ...this._statusColors(opt),
                hoverData: { actor, item: opt.item ?? null, action: opt.action ?? { name: opt.name, activation: 'Invade' }, category: 'Tech' },
                onClick: () => executeInvade(actor, opt),
                onRightClick: (/** @type {any} */ row) => {
                    const detail = laFormatDetailHtml(opt.detail);
                    const bodyHtml = detail ? `<div style="margin:0;font-size:0.82em;line-height:1.5;">${detail}</div>` : '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
                    const isWeapon = opt.item?.type?.includes('weapon');
                    const sourceType  = isWeapon ? ' (Weapon)' : (opt.item?.system?.type ? ` (${opt.item.system.type})` : '');
                    const sourceLabel = opt.item?.name ? ` · ${opt.item.name}${sourceType}` : '';
                    toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-invade-popup', dataKey: 'invade-name', dataValue: opt.name, title: opt.name, theme: 'invade', subtitle: `Invade · Quick Tech${sourceLabel}`, bodyHtml, item: opt.item, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
                },
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
                        toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: dep.name, subtitle: `Deployable · ${item.name}${srcType ? ` (${srcType})` : ''}`, bodyHtml: laRenderDeployables([dep]), theme: 'deployable', item, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
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
                        toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-ammo-popup', dataKey: 'ammo-idx', dataValue: `${item.id}-${idx}`, title: ammo.name, subtitle: `Ammo · ${item.name}`, bodyHtml, theme: 'system', item, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
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
                const frameSubtitle = [sys.manufacturer, sys.license ? `LL${sys.license_level}` : null, ...(sys.mechtype ?? []), as.size != null ? `Size ${as.size}` : null].filter(Boolean).join(' · ');
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
                        onRightClick: (/** @type {any} */ row) => toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'frame-id', dataValue: frame.id, title: frame.name, subtitle: frameSubtitle, bodyHtml: currentStats + mountsHtml + baseStats, theme: 'frame', item: frame, row, showPopupAt: (p, r) => this._showPopupAt(p, r) }),
                    },
                    { label: 'Core Power',  childColLabel: 'Core Power',  getChildren: () => this._corePowerItems(frame, actor), onRightClick: (/** @type {any} */ row) => toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'core-system', dataValue: frame.id, title: frame.system?.core_system?.name ?? 'Core System', subtitle: frame.name, bodyHtml: laRenderCoreSystemBody(frame.system?.core_system), theme: 'frame', item: frame, row, showPopupAt: (p, r) => this._showPopupAt(p, r) }) },
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
                return rows;
            },
        };
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
                        onRightClick: (/** @type {any} */ row) => toggleDetailPopup({
                            cssClass: 'la-hud-popup la-hud-npcclass-popup',
                            dataKey: 'npcclass-id',
                            dataValue: npcClass.id,
                            title: npcClass.name,
                            subtitle: [
                                `Tier ${tierClamped}`,
                                npcClass.system?.role ? npcClass.system.role.charAt(0).toUpperCase() + npcClass.system.role.slice(1) : null,
                                as.size != null ? `Size ${as.size}` : (bs.size != null ? `Size ${bs.size}` : null),
                            ].filter(Boolean).join(' · '),
                            bodyHtml,
                            theme: 'frame',
                            item: npcClass,
                            row,
                            showPopupAt: (p, r) => this._showPopupAt(p, r),
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
                toggleDetailPopup({
                    cssClass: 'la-hud-popup la-hud-npctemplate-popup',
                    dataKey: 'npctemplate-id',
                    dataValue: tmpl.id,
                    title: tmpl.name,
                    subtitle: 'Template',
                    bodyHtml: desc,
                    theme: 'frame',
                    item: tmpl,
                    row,
                    showPopupAt: (p, r) => this._showPopupAt(p, r),
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
                    toggleDetailPopup({
                        cssClass: 'la-hud-popup la-hud-npctrait-popup',
                        dataKey: 'npctrait-id',
                        dataValue: feat.id,
                        title: feat.name,
                        subtitle: origin,
                        bodyHtml,
                        theme: 'trait',
                        item: feat,
                        row,
                        showPopupAt: (p, r) => this._showPopupAt(p, r),
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
                    const labelHtml = status.destroyed ? `<s class="horus--subtle" style="opacity:0.7;color:#e50000;">${item.name}</s>` : item.name;
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
                            toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-npcsys-popup', dataKey: 'npcsys-id', dataValue: item.id, title: item.name, subtitle: [actLabel ?? sys.type, origin].filter(Boolean).join(' · '), bodyHtml, theme: activation ? activationTheme(activation) : 'system', item, row, showPopupAt: (p, r) => this._showPopupAt(p, r), postRender: /** @type {any} */ p => appendItemPips(item, p) });
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
                            const eaBadge = action.recharge ? (charged ? '▣' : '□') : null;
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
                            toggleDetailPopup({
                                cssClass: 'la-hud-popup la-hud-npcsys-popup',
                                dataKey: 'npcsys-id',
                                dataValue: item.id,
                                title: item.name,
                                subtitle: [actLabel ?? sys.type, origin].filter(Boolean).join(' · '),
                                bodyHtml,
                                theme: activation ? activationTheme(activation) : 'system',
                                item,
                                row,
                                showPopupAt: (p, r) => this._showPopupAt(p, r),
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

        const rows = /** @type {any[]} */ ([{
            label: coreName,
            icon: getActivationIcon(activeAction ?? 'Protocol'),
            highlightBg: coreUsed ? '#ffe5b4' : null,
            highlightBorderColor: coreUsed ? '#cc7700' : null,
            onClick: () => /** @type {any} */ (frame.beginCoreActiveFlow('system.core_system')),
            onRightClick: (/** @type {any} */ row) => toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'core-active', dataValue: frame.id, title: coreName, subtitle: `${frame.name} · Core Active`, bodyHtml: `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(cs?.active_effect ?? cs?.description ?? '')}</div>`, theme: 'frame', item: frame, row, showPopupAt: (p, r) => this._showPopupAt(p, r) }),
        }]);

        if ((passiveName && cs?.passive_effect) || passiveActions.length) {
            rows.push({ label: 'PASSIVE', isSectionLabel: true });
            if (passiveName) {
                rows.push({
                    label: passiveName,
                    icon: 'systems/lancer/assets/icons/core_bonus.svg',
                    onRightClick: (/** @type {any} */ row) => toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-frame-popup', dataKey: 'core-passive', dataValue: frame.id, title: passiveName, subtitle: `${frame.name} · Core Passive`, bodyHtml: `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(cs?.passive_effect ?? '')}</div>${laRenderActions(cs?.passive_actions ?? [])}`, theme: 'frame', item: frame, row, showPopupAt: (p, r) => this._showPopupAt(p, r) }),
                });
            }
            for (const action of passiveActions) {
                rows.push({ label: action.name, icon: getActivationIcon(action), onRightClick: this._actionPopup(action, null, 'frame') });
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
        const ap = a => this._actionPopup(a);
        const traits = frame.system?.traits ?? [];
        if (!traits.length)
            return [];
        return traits.map(/** @type {any} */ (trait) => ({
            label: trait.name,
            icon: 'systems/lancer/assets/icons/trait.svg',
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
                            toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: dep.name, subtitle: `Deployable · ${trait.name} (Trait)`, bodyHtml: laRenderDeployables([dep]), theme: 'deployable', item: frame, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
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
                toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-trait-popup', dataKey: 'trait-name', dataValue: trait.name, title: trait.name, subtitle: `${frame.name} · Trait`, bodyHtml, theme: 'trait', item: frame, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
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
                toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-cb-popup', dataKey: 'cb-id', dataValue: cb.id, title: cb.name, subtitle: 'Core Bonus', bodyHtml: laRenderCoreBonusBody(cb), theme: 'core_bonus', item: cb, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
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
                    toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-system-popup', dataKey: 'system-id', dataValue: intItem.id, title: intItem.name, subtitle: `Integrated · ${frame.name}`, bodyHtml: this._bodyHtml(intItem.system), theme: 'system', item: intItem, row, showPopupAt: (p, r) => this._showPopupAt(p, r), postRender: p => appendItemPips(intItem, p) });
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
                        toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-deploy-popup', dataKey: 'deploy-name', dataValue: dep.name, title: dep.name, subtitle: `Deployable · ${frame.name} (Core)`, bodyHtml: laRenderDeployables([dep]), theme: 'deployable', item: frame, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
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
                    toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-talent-popup', dataKey: 'rank-key', dataValue: key, title: rankLabel, subtitle: `${talent.name} · Rank ${roman[i] ?? i + 1}`, bodyHtml, theme: 'talent', item: talent, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
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
            if (hasBoth)
                items.push({ label: 'ACTIONS', isSectionLabel: true });
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
                    items.push(this._buildCounterRow(counter, path, /** @type {any} */ (talent), 'modules/lancer-automations/icons/perspective-dice-two.svg'));
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
                        toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-ammo-popup', dataKey: 'ammo-idx', dataValue: `${sysItem.id}-${idx}`, title: ammo.name, subtitle: sysItem.name, bodyHtml, theme: 'system', item: sysItem, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
                    },
                });
            });
        }
        return items;
    }

    /** Build a single increment/decrement counter row item. */
    _buildCounterRow(/** @type {any} */ counter, path, /** @type {any} */ talent, icon = null) {
        return {
            inputCell: true,
            subtype: 'increment',
            name: counter.name,
            ...(icon ? { icon } : {}),
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
                        toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-ammo-popup', dataKey: 'ammo-idx', dataValue: `${item.id}-${idx}`, title: ammo.name, subtitle: `${item.name}`, bodyHtml, theme: 'system', item, row, showPopupAt: (p, r) => this._showPopupAt(p, r) });
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


    _weaponItem(weapon, modItem, mount = null) {
        const sys    = weapon.system;
        const status = getItemStatus(weapon);
        const labelHtml = status.destroyed ? `<s class="horus--subtle" style="opacity:0.7;color:#e50000;">${weapon.name}</s>` : weapon.name;
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
                const subtitle = [sys.mount_type ?? sys.size, profileType ?? sys.weapon_type].filter(Boolean).join(' · ');
                toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-weapon-popup', dataKey: 'weapon-id', dataValue: weapon.id, title: weapon.name, subtitle, bodyHtml, theme: 'weapon', item: weapon, row, showPopupAt: (p, r) => this._showPopupAt(p, r), postRender: p => appendItemPips(weapon, p, this._depthCallbacks()) });
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
            // Mod row may have no onClick — handle it first
            if (modItem && child.label === modItem.name) {
                const ms = modItem.system;
                const subtitle = [ms?.type, ms?.license ? `${ms.manufacturer} ${ms.license_level}` : null].filter(Boolean).join(' · ') || 'Weapon Mod';
                return { ...child, onRightClick: (/** @type {any} */ row) => toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-mod-popup', dataKey: 'mod-id', dataValue: modItem.id, title: modItem.name, subtitle, bodyHtml: laRenderModBody(modItem), theme: 'mod', item: modItem, row, showPopupAt: (p, r) => this._showPopupAt(p, r), postRender: p => appendItemPips(modItem, p, this._depthCallbacks()) }) };
            }
            if (!child.onClick)
                return child;
            if (child.label === attackLabel) {
                const mountWeapons = (bypassMountArg?.slots ?? []).map((/** @type {any} */ s) => s.weapon?.value?.name).filter(Boolean);
                const weaponList = mountWeapons.length ? mountWeapons.join(', ') : weapon.name;
                const title = attackLabel === 'FIGHT' ? 'Fight' : attackLabel === 'BARRAGE' ? 'Barrage' : 'Skirmish';
                const body = `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${title} with: <b>${weaponList}</b></div>`;
                return { ...child, onRightClick: (/** @type {any} */ row) => toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-action-popup', dataKey: 'action-key', dataValue: attackLabel, title, subtitle: attackLabel === 'FIGHT' ? 'Full' : attackLabel === 'BARRAGE' ? 'Full' : 'Quick', bodyHtml: body, theme: 'weapon', item: weapon, row, showPopupAt: (p, r) => this._showPopupAt(p, r) }) };
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
            return [{
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

        if (actor.type === 'pilot') {
            return [...addRightClicks(addHover(laHudItemChildren(weapon, {
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
                        onRightClick: (row) => toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-action-popup', dataKey: 'action-key', dataValue: 'ATTACK', title: 'Attack', subtitle: 'Quick', bodyHtml: `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">Attack with: <b>${weapon.name}</b></div>`, theme: 'weapon', item: weapon, row, showPopupAt: (p, r) => this._showPopupAt(p, r) }),
                    },
                ],
                modItem,
                showPopup: (popup, row) => this._showPopupAt(popup, row),
                onActivate,
            })), 'FIGHT', { slots: [{ weapon: { value: weapon } }] }), ...rangeToggle()];
        }
        const isSuperHeavy = (sys.size || sys.type || '').toLowerCase() === 'superheavy';
        const bypassMount = mount ?? { slots: [{ weapon: { value: weapon } }] };
        const attackLabel = isSuperHeavy ? 'BARRAGE' : 'SKIRMISH';
        return [...addRightClicks(addHover(laHudItemChildren(weapon, {
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
                    onRightClick: (row) => toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-action-popup', dataKey: 'action-key', dataValue: 'ATTACK', title: 'Attack', subtitle: 'Quick', bodyHtml: `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">Attack with: <b>${weapon.name}</b></div>`, theme: 'weapon', item: weapon, row, showPopupAt: (p, r) => this._showPopupAt(p, r) }),
                },
            ],
            modItem,
            showPopup: (popup, row) => this._showPopupAt(popup, row),
            onActivate,
        })), attackLabel, bypassMount), ...rangeToggle()];
    }

    _getInvadeOptions(actor) {
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

    _actionPopup(action, source = null, themeOverride = null) {
        return (/** @type {any} */ row) => {
            const sourceName = typeof source === 'string' ? source : /** @type {any} */ (source)?.name ?? null;
            const sourceType = typeof source === 'string' ? null : /** @type {any} */ (source)?.system?.type ?? null;
            const tier = (typeof source !== 'string' ? source?.parent?.system?.tier : null) ?? 1;
            const bodyHtml = laRenderActionDetail(action, { tier });
            const subtitleParts = [action.activation ?? ''];
            if (sourceName)
                subtitleParts.push(sourceType ? `${sourceName} (${sourceType})` : sourceName);
            const theme = themeOverride ?? activationTheme(action.activation);
            const sourceItem = typeof source === 'string' ? null : source;
            toggleDetailPopup({ cssClass: 'la-hud-popup la-hud-action-popup', dataKey: 'action-key', dataValue: action.name, title: action.name, subtitle: subtitleParts.filter(Boolean).join(' · '), bodyHtml, theme, item: sourceItem ?? action.name, row, showPopupAt: (p, r) => this._showPopupAt(p, r), postRender: sourceItem ? p => appendItemPips(sourceItem, p, { action }) : (action.recharge ? p => appendItemPips(null, p, { action }) : null) });
        };
    }

    _getActionsByActivation(actor, activationType, category = null) {
        return getActorActionItems(actor, activationType).map((/** @type {any} */ { action, sourceItem, rankIdx, _coreActive }) => {
            const status = sourceItem ? getItemStatus(sourceItem) : { badge: null, badgeColor: null, unavailable: false, destroyed: false };
            // Extra-action recharge: overlay action-level charged state onto item status
            if (action.recharge && !status.destroyed) {
                const charged = action.charged !== false;
                status.badge = (status.badge ? status.badge + ' ' : '') + (charged ? '▣' : '□');
                status.badgeColor = charged ? (status.badgeColor ?? '#3a9e6e') : '#c33';
                if (!charged)
                    status.unavailable = true;
            }
            return {
                label: status.destroyed ? `<s class="horus--subtle" style="opacity:0.7;color:#e50000;">${action.name}</s>`
                    : (action._sourceItemId ? `<span style="color:#e8a030;font-size:0.7em;vertical-align:middle;">●</span> ${action.name}` : action.name),
                badge: status.badge ?? null,
                badgeColor: status.badgeColor ?? null,
                icon: _coreActive ? 'systems/lancer/assets/icons/corepower.svg' : (action.icon ?? getActivationIcon(action) ?? sourceItem?.img ?? null),
                ...this._statusColors(status),
                onClick: () => {
                    const si = /** @type {any} */ (sourceItem);
                    if (_coreActive)
                        si.beginCoreActiveFlow('system.core_system');
                    else if (si?.type === 'mech_system' || si?.type === 'npc_feature') {
                        if (si?.type === 'npc_feature' && si.system?.tech_attack && si.beginTechAttackFlow) {
                            si.beginTechAttackFlow();
                        } else {
                            const actionIdx = (si.system?.actions ?? []).findIndex(/** @type {any} */ a => a === action || a.name === action.name);
                            if (actionIdx >= 0)
                                si.beginActivationFlow(`system.actions.${actionIdx}`);
                            else if (action._sourceItemId || action.recharge !== undefined)
                                executeSimpleActivation(actor, { title: action.name, action, detail: action.detail || '' }, { item: si });
                            else
                                si.beginSystemFlow();
                        }
                    } else if (si?.type === 'talent') {
                        if (action.activation === 'Invade') {
                            const opt = this._getInvadeOptions(actor).find(o => o.item?.id === si.id && o.name === action.name);
                            if (opt)
                                executeInvade(actor, opt);
                        } else {
                            const ri = rankIdx ?? 0;
                            const ai = (si.system?.ranks?.[ri]?.actions ?? []).findIndex(/** @type {any} */ a => a.name === action.name);
                            si.beginActivationFlow(`system.ranks.${ri}.actions.${ai >= 0 ? ai : 0}`);
                        }
                    } else
                        executeSimpleActivation(actor, { title: action.name, action, detail: action.detail || '' });
                },
                broadcastFn: (t, a) => {
                    const si = /** @type {any} */ (sourceItem);
                    if (_coreActive) {
                        const equiv = /** @type {any} */ (a).system?.loadout?.frame?.value;
                        if (equiv)
                            equiv.beginCoreActiveFlow('system.core_system');
                    } else if (si?.type === 'mech_system' || si?.type === 'npc_feature') {
                        const equiv = /** @type {any} */ (a).items.find(/** @type {any} */ i => i.system?.lid === si.system?.lid);
                        if (equiv) {
                            const actionIdx = (si.system?.actions ?? []).findIndex(/** @type {any} */ ac => ac === action || ac.name === action.name);
                            if (actionIdx >= 0)
                                equiv.beginActivationFlow(`system.actions.${actionIdx}`);
                            else if (action._sourceItemId || action.recharge !== undefined)
                                executeSimpleActivation(a, { title: action.name, action, detail: action.detail || '' }, { item: equiv });
                            else
                                equiv.beginSystemFlow();
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

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Re-render the content of all currently-visible columns without touching the DOM
     * structure, popups, or collapse timers. Used when a detail popup is open and an
     * item update fires — we need badge/status indicators to update but must not destroy
     * the existing column layout or close the popup.
     */
    _refreshColumnsInPlace() {
        if (!this._c2Category?.getItems || !this._c2?.is(':visible'))
            return;
        this._openCol(this._c2, this._c2Category.getItems(), this._c2AnchorRow);

        if (!this._c3SourceItem?.getChildren || !this._c3?.is(':visible'))
            return;
        // _c3AnchorRow is a c2 row that was just rebuilt above — now detached, skip reposition
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
        return $(`<div style="${S_COL}"><div class="la-hud-col-label" style="${S_COL_LABEL}">${label}</div></div>`);
    }

    _makeRow(label, hasArrow, icon = null, activation = null, badge = null, badgeColor = null, count = 0) {
        const iconHtml = icon ? laHudRenderIcon(icon) : '';
        const countHtml = hasArrow && count > 0 ? `<span style="opacity:0.35;font-size:0.72em;margin-left:4px;flex-shrink:0;">${count}</span>` : '';
        const arrow = hasArrow ? `<span style="opacity:0.5;font-size:0.75em;margin-left:2px;flex-shrink:0;">▶</span>` : '';
        const actHtml = activation
            ? `<span style="font-size:0.68em;color:#777;font-weight:normal;margin-left:5px;letter-spacing:0;white-space:nowrap;">[${activation}]</span>`
            : '';
        const badgeHtml = badge
            ? `<span style="font-size:0.92em;font-weight:bold;color:${badgeColor ?? '#3a9e6e'};margin-left:6px;flex-shrink:0;white-space:nowrap;letter-spacing:0;">${badge}</span>`
            : '';
        const row = $(`<div class="la-hud-row" style="${S_ITEM}">${iconHtml}<span class="la-hud-clip" style="flex:1;overflow:hidden;min-width:0;"><span class="la-hud-pan" style="display:inline-block;white-space:nowrap;padding-right:8px;">${label}${actHtml}</span></span>${badgeHtml}${countHtml}${arrow}</div>`);
        row.on('mouseenter', () => {
            if (!row.hasClass('la-hud-active'))
                row.css({ background: row.data('hoverBg') ?? BG_HOVER, color: TEXT_DEFAULT });
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
                const css = { background: row.data('restingBg') ?? BG_DEFAULT, color: TEXT_DEFAULT };
                const rb  = row.data('restingBorder');
                if (rb)
                    css.borderLeftColor = rb;
                row.css(css);
            }
            row.find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
        });
        return row;
    }

    _setActive(col, activeRow, isCategory = false) {
        col.find('.la-hud-row').each(function() {
            const r = $(this);
            const css = { background: r.data('restingBg') ?? BG_DEFAULT, color: TEXT_DEFAULT };
            const rb  = r.data('restingBorder');
            if (rb)
                css.borderLeftColor = rb;
            r.css(css).removeClass('la-hud-active');
        });
        if (isCategory)
            activeRow.css({ background: BG_ACTIVE, color: TEXT_ACTIVE }).addClass('la-hud-active');
        else
            activeRow.css({ background: activeRow.data('hoverBg') ?? BG_HOVER, color: TEXT_DEFAULT }).addClass('la-hud-active');
    }
}
