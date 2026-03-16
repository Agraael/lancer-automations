/* global $ */

/**
 * Shared popup rendering helpers for lancer-automations choice dialogs.
 * Used by combat.js (choseMount, choseSystem, choseTrait, chooseInvade)
 * and structure.js (showSystemTraumaDialog).
 */

// ── Layout utilities ──────────────────────────────────────────────────────────

/**
 * Returns a coloured section-label badge for detail popups.
 * @param {string} text
 * @param {string} bg  CSS colour
 * @returns {string}
 */
export function laPopupSectionLabel(text, bg) {
    return `<span style="display:inline-block;background:${bg};color:#fff;font-size:0.65em;padding:1px 5px;border-radius:2px;font-weight:bold;letter-spacing:0.5px;margin-bottom:3px;">${text}</span>`;
}

/**
 * Binds the standard popup interactions: close button, mod-block toggle,
 * click-outside dismiss, and stopPropagation.
 * Called by both laPositionPopup (dialog context) and LancerHUD._showPopupAt (HUD context).
 * @param {JQuery} popup
 */
export function laBindPopupBehavior(popup) {
    popup.find('.la-detail-close').on('click', () => popup.remove());
    popup.on('click', '.la-mod-block', function() {
        const body = $(this).find('.la-mod-body');
        const toggle = $(this).find('.la-mod-toggle');
        body.slideToggle(120);
        toggle.text(body.is(':visible') ? '▶' : '▼');
    });
    popup.on('click', e => e.stopPropagation());
    $(document).one('click', () => popup.remove());
}

/**
 * Appends a popup next to the parent dialog with a slide-from-left animation,
 * then binds close + outside-click dismiss.
 * @param {JQuery} popup
 * @param {JQuery} html  Dialog render-callback html element
 */
export function laPositionPopup(popup, html) {
    $('body').append(popup);
    const dlg = html.closest('.app');
    const dlgOffset = dlg.offset() ?? { left: 100, top: 100 };
    const dlgW = dlg.outerWidth() ?? 480;
    const pw = popup.outerWidth(), ph = popup.outerHeight();
    const wx = window.innerWidth, wy = window.innerHeight;
    let px = dlgOffset.left + dlgW + 8;
    if (px + pw > wx - 10)
        px = dlgOffset.left - pw - 8;
    let py = dlgOffset.top;
    if (py + ph > wy - 10)
        py = wy - ph - 10;
    const finalLeft = Math.max(10, px);
    popup.css({ left: finalLeft - 20, top: Math.max(10, py), opacity: 0 });
    popup.animate({ left: finalLeft, opacity: 1 }, { duration: 150, easing: 'swing' });
    laBindPopupBehavior(popup);
}

// ── Content renderers ─────────────────────────────────────────────────────────

/**
 * Strips raw HTML from Lancer item data and returns clean, readable HTML.
 * Block-level tags (p, br, li, div) become newlines; remaining tags are stripped.
 * Use this on any `action.detail`, `system.effect`, description, etc. before embedding.
 * @param {string} rawHtml
 * @returns {string}  Plain text with <br> separators, safe to embed in innerHTML
 */
export function laFormatDetailHtml(rawHtml) {
    if (!rawHtml) return '';
    const withBreaks = String(rawHtml)
        .replaceAll(/<\/p>/gi, '\n')
        .replaceAll(/<br\s*\/?>/gi, '\n')
        .replaceAll(/<\/li>/gi, '\n')
        .replaceAll(/<\/div>/gi, '\n');
    const text = $('<div>').html(withBreaks).text()
        .replaceAll(/\n{3,}/g, '\n\n')
        .trim();
    return text ? text.replaceAll('\n', '<br>') : '';
}

/**
 * Renders a flex row of tag chips.
 * @param {Array} tags
 * @param {Function} [resolveStr]  Optional string resolver (e.g. tier resolution)
 * @returns {string}
 */
