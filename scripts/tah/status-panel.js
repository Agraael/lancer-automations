/* global $, game, CONFIG */

function getBonusDetailStr(/** @type {any} */ b) {
    if (b.type === 'accuracy')   return `Accuracy +${b.val}`;
    if (b.type === 'difficulty') return `Difficulty +${b.val}`;
    if (b.type === 'stat')       return `${b.stat?.split('.').pop() || b.stat} ${Number.parseInt(b.val) >= 0 ? '+' : ''}${b.val}`;
    if (b.type === 'damage')     return (b.damage || []).map((/** @type {any} */ d) => `${d.val} ${d.type}`).join(' + ');
    if (b.type === 'tag')        return b.removeTag ? `Remove Tag: ${b.tagName}` : `${b.tagMode === 'override' ? 'Set' : 'Add'} ${b.tagName} ${b.val}`;
    if (b.type === 'range')      return `${b.rangeMode === 'override' ? 'Set' : 'Add'} ${b.rangeType} ${b.val}`;
    if (b.type === 'immunity') {
        if (b.subtype === 'effect' && b.effects)                                    return `Immunity: ${b.effects.join(', ')}`;
        if ((b.subtype === 'damage' || b.subtype === 'resistance') && b.damageTypes) return `${b.subtype}: ${b.damageTypes.join(', ')}`;
        if (b.subtype === 'crit')  return 'Crit immunity';
        if (b.subtype === 'hit')   return 'Hit immunity';
        if (b.subtype === 'miss')  return 'Miss immunity';
        return b.subtype;
    }
    if (b.type === 'multi' && Array.isArray(b.bonuses)) return b.bonuses.map(getBonusDetailStr).join(' | ');
    return b.type || '?';
}

const BG_DEFAULT = '#f5f5f5';
const BG_HOVER   = '#ffe0e0';
const S_COL_LABEL = [
    'padding:3px 12px 4px',
    'background:#991e2a',
    'color:#fff',
    'font-size:0.68em',
    'letter-spacing:1px',
    'text-transform:uppercase',
    'font-weight:bold',
].join(';') + ';';

