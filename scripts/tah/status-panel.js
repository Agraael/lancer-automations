/* global $, game, CONFIG */

import { removeGlobalBonus, removeConstantBonus } from '../bonuses/genericBonuses.js';
import { playUiSound } from './sound.js';

function getBonusDetailStr(/** @type {any} */ b) {
    if (b.type === 'accuracy')
        return `Accuracy +${b.val}`;
    if (b.type === 'difficulty')
        return `Difficulty +${b.val}`;
    if (b.type === 'stat')
        return `${b.stat?.split('.').pop() || b.stat} ${Number.parseInt(b.val) >= 0 ? '+' : ''}${b.val}`;
    if (b.type === 'damage')
        return (b.damage || []).map((/** @type {any} */ d) => `${d.val} ${d.type}`).join(' + ');
    if (b.type === 'tag')
        return b.removeTag ? `Remove Tag: ${b.tagName}` : `${b.tagMode === 'override' ? 'Set' : 'Add'} ${b.tagName} ${b.val}`;
    if (b.type === 'range')
        return `${b.rangeMode === 'override' ? 'Set' : 'Add'} ${b.rangeType} ${b.val}`;
    if (b.type === 'immunity') {
        if (b.subtype === 'effect' && b.effects)
            return `Immunity: ${b.effects.join(', ')}`;
        if ((b.subtype === 'damage' || b.subtype === 'resistance') && b.damageTypes)
            return `${b.subtype}: ${b.damageTypes.join(', ')}`;
        if (b.subtype === 'crit')
            return 'Crit immunity';
        if (b.subtype === 'hit')
            return 'Hit immunity';
        if (b.subtype === 'miss')
            return 'Miss immunity';
        return b.subtype;
    }
    if (b.type === 'target_modifier') {
        const labels = {
            invisible: 'Invisible (50% miss)',
            no_invisible: 'Not Invisible',
            no_cover: 'No Cover',
            soft_cover: 'Soft Cover',
            hard_cover: 'Hard Cover',
            ap: 'Armor Piercing',
            half_damage: 'Half Damage',
            paracausal: 'Cannot be Reduced',
            crit: 'Force Crit',
            hit: 'Force Hit',
            miss: 'Force Miss'
        };
        return `Target: ${labels[b.subtype] || b.subtype}`;
    }
    if (b.type === 'multi' && Array.isArray(b.bonuses))
        return b.bonuses.map(getBonusDetailStr).join(' | ');
    return b.type || '?';
}

const BG_DEFAULT = '#f5f5f5';
const BG_HOVER   = 'color-mix(in srgb, var(--primary-color) 18%, #f5f5f5)';

export class StatusPanel {
    constructor({ actor, token, tokens, el, cancelCollapse, scheduleCollapse, incDepth, decDepth }) {
        this._actor           = actor;
        this._token           = token;
        this._tokens          = tokens ?? [token];
        this._el              = el;
        this._cancelCollapse  = cancelCollapse;
        this._scheduleCollapse = scheduleCollapse;
        this._incDepth        = incDepth;
        this._decDepth        = decDepth;

        this._panel        = null;
        this._anchor       = null;
        this._subtypePanel = null;
    }

    get isVisible() {
        return this._panel?.is(':visible') ?? false;
    }

    close() {
        $('.la-status-tooltip').remove();
        if (this._subtypePanel) {
            this._subtypePanel.remove();
            this._subtypePanel = null;
        }
        if (this._panel) {
            const panel = this._panel;
            this._panel = null;
            panel.stop(true).animate({ opacity: 0, marginLeft: -10 }, 250, function() {
                $(this).remove();
            });
        }
    }