export function laRenderTags(tags, resolveStr) {
    if (!tags?.length) return '';
    const resolve = resolveStr ?? (s => s);
    const chips = tags.map(t => {
        const raw = String(t._resolvedName ?? t.name ?? t.lid ?? t.id ?? '');
        const text = resolve(raw).replaceAll('{VAL}', resolve(String(t.val ?? '')));
        return `<span style="background:rgba(255,255,255,0.1);border:1px solid #555;border-radius:3px;padding:1px 6px;font-size:0.75em;color:#ccc;">${text}</span>`;
    }).join('');
    return `<div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:4px;">${chips}</div>`;
}

/**
 * Renders a labeled text block (EFFECT, ON HIT, etc.).
 * @param {string} label  Section label text
 * @param {string} text
 * @param {string} labelColor  CSS colour for label badge
 * @param {Function} [resolveStr]  Optional string resolver
 * @returns {string}
 */
export function laRenderTextSection(label, text, labelColor, resolveStr) {
    if (!text) return '';
    const resolve = resolveStr ?? (s => s);
    return `<div style="margin-bottom:6px;">${laPopupSectionLabel(label, labelColor)}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(resolve(text))}</div></div>`;
}

/**
 * Renders an actions list.
 * @param {Array} actions
 * @param {Function} [resolveStr]
 * @returns {string}
 */
export function laRenderActions(actions, resolveStr) {
    if (!actions?.length) return '';
    const resolve = resolveStr ?? (s => s);
    const items = actions.map(a => {
        const aEffect = laFormatDetailHtml(resolve(a.detail || a.effect || ''));
        return `<div style="margin-top:4px;padding:4px 6px;background:rgba(255,255,255,0.04);border-radius:3px;">
            <div style="font-size:0.78em;font-weight:bold;color:#ccc;">${a.name || ''}${a.activation ? `<span style="font-size:0.85em;font-weight:normal;color:#888;margin-left:6px;">[${a.activation}]</span>` : ''}</div>
            ${aEffect ? `<div style="font-size:0.78em;color:#aaa;margin-top:2px;line-height:1.3;">${aEffect}</div>` : ''}
        </div>`;
    }).join('');
    return `<div style="margin-bottom:4px;">${laPopupSectionLabel('ACTIONS', '#1a5c3a')}${items}</div>`;
}

/**
 * Renders a deployable actors section.
 * @param {Array} deployableActors
 * @returns {string}
 */
export function laRenderDeployables(deployableActors) {
    if (!deployableActors?.length) return '';
    const items = deployableActors.map(dep => {
        const ds = dep.system;
        const statPairs = [
            ds?.hp?.max != null ? `HP ${ds.hp.max}` : null,
            ds?.size != null ? `Size ${ds.size}` : null,
            ds?.armor != null && ds.armor > 0 ? `Armor ${ds.armor}` : null,
            ds?.evasion != null ? `Evasion ${ds.evasion}` : null,
            ds?.edef != null ? `E-Def ${ds.edef}` : null,
            ds?.speed != null && ds.speed > 0 ? `Speed ${ds.speed}` : null,
            ds?.heatcap != null && ds.heatcap > 0 ? `Heat ${ds.heatcap}` : null,
            ds?.save != null && ds.save > 0 ? `Save ${ds.save}` : null
        ].filter(Boolean);
        const depEffect = laFormatDetailHtml(ds?.effect || '');
        return `<div style="margin-top:4px;padding:5px 7px;background:rgba(74,16,112,0.1);border:1px solid rgba(74,16,112,0.35);border-radius:3px;">
            <div style="font-size:0.78em;font-weight:bold;color:#c084fc;margin-bottom:3px;">${dep.name}</div>
            ${statPairs.length ? `<div style="font-size:0.75em;color:#aaa;display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${depEffect ? '4' : '0'}px;">${statPairs.map(s => `<span>${s}</span>`).join('')}</div>` : ''}
            ${depEffect ? `<div style="font-size:0.77em;color:#bbb;line-height:1.3;">${depEffect}</div>` : ''}
        </div>`;
    }).join('');
    return `<div style="margin-bottom:4px;">${laPopupSectionLabel('DEPLOYABLE', '#4a1070')}${items}</div>`;
}