export class StatusPanel {
    constructor({ actor, token, el, cancelCollapse, scheduleCollapse, incDepth, decDepth }) {
        this._actor           = actor;
        this._token           = token;
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
        if (this._subtypePanel) {
            this._subtypePanel.remove();
            this._subtypePanel = null;
        }
        if (this._panel) {
            this._panel.stop(true).remove();
            this._panel = null;
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
            el.data('active', nowActive);
            el.css({ background: nowActive ? '#b8d4f0' : BG_DEFAULT, borderLeftColor: nowActive ? '#1a4a7a' : 'transparent' });
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
            ? /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ e => e.getFlag?.('temporary-custom-statuses', 'isCustom'))
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
        const allStatuses = (/** @type {any} */ (CONFIG).statusEffects ?? [])
            .filter(/** @type {any} */ s => s.id)
            .sort(/** @type {any} */ (a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

        const getEffectsForStatus = (/** @type {string} */ sid) =>
            /** @type {any[]} */ ([...actor.effects]).filter(/** @type {any} */ e => e.statuses?.has(sid) && !e.disabled);

        const getStack = (/** @type {any} */ eff) =>
            hasSC ? (eff.getFlag?.('statuscounter', 'value') ?? 1) : 1;

        const isActive = (/** @type {any} */ s) => getEffectsForStatus(s.id).length > 0;

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
                lines.push(`<div style="color:#bbb;margin-bottom:4px;line-height:1.4;">${s.description}</div>`);
            for (const eff of effects) {
                const la = /** @type {any} */ (eff.flags)?.['lancer-automations'];
                const sc = hasSC ? (eff.getFlag?.('statuscounter', 'value') ?? 1) : null;
                let label = 'Base Effect';
                if (la?.consumption)
                    label = `Consume: ${typeof la.consumption === 'string' ? la.consumption : (la.consumption?.trigger ?? la.consumption?.type ?? 'Effect')}`;
                else if (la?.linkedBonusId)
                    label = 'Bonus Effect';
                const stackStr = sc && sc > 1 ? ` ×${sc}` : '';
                if (effects.length > 1 || stackStr)
                    lines.push(`<div style="font-weight:bold;color:#fff;margin-top:4px;">${label}${stackStr}</div>`);
                const dur = la?.duration ?? /** @type {any} */ (eff.flags)?.['csm-lancer-qol']?.duration;
                if (dur?.label)
                    lines.push(`<div style="color:#aaa;font-size:0.85em;margin-top:2px;">Duration: ${dur.label}</div>`);
            }
            return lines.length ? lines.join('') : null;
        };

        // ── Styles ─────────────────────────────────────────────────────────────
        const S_PANEL      = 'display:flex;flex-direction:row;gap:4px;background:#f5f5f5;border:2px solid #991e2a;border-radius:3px;box-shadow:0 4px 16px rgba(0,0,0,0.45);font-family:inherit;font-size:0.8em;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;';
        const S_STATUS_GRID = `overflow-y:auto;overflow-x:hidden;max-height:420px;padding:4px;display:grid;grid-template-columns:repeat(3,1fr);gap:0;min-width:500px;`;
        const S_STATUS_ROW  = `display:flex;align-items:center;gap:5px;padding:1px 5px;margin-bottom:0;cursor:pointer;border-radius:2px;border-left:3px solid transparent;`;
        const S_RIGHT_COL   = `display:flex;flex-direction:column;gap:4px;width:160px;flex-shrink:0;padding:4px;`;
        const S_UTIL_BTN    = `padding:4px 6px;background:#991e2a;color:#fff;border:none;border-radius:2px;cursor:pointer;font-size:0.78em;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;width:100%;text-align:left;`;
        const S_CUSTOM_LIST = `overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:1px;`;
        const S_PANEL_HEADER = `background:#991e2a;color:#fff;padding:3px 8px;font-size:0.75em;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;border-radius:1px;margin-bottom:4px;flex-shrink:0;`;
        const S_TOOLTIP     = 'position:fixed;z-index:9999;background:#1a1a1a;border:1px solid #555;border-radius:3px;padding:6px 8px;max-width:260px;font-size:0.78em;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.6);';

        // ── In-place helpers ───────────────────────────────────────────────────
        const setRowActive = (/** @type {any} */ rowEl, /** @type {boolean} */ nowActive) => {
            rowEl.data('active', nowActive);
            rowEl.css({ background: nowActive ? '#b8d4f0' : BG_DEFAULT, borderLeftColor: nowActive ? '#1a4a7a' : 'transparent' });
        };
        const updateRowBadge = (/** @type {any} */ rowEl, /** @type {any} */ s) => {
            rowEl.find('.la-status-badge').text(getStatusBadge(s));
        };

        // ── Tooltip helper ─────────────────────────────────────────────────────
        const showTooltip = (/** @type {any} */ rowEl, /** @type {any} */ s) => {
            const tip = buildStatusTooltip(s);
            if (!tip)
                return null;
            const tt = $(`<div class="la-status-tooltip" style="${S_TOOLTIP}">${tip}</div>`);
            $('body').append(tt);
            const rect = /** @type {HTMLElement} */ (rowEl[0]).getBoundingClientRect();
            const ttH = tt.outerHeight() ?? 0;
            const top = Math.min(rect.top, window.innerHeight - ttH - 8);
            tt.css({ top, left: rect.right + 6 });
            return tt;
        };

        // ── Status grid ────────────────────────────────────────────────────────
        const gridEl = $(`<div style="${S_STATUS_GRID}"></div>`);
        for (const s of allStatuses) {
            const active = isActive(s);
            const badge  = getStatusBadge(s);
            const bg     = active ? '#b8d4f0' : BG_DEFAULT;
            const border = active ? '#1a4a7a' : 'transparent';
            const rowEl = $(`<div style="${S_STATUS_ROW}background:${bg};border-left-color:${border};" data-status-id="${s.id}">
                <img src="${s.icon ?? s.img ?? ''}" style="width:30px;height:30px;object-fit:contain;flex-shrink:0;image-rendering:pixelated;background:#2a2a2a;border-radius:2px;padding:2px;" onerror="this.style.display='none'">
                <span class="la-status-name" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${game.i18n.localize(s.name ?? s.id)}</span>
                <span class="la-status-badge" style="font-size:0.78em;color:#555;flex-shrink:0;margin-left:3px;">${badge}</span>
            </div>`);
            rowEl.data('active', active);

            let tooltipEl = /** @type {any} */ (null);
            let tooltipTimer = null;
            rowEl.on('mouseenter', function() {
                if (!$(this).data('active'))
                    $(this).css({ background: BG_HOVER, borderLeftColor: '#aaa' });
                const self = $(this);
                tooltipTimer = setTimeout(() => { tooltipEl = showTooltip(self, s); }, 600);
            }).on('mouseleave', function() {
                clearTimeout(tooltipTimer); tooltipTimer = null;
                tooltipEl?.remove(); tooltipEl = null;
                const a = $(this).data('active');
                $(this).css({ background: a ? '#b8d4f0' : BG_DEFAULT, borderLeftColor: a ? '#1a4a7a' : 'transparent' });
            });

            // Left-click: toggle / increment / open subtype manager
            rowEl.on('click', async () => {
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
                        await /** @type {any} */ (token).toggleEffect(s);
                    }
                    updateRowBadge(rowEl, s);
                    setRowActive(rowEl, isActive(s));
                } finally {
                    this._decDepth();
                }
            });

            // Right-click: decrement / delete
            rowEl.on('contextmenu', async (ev) => {
                ev.preventDefault();
                const effects = getEffectsForStatus(s.id);
                if (effects.length > 1) {
                    this._openSubtypeManager(actor, s, effects, rowEl);
                    return;
                }
                if (effects.length === 0) {
                    // Right-click on inactive: same as left-click toggle
                    this._incDepth();
                    try {
                        await /** @type {any} */ (token).toggleEffect(s);
                        updateRowBadge(rowEl, s);
                        setRowActive(rowEl, isActive(s));
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
                    }
                    updateRowBadge(rowEl, s);
                    setRowActive(rowEl, isActive(s));
                } finally {
                    this._decDepth();
                }
            });

            gridEl.append(rowEl);
        }

