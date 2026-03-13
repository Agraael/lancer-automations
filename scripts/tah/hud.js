/* global $, window, game */

import { laDetailPopup, laRenderWeaponBody, laBindPopupBehavior, laFormatDetailHtml, laRenderActionDetail, laRenderActions, laPopupSectionLabel, laRenderDeployables, laRenderTags } from '../interactive/detail-renderers.js';
import { executeSkirmish, executeBarrage, executeFight, executeSimpleActivation, executeBasicAttack, executeDamageRoll, executeTechAttack, executeReactorMeltdown, executeReactorExplosion, executeStatRoll, getActorActionItems, hasReactionAvailable } from '../misc-tools.js';
import { executeInvade, openThrowMenu, clearMovementHistory } from '../interactive/combat.js';
import { pickupWeaponToken, openDeployableMenu, recallDeployable, getItemDeployables, deployDeployable, reloadOneWeapon } from '../interactive/deployables.js';
import { knockBackToken } from '../interactive/canvas.js';
import { delayedTokenAppearance } from '../reinforcement.js';
import { laHudRenderIcon, getActivationIcon, laHudItemChildren, getItemStatus } from './item-helpers.js';
import { onHudRowHover } from './hover.js';

// ── Lancer-style-library palette ─────────────────────────────────────────────

const HUD_LEFT = 120;    // right of Foundry's left toolbar
const HUD_TOP  = 115;   // below Foundry's top nav bar

const S_COL  = 'display:flex;flex-direction:column;gap:2px;min-width:180px;';

const ROW_MAX_WIDTH = 300;

const S_ITEM = [
    'padding:6px 12px',
    'background:#f5f5f5',
    'border:2px solid #bbb',
    'border-left:3px solid #991e2a',
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
    'background:#991e2a',
    'color:#fff',
    'font-size:0.68em',
    'letter-spacing:1px',
    'text-transform:uppercase',
    'font-weight:bold',
].join(';') + ';';

const BG_DEFAULT   = '#f5f5f5';
const BG_HOVER     = '#ffe0e0';
const BG_ACTIVE    = '#991e2a';
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

// ── Popup positioning ─────────────────────────────────────────────────────────

// ── Item / Category data builders ─────────────────────────────────────────────
//
// Category shape: { label, colLabel, getItems: () => Item[] }
// Item shape:     { label, childColLabel?, getChildren?: () => Item[], onClick?: () => void, onRightClick?: (rowEl) => void }

// ── LancerHUD ─────────────────────────────────────────────────────────────────

export class LancerHUD {
    constructor() {
        this._el              = null;
        this._c2              = null;
        this._c3              = null;
        this._c4              = null;
        this._c4AnchorRow       = null;
        this._token              = null;
        this._pendingCol4Refresh = null;
        this._pendingCol3Refresh = null;
        this._refreshTimer       = null;
    }

    bind(token) {
        this.unbind();
        if (!token.actor?.isOwner)
            return;
        this._token = token;
        this._render();
    }

    unbind() {
        const el = this._el;
        this._el = this._c2 = this._c3 = this._c4 = null;
        this._c4AnchorRow = null;
        this._token = null;
        this._pendingCol3Refresh = null;
        this._pendingCol4Refresh = null;
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
        $('.la-hud-popup').stop(true).animate({ opacity: 0 }, 120, function() {
            $(this).remove();
        });
        if (el)
            el.stop(true).animate({ opacity: 0, left: '-=18' }, 180, () => el.remove());
    }

    /** Debounced full refresh — coalesces rapid successive updates into one render. */
    scheduleRefresh(delay = 150) {
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
        this._el.find('#la-hud-stats').replaceWith($(this._buildStatsHtml(this._actor)));
    }