/**
 * Renders a single weapon profile block (damage, range, tags, on_hit, effect).
 * @param {Object} p  Profile data
 * @param {boolean} showName  Whether to show the profile name header
 * @returns {string}
 */
export function laRenderWeaponProfile(p, showName) {
    const nameHdr = showName && p.name
        ? `<div style="font-size:0.75em;font-weight:bold;color:#aaa;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;margin-top:2px;">${p.name}</div>`
        : '';
    const damageHtml = p.damage?.length
        ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('DAMAGE', '#b71c1c')}<div style="font-size:0.88em;color:#eee;margin-top:2px;">${p.damage.map(d => `<b>${d.val}</b> ${d.type}`).join(' + ')}</div></div>`
        : '';
    const rangeHtml = p.range?.length
        ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('RANGE', '#1565c0')}<div style="font-size:0.88em;color:#eee;margin-top:2px;">${p.range.map(r => `<b>${r.val}</b> ${r.type}`).join(' · ')}</div></div>`
        : '';
    const tagsHtml = laRenderTags(p.tags);
    const onHitHtml = p.on_hit
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('ON HIT', '#6a1b9a')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(p.on_hit)}</div></div>`
        : '';
    const effectHtml = p.effect
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('EFFECT', '#e65100')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(p.effect)}</div></div>`
        : '';
    return `${nameHdr}${damageHtml}${rangeHtml}${tagsHtml}${onHitHtml}${effectHtml}`;
}

/**
 * Renders a weapon mod block.
 * @param {string} modName
 * @param {Object} modItem  The mod item (modItem.system has effect, tags, etc.)
 * @returns {string}
 */