        // ── Right column ───────────────────────────────────────────────────────
        const rightEl = $(`<div style="${S_RIGHT_COL}"></div>`);

        const laApi = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
        if (laApi?.executeEffectManager) {
            const emBtn = $(`<button style="${S_UTIL_BTN}">Effect Manager</button>`);
            emBtn.on('click', () => laApi.executeEffectManager());
            rightEl.append(emBtn);
        }
        const clearBtn = $(`<button style="${S_UTIL_BTN}background:#444;">Clear All Effects</button>`);
        clearBtn.on('click', async () => {
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
                if (!effs.length) return '';
                const totalStack = hasSC ? effs.reduce((sum, /** @type {any} */ e) => sum + (e.getFlag?.('statuscounter', 'value') ?? 1), 0) : 0;
                const parts = [];
                if (hasSC && totalStack > 1) parts.push(`×${totalStack}`);
                if (effs.length > 1) parts.push(`[${effs.length}]`);
                return parts.join(' ');
            };

            rightEl.append($(`<div style="${S_PANEL_HEADER}">Custom</div>`));
            const customListEl = $(`<div style="${S_CUSTOM_LIST}"></div>`);
            for (const cs of /** @type {any[]} */ (customSaved)) {
                const active = isCustomActive(cs.name);
                const badge  = getCustomBadge(cs.name);
                const bg     = active ? '#b8d4f0' : BG_DEFAULT;
                const border = active ? '#1a4a7a' : 'transparent';
                const cRow = $(`<div style="${S_STATUS_ROW}background:${bg};border-left-color:${border};">
                    <img src="${cs.icon ?? ''}" style="width:30px;height:30px;object-fit:contain;flex-shrink:0;image-rendering:pixelated;background:#2a2a2a;border-radius:2px;padding:2px;" onerror="this.style.display='none'">
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cs.name}</span>
                    <span class="la-status-badge" style="font-size:0.78em;color:#555;flex-shrink:0;margin-left:3px;">${badge}</span>
                </div>`);
                cRow.on('mouseenter', function() {
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
                            await tcsApi.addStatus(actor, cs.name, cs.icon, 1);
                        } else {
                            await tcsApi.removeStatus(actor, effs[0].id);
                        }
                        updateCRow();
                    } finally {
                        this._decDepth();
                    }
                });