    syncRows() {
        if (!this._panel || !this._actor)
            return;
        const actor = this._actor;
        const hasSC = !!game.modules.get('statuscounter')?.active;
        this._panel.find('[data-status-id]').each(function() {
            const el = $(this);
            const sid = el.attr('data-status-id');
            const effects = /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ e => e.statuses?.has(sid) && !e.disabled);
            const nowActive = effects.length > 0;
            const nowPerm = nowActive && effects.some(/** @type {any} */ e => {
                const la = /** @type {any} */ (e.flags)?.['lancer-automations'];
                const dur = la?.duration ?? /** @type {any} */ (e.flags)?.['csm-lancer-qol']?.duration;
                return dur?.label === 'permanent';
            });
            el.data('active', nowActive);
            el.data('permanent', nowPerm);
            const bg = nowActive ? (nowPerm ? '#f0e0a0' : '#b8d4f0') : BG_DEFAULT;
            const border = nowActive ? (nowPerm ? '#a07020' : '#1a4a7a') : 'transparent';
            el.css({ background: bg, borderLeftColor: border });
            const totalStack = hasSC ? effects.reduce((sum, /** @type {any} */ e) => sum + (e.getFlag?.('statuscounter', 'value') ?? 1), 0) : 0;
            const parts = [];
            if (hasSC && totalStack > 1)
                parts.push(`×${totalStack}`);
            if (effects.length > 1)
                parts.push(`[${effects.length}]`);
            el.find('.la-status-badge').text(parts.join(' '));
        });
    }

    refresh() {
        if (this._panel && this._anchor)
            this.open(this._anchor);
    }

    open(anchorRow) {
        $('.la-status-tooltip').remove();
        if (this._panel) {
            this._panel.stop(true).remove();
            this._panel = null;
        }
        this._anchor = anchorRow;
        const actor = this._actor;
        const token = this._token;
        if (!actor || !token)
            return;

        // ── Module checks ──────────────────────────────────────────────────────
        const hasSC  = !!game.modules.get('statuscounter')?.active;
        const hasTCS = !!game.modules.get('temporary-custom-statuses')?.active;
        const tcsApi = hasTCS ? /** @type {any} */ (game.modules.get('temporary-custom-statuses'))?.api : null;
        const savedStatuses = hasTCS ? (game.settings.get('temporary-custom-statuses', 'savedStatuses') ?? []) : [];
        const activeCustomEffects = hasTCS
            ? /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ e =>
                e.getFlag?.('temporary-custom-statuses', 'isCustom') &&
                !e.getFlag?.('lancer-automations', 'linkedBonusId')
            )
            : [];
        const customMap = new Map();
        savedStatuses.forEach(/** @type {any} */ s => customMap.set(s.name, { name: s.name, icon: s.icon }));
        activeCustomEffects.forEach(/** @type {any} */ e => {
            const name = e.getFlag?.('temporary-custom-statuses', 'originalName') || e.name;
            if (!customMap.has(name))
                customMap.set(name, { name, icon: e.img ?? '' });
        });
        const customSaved = [...customMap.values()];

        // ── Data helpers ───────────────────────────────────────────────────────
        // active first, alphabetic within each group
        const activeStatusIds = new Set();
        for (const e of /** @type {any} */ (actor.effects)) {
            if (e.disabled)
                continue;
            for (const sid of (e.statuses ?? []))
                activeStatusIds.add(sid);
        }
        const allStatuses = (/** @type {any} */ (CONFIG).statusEffects ?? [])
            .filter(/** @type {any} */ s => s.id)
            .sort(/** @type {any} */ (a, b) => {
                const aA = activeStatusIds.has(a.id);
                const bA = activeStatusIds.has(b.id);
                if (aA !== bA)
                    return aA ? -1 : 1;
                return (a.name ?? a.id).localeCompare(b.name ?? b.id);
            });

        const getEffectsForStatus = (/** @type {string} */ sid) =>
            /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ e => e.statuses?.has(sid) && !e.disabled);

        const getStack = (/** @type {any} */ eff) =>
            hasSC ? (eff.getFlag?.('statuscounter', 'value') ?? 1) : 1;

        const isActive = (/** @type {any} */ s) => getEffectsForStatus(s.id).length > 0;

        // permanent if any active effect declares duration.label === 'permanent'
        const isPermanent = (/** @type {any} */ s) => {
            for (const eff of getEffectsForStatus(s.id)) {
                const la = /** @type {any} */ (eff.flags)?.['lancer-automations'];
                const dur = la?.duration ?? /** @type {any} */ (eff.flags)?.['csm-lancer-qol']?.duration;
                if (dur?.label === 'permanent')
                    return true;
            }
            return false;
        };

        // active-row colors: yellow when any active effect is permanent, blue otherwise
        const ACTIVE_BG_NORMAL    = '#b8d4f0';
        const ACTIVE_BORDER_NORMAL = '#1a4a7a';
        const ACTIVE_BG_PERM      = '#f0e0a0';
        const ACTIVE_BORDER_PERM  = '#a07020';
        const activeBg     = (/** @type {boolean} */ perm) => perm ? ACTIVE_BG_PERM : ACTIVE_BG_NORMAL;
        const activeBorder = (/** @type {boolean} */ perm) => perm ? ACTIVE_BORDER_PERM : ACTIVE_BORDER_NORMAL;

        const isCustomActive = (/** @type {string} */ name) =>
            /** @type {any[]} */ ([...actor.effects]).some(/** @type {any} */ e =>
                (e.getFlag?.('temporary-custom-statuses', 'originalName') === name || e.name === name) &&
                !e.disabled
            );

        const getStatusBadge = (/** @type {any} */ s) => {
            const effects = getEffectsForStatus(s.id);
            if (!effects.length)
                return '';
            const totalStack = hasSC ? effects.reduce((sum, e) => sum + getStack(e), 0) : 0;
            const parts = [];
            if (hasSC && totalStack > 1)
                parts.push(`×${totalStack}`);
            if (effects.length > 1)
                parts.push(`[${effects.length}]`);
            return parts.join(' ');
        };

        const buildStatusTooltip = (/** @type {any} */ s) => {
            const effects = getEffectsForStatus(s.id);
            const lines = [];
            if (s.description)
                lines.push(`<div class="la-tooltip-line">${s.description}</div>`);
            for (const eff of effects) {
                const la = /** @type {any} */ (eff.flags)?.['lancer-automations'];
                const sc = hasSC ? (eff.getFlag?.('statuscounter', 'value') ?? 1) : null;
                let label = 'Base Effect';
                if (la?.consumption) {
                    const t = la.consumption?.trigger;
                    const triggerLabel = Array.isArray(t) ? t.join(', ') : t;
                    label = `Consume: ${typeof la.consumption === 'string' ? la.consumption : (triggerLabel ?? la.consumption?.type ?? 'Effect')}`;
                } else if (la?.linkedBonusId)
                    label = 'Bonus Effect';
                const stackStr = sc && sc > 1 ? ` ×${sc}` : '';
                if (effects.length > 1 || stackStr)
                    lines.push(`<div class="la-tooltip-label">${label}${stackStr}</div>`);
                const dur = la?.duration ?? /** @type {any} */ (eff.flags)?.['csm-lancer-qol']?.duration;
                if (dur?.label)
                    lines.push(`<div class="la-tooltip-duration">Duration: ${dur.label}</div>`);
            }
            return lines.length ? lines.join('') : null;
        };

        // ── In-place helpers ───────────────────────────────────────────────────
        const setRowActive = (/** @type {any} */ rowEl, /** @type {boolean} */ nowActive, /** @type {boolean} */ perm = false) => {
            rowEl.data('active', nowActive);
            rowEl.data('permanent', nowActive && perm);
            rowEl.css({
                background: nowActive ? activeBg(perm) : BG_DEFAULT,
                borderLeftColor: nowActive ? activeBorder(perm) : 'transparent'
            });
        };
        const updateRowBadge = (/** @type {any} */ rowEl, /** @type {any} */ s) => {
            rowEl.find('.la-status-badge').text(getStatusBadge(s));
        };

        // ── Tooltip helper ─────────────────────────────────────────────────────
        const showTooltip = (/** @type {any} */ rowEl, /** @type {any} */ s) => {
            const body = buildStatusTooltip(s);
            if (!body)
                return null;
            const label = game.i18n.localize(s.name ?? s.id);
            const tt = $(`<div class="la-status-tooltip">
                <div class="la-status-tooltip__title">${label}</div>
                <div class="la-status-tooltip__body">${body}</div>
            </div>`);
            $('body').append(tt);
            const rect = /** @type {HTMLElement} */ (rowEl[0]).getBoundingClientRect();
            const ttH = tt.outerHeight() ?? 0;
            const top = Math.min(rect.top, window.innerHeight - ttH - 8);
            tt.css({ top, left: rect.right + 6 });
            return tt;
        };

        // ── Search bar ─────────────────────────────────────────────────────────
        const searchBar = $(`<input type="text" class="la-status-search" placeholder="Search statuses…">`);
        const searchWrap = $(`<div class="la-status-search-wrap"><i class="fas fa-search la-status-search-icon"></i></div>`);
        searchWrap.append(searchBar);

        // ── Status grid ────────────────────────────────────────────────────────
        const gridEl = $(`<div class="lancer-scroll la-hud-status-grid"></div>`);
        for (const s of allStatuses) {
            const active = isActive(s);
            const perm   = active && isPermanent(s);
            const badge  = getStatusBadge(s);
            const bg     = active ? activeBg(perm) : BG_DEFAULT;
            const border = active ? activeBorder(perm) : 'transparent';
            const rowEl = $(`<div class="la-hud-status-row" style="background:${bg};border-left-color:${border};" data-status-id="${s.id}">
                <img class="la-status-row__img" src="${s.icon ?? s.img ?? ''}" onerror="this.style.display='none'">
                <span class="la-status-name">${game.i18n.localize(s.name ?? s.id)}</span>
                <span class="la-status-badge">${badge}</span>
            </div>`);
            rowEl.data('active', active);
            rowEl.data('permanent', perm);

            let tooltipEl = /** @type {any} */ (null);
            let tooltipTimer = null;
            rowEl.on('mouseenter', function() {
                playUiSound('statusHover');
                if (!$(this).data('active'))
                    $(this).css({ background: BG_HOVER, borderLeftColor: '#aaa' });
                const self = $(this);
                tooltipTimer = setTimeout(() => {
                    tooltipEl = showTooltip(self, s);
                }, 600);
            }).on('mouseleave', function() {
                clearTimeout(tooltipTimer); tooltipTimer = null;
                tooltipEl?.remove(); tooltipEl = null;
                const a = $(this).data('active');
                const p = $(this).data('permanent');
                $(this).css({ background: a ? activeBg(p) : BG_DEFAULT, borderLeftColor: a ? activeBorder(p) : 'transparent' });
            });

            // Left-click: toggle / increment / open subtype manager
            rowEl.on('click', async () => {
                playUiSound('toggle');
                const effects = getEffectsForStatus(s.id);
                if (effects.length > 1) {
                    this._openSubtypeManager(actor, s, effects, rowEl);
                    return;
                }
                this._incDepth();
                try {
                    if (hasSC && effects.length === 1) {
                        const eff = effects[0];
                        await eff.update({ 'flags.statuscounter.value': getStack(eff) + 1, 'flags.statuscounter.visible': true });
                    } else {
                        for (const t of this._tokens)
                            await /** @type {any} */ (t).toggleEffect(s);
                    }
                    updateRowBadge(rowEl, s);
                    setRowActive(rowEl, isActive(s), isPermanent(s));
                } finally {
                    this._decDepth();
                }
            });

            // Right-click: decrement / delete
            rowEl.on('contextmenu', async (ev) => {
                ev.preventDefault();
                playUiSound('toggle');
                const effects = getEffectsForStatus(s.id);
                if (effects.length > 1) {
                    this._openSubtypeManager(actor, s, effects, rowEl);
                    return;
                }
                if (effects.length === 0) {
                    // Right-click on inactive: same as left-click toggle
                    this._incDepth();
                    try {
                        for (const t of this._tokens)
                            await /** @type {any} */ (t).toggleEffect(s);
                        updateRowBadge(rowEl, s);
                        setRowActive(rowEl, isActive(s), isPermanent(s));
                    } finally {
                        this._decDepth();
                    }
                    return;
                }
                this._incDepth();
                try {
                    const eff = effects[0];
                    const stack = getStack(eff);
                    if (hasSC && stack > 1) {
                        await eff.update({ 'flags.statuscounter.value': stack - 1, 'flags.statuscounter.visible': stack - 1 > 1 });
                    } else {
                        await actor.deleteEmbeddedDocuments('ActiveEffect', [eff.id]);
                        // Broadcast removal to all other tokens
                        for (const t of this._tokens.slice(1)) {
                            const te = [...t.actor.effects].find(e => e.statuses?.has(s.id) && !e.disabled);
                            if (te)
                                await t.actor.deleteEmbeddedDocuments('ActiveEffect', [te.id]);
                        }
                    }
                    updateRowBadge(rowEl, s);
                    setRowActive(rowEl, isActive(s), isPermanent(s));
                } finally {
                    this._decDepth();
                }
            });

            gridEl.append(rowEl);
        }

        // ── Right column ───────────────────────────────────────────────────────
        const rightEl = $(`<div class="la-hud-right-col"></div>`);

        const laApi = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
        if (laApi?.executeEffectManager) {
            const emBtn = $(`<button class="la-hud-util-btn">Effect Manager</button>`);
            emBtn.on('mouseenter', () => playUiSound('statusHover'));
            emBtn.on('click', () => {
                playUiSound('toggle'); laApi.executeEffectManager();
            });
            rightEl.append(emBtn);
        }
        const clearBtn = $(`<button class="la-hud-util-btn la-hud-util-btn--secondary">Clear All Effects</button>`);
        clearBtn.on('mouseenter', () => playUiSound('statusHover'));
        clearBtn.on('click', async () => {
            playUiSound('toggle');
            this._incDepth();
            try {
                const ids = /** @type {any[]} */ ([...actor.effects]).map(/** @type {any} */ e => e.id);
                if (ids.length)
                    await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
                gridEl.find('[data-status-id]').each(function() {
                    setRowActive($(this), false);
                    $(this).find('.la-status-badge').text('');
                });
            } finally {
                this._decDepth();
            }
        });
        rightEl.append(clearBtn);

        if (hasTCS) {
            const getCustomEffects = (/** @type {string} */ name) =>
                /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ e =>
                    (e.getFlag?.('temporary-custom-statuses', 'originalName') === name || e.name === name) && !e.disabled
                );

            const getCustomBadge = (/** @type {string} */ name) => {
                const effs = getCustomEffects(name);
                if (!effs.length)
                    return '';
                const totalStack = hasSC ? effs.reduce((sum, /** @type {any} */ e) => sum + (e.getFlag?.('statuscounter', 'value') ?? 1), 0) : 0;
                const parts = [];
                if (hasSC && totalStack > 1)
                    parts.push(`×${totalStack}`);
                if (effs.length > 1)
                    parts.push(`[${effs.length}]`);
                return parts.join(' ');
            };

            rightEl.append($(`<div class="la-hud-panel-section-header">Custom</div>`));
            const customListEl = $(`<div class="lancer-scroll la-hud-custom-list"></div>`);
            for (const cs of /** @type {any[]} */ (customSaved)) {
                const active = isCustomActive(cs.name);
                const badge  = getCustomBadge(cs.name);
                const bg     = active ? '#b8d4f0' : BG_DEFAULT;
                const border = active ? '#1a4a7a' : 'transparent';
                const cRow = $(`<div class="la-hud-status-row" style="background:${bg};border-left-color:${border};">
                    <img class="la-status-row__img" src="${cs.icon ?? ''}" onerror="this.style.display='none'">
                    <span class="la-status-name">${cs.name}</span>
                    <span class="la-status-badge">${badge}</span>
                </div>`);
                cRow.on('mouseenter', function() {
                    playUiSound('statusHover');
                    if (!$(this).data('active'))
                        $(this).css({ background: BG_HOVER, borderLeftColor: '#aaa' });
                }).on('mouseleave', function() {
                    const a = $(this).data('active');
                    $(this).css({ background: a ? '#b8d4f0' : BG_DEFAULT, borderLeftColor: a ? '#1a4a7a' : 'transparent' });
                });
                cRow.data('active', active);

                const updateCRow = () => {
                    cRow.find('.la-status-badge').text(getCustomBadge(cs.name));
                    setRowActive(cRow, isCustomActive(cs.name));
                    this.syncRows();
                };

                // Left-click: same as regular — increment stack if SC+active, else add/toggle
                cRow.on('click', async () => {
                    playUiSound('toggle');
                    const effs = getCustomEffects(cs.name);
                    if (effs.length > 1) {
                        this._openSubtypeManager(actor, { id: cs.name, name: cs.name, icon: cs.icon }, effs, cRow);
                        return;
                    }
                    this._incDepth();
                    try {
                        if (hasSC && effs.length === 1) {
                            const eff = effs[0];
                            await eff.update({ 'flags.statuscounter.value': getStack(eff) + 1, 'flags.statuscounter.visible': true });
                        } else if (effs.length === 0) {
                            for (const t of this._tokens)
                                await tcsApi.addStatus(t.actor, cs.name, cs.icon, 1);
                        } else {
                            await actor.deleteEmbeddedDocuments('ActiveEffect', [effs[0].id]);
                            for (const t of this._tokens.slice(1)) {
                                const eff = [...t.actor.effects].find(e => e.getFlag?.('temporary-custom-statuses', 'originalName') === cs.name || e.name === cs.name);
                                if (eff)
                                    await t.actor.deleteEmbeddedDocuments('ActiveEffect', [eff.id]);
                            }
                        }
                        updateCRow();
                    } finally {
                        this._decDepth();
                    }
                });

                // Right-click: same as regular — decrement/delete if active, add if inactive
                cRow.on('contextmenu', async (ev) => {
                    ev.preventDefault();
                    playUiSound('toggle');
                    const effs = getCustomEffects(cs.name);
                    if (effs.length > 1) {
                        this._openSubtypeManager(actor, { id: cs.name, name: cs.name, icon: cs.icon }, effs, cRow);
                        return;
                    }
                    if (effs.length === 0) {
                        this._incDepth();
                        try {
                            for (const t of this._tokens)
                                await tcsApi.addStatus(t.actor, cs.name, cs.icon, 1);
                            updateCRow();
                        } finally {
                            this._decDepth();
                        }
                        return;
                    }
                    this._incDepth();
                    try {
                        const eff = effs[0];
                        const stack = getStack(eff);
                        if (hasSC && stack > 1) {
                            await eff.update({ 'flags.statuscounter.value': stack - 1, 'flags.statuscounter.visible': stack - 1 > 1 });
                        } else {
                            await actor.deleteEmbeddedDocuments('ActiveEffect', [eff.id]);
                            for (const t of this._tokens.slice(1)) {
                                const oe = [...t.actor.effects].find(e => e.getFlag?.('temporary-custom-statuses', 'originalName') === cs.name || e.name === cs.name);
                                if (oe)
                                    await t.actor.deleteEmbeddedDocuments('ActiveEffect', [oe.id]);
                            }
                        }
                        updateCRow();
                    } finally {
                        this._decDepth();
                    }
                });

                customListEl.append(cRow);
            }
            if (!customSaved.length)
                customListEl.append($(`<div class="la-status-empty">No custom statuses</div>`));
            rightEl.append(customListEl);
        }

        // ── Bonuses ────────────────────────────────────────────────────────────
        const globalBonuses   = /** @type {any[]} */ (actor.getFlag('lancer-automations', 'global_bonuses')   || []);
        const constantBonuses = /** @type {any[]} */ (actor.getFlag('lancer-automations', 'constant_bonuses') || []);
        const allBonuses = [
            ...globalBonuses.map((/** @type {any} */ b, i) => ({ b, kind: 'global', idx: i })),
            ...constantBonuses.map((/** @type {any} */ b, i) => ({ b, kind: 'constant', idx: i })),
        ];
        rightEl.append($(`<div class="la-hud-panel-section-header">Bonuses</div>`));
        const bonusListEl = $(`<div class="lancer-scroll la-bonus-list"></div>`);
        if (!allBonuses.length) {
            bonusListEl.append($(`<div class="la-status-empty">No bonuses</div>`));
        } else {
            for (const { b, kind } of allBonuses) {
                const detail = getBonusDetailStr(b);
                const kindBadge = kind === 'constant' ? ' <span class="la-bonus-row__kind">(const)</span>' : '';
                const row = $(`<div class="la-bonus-row" title="${b.name}: ${detail}">
                    <div class="la-bonus-row__body">
                        <b>${b.name}</b>${kindBadge}<br>
                        <span class="la-bonus-row__detail">${detail}</span>
                    </div>
                    <i class="la-bonus-del fas fa-trash" title="Delete bonus"></i>
                </div>`);
                row.find('.la-bonus-del').on('mouseenter', function() {
                    $(this).css('opacity', '1');
                })
                    .on('mouseleave', function() {
                        $(this).css('opacity', '0.45');
                    })
                    .on('click', async (ev) => {
                        ev.stopPropagation();
                        if (kind === 'global')
                            await removeGlobalBonus(actor, b.id);
                        else
                            await removeConstantBonus(actor, b.id);
                        row.remove();
                        if (!bonusListEl.children().length)
                            bonusListEl.append($(`<div class="la-status-empty">No bonuses</div>`));
                    });
                bonusListEl.append(row);
            }
        }
        rightEl.append(bonusListEl);

        // ── Assemble panel ──────────────────────────────────────────────────────
        const panel = $(`<div class="la-hud-status-panel"></div>`);
        const leftWrap = $(`<div class="la-status-leftwrap"></div>`);
        const header = $(`<div class="la-hud-col-label">Statuses</div>`);
        searchBar.on('input', function () {
            const q = String($(this).val()).toLowerCase().trim();
            gridEl.find('[data-status-id]').each(function () {
                const name = $(this).find('.la-status-name').text().toLowerCase();
                $(this).toggle(!q || name.includes(q));
            });
        });
        searchBar.on('click mousedown', (ev) => ev.stopPropagation());
        leftWrap.append(header, searchWrap, gridEl);
        panel.append(leftWrap, rightEl);

        let topInHud  = anchorRow.offset().top - this._el.offset().top;
        const leftInHud = /** @type {any} */ (this._el.children().first()).outerWidth();
        panel.css({ position: 'absolute', top: topInHud, left: leftInHud, zIndex: 10 });

        this._el.append(panel);

        // Clamp so the panel fits in the viewport; shift up if it would overflow the bottom.
        const margin = 8;
        const panelHeight = /** @type {any} */ (panel[0]).getBoundingClientRect().height;
        const hudTop = this._el.offset().top;
        const maxTopInHud = window.innerHeight - margin - panelHeight - hudTop;
        if (topInHud > maxTopInHud)
            topInHud = Math.max(margin - hudTop, maxTopInHud);
        panel.css({ top: topInHud });

        panel.on('mouseleave', this._scheduleCollapse).on('mouseenter', this._cancelCollapse);
        panel.css({ opacity: 0, marginLeft: -10 }).animate({ opacity: 1, marginLeft: 0 }, 150);
        this._panel = panel;
    }

    _openSubtypeManager(actor, statusConfig, effects, anchorRow) {
        if (this._subtypePanel) {
            this._subtypePanel.remove(); this._subtypePanel = null;
        }
        const hasSC = !!game.modules.get('statuscounter')?.active;
        const getStack = (/** @type {any} */ eff) => hasSC ? (eff.getFlag?.('statuscounter', 'value') ?? 1) : 1;
        const statusName = game.i18n.localize(statusConfig.name ?? statusConfig.id);

        const panel = $(`<div class="la-hud-sub-panel"></div>`);
        const hdr   = $(`<div class="la-hud-sub-header">${statusName} <span class="la-sub-close">✕</span></div>`);
        const body  = $(`<div></div>`);
        panel.append(hdr, body);
        hdr.find('.la-sub-close').on('click', () => {
            panel.remove(); this._subtypePanel = null;
        });

        const refresh = () => {
            const current = /** @type {any[]} */ ([...actor.effects]).filter(e => effects.some(/** @type {any} */ o => o.id === e.id));
            if (!current.length) {
                panel.remove(); this._subtypePanel = null; this.syncRows(); return;
            }
            body.empty();
            for (const eff of current) {
                const la = /** @type {any} */ (eff.flags)?.['lancer-automations'];
                let label = 'Base';
                if (la?.consumption)
                    label = 'Consume';
                else if (la?.linkedBonusId)
                    label = 'Bonus';
                const stack = getStack(eff);
                const row = $(`<div class="la-hud-sub-row" data-eid="${eff.id}">
                    <span class="la-sub-label">${label}</span>
                    <span class="la-sub-stack">×${stack}</span>
                    ${hasSC ? `<span class="la-sub-minus la-sub-btn la-sub-btn--minus">−</span>` : ''}
                    ${hasSC ? `<span class="la-sub-plus la-sub-btn la-sub-btn--plus">+</span>` : ''}
                    <span class="la-sub-del la-sub-btn la-sub-btn--del">✕</span>
                </div>`);
                row.find('.la-sub-minus').on('click', async () => {
                    const e = /** @type {any} */ (actor.effects).get(eff.id);
                    if (!e)
                        return;
                    const s = getStack(e);
                    if (s > 1)
                        await e.update({ 'flags.statuscounter.value': s - 1, 'flags.statuscounter.visible': s - 1 > 1 });
                    else
                        await actor.deleteEmbeddedDocuments('ActiveEffect', [eff.id]);
                    refresh();
                });
                row.find('.la-sub-plus').on('click', async () => {
                    const e = /** @type {any} */ (actor.effects).get(eff.id);
                    if (!e)
                        return;
                    const s = getStack(e);
                    await e.update({ 'flags.statuscounter.value': s + 1, 'flags.statuscounter.visible': true });
                    refresh();
                });
                row.find('.la-sub-del').on('click', async () => {
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

        // Slide up from the row — fixed to body, animates like the HUD columns (opacity + position)
        const rect     = anchorRow[0].getBoundingClientRect();
        const panelH   = panel.outerHeight() || 0;
        const panelW   = panel.outerWidth()  || 200;
        const goAbove  = rect.top - panelH > 4;
        const finalTop = goAbove ? rect.top - panelH : rect.bottom;
        const startTop = goAbove ? rect.top           : rect.bottom - panelH;
        const left     = Math.min(rect.left, window.innerWidth - panelW - 8);
        panel.css({ position: 'fixed', top: startTop, left, zIndex: 9999, opacity: 0, width: 'fit-content' });
        panel.animate({ top: finalTop, opacity: 1 }, 250);
    }
}