export function laRenderWeaponMod(modName, modItem) {
    const ms = modItem?.system;
    const modEffect = laFormatDetailHtml(ms?.effect || ms?.description || '');
    const modActionsHtml = laRenderActions(ms?.actions ?? []);
    const modTagsArr = ms?.tags ?? [];
    const modTagsHtml = modTagsArr.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;">${modTagsArr.map(t => {
            const tn = String(t.name ?? t.lid ?? t.id ?? '').replaceAll('{VAL}', t.val ?? '');
            return `<span style="background:rgba(255,255,255,0.08);border:1px solid #555;border-radius:3px;padding:0 5px;font-size:0.72em;color:#ccc;">${tn}</span>`;
        }).join('')}</div>`
        : '';
    const modBody = `${modActionsHtml}${modEffect ? `<div style="font-size:0.8em;color:#bbb;margin-top:3px;line-height:1.3;">${modEffect}</div>` : ''}${modTagsHtml}`;
    const hasDetail = !!(modEffect || modTagsArr.length || modActionsHtml);
    return `<div class="la-mod-block" style="margin-bottom:8px;padding:5px 7px;background:rgba(255,100,0,0.07);border:1px solid rgba(255,100,0,0.35);border-radius:3px;${hasDetail ? 'cursor:pointer;' : ''}">
        <div style="font-size:0.72em;font-weight:bold;color:#ff6400;letter-spacing:0.4px;display:flex;justify-content:space-between;align-items:center;">
            <span>MOD · ${modName}</span>
            ${hasDetail ? '<span class="la-mod-toggle" style="opacity:0.6;font-size:0.9em;">▶</span>' : ''}
        </div>
        ${hasDetail ? `<div class="la-mod-body" style="display:none;margin-top:3px;">${modBody}</div>` : ''}
    </div>`;
}

/**
 * Renders the full body HTML for a single weapon: actions, profiles (collapsible
 * when more than one), then an optional mod block.
 *
 * @param {Array}        profiles
 * @param {Object}       [opts]
 * @param {Array}        [opts.actions=[]]
 * @param {string|null}  [opts.modName=null]         Display name for the mod header
 * @param {Object|null}  [opts.modItem=null]          Mod item (passed to laRenderWeaponMod)
 * @param {number}       [opts.activeProfileIndex=0]  Index of the currently active profile (shown open + gray)
 * @returns {string}
 */
export function laRenderWeaponBody(profiles, opts = {}) {
    const { actions = [], modName = null, modItem = null, activeProfileIndex = 0 } = opts;
    const actionsHtml = laRenderActions(actions);

    let profilesHtml = '';
    if (profiles.length <= 1) {
        profilesHtml = profiles.map(p => laRenderWeaponProfile(p, false)).join('');
    } else {
        const blocks = profiles.map((p, idx) => {
            const inner   = laRenderWeaponProfile(p, false);
            const name    = (p.name || 'Profile').toUpperCase();
            const isActive = idx === activeProfileIndex;
            const blockStyle = isActive
                ? 'margin-bottom:6px;padding:5px 7px;background:rgba(50,50,50,0.85);border:1px solid rgba(160,160,160,0.35);border-radius:3px;cursor:pointer;'
                : 'margin-bottom:6px;padding:5px 7px;background:color-mix(in srgb, var(--primary-color), transparent 88%);border:1px solid color-mix(in srgb, var(--primary-color), transparent 55%);border-radius:3px;cursor:pointer;';
            const nameStyle = isActive
                ? 'font-size:0.75em;font-weight:bold;color:#bbb;letter-spacing:0.4px;display:flex;justify-content:space-between;align-items:center;'
                : 'font-size:0.75em;font-weight:bold;color:#e06060;letter-spacing:0.4px;display:flex;justify-content:space-between;align-items:center;';
            const bodyDisplay = isActive ? 'block' : 'none';
            const toggleChar  = isActive ? '▼' : '▶';
            return `<div class="la-mod-block" style="${blockStyle}">
                <div style="${nameStyle}">
                    <span>${name}</span>
                    <span class="la-mod-toggle" style="opacity:0.6;font-size:0.9em;">${toggleChar}</span>
                </div>
                <div class="la-mod-body" style="display:${bodyDisplay};margin-top:4px;">${inner}</div>
            </div>`;
        }).join('');
        profilesHtml = `<div style="margin-bottom:4px;">${laPopupSectionLabel('PROFILES', 'var(--primary-color)')}${blocks}</div>`;
    }

    const modHtml = modName ? laRenderWeaponMod(modName, modItem) : '';
    return actionsHtml + profilesHtml + modHtml;
}

/**
 * Renders the body HTML for a single action detail popup.
 * Covers: range, damage, trigger, tags, and effect/detail text.
 * @param {Object} action  Lancer action object (name, activation, detail, trigger, range, damage, tags, tech_attack)
 * @param {Object} [opts]
 * @param {string} [opts.sourceName]  If provided, shown as "From: X" at the top
 * @returns {string}
 */
export function laRenderActionDetail(action, opts = {}) {
    if (!action) return '';
    const { sourceName = null } = opts;
    const sourceHtml = sourceName
        ? `<div style="font-size:0.72em;color:#777;margin-bottom:6px;">From: ${sourceName}</div>`
        : '';
    const rangeHtml = action.range?.length
        ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('RANGE', '#1565c0')}<div style="font-size:0.88em;color:#eee;margin-top:2px;">${action.range.map(r => `<b>${r.val}</b> ${r.type}`).join(' · ')}</div></div>`
        : '';
    const damageHtml = action.damage?.length
        ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('DAMAGE', '#b71c1c')}<div style="font-size:0.88em;color:#eee;margin-top:2px;">${action.damage.map(d => `<b>${d.val}</b> ${d.type}`).join(' + ')}</div></div>`
        : '';
    const triggerHtml = action.trigger
        ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('TRIGGER', '#1a5c3a')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(action.trigger)}</div></div>`
        : '';
    const tagsHtml = laRenderTags(action.tags ?? []);
    const detail = laFormatDetailHtml(action.detail || action.effect || '');
    const detailHtml = detail
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('EFFECT', '#e65100')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${detail}</div></div>`
        : '';
    const body = sourceHtml + rangeHtml + damageHtml + triggerHtml + tagsHtml + detailHtml;
    return body || '<div style="font-size:0.82em;color:#888;">No description.</div>';
}

// ── Popup container ───────────────────────────────────────────────────────────

/** @type {Record<string,{border:string,gradFrom:string,gradTo:string,headerBorder:string}>} */
const THEMES = {
    default: { border: '#383838', gradFrom: '#1c1c1c', gradTo: '#111111', headerBorder: '#484848' },
    weapon: { border: '#4a1010', gradFrom: '#2d0a0a', gradTo: '#1a0808', headerBorder: '#5a1515' },
    system: { border: '#1a4a10', gradFrom: '#0d2d0a', gradTo: '#081a08', headerBorder: '#1a5a15' },
    trait:  { border: '#1a3a5c', gradFrom: '#0a1d2d', gradTo: '#081318', headerBorder: '#1a3a5c' },
    frame:       { border: '#5a4210', gradFrom: '#2d2008', gradTo: '#1a1505', headerBorder: '#6a5015' },
    protocol:    { border: '#404040', gradFrom: '#202020', gradTo: '#141414', headerBorder: '#555555' },
    reaction:    { border: '#3a105c', gradFrom: '#1d0830', gradTo: '#110520', headerBorder: '#4a1570' },
    free_action: { border: '#0a4a40', gradFrom: '#052520', gradTo: '#021a18', headerBorder: '#0a6a58' },
    talent:      { border: '#5a3800', gradFrom: '#2d1c00', gradTo: '#1a1000', headerBorder: '#6a4800' },
    core_bonus:  { border: '#5c1a50', gradFrom: '#300d2a', gradTo: '#1c0818', headerBorder: '#7a2070' },
    deployable:  { border: '#0a3a4a', gradFrom: '#051d25', gradTo: '#021015', headerBorder: '#0a4a5a' },
    invade:      { border: '#1a1a5c', gradFrom: '#0d0d30', gradTo: '#08081c', headerBorder: '#2020a0' },
    tech:        { border: '#105a5a', gradFrom: '#052d2d', gradTo: '#021a1a', headerBorder: '#107a7a' },
    action:      { border: '#4a2800', gradFrom: '#251400', gradTo: '#160c00', headerBorder: '#5a3200' },
};

/**
 * Creates the popup container jQuery element.
 * @param {string} cssClass  CSS class for the popup div
 * @param {string} title
 * @param {string} subtitle
 * @param {string} bodyHtml
 * @param {string} [theme='weapon']
 * @returns {JQuery}
 */
export function laDetailPopup(cssClass, title, subtitle, bodyHtml, theme = 'weapon') {
    const t = THEMES[theme] ?? THEMES.default;
    return $(`
        <div class="${cssClass}" style="position:fixed;z-index:10000;background:#181818;border:1px solid ${t.border};border-radius:4px;min-width:260px;max-width:380px;box-shadow:0 4px 24px rgba(0,0,0,0.9);color:#ddd;font-family:inherit;">
            <div style="background:linear-gradient(90deg,${t.gradFrom},${t.gradTo});padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${t.headerBorder};border-radius:4px 4px 0 0;">
                <div>
                    <div style="font-weight:bold;font-size:0.95em;color:#fff;">${title}</div>
                    <div style="font-size:0.72em;color:#aaa;">${subtitle}</div>
                </div>
                <span class="la-detail-close" style="cursor:pointer;color:#aaa;font-size:0.95em;padding:2px 6px;border-radius:3px;background:rgba(255,255,255,0.05);">✕</span>
            </div>
            <div style="padding:10px 12px;overflow-y:auto;max-height:400px;">${bodyHtml}</div>
        </div>`);
}