    refresh() {
        if (!this._token)
            return;
        const pending4 = this._pendingCol4Refresh;
        this._pendingCol4Refresh = null;
        if (pending4?.anchor && this._c4) {
            this._openCol(this._c4, pending4.fn(), pending4.anchor);
            return;
        }
        const pending3 = this._pendingCol3Refresh;
        this._pendingCol3Refresh = null;
        if (pending3?.anchor && this._c3) {
            this._openCol(this._c3, pending3.fn(), pending3.anchor);
            return;
        }
        const openPath = this._saveOpenPath();
        const el = this._el;
        this._el = this._c2 = this._c3 = this._c4 = null;
        this._c4AnchorRow = null;
        if (el)
            el.stop(true).remove();
        $('.la-hud-popup').stop(true).remove();
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

        const actor = this._actor;
        const tokenName = this._token.name ?? actor.name ?? '';
        const S_TOKEN_TITLE = [
            'padding:6px 12px 5px',
            'background:#1a1a1a',
            'color:#fff',
            'font-size:1em',
            'letter-spacing:1px',
            'text-transform:uppercase',
            'font-weight:bold',
            'white-space:nowrap',
            'width:max-content',
            'cursor:context-menu',
        ].join(';') + ';';

        const titleEl = $(`<div style="${S_TOKEN_TITLE}">${tokenName}</div>`);
        titleEl.on('contextmenu', ev => {
            ev.preventDefault(); actor.sheet?.render(true);
        });

        const statsEl = $(this._buildStatsHtml(actor));

        const c1 = this._makeCol('Menu');
        c1.css('width', '180px');
        c1.prepend(statsEl);
        c1.prepend(titleEl);

        // c1 must exist in DOM before we can measure it below, so build hud first
        const hud = $(`<div id="la-hud" style="position:fixed;left:${HUD_LEFT}px;top:${HUD_TOP}px;z-index:70;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));"></div>`);
        if (animate)
            hud.css({ opacity: 0, left: HUD_LEFT - 18 });
        hud.append(c1);
        $('body').append(hud);
        this._el = hud;
        if (animate)
            hud.animate({ opacity: 1, left: HUD_LEFT }, 350);

        // c2 and c3 are absolutely positioned — never affect c1's layout
        const c2 = this._makeCol('');
        const c3 = this._makeCol('');
        const c4 = this._makeCol('');
        c2.css({ position: 'absolute', top: 0, left: c1.outerWidth(), display: 'none' });
        c3.css({ position: 'absolute', top: 0, left: 0,                   display: 'none' });
        c4.css({ position: 'absolute', top: 0, left: 0,                   display: 'none' });
        hud.append(c2, c3, c4);
        this._c2 = c2;
        this._c3 = c3;
        this._c4 = c4;

        for (const cat of categories) {
            const row = this._makeRow(cat.label, true);
            row.on('mouseenter', () => {
                if (row.hasClass('la-hud-active') && c2.is(':visible')) {
                    _cancelCollapse();
                    return;
                }
                this._setActive(c1, row, true);
                // collapse c3+c4 before replacing c2
                closeCol(c3, 80);
                closeCol(c4, 80);
                c2.find('.la-hud-col-label').text(cat.colLabel);
                this._openCol(c2, cat.getItems(), row);
                c2.stop(true).css({ opacity: 0, marginLeft: -10, pointerEvents: 'none' }).show().animate({ opacity: 1, marginLeft: 0 }, 140, function() { $(this).css('pointerEvents', ''); });
            });
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
                closeCol(c2);
                closeCol(c3);
                closeCol(c4);
                _clearC1Active();
                $('.la-hud-popup').stop(true).animate({ opacity: 0 }, 120, function() {
                    $(this).remove();
                });
            }, 500);
        };
        const _cancelCollapse = () => clearTimeout(_leaveTimer);
        this._scheduleCollapse = _scheduleCollapse;
        this._cancelCollapse   = _cancelCollapse;
        this._clearC1Active    = _clearC1Active;
        hud.on('mouseleave', () => {
            _clearC1Active();
            _scheduleCollapse();
        }).on('mouseenter', _cancelCollapse);
        c2.on('mouseleave', _scheduleCollapse).on('mouseenter', _cancelCollapse);
        c3.on('mouseleave', _scheduleCollapse).on('mouseenter', _cancelCollapse);
        c4.on('mouseleave', _scheduleCollapse).on('mouseenter', _cancelCollapse);
    }

    // ── Generic column populator ──────────────────────────────────────────────
    // col       — jQuery element to populate
    // items     — Item[] (see shape above)
    // anchorRow — the parent row this column aligns with vertically

    _openCol(col, items, anchorRow) {
        col.children(':not(.la-hud-col-label)').remove();
        // Use page-relative offset minus hud offset so the result is correct
        // regardless of which column anchorRow lives in (c1 or c2).
        const topInHud = anchorRow.offset().top - this._el.offset().top;
        col.css({ top: topInHud });

        if (!items.length) {
            col.append(`<div style="${S_MUTED}">Empty</div>`);
            return;
        }

        for (const item of items) {
            if (item.isSectionLabel) {
                const iconHtml = item.icon ? laHudRenderIcon(item.icon) : '';
                col.append(`<div style="${S_COL_LABEL};display:flex;align-items:center;">${iconHtml}${item.label}</div>`);
                continue;
            }
            const hasChildren = !!item.getChildren;
            const row = this._makeRow(item.label, hasChildren, item.icon, item.activation ?? null, item.badge ?? null, item.badgeColor ?? null);

            if (item.highlightBg) {
                const borderColor = item.highlightBorderColor ?? '#3a78b5';
                row.data('restingBg', item.highlightBg);
                row.data('restingBorder', borderColor);
                row.data('hoverBg', brighten(item.highlightBg));
                row.css({ background: item.highlightBg, borderLeftColor: borderColor });
            }

            if (col !== this._c4) {
                row.on('mouseenter', () => {
                    $('.la-hud-popup').remove();
                    if (col === this._c2 && !hasChildren) {
                        col.find('.la-hud-active').each(function() {
                            const r = $(this); r.css({ background: r.data('restingBg') ?? BG_DEFAULT, color: TEXT_DEFAULT }).removeClass('la-hud-active');
                        });
                        closeCol(this._c3, 80);
                        closeCol(this._c4, 80);
                    } else if (col === this._c3 && !hasChildren) {
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
                    if (item.keepOpen && item.refreshCol4) {
                        if (col === this._c3)
                            this._pendingCol3Refresh = { fn: item.refreshCol4, anchor: anchorRow };
                        else
                            this._pendingCol4Refresh = { fn: item.refreshCol4, anchor: this._c4AnchorRow };
                    }
                    await item.onClick();
                });
            }
            if (item.onRightClick) {
                row.attr('title', 'Right click for details');
                row.on('contextmenu', ev => {
                    ev.preventDefault(); item.onRightClick(row);
                });
            }
            if (item.hoverData) {
                const hd = item.hoverData;
                const token = this._token;
                row.on('mouseenter', () => onHudRowHover({ ...hd, token, isEntering: true,  isLeaving: false }));
                row.on('mouseleave', () => onHudRowHover({ ...hd, token, isEntering: false, isLeaving: true  }));
            }
            if (hasChildren) {
                row.on('mouseenter', () => {
                    if (col === this._c2 && row.hasClass('la-hud-active') && this._c3.is(':visible')) {
                        this._cancelCollapse();
                        return;
                    }
                    if (col === this._c3 && row.hasClass('la-hud-active') && this._c4.is(':visible')) {
                        this._cancelCollapse();
                        return;
                    }
                    this._setActive(col, row);
                    if (col === this._c2) {
                        closeCol(this._c4, 80);
                        this._c3.find('.la-hud-col-label').text(item.childColLabel ?? '');
                        this._c3.css({ left: col.position().left + col.outerWidth() });
                        this._openCol(this._c3, item.getChildren(), row);
                        this._c3.stop(true).css({ opacity: 0, marginLeft: -10, pointerEvents: 'none' }).show().animate({ opacity: 1, marginLeft: 0 }, 140, function() { $(this).css('pointerEvents', ''); });
                    } else if (col === this._c3) {
                        this._c4AnchorRow = row;
                        this._c4.find('.la-hud-col-label').text(item.childColLabel ?? '');
                        this._c4.css({ left: this._c3.position().left + this._c3.outerWidth() });
                        this._openCol(this._c4, item.getChildren(), row);
                        this._c4.stop(true).css({ opacity: 0, marginLeft: -10, pointerEvents: 'none' }).show().animate({ opacity: 1, marginLeft: 0 }, 140, function() { $(this).css('pointerEvents', ''); });
                    }
                });
            }

            col.append(row);
        }
    }

    // ── Category / item builders ──────────────────────────────────────────────

    // ── Category list — reorder these lines to reorder the HUD ──────────────
    _buildCategories() {
        const isMech       = this._actor.type === 'mech';
        const isDeployable = this._actor.type === 'deployable';
        const isPilot      = this._actor.type === 'pilot';
        return [
            this._catAttacks(),
            ...(isDeployable ? [] : [this._catWeapons()]),
            this._catTech(),
            this._catActions(),
            ...(isDeployable || isPilot ? [] : [this._catDeployables()]),
            ...(isMech ? [this._catSystems()] : []),
            ...(isMech ? [this._catFrame()] : []),
            ...(isMech ? [this._catTalents()] : []),
            this._catSkills(),
            this._catUtility(),
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
                { label: 'Resources', childColLabel: 'Resources', getChildren: () => this._resourceItems() },
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
                { label: 'Reload', icon: 'modules/lancer-automations/icons/reload.svg', onClick: () => reloadOneWeapon(token), onRightClick: ap({ name: 'Reload', activation: 'Quick', detail: 'Reload one Loading weapon.' }) },
                { label: 'Mount',  icon: 'systems/lancer/assets/icons/white/mech.svg',  onClick: () => executeSimpleActivation(actor, { title: 'Mount',  action: { name: 'Mount',  activation: 'Full' }, detail: 'You can MOUNT as a full action. You must be adjacent your mech to MOUNT.\nAdditionally, you can also MOUNT willing allied mechs or vehicles. When you do so, move into the same space and then move with them.' }), onRightClick: ap({ name: 'Mount',  activation: 'Full', detail: 'You can MOUNT as a full action. You must be adjacent your mech to MOUNT.\nAdditionally, you can also MOUNT willing allied mechs or vehicles. When you do so, move into the same space and then move with them.' }) },
                { label: 'Jockey', icon: 'modules/lancer-automations/icons/ram.svg',    onClick: () => executeSimpleActivation(actor, { title: 'Jockey', action: { name: 'Jockey', activation: 'Full' }, detail: 'To JOCKEY, you must be adjacent to a mech. As a full action, make a contested skill check using GRIT. The mech contests with HULL. On a success, climb onto the mech, sharing its space.\nChoose one: DISTRACT (mech is IMPAIRED and SLOWED), SHRED (deal 2 heat), or DAMAGE (deal 4 kinetic damage).' }), onRightClick: ap({ name: 'Jockey', activation: 'Full', detail: 'To JOCKEY, you must be adjacent to a mech. As a full action, make a contested skill check using GRIT. The mech contests with HULL. On a success, climb onto the mech, sharing its space.\nChoose one: DISTRACT (mech is IMPAIRED and SLOWED), SHRED (deal 2 heat), or DAMAGE (deal 4 kinetic damage).' }) },
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

        const deployableRows = [];
        for (const item of actor.items) {
            const lids = getItemDeployables(item, actor);
            for (const lid of lids) {
                const depActor = /** @type {any} */ (game.actors)?.find(
                    (/** @type {any} */ a) => a.type === 'deployable' && a.system?.lid === lid
                );
                const label = depActor?.name ?? lid;
                const icon  = depActor?.img  ?? 'systems/lancer/assets/icons/deployable.svg';
                deployableRows.push({
                    label,
                    icon,
                    hoverData: { actor, item, action: null, category: 'Deployables' },
                    onClick: () => deployDeployable(actor, lid, item, true),
                    onRightClick: depActor ? (/** @type {any} */ row) => {
                        const body = laRenderDeployables([depActor]);
                        const srcType = item.system?.type ?? '';
                        const subtitle = `Deployable · ${item.name}${srcType ? ` (${srcType})` : ''}`;
                        const popup = laDetailPopup('la-hud-popup la-hud-deploy-popup', depActor.name, subtitle, body, 'system');
                        this._showPopupAt(popup, row);
                    } : null,
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
                    { label: 'Skirmish',          icon: 'mdi mdi-hexagon-slice-3', onClick: () => executeSkirmish(actor),    onRightClick: ap({ name: 'Skirmish',          activation: 'Quick', detail: 'Make one attack with a single weapon.' }) },
                    { label: 'Barrage',           icon: 'mdi mdi-hexagon-slice-6',  onClick: () => executeBarrage(actor),     onRightClick: ap({ name: 'Barrage',           activation: 'Full',  detail: 'Make two attacks, each with a different weapon, or two attacks with the same weapon. You may also make one attack with a SUPERHEAVY weapon.' }) },
                    { label: 'Ram',               icon: 'mdi mdi-hexagon-slice-3', onClick: () => executeSimpleActivation(actor, { title: 'Ram',               action: { name: 'Ram',               activation: 'Quick' }, detail: 'Make a melee attack against an adjacent character the same SIZE or smaller than you. On a success, your target is knocked PRONE and you may also choose to knock them back by one space, directly away from you.' }),               onRightClick: ap({ name: 'Ram',               activation: 'Quick', detail: 'Make a melee attack against an adjacent character the same SIZE or smaller than you. On a success, your target is knocked PRONE and you may also choose to knock them back by one space, directly away from you.' }) },
                    { label: 'Grapple',           icon: 'mdi mdi-hexagon-slice-3', onClick: () => executeSimpleActivation(actor, { title: 'Grapple',           action: { name: 'Grapple',           activation: 'Quick' }, detail: 'Perform a melee attack to grapple a target, end an existing grapple, or break free from a grapple.' }),                                                                                                                         onRightClick: ap({ name: 'Grapple',           activation: 'Quick', detail: 'Perform a melee attack to grapple a target, end an existing grapple, or break free from a grapple.' }) },
                    { label: 'Improvised Attack', icon: 'mdi mdi-hexagon-slice-6',  onClick: () => executeBasicAttack(actor), onRightClick: ap({ name: 'Improvised Attack', activation: 'Full',  detail: 'Make a melee or ranged attack using a non-weapon object or piece of terrain. On a hit, deal 1d6 AP kinetic damage.' }) },
                ] : []),
                ...(actor.type === 'pilot' ? [
                    { label: 'Fight', icon: 'systems/lancer/assets/icons/white/melee.svg', onClick: () => executeFight(actor), onRightClick: ap({ name: 'Fight', activation: 'Full', detail: 'Make a melee or ranged attack with a pilot weapon.' }) },
                ] : []),
                { isSectionLabel: true, label: 'Tools' },
                { label: 'Basic Attack',  icon: 'systems/lancer/assets/icons/mech_weapon.svg',                  onClick: () => executeBasicAttack(actor) },
                { label: 'Damage',        icon: 'systems/lancer/assets/icons/melee.svg',                   onClick: () => executeDamageRoll(token, [...(game.user?.targets ?? [])], '0', 'Kinetic') },
                { label: 'Throw Weapon',  icon: 'systems/lancer/assets/icons/thrown.svg',              onClick: () => openThrowMenu(actor) },
                { label: 'Pickup Weapon', icon: 'modules/lancer-automations/icons/pickup.svg',             onClick: () => pickupWeaponToken(token), keepOpen: true },
            ].map(it => it.isSectionLabel || !it.onClick
                ? it
                : { ...it, hoverData: { actor, item: null, action: { name: it.label }, category: 'Attacks' } }),
        };
    }

    _catWeapons() {
        const actor = this._actor;
        return {
            label: 'Weapons',
            colLabel: actor?.type === 'npc' || actor?.type === 'pilot' ? 'Weapons' : 'Mounts',
            getItems: () => {
                if (actor?.type === 'npc')
                    return actor.items.filter(i => i.type === 'npc_feature' && i.system.type === 'Weapon').map(w => this._weaponItem(w, null, null));
                if (actor?.type === 'pilot')
                    return actor.items.filter(i => i.type === 'pilot_weapon').map(w => this._weaponItem(w, null, null));
                const mounts = actor?.system?.loadout?.weapon_mounts ?? [];
                const result = [];
                mounts.forEach((mount, idx) => {
                    const slots = (mount.slots ?? []).filter(s => s.weapon?.id).map(s => ({ weapon: actor.items.get(s.weapon.id), mod: s.mod?.id ? actor.items.get(s.mod.id) : null })).filter(e => e.weapon);
                    if (!slots.length)
                        return;
                    result.push({ label: mount.type || `Mount ${idx + 1}`, isSectionLabel: true });
                    slots.forEach(e => result.push(this._weaponItem(e.weapon, e.mod, mount)));
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
                label: opt.destroyed ? `<s style="opacity:0.55;">${opt.name}</s>` : opt.name,
                icon: opt.item?.img ?? ICON_TECH_QUICK,
                highlightBg:          opt.destroyed ? '#ffcccc' : opt.unavailable ? '#ffe5b4' : null,
                highlightBorderColor: opt.destroyed ? '#cc3333' : opt.unavailable ? '#cc7700' : null,
                hoverData: { actor, item: opt.item ?? null, action: opt.action ?? { name: opt.name, activation: 'Invade' }, category: 'Tech' },
                onClick: () => executeInvade(actor, opt),
                onRightClick: (row) => {
                    const existing = $('.la-hud-invade-popup');
                    if (existing.length && existing.data('invade-name') === opt.name) {
                        existing.remove(); return;
                    }
                    existing.remove();
                    const detail = laFormatDetailHtml(opt.detail);
                    const bodyHtml = detail ? `<div style="margin:0;font-size:0.82em;line-height:1.5;">${detail}</div>` : '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
                    const sourceType  = opt.item?.system?.type ? ` (${opt.item.system.type})` : '';
                    const sourceLabel = !opt.isFragmentSignal && opt.item?.name ? ` · ${opt.item.name}${sourceType}` : '';
                    const subtitle = (opt.isFragmentSignal ? 'Fragment Signal · Quick Tech' : 'Invade · Quick Tech') + sourceLabel;
                    const popup = laDetailPopup('la-hud-popup la-hud-invade-popup', opt.name, subtitle, bodyHtml, 'system');
                    popup.data('invade-name', opt.name);
                    this._showPopupAt(popup, row);
                },
            })),
        };
    }

    _catQuickActions() {
        const actor = this._actor;
        const ap = a => this._actionPopup(a);
        const basicChildren = () => {
            const items = [
                { label: 'Aid',       icon: 'modules/lancer-automations/icons/medical-pack.svg',           onClick: () => executeSimpleActivation(actor, { title: 'Aid',       action: { name: 'Aid',       activation: 'Quick'          }, detail: 'You assist a mech so it can Stabilize more easily. Choose an adjacent character. On their next turn, they may Stabilize as a quick action. They can choose to take this action even if they normally would not be able to take actions (for example, by being affected by the Stunned condition).' }), onRightClick: ap({ name: 'Aid',       activation: 'Quick',          detail: 'You assist a mech so it can Stabilize more easily. Choose an adjacent character. On their next turn, they may Stabilize as a quick action. They can choose to take this action even if they normally would not be able to take actions (for example, by being affected by the Stunned condition).' }) },
                { label: 'Hide',      icon: 'systems/lancer/assets/icons/status_hidden.svg',         onClick: () => executeSimpleActivation(actor, { title: 'Hide',      action: { name: 'Hide',      activation: 'Quick'          }, detail: 'Obscure the position of your mech, becoming HIDDEN and unable to be identified, precisely located, or be targeted directly by attacks or hostile actions.' }),                                                                                                                                                                                                                                          onRightClick: ap({ name: 'Hide',      activation: 'Quick',          detail: 'Obscure the position of your mech, becoming HIDDEN and unable to be identified, precisely located, or be targeted directly by attacks or hostile actions.' }) },
                { label: 'Search',    icon: 'modules/lancer-automations/icons/search.svg',                 onClick: () => executeSimpleActivation(actor, { title: 'Search',    action: { name: 'Search',    activation: 'Quick'          }, detail: 'Choose a character within your SENSORS that you suspect is HIDDEN and make a contested SYSTEMS check against their AGILITY. This can be used to reveal characters within RANGE 5. Once a HIDDEN character has been found, they immediately lose HIDDEN.' }),                                                                                                                                  onRightClick: ap({ name: 'Search',    activation: 'Quick',          detail: 'Choose a character within your SENSORS that you suspect is HIDDEN and make a contested SYSTEMS check against their AGILITY. This can be used to reveal characters within RANGE 5. Once a HIDDEN character has been found, they immediately lose HIDDEN.' }) },
                { label: 'Shut Down', icon: 'systems/lancer/assets/icons/status_shutdown.svg',       onClick: () => executeSimpleActivation(actor, { title: 'Shut Down', action: { name: 'Shut Down', activation: 'Quick'          }, detail: 'Shut down your mech as a desperate measure, to end system attacks, regain control of AI, and cool your mech. The mech is STUNNED until rebooted via the BOOT UP action.' }),                                                                                                                                                                                                               onRightClick: ap({ name: 'Shut Down', activation: 'Quick',          detail: 'Shut down your mech as a desperate measure, to end system attacks, regain control of AI, and cool your mech. The mech is STUNNED until rebooted via the BOOT UP action.' }) },
                { label: 'Handle',    icon: 'modules/lancer-automations/icons/hand-truck.svg',             onClick: () => executeSimpleActivation(actor, { title: 'Handle',    action: { name: 'Handle',    activation: 'Protocol/Quick' }, detail: 'As a protocol or quick action, start to handle an adjacent object or willing character by lifting or dragging them. Mechs can drag characters or objects up to twice their SIZE but are SLOWED while doing so. They can also lift characters or objects of equal or lesser SIZE overhead but are IMMOBILIZED while doing so.' }),                                                                 onRightClick: ap({ name: 'Handle',    activation: 'Protocol/Quick', detail: 'As a protocol or quick action, start to handle an adjacent object or willing character by lifting or dragging them. Mechs can drag characters or objects up to twice their SIZE but are SLOWED while doing so. They can also lift characters or objects of equal or lesser SIZE overhead but are IMMOBILIZED while doing so.' }) },
                { label: 'Interact',  icon: 'modules/lancer-automations/icons/click.svg',                  onClick: () => executeSimpleActivation(actor, { title: 'Interact',  action: { name: 'Interact',  activation: 'Protocol/Quick' }, detail: 'Manipulate an object in some way, such as pushing a button, knocking it over, or ripping out wires. You may only Interact 1/turn. If no hostile characters are adjacent to the object, you automatically succeed. Otherwise, make a contested skill check.' }),                                                                                                                                 onRightClick: ap({ name: 'Interact',  activation: 'Protocol/Quick', detail: 'Manipulate an object in some way, such as pushing a button, knocking it over, or ripping out wires. You may only Interact 1/turn. If no hostile characters are adjacent to the object, you automatically succeed. Otherwise, make a contested skill check.' }) },
                { label: 'Prepare',   icon: 'modules/lancer-automations/icons/light-bulb.svg',             onClick: () => executeSimpleActivation(actor, { title: 'Prepare',   action: { name: 'Prepare',   activation: 'Quick'          }, detail: 'Prepare any other Quick Action and specify a valid trigger in the form "When X then Y". Until the start of your next turn, when it is triggered, you can take this action as a Reaction. While holding a Prepared Action, you may not move or perform any other actions or Reactions.' }),                                                                                                       onRightClick: ap({ name: 'Prepare',   activation: 'Quick',          detail: 'Prepare any other Quick Action and specify a valid trigger in the form "When X then Y". Until the start of your next turn, when it is triggered, you can take this action as a Reaction. While holding a Prepared Action, you may not move or perform any other actions or Reactions.' }) },
                { label: 'Eject',     icon: 'modules/lancer-automations/icons/parachute.svg',              onClick: () => executeSimpleActivation(actor, { title: 'Eject',     action: { name: 'Eject',     activation: 'Quick'          }, detail: 'EJECT as a quick action, flying 6 spaces in the direction of your choice; however, this is a single-use system for emergency use only – it leaves your mech IMPAIRED. Your mech remains IMPAIRED and you cannot EJECT again until your next FULL REPAIR.' }),                                                                                                                                 onRightClick: ap({ name: 'Eject',     activation: 'Quick',          detail: 'EJECT as a quick action, flying 6 spaces in the direction of your choice; however, this is a single-use system for emergency use only – it leaves your mech IMPAIRED. Your mech remains IMPAIRED and you cannot EJECT again until your next FULL REPAIR.' }) },
            ];
            if (actor.type === 'mech')
                items.push({ label: 'Self Destruct', icon: 'modules/lancer-automations/icons/mushroom-cloud.svg', onClick: () => /** @type {any} */ (executeReactorMeltdown(actor)), onRightClick: ap({ name: 'Self Destruct', activation: 'Quick', detail: 'Trigger a reactor meltdown. Your mech will explode at the end of your next turn or immediately if you choose to EJECT.' }) });
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
                { label: 'Boot Up',   icon: 'modules/lancer-automations/icons/boot.svg',      onClick: () => executeSimpleActivation(actor, { title: 'Boot Up',   action: { name: 'Boot Up',   activation: 'Full' }, detail: 'You can BOOT UP a mech that you are piloting as a full action, clearing SHUT DOWN and restoring your mech to a powered state.' }),                                                                                                                                                                                                     onRightClick: ap({ name: 'Boot Up',   activation: 'Full', detail: 'You can BOOT UP a mech that you are piloting as a full action, clearing SHUT DOWN and restoring your mech to a powered state.' }) },
                { label: 'Disengage', icon: 'modules/lancer-automations/icons/disengage.svg', onClick: () => executeSimpleActivation(actor, { title: 'Disengage', action: { name: 'Disengage', activation: 'Full' }, detail: 'Until the end of your current turn, you ignore engagement and your movement does not provoke reactions.' }),                                                                                                                                                                                                                         onRightClick: ap({ name: 'Disengage', activation: 'Full', detail: 'Until the end of your current turn, you ignore engagement and your movement does not provoke reactions.' }) },
                { label: 'Dismount',  icon: 'modules/lancer-automations/icons/dismount.svg',  onClick: () => executeSimpleActivation(actor, { title: 'Dismount',  action: { name: 'Dismount',  activation: 'Full' }, detail: 'When you DISMOUNT, you climb off of a mech. You can DISMOUNT as a full action. When you DISMOUNT, you are placed in an adjacent space – if there are no free spaces, you cannot DISMOUNT. Additionally, you can also DISMOUNT willing allied mechs or vehicles you have MOUNTED.' }), onRightClick: ap({ name: 'Dismount',  activation: 'Full', detail: 'When you DISMOUNT, you climb off of a mech. You can DISMOUNT as a full action. When you DISMOUNT, you are placed in an adjacent space – if there are no free spaces, you cannot DISMOUNT. Additionally, you can also DISMOUNT willing allied mechs or vehicles you have MOUNTED.' }) },
            ];
            if (actor.type === 'mech')
                items.push({ label: 'Stabilize', icon: 'systems/lancer/assets/icons/repair.svg', onClick: () => /** @type {any} */ (actor.beginStabilizeFlow()), onRightClick: ap({ name: 'Stabilize', activation: 'Full', detail: 'To STABILIZE, choose one: Cool your mech, clearing all heat and ending the EXPOSED status; or Spend 1 Repair to heal your mech for half its max HP (rounded up).' }) });
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
        const ap = a => this._actionPopup(a);
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
                        { label: 'Brace',     icon: 'modules/lancer-automations/icons/brace.svg',         highlightBg: reactionAvail ? null : unavailBg, highlightBorderColor: reactionAvail ? null : unavailBorder, onClick: () => executeSimpleActivation(actor, { title: 'Brace',     action: { name: 'Brace',     activation: 'Reaction' }, detail: 'You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.' }), onRightClick: ap({ name: 'Brace',     activation: 'Reaction', detail: 'You count as having RESISTANCE to all damage, burn, and heat from the triggering attack, and until the end of your next turn, all other attacks against you are made at +1 difficulty. Due to the stress of bracing, you cannot take reactions until the end of your next turn and on that turn, you can only take one quick action – you cannot OVERCHARGE, move normally, take full actions, or take free actions.' }) },
                        { label: 'Overwatch', icon: 'systems/lancer/assets/icons/reaction.svg',     highlightBg: reactionAvail ? null : unavailBg, highlightBorderColor: reactionAvail ? null : unavailBorder, onClick: () => executeSimpleActivation(actor, { title: 'Overwatch', action: { name: 'Overwatch', activation: 'Reaction' }, detail: 'Trigger: A hostile character starts any movement (including BOOST and other actions) inside one of your weapons\' THREAT.<br>Effect: Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move.' }),                                                                                                                                                                                                                                                                                                                                                                                                                                     onRightClick: ap({ name: 'Overwatch', activation: 'Reaction', detail: 'Trigger: A hostile character starts any movement (including BOOST and other actions) inside one of your weapons\' THREAT.<br>Effect: Trigger OVERWATCH, immediately using that weapon to SKIRMISH against that character as a reaction, before they move.' }) },
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
                ...(actor.type === 'mech' ? [{ label: 'Overcharge', icon: 'systems/lancer/assets/icons/overcharge.svg', onClick: () => /** @type {any} */ (actor.beginOverchargeFlow()), onRightClick: ap({ name: 'Overcharge', activation: 'Protocol', detail: 'Each time you OVERCHARGE, the next time you OVERCHARGE in the same scene, it deals more self-heat. The sequence is 1d3 heat, 1d6 heat, 1d6+4 heat. It resets at the start of your next scene.' }) }] : []),
                ...this._getActionsByActivation(actor, 'Protocol', 'Actions'),
            ].map(it => /** @type {any} */ (it).hoverData || !it.onClick ? it : { ...it, hoverData: { actor, item: null, action: { name: it.label }, category: 'Actions' } }),
        };
    }

    _catFreeActions() {
        const actor = this._actor;
        const ap = a => this._actionPopup(a);
        return {
            label: 'Free Actions',
            colLabel: 'Free Actions',
            getItems: () => [
                ...(actor.type !== 'deployable' ? [{ label: 'Squeeze', icon: 'modules/lancer-automations/icons/contract.svg', onClick: () => executeSimpleActivation(actor, { title: 'Squeeze', action: { name: 'Squeeze', activation: 'Free' }, detail: 'A character may squeeze as a free action, treating themselves as one Size smaller for the purposes of movement. While squeezing, the character is additionally treated as Prone. The character may stop squeezing as a free action while in a space able to accommodate their normal Size.' }), onRightClick: ap({ name: 'Squeeze', activation: 'Free', detail: 'A character may squeeze as a free action, treating themselves as one Size smaller for the purposes of movement. While squeezing, the character is additionally treated as Prone. The character may stop squeezing as a free action while in a space able to accommodate their normal Size.' }) }] : []),
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
        ];
        const statsItems = statDefs
            .filter(s => actor.system[s.key] !== undefined)
            .map(s => ({
                label: s.label,
                badge: `+${actor.system[s.key]}`,
                badgeColor: '#777',
                hoverData: { actor, item: null, action: { name: s.label }, category: 'Skills' },
                onClick: () => executeStatRoll(actor, s.key, s.label),
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
                    { isSectionLabel: true, label: 'Stats' },
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
            { label: 'Reload Weapon', icon: 'modules/lancer-automations/icons/reload.svg',       onClick: () => reloadOneWeapon(token) },
            { label: 'Full Repair',   icon: 'modules/lancer-automations/icons/auto-repair.svg',  onClick: () => /** @type {any} */ (actor)?.beginFullRepairFlow() },
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
                { label: 'Reactor Explosion', icon: 'modules/lancer-automations/icons/time-bomb.svg', onClick: () => executeReactorExplosion(token) },
            ] : []),
        ];

        const movementItems = [
            { label: 'Knockback',      icon: 'modules/lancer-automations/icons/push.svg', onClick: () => knockBackToken([...(/** @type {any} */ (game.user)?.targets ?? [])], -1, { title: 'KNOCKBACK', description: 'Place each token at its knockback destination.' }) },
            { label: 'Reset History',  icon: 'modules/lancer-automations/icons/trash-can.svg', onClick: () => clearMovementHistory(token, false) },
            { label: 'Reset & Revert', icon: 'modules/lancer-automations/icons/anticlockwise-rotation.svg', onClick: () => clearMovementHistory(token, true) },
        ];

        return {
            label: 'Utility',
            colLabel: 'Utility',
            getItems: () => [
                { label: 'Combat',    childColLabel: 'Combat',    getChildren: () => combatItems },
                { label: 'Gameplay',  childColLabel: 'Gameplay',  getChildren: () => gameplayItems },
                { label: 'Movement',  childColLabel: 'Movement',  getChildren: () => movementItems },
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
                    return [{ isSectionLabel: true, label: 'No systems' }];
                return systems.map(item => {
                    const sys = item.system;
                    const status = getItemStatus(item);
                    const labelHtml = status.destroyed ? `<s style="opacity:0.55;">${item.name}</s>` : item.name;
                    return {
                        label: labelHtml,
                        badge: status.badge ?? null,
                        badgeColor: status.badgeColor ?? null,
                        icon: item.img ?? null,
                        ...(this._systemHasChildren(item, actor) ? { childColLabel: item.name, getChildren: () => this._systemChildren(item, actor) } : {}),
                        highlightBg:          status.destroyed ? '#ffcccc' : status.unavailable ? '#ffe5b4' : null,
                        highlightBorderColor: status.destroyed ? '#cc3333' : status.unavailable ? '#cc7700' : null,
                        onRightClick: (row) => {
                            const existing = $('.la-hud-system-popup');
                            if (existing.length && existing.data('system-id') === item.id) {
                                existing.remove(); return;
                            }
                            existing.remove();
                            const effect   = sys.effect      ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;margin-bottom:4px;">${laFormatDetailHtml(sys.effect)}</div>`      : '';
                            const desc     = sys.description ? `<div style="font-size:0.82em;color:#888;line-height:1.4;">${laFormatDetailHtml(sys.description)}</div>`                   : '';
                            const tagsHtml = laRenderTags(sys.tags ?? []);
                            const bodyHtml = tagsHtml + effect + desc;
                            if (!bodyHtml)
                                return;
                            const subtitle = [sys.type, sys.license ? `${sys.manufacturer} ${sys.license_level}` : null].filter(Boolean).join(' · ');
                            const popup = laDetailPopup('la-hud-popup la-hud-system-popup', item.name, subtitle, bodyHtml, 'system');
                            popup.data('system-id', item.id);
                            this._showPopupAt(popup, row);
                        },
                        hoverData: { actor, item, action: null, category: 'Systems' },
                    };
                });
            },
        };
    }

    _systemHasChildren(/** @type {any} */ item, /** @type {any} */ actor) {
        const sys = item.system;
        const ACTIVATION_TAGS = ['tg_quick_action', 'tg_full_action', 'tg_protocol', 'tg_reaction', 'tg_free_action'];
        const hasActivationTag = (sys.tags ?? []).some(t => ACTIVATION_TAGS.includes(t.lid));
        if (hasActivationTag || (sys.actions ?? []).length) return true;
        if (this._getInvadeOptions(actor).some(opt => opt.item?.id === item.id)) return true;
        if (getItemDeployables(item, actor).length) return true;
        return false;
    }

    _systemChildren(/** @type {any} */ item, /** @type {any} */ actor) {
        const sys = item.system;
        const ap = a => this._actionPopup(a);
        const children = [];
        const ACTIVATION_TAGS = ['tg_quick_action', 'tg_full_action', 'tg_protocol', 'tg_reaction', 'tg_free_action'];
        const activationTag = (sys.tags ?? []).find(t => ACTIVATION_TAGS.includes(t.lid));
        if (activationTag && !(sys.actions ?? []).length) {
            const activation = activationTag.lid.replace('tg_', '').replace('_action', ' action');
            children.push({
                label: 'Activate',
                icon: getActivationIcon(activation),
                onClick: () => executeSimpleActivation(actor, { title: item.name, action: { name: item.name, activation }, detail: sys.effect ?? '' }),
                onRightClick: ap({ name: item.name, activation, detail: sys.effect ?? '' }),
                hoverData: { actor, item, action: { name: item.name, activation }, category: 'Systems' },
            });
        }
        for (const action of (sys.actions ?? [])) {
            children.push({
                label: action.name,
                icon: getActivationIcon(action),
                onClick: () => executeSimpleActivation(actor, { title: action.name, action, detail: action.detail ?? '' }),
                onRightClick: ap(action),
                hoverData: { actor, item, action, category: 'Systems' },
            });
        }
        const sysActionNames = new Set((sys.actions ?? []).map(/** @type {any} */ a => a.name));
        const invadeOpts = this._getInvadeOptions(actor).filter(opt => opt.item?.id === item.id && !sysActionNames.has(opt.name));
        for (const opt of invadeOpts) {
            children.push({
                label: opt.destroyed ? `<s style="opacity:0.55;">${opt.name}</s>` : opt.name,
                icon: ICON_TECH_QUICK,
                highlightBg:          opt.destroyed ? '#ffcccc' : opt.unavailable ? '#ffe5b4' : null,
                highlightBorderColor: opt.destroyed ? '#cc3333' : opt.unavailable ? '#cc7700' : null,
                hoverData: { actor, item: opt.item ?? null, action: opt.action ?? { name: opt.name, activation: 'Invade' }, category: 'Tech' },
                onClick: () => executeInvade(actor, opt),
                onRightClick: (/** @type {any} */ row) => {
                    const existing = $('.la-hud-invade-popup');
                    if (existing.length && existing.data('invade-name') === opt.name) {
                        existing.remove(); return;
                    }
                    existing.remove();
                    const detail = laFormatDetailHtml(opt.detail);
                    const bodyHtml = detail ? `<div style="margin:0;font-size:0.82em;line-height:1.5;">${detail}</div>` : '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
                    const sourceType  = opt.item?.system?.type ? ` (${opt.item.system.type})` : '';
                    const sourceLabel = opt.item?.name ? ` · ${opt.item.name}${sourceType}` : '';
                    const popup = laDetailPopup('la-hud-popup la-hud-invade-popup', opt.name, `Invade · Quick Tech${sourceLabel}`, bodyHtml, 'system');
                    popup.data('invade-name', opt.name);
                    this._showPopupAt(popup, row);
                },
            });
        }
        const lids = getItemDeployables(item, actor);
        if (lids.length) {
            children.push({ isSectionLabel: true, label: 'Deployables' });
            for (const lid of lids) {
                const depActor = /** @type {any} */ (game.actors)?.find(/** @type {any} */ a => a.type === 'deployable' && a.system?.lid === lid);
                children.push({
                    label: depActor?.name ?? lid,
                    icon:  depActor?.img  ?? 'systems/lancer/assets/icons/deployable.svg',
                    onClick: () => deployDeployable(actor, lid, item, true),
                    onRightClick: depActor ? (/** @type {any} */ row) => {
                        const body = laRenderDeployables([depActor]);
                        const srcType = item.system?.type ?? '';
                        const subtitle = `Deployable · ${item.name}${srcType ? ` (${srcType})` : ''}`;
                        const popup = laDetailPopup('la-hud-popup la-hud-deploy-popup', depActor.name, subtitle, body, 'system');
                        this._showPopupAt(popup, row);
                    } : null,
                });
            }
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
                    return [{ isSectionLabel: true, label: 'No frame equipped' }];
                const rows = [
                    { label: 'Core Power',  childColLabel: 'Core Power',  getChildren: () => this._corePowerItems(frame, actor) },
                    { label: 'Traits',      childColLabel: 'Traits',      getChildren: () => this._frameTraitItems(frame, actor) },
                    { label: 'Core Bonus',  childColLabel: 'Core Bonus',  getChildren: () => this._coreBonusItems(actor) },
                ];
                const intLids = [
                    ...(frame.system?.traits ?? []).flatMap((/** @type {any} */ t) => t.integrated ?? []),
                    ...(frame.system?.core_system?.integrated ?? []),
                ];
                if (intLids.length)
                    rows.push({ label: 'Integrated', childColLabel: 'Integrated', getChildren: () => this._frameIntegratedItems(frame, actor, intLids) });
                return rows;
            },
        };
    }

    _corePowerItems(/** @type {any} */ frame, /** @type {any} */ actor) {
        const ap = a => this._actionPopup(a);
        const cs = frame.system?.core_system;
        const coreName = cs?.active_name ?? 'Core Power';
        const coreUsed = actor.system?.core_energy === 0;
        const activeAction = cs?.active_actions?.[0];
        return [{
            label: coreName,
            icon: getActivationIcon(activeAction ?? 'Protocol'),
            highlightBg: coreUsed ? '#ffe5b4' : null,
            highlightBorderColor: coreUsed ? '#cc7700' : null,
            onClick: () => /** @type {any} */ (frame.beginCoreActiveFlow('system.core_system')),
            onRightClick: ap({ name: coreName, activation: activeAction?.activation ?? 'Protocol', detail: `<b>${frame.name} — Core Active</b><br>${cs?.active_effect ?? cs?.description ?? ''}` }),
        }];
    }

    _frameTraitItems(/** @type {any} */ frame, /** @type {any} */ actor) {
        const ap = a => this._actionPopup(a);
        const traits = frame.system?.traits ?? [];
        if (!traits.length)
            return [{ isSectionLabel: true, label: 'No traits' }];
        return traits.map(/** @type {any} */ trait => ({
            label: trait.name,
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
                    const depActor = /** @type {any} */ (game.actors)?.find(/** @type {any} */ a => a.type === 'deployable' && a.system?.lid === lid);
                    children.push({
                        label: depActor?.name ?? lid,
                        icon:  depActor?.img  ?? 'systems/lancer/assets/icons/deployable.svg',
                        onClick: () => deployDeployable(actor, lid, frame, true),
                        onRightClick: depActor ? (/** @type {any} */ row) => {
                            const body = laRenderDeployables([depActor]);
                            const popup = laDetailPopup('la-hud-popup la-hud-deploy-popup', depActor.name, `Deployable · ${trait.name} (Trait)`, body, 'system');
                            this._showPopupAt(popup, row);
                        } : null,
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
                if (!children.length)
                    children.push({ isSectionLabel: true, label: 'Passive' });
                return children;
            },
            onRightClick: (/** @type {any} */ row) => {
                const existing = $('.la-hud-trait-popup');
                if (existing.length && existing.data('trait-name') === trait.name) {
                    existing.remove(); return;
                }
                existing.remove();
                const bodyHtml = trait.description
                    ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;">${laFormatDetailHtml(trait.description)}</div>`
                    : '<div style="font-size:0.82em;color:#888;">No description.</div>';
                const popup = laDetailPopup('la-hud-popup la-hud-trait-popup', trait.name, `${frame.name} · Trait`, bodyHtml, 'system');
                popup.data('trait-name', trait.name);
                this._showPopupAt(popup, row);
            },
        }));
    }

    _coreBonusItems(/** @type {any} */ actor) {
        const bonuses = actor.items.filter(/** @type {any} */ i => i.type === 'core_bonus');
        return bonuses.map(/** @type {any} */ cb => ({
            label: cb.name,
            icon: cb.img ?? null,
            onRightClick: (/** @type {any} */ row) => {
                const existing = $('.la-hud-cb-popup');
                if (existing.length && existing.data('cb-id') === cb.id) {
                    existing.remove(); return;
                }
                existing.remove();
                const sys    = cb.system;
                const effect = sys?.effect      ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;margin-bottom:4px;">${laFormatDetailHtml(sys.effect)}</div>`      : '';
                const desc   = sys?.description ? `<div style="font-size:0.82em;color:#888;line-height:1.4;">${laFormatDetailHtml(sys.description)}</div>`                   : '';
                const bodyHtml = effect + desc;
                if (!bodyHtml)
                    return;
                const popup = laDetailPopup('la-hud-popup la-hud-cb-popup', cb.name, 'Core Bonus', bodyHtml, 'system');
                popup.data('cb-id', cb.id);
                this._showPopupAt(popup, row);
            },
        }));
    }

    _frameIntegratedItems(/** @type {any} */ frame, /** @type {any} */ actor, /** @type {string[]} */ lids) {
        const items = lids
            .map(lid => /** @type {any} */ (actor.items.find(/** @type {any} */ i => i.system?.lid === lid)))
            .filter(/** @type {any} */ i => !!i);
        return items.map(/** @type {any} */ intItem => {
            if (intItem.type === 'mech_weapon' || intItem.type === 'pilot_weapon')
                return this._weaponItem(intItem, null, null);
            return {
                label: intItem.name,
                icon: intItem.img ?? null,
                childColLabel: intItem.name,
                getChildren: () => this._systemChildren(intItem, actor),
                onRightClick: (/** @type {any} */ row) => {
                    const sys = intItem.system;
                    const effect = sys?.effect      ? `<div style="font-size:0.82em;color:#bbb;line-height:1.4;margin-bottom:4px;">${laFormatDetailHtml(sys.effect)}</div>`      : '';
                    const desc   = sys?.description ? `<div style="font-size:0.82em;color:#888;line-height:1.4;">${laFormatDetailHtml(sys.description)}</div>`                   : '';
                    const bodyHtml = laRenderTags(sys?.tags ?? []) + effect + desc;
                    if (!bodyHtml)
                        return;
                    const popup = laDetailPopup('la-hud-popup la-hud-system-popup', intItem.name, `Integrated · ${frame.name}`, bodyHtml, 'system');
                    this._showPopupAt(popup, row);
                },
            };
        });
    }

    _catTalents() {
        const actor = this._actor;
        return {
            label: 'Talents',
            colLabel: 'Talents',
            getItems: () => {
                const pilot = actor?.system?.pilot?.value ?? actor;
                if (!pilot)
                    return [{ isSectionLabel: true, label: 'No pilot linked' }];
                const talents = [...pilot.items.values()].filter(i => i.type === 'talent');
                if (!talents.length)
                    return [{ isSectionLabel: true, label: 'No talents' }];
                return talents.map(talent => ({
                    label: talent.name,
                    icon: talent.img ?? null,
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
                childColLabel: rankLabel,
                getChildren: (actions.length || counters.length) ? () => this._talentRankActionItems(talent.system.ranks[i], talent, i) : undefined,
                onRightClick: (row) => {
                    const key = `${talent.id}_${i}`;
                    const existing = $('.la-hud-talent-popup');
                    if (existing.length && existing.data('rank-key') === key) {
                        existing.remove(); return;
                    }
                    existing.remove();
                    const desc = laFormatDetailHtml(rank.description ?? '');
                    const descHtml = desc
                        ? `<div style="margin-bottom:8px;font-size:0.82em;line-height:1.5;color:#bbb;">${desc}</div>`
                        : '';
                    const actionsHtml = laRenderActions(rank.actions ?? []);
                    const rankCounters = rank.counters ?? [];
                    const countersHtml = rankCounters.length
                        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('RESOURCES', '#1a3a5c')}${rankCounters.map(c =>
                            `<div style="margin-top:4px;padding:4px 6px;background:rgba(255,255,255,0.04);border-radius:3px;display:flex;justify-content:space-between;align-items:center;">
                                <span style="font-size:0.78em;font-weight:bold;color:#ccc;">${c.name}</span>
                                <span style="font-size:0.78em;color:#aaa;">${c.value ?? 0} / ${c.max ?? 0}</span>
                            </div>`).join('')}</div>`
                        : '';
                    const bodyHtml = (descHtml + actionsHtml + countersHtml)
                        || '<div style="font-size:0.82em;color:#888;margin:0;">No description.</div>';
                    const popup = laDetailPopup('la-hud-popup la-hud-talent-popup', rankLabel, `${talent.name} · Rank ${roman[i] ?? i + 1}`, bodyHtml, 'system');
                    popup.data('rank-key', key);
                    this._showPopupAt(popup, row);
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
            actions.forEach(action => items.push({
                label: action.name,
                icon: getActivationIcon(action),
                onClick: () => executeSimpleActivation(this._actor, { title: action.name, action, detail: action.detail || '' }),
                onRightClick: this._actionPopup(action, talent.name),
            }));
        }

        if (counters.length) {
            if (hasBoth)
                items.push({ label: 'RESOURCES', isSectionLabel: true });
            counters.forEach((counter, cidx) => {
                const min     = 0;
                const isEmpty = counter.value <= min;
                const isFull  = counter.value >= counter.max;
                const path    = `system.ranks.${rankIdx}.counters.${cidx}.value`;
                const refresh = () => this._talentRankActionItems(talent.system.ranks[rankIdx], talent, rankIdx);
                items.push({
                    label: counter.name,
                    badge: `${counter.value}/${counter.max}`,
                    badgeColor: isEmpty ? '#c33' : !isFull ? '#cc7700' : '#3a9e6e',
                    highlightBg:          isEmpty ? '#ffcccc' : !isFull ? '#ffe5b4' : null,
                    highlightBorderColor: isEmpty ? '#cc3333' : !isFull ? '#cc7700' : null,
                    keepOpen: true,
                    refreshCol4: refresh,
                    onClick: isEmpty ? null : async () => talent.update({ [path]: counter.value - 1 }),
                    onRightClick: isFull ? null : () => {
                        this._pendingCol4Refresh = { fn: refresh, anchor: this._c4AnchorRow };
                        talent.update({ [path]: counter.value + 1 });
                    },
                });
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
                if (!rank) return;
                const counters = rank.counters ?? [];
                counters.forEach((counter, cidx) => {
                    const min     = 0;
                    const isEmpty = counter.value <= min;
                    const isFull  = counter.value >= counter.max;
                    const path    = `system.ranks.${rankIdx}.counters.${cidx}.value`;
                    const refresh = () => this._resourceItems();
                    items.push({
                        label: counter.name,
                        badge: `${counter.value}/${counter.max}`,
                        badgeColor: isEmpty ? '#c33' : !isFull ? '#cc7700' : '#3a9e6e',
                        icon: 'modules/lancer-automations/icons/perspective-dice-two.svg',
                        highlightBg:          isEmpty ? '#ffcccc' : !isFull ? '#ffe5b4' : null,
                        highlightBorderColor: isEmpty ? '#cc3333' : !isFull ? '#cc7700' : null,
                        keepOpen: true,
                        refreshCol4: refresh,
                        onClick: isEmpty ? null : async () => /** @type {any} */ (talent).update({ [path]: counter.value - 1 }),
                        onRightClick: isFull ? null : () => {
                            this._pendingCol4Refresh = { fn: refresh, anchor: this._c4AnchorRow };
                            /** @type {any} */ (talent).update({ [path]: counter.value + 1 });
                        },
                    });
                });
            });
        }
        return items;
    }

    _weaponItem(weapon, modItem, mount = null) {
        const sys    = weapon.system;
        const status = getItemStatus(weapon);
        const labelHtml = status.destroyed ? `<s style="opacity:0.55;">${weapon.name}</s>` : weapon.name;
        const highlightBg          = status.destroyed  ? '#ffcccc'               : status.unavailable ? '#ffe5b4'             : null;
        const highlightBorderColor = status.destroyed  ? '#cc3333'               : status.unavailable ? '#cc7700'              : null;
        return {
            label: labelHtml,
            badge: status.badge ?? null,
            badgeColor: status.badgeColor ?? null,
            childColLabel: weapon.name,
            highlightBg,
            highlightBorderColor,
            hoverData: { actor: this._actor, item: weapon, action: null, category: 'Weapons' },
            onClick: () => weapon.beginWeaponAttackFlow(),
            getChildren: () => this._weaponChildren(weapon, modItem, mount),
            onRightClick: (row) => {
                const existing = $('.la-hud-weapon-popup');
                if (existing.length && existing.data('weapon-id') === weapon.id) {
                    existing.remove();
                    return;
                }
                existing.remove();
                let profiles = sys.profiles ?? [];
                if (!profiles.length && weapon.type === 'npc_feature') {
                    const tierOverride = sys.tier_override ?? 0;
                    const tier = tierOverride > 0 ? tierOverride : (this._actor?.system?.tier ?? 1);
                    const tierIdx = Math.max(0, Math.min(2, tier - 1));
                    profiles = [{ name: null, damage: (sys.damage ?? [])[tierIdx] ?? [], range: sys.range ?? [], tags: sys.tags ?? [], effect: sys.effect || '', on_hit: sys.on_hit || '' }];
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
                if (!bodyHtml)
                    return;
                const subtitle = [sys.mount_type ?? sys.size, sys.weapon_type ?? sys.type].filter(Boolean).join(' · ');
                const popup = laDetailPopup('la-hud-popup la-hud-weapon-popup', weapon.name, subtitle, bodyHtml, 'weapon');
                popup.data('weapon-id', weapon.id);
                this._showPopupAt(popup, row);
            },
        };
    }

    _weaponChildren(weapon, modItem, mount) {
        const sys = weapon.system;
        const actor = this._actor;
        const addHover = children => children.map(child => {
            if (child.isSectionLabel || !child.onClick)
                return child;
            return { ...child, hoverData: { actor, item: weapon, action: child.action ?? { name: child.label, activation: child.activation ?? null }, category: 'Weapons' } };
        });
        if (actor.type === 'pilot') {
            return addHover(laHudItemChildren(weapon, {
                defaultActions: [{
                    label: 'FIGHT',
                    icon: 'systems/lancer/assets/icons/white/melee.svg',
                    onClick: () => executeFight(actor, weapon),
                }],
                modItem,
                showPopup: (popup, row) => this._showPopupAt(popup, row),
            }));
        }
        const isSuperHeavy = (sys.size || sys.type || '').toLowerCase() === 'superheavy';
        const bypassMount = mount ?? { slots: [{ weapon: { value: weapon } }] };
        return addHover(laHudItemChildren(weapon, {
            defaultActions: [{
                label: isSuperHeavy ? 'BARRAGE' : 'SKIRMISH',
                icon: isSuperHeavy
                    ? 'mdi mdi-hexagon-slice-6'
                    : 'mdi mdi-hexagon-slice-3',
                onClick: () => isSuperHeavy
                    ? executeBarrage(actor, bypassMount)
                    : executeSkirmish(actor, bypassMount),
            }],
            modItem,
            showPopup: (popup, row) => this._showPopupAt(popup, row),
        }));
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

    _actionPopup(action, source = null) {
        return (/** @type {any} */ row) => {
            const existing = $('.la-hud-action-popup');
            if (existing.length && existing.data('action-key') === action.name) {
                existing.remove(); return;
            }
            existing.remove();
            const sourceName = typeof source === 'string' ? source : /** @type {any} */ (source)?.name ?? null;
            const sourceType = typeof source === 'string' ? null : /** @type {any} */ (source)?.system?.type ?? null;
            const body = laRenderActionDetail(action, { sourceName });
            const subtitleParts = [action.activation ?? ''];
            if (sourceName)
                subtitleParts.push(sourceType ? `${sourceName} (${sourceType})` : sourceName);
            const popup = laDetailPopup('la-hud-popup la-hud-action-popup', action.name, subtitleParts.filter(Boolean).join(' · '), body, 'system');
            popup.data('action-key', action.name);
            this._showPopupAt(popup, row);
        };
    }

    _getActionsByActivation(actor, activationType, category = null) {
        return getActorActionItems(actor, activationType).map(({ action, sourceItem }) => {
            const status = sourceItem ? getItemStatus(sourceItem) : { badge: null, badgeColor: null, unavailable: false, destroyed: false };
            return {
                label: status.destroyed ? `<s style="opacity:0.55;">${action.name}</s>` : action.name,
                badge: status.badge ?? null,
                badgeColor: status.badgeColor ?? null,
                icon: getActivationIcon(action) ?? sourceItem?.img ?? null,
                highlightBg:          status.destroyed ? '#ffcccc' : status.unavailable ? '#ffe5b4' : null,
                highlightBorderColor: status.destroyed ? '#cc3333' : status.unavailable ? '#cc7700' : null,
                onClick: () => executeSimpleActivation(actor, { title: action.name, action, detail: action.detail || '' }),
                onRightClick: this._actionPopup(action, sourceItem),
                hoverData: { actor, item: sourceItem ?? null, action, category },
            };
        });
    }

    _buildStatsHtml(actor) {
        const sys = actor.system;
        const strVal    = sys.structure?.value ?? 4;
        const strMax    = sys.structure?.max  ?? 4;
        const stressVal = sys.stress?.value   ?? 4;
        const stressMax = sys.stress?.max     ?? 4;
        const hp          = sys.hp     ?? { value: 0, max: 0 };
        const heat        = sys.heat   ?? { value: 0, max: 0 };
        const overshield  = sys.overshield?.value ?? 0;
        const repairs     = sys.repairs?.value ?? 0;
        const burn        = sys.burn ?? 0;
        const oc          = sys.overcharge ?? 0;
        const reaction    = sys.action_tracker?.reaction ?? false;

        const lerpColor = (r1, g1, b1, r2, g2, b2, t) => {
            const r = Math.round(r1 + (r2 - r1) * t);
            const g = Math.round(g1 + (g2 - g1) * t);
            const b = Math.round(b1 + (b2 - b1) * t);
            return `rgb(${r},${g},${b})`;
        };
        const hpRatio    = hp.max > 0 ? hp.value / hp.max : 1;
        const heatRatio  = heat.max > 0 ? heat.value / heat.max : 0;
        const hpColor    = lerpColor(244, 67, 54,  76, 175, 80,  hpRatio);   // red→green
        const heatColor  = lerpColor(136, 136, 136, 244, 67, 54, heatRatio); // grey→red

        const strPips    = Array.from({ length: strMax },    (_, i) => `<span style="color:${i >= strMax    - strVal    ? '#e8d060' : '#3a3a3a'};">◆</span>`).join('');
        const stressPips = Array.from({ length: stressMax }, (_, i) => `<span style="color:${i >= stressMax - stressVal ? '#e07830' : '#3a3a3a'};">●</span>`).join('');

        const ocLabels = ['—', '1d3', '1d6', '1d6+4'];
        const ocColor    = oc > 0 ? '#f88040' : '#555';
        const SEP = `<span style="color:#444;">│</span>`;
        const repairImg   = `<img src="systems/lancer/assets/icons/white/repair.svg" title="Repairs" style="width:1.4em;height:1.4em;vertical-align:middle;opacity:${repairs > 0 ? 1 : 0.3};">`;
        const reactionNum = `<span title="Reaction" style="color:${reaction ? '#a855f7' : '#aaa'};font-weight:bold;">${reaction ? '1' : '0'}</span>`;
        const reactionImg = `<img src="systems/lancer/assets/icons/white/reaction.svg" title="Reaction" style="width:1.4em;height:1.4em;vertical-align:middle;opacity:${reaction ? 1 : 0.3};">`;
        const overshieldHtml = overshield > 0 ? `${SEP}<span title="Overshield" style="color:#60a5fa;">${overshield}🛡</span>` : '';
        return `<div id="la-hud-stats" style="background:#111;border-bottom:2px solid #991e2a;padding:3px 10px 5px;font-size:0.85em;color:#888;width:max-content;pointer-events:none;">` +
            `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;">` +
            `${strPips}${SEP}<span title="HP" style="color:${hpColor};">${hp.value}/${hp.max} ♥</span>${overshieldHtml}${SEP}${repairImg}<span style="color:${repairs > 0 ? '#66cc66' : '#aaa'};">${repairs}</span>` +
            `</div>` +
            `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;margin-top:2px;">` +
            `${stressPips}${SEP}<span title="Heat" style="color:${heatColor};">${heat.value}/${heat.max}🌡</span>${burn > 0 ? `${SEP}<span title="Burn" style="color:#ff6600;">🔥${burn}</span>` : ''}${SEP}<span title="Overcharge" style="color:${ocColor};">⚡${ocLabels[Math.min(oc, 3)]}</span>${SEP}${reactionImg}${reactionNum}` +
            `</div>` +
            `</div>`;
    }

    _showPopupAt(popup, anchorEl) {
        $('body').append(popup);
        const offset = anchorEl.offset() ?? { left: 300, top: 100 };
        const pw = popup.outerWidth(), ph = popup.outerHeight();
        const wx = window.innerWidth,  wy = window.innerHeight;
        let px = offset.left + anchorEl.outerWidth() + 2;
        if (px + pw > wx - 10)
            px = offset.left - pw - 2;
        let py = offset.top;
        if (py + ph > wy - 10)
            py = wy - ph - 10;
        const finalLeft = Math.max(10, px);
        popup.css({ position: 'fixed', left: finalLeft - 20, top: Math.max(10, py), opacity: 0 });
        popup.animate({ left: finalLeft, opacity: 1 }, { duration: 150, easing: 'swing' });
        laBindPopupBehavior(popup);
        // HUD-specific: hovering the popup keeps columns alive
        popup.on('mouseenter', this._cancelCollapse).on('mouseleave', this._scheduleCollapse);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _saveOpenPath() {
        if (!this._el || !this._c2?.is(':visible'))
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
        if (!path || path.c1Idx < 0)
            return;
        const c1 = this._el.children().first();
        const c1Row = c1.find('.la-hud-row').eq(path.c1Idx);
        if (!c1Row.length)
            return;
        c1Row.trigger('mouseenter');
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

    _makeRow(label, hasArrow, icon = null, activation = null, badge = null, badgeColor = null) {
        const iconHtml = icon ? laHudRenderIcon(icon) : '';
        const arrow = hasArrow ? `<span style="opacity:0.5;font-size:0.75em;margin-left:6px;flex-shrink:0;">▶</span>` : '';
        const actHtml = activation
            ? `<span style="font-size:0.68em;color:#777;font-weight:normal;margin-left:5px;letter-spacing:0;white-space:nowrap;">[${activation}]</span>`
            : '';
        const badgeHtml = badge
            ? `<span style="font-size:0.92em;font-weight:bold;color:${badgeColor ?? '#3a9e6e'};margin-left:6px;flex-shrink:0;white-space:nowrap;letter-spacing:0;">${badge}</span>`
            : '';
        const row = $(`<div class="la-hud-row" style="${S_ITEM}">${iconHtml}<span class="la-hud-clip" style="flex:1;overflow:hidden;min-width:0;"><span class="la-hud-pan" style="display:inline-block;white-space:nowrap;padding-right:8px;">${label}${actHtml}</span></span>${badgeHtml}${arrow}</div>`);
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