                // Right-click: same as regular — decrement/delete if active, add if inactive
                cRow.on('contextmenu', async (ev) => {
                    ev.preventDefault();
                    const effs = getCustomEffects(cs.name);
                    if (effs.length > 1) {
                        this._openSubtypeManager(actor, { id: cs.name, name: cs.name, icon: cs.icon }, effs, cRow);
                        return;
                    }
                    if (effs.length === 0) {
                        this._incDepth();
                        try {
                            await tcsApi.addStatus(actor, cs.name, cs.icon, 1);
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
                            await tcsApi.removeStatus(actor, eff.id);
                        }
                        updateCRow();
                    } finally {
                        this._decDepth();
                    }
                });

                customListEl.append(cRow);
            }
            if (!customSaved.length)
                customListEl.append($(`<div style="font-size:0.78em;color:#888;padding:4px;">No custom statuses</div>`));
            rightEl.append(customListEl);
        }

        // ── Bonuses ────────────────────────────────────────────────────────────
        const globalBonuses   = /** @type {any[]} */ (actor.getFlag('lancer-automations', 'global_bonuses')   || []);
        const constantBonuses = /** @type {any[]} */ (actor.getFlag('lancer-automations', 'constant_bonuses') || []);
        const allBonuses = [
            ...globalBonuses.map((/** @type {any} */ b, i) => ({ b, kind: 'global', idx: i })),
            ...constantBonuses.map((/** @type {any} */ b, i) => ({ b, kind: 'constant', idx: i })),
        ];
        rightEl.append($(`<div style="${S_PANEL_HEADER}">Bonuses</div>`));
        const bonusListEl = $(`<div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:1px;"></div>`);
        if (!allBonuses.length) {
            bonusListEl.append($(`<div style="font-size:0.78em;color:#888;padding:4px;">No bonuses</div>`));
        } else {
            for (const { b, kind, idx } of allBonuses) {
                const detail = getBonusDetailStr(b);
                const kindBadge = kind === 'constant' ? ' <span style="opacity:0.6;font-size:0.85em;">(const)</span>' : '';
                const row = $(`<div style="font-size:0.75em;padding:2px 4px;line-height:1.4;display:flex;align-items:flex-start;gap:3px;" title="${b.name}: ${detail}">
                    <div style="flex:1;">
                        <b>${b.name}</b>${kindBadge}<br>
                        <span style="color:#666;">${detail}</span>
                    </div>
                    <i class="la-bonus-del fas fa-trash" style="cursor:pointer;color:#991e2a;opacity:0.45;flex-shrink:0;padding:2px;font-size:0.9em;" title="Delete bonus"></i>
                </div>`);
                row.find('.la-bonus-del').on('mouseenter', function() { $(this).css('opacity', '1'); })
                    .on('mouseleave', function() { $(this).css('opacity', '0.45'); })
                    .on('click', async (ev) => {
                        ev.stopPropagation();
                        const key = kind === 'global' ? 'global_bonuses' : 'constant_bonuses';
                        const current = /** @type {any[]} */ ([...(actor.getFlag('lancer-automations', key) || [])]);
                        current.splice(idx, 1);
                        await actor.setFlag('lancer-automations', key, current);
                        row.remove();
                        if (!bonusListEl.children().length)
                            bonusListEl.append($(`<div style="font-size:0.78em;color:#888;padding:4px;">No bonuses</div>`));
                    });
                bonusListEl.append(row);
            }
        }
        rightEl.append(bonusListEl);

        // ── Assemble panel ──────────────────────────────────────────────────────
        const panel = $(`<div style="${S_PANEL}"></div>`);
        const leftWrap = $(`<div style="display:flex;flex-direction:column;flex:1;min-width:0;"></div>`);
        const header = $(`<div style="${S_COL_LABEL}">Statuses</div>`);
        leftWrap.append(header, gridEl);
        panel.append(leftWrap, rightEl);

        const topInHud  = anchorRow.offset().top - this._el.offset().top;
        const leftInHud = /** @type {any} */ (this._el.children().first()).outerWidth();
        panel.css({ position: 'absolute', top: topInHud, left: leftInHud, zIndex: 10 });

        this._el.append(panel);
        panel.on('mouseleave', this._scheduleCollapse).on('mouseenter', this._cancelCollapse);
        panel.css({ opacity: 0, marginLeft: -10 }).animate({ opacity: 1, marginLeft: 0 }, 140);
        this._panel = panel;
    }

    _openSubtypeManager(actor, statusConfig, effects, anchorRow) {
        if (this._subtypePanel) {
            this._subtypePanel.remove(); this._subtypePanel = null;
        }
        const hasSC = !!game.modules.get('statuscounter')?.active;
        const getStack = (/** @type {any} */ eff) => hasSC ? (eff.getFlag?.('statuscounter', 'value') ?? 1) : 1;
        const statusName = game.i18n.localize(statusConfig.name ?? statusConfig.id);
        const S_PANEL = 'background:#2a2a2a;border:1px solid #991e2a;border-radius:3px;box-shadow:0 2px 8px rgba(0,0,0,0.6);font-family:inherit;font-size:0.78em;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;min-width:180px;';
        const S_HDR   = 'background:#991e2a;color:#fff;padding:2px 6px;display:flex;justify-content:space-between;align-items:center;border-radius:2px 2px 0 0;';
        const S_ROW   = 'display:flex;align-items:center;gap:4px;padding:2px 6px;border-bottom:1px solid #3a3a3a;';
        const S_BTN   = 'display:inline-block;border-radius:2px;cursor:pointer;width:18px;height:16px;line-height:16px;font-weight:bold;flex-shrink:0;text-align:center;user-select:none;';

        const panel = $(`<div style="${S_PANEL}position:absolute;z-index:20;"></div>`);
        const hdr   = $(`<div style="${S_HDR}">${statusName} <span class="la-sub-close" style="cursor:pointer;margin-left:8px;opacity:0.8;">✕</span></div>`);
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
                const row = $(`<div style="${S_ROW}" data-eid="${eff.id}">
                    <span style="flex:1;color:#ccc;text-transform:none;letter-spacing:0;">${label}</span>
                    <span style="color:#fff;min-width:18px;text-align:center;">×${stack}</span>
                    ${hasSC ? `<span class="la-sub-minus" style="${S_BTN}background:#555;color:#fff;">−</span>` : ''}
                    ${hasSC ? `<span class="la-sub-plus"  style="${S_BTN}background:#3a6a3a;color:#fff;">+</span>` : ''}
                    <span class="la-sub-del" style="${S_BTN}background:#6a2a2a;color:#fff;">✕</span>
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
        panel.animate({ top: finalTop, opacity: 1 }, 140);
    }
}
