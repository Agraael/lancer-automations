/* global $ */
/**
 * Generic HUD item children helpers for lancer-automations.
 * Builds col4 item lists from Foundry item data.
 * Designed to be extended for systems, traits, etc.
 */

import { getItemActions } from '../interactive/deployables.js';
import { laDetailPopup, laRenderActionDetail, laRenderWeaponProfile } from '../interactive/detail-renderers.js';
import { getActivationIcon } from '../misc-tools.js';
export { getActivationIcon } from '../misc-tools.js';

const ICON_PROFILE = 'systems/lancer/assets/icons/weapon_profile.svg';
const ICON_MOD     = 'systems/lancer/assets/icons/weapon_mod.svg';

export function activationTheme(/** @type {string|null|undefined} */ activation) {
    const a = (activation ?? '').toLowerCase().replaceAll(/[\s-]+/g, '_');
    if (a === 'protocol')
        return 'protocol';
    if (a === 'reaction')
        return 'reaction';
    if (a === 'free_action' || a === 'free')
        return 'free_action';
    if (a === 'invade')
        return 'invade';
    if (a === 'quick_tech' || a === 'full_tech')
        return 'tech';
    if (a === 'quick' || a === 'quick_action' || a === 'full' || a === 'full_action')
        return 'action';
    return 'weapon';
}

/**
 * Inspects any Lancer item and returns its availability status for display in the HUD.
 * Checks: loading, recharge, limited uses, disabled, destroyed.
 * Works for weapons (uses active_profile tags), systems, traits, and any other item type.
 *
 * @param {Item} item
 * @returns {{ labelPrefix: string, badge: string|null, badgeColor: string, unavailable: boolean, destroyed: boolean }}
 */
export function getItemStatus(item) {
    const sys = item.system;
    const activeTags = sys.active_profile?.tags ?? [];
    const baseTags   = sys.all_base_tags ?? sys.tags ?? [];
    const tags = [...activeTags, ...baseTags];

    let unavailable = !!(sys.disabled);
    const destroyed = !!(sys.destroyed);
    const parts = [];
    let badgeColor = '#3a9e6e'; // green = ready

    if (!destroyed && !unavailable) {
        const hasLoading  = tags.some(t => t.lid === 'tg_loading');
        const hasRecharge = tags.some(t => t.lid === 'tg_recharge');
        const hasLimited  = tags.some(t => t.lid === 'tg_limited');

        if (hasLoading) {
            if (sys.loaded === false) {
                parts.push('⬡'); unavailable = true; badgeColor = '#c33';
            } else {
                parts.push('⬢');
            }
        }
        if (hasRecharge) {
            if (sys.charged === false) {
                parts.push('□'); unavailable = true; badgeColor = '#c33';
            } else {
                parts.push('▣');
            }
        }
        if (hasLimited) {
            let val = 0, max = 0;
            if (sys.uses != null) {
                if (typeof sys.uses === 'number') {
                    val = sys.uses;
                } else {
                    val = sys.uses.value ?? 0; max = sys.uses.max ?? 0;
                }
            }
            if (val <= 0) { unavailable = true; badgeColor = '#c33'; }
            else if (val < max && badgeColor !== '#c33') { badgeColor = '#cc7700'; }
            parts.push(`${val}/${max}`);
        }
    }

    const badge = parts.length ? parts.join(' ') : null;
    return { labelPrefix: '', badge, badgeColor, unavailable, destroyed };
}

/**
 * Returns an HTML string for a small icon in a HUD row.
 * Accepts a web-relative SVG path (e.g. "systems/lancer/assets/icons/foo.svg")
 * or an MDI class string (e.g. "mdi mdi-hexagon-slice-3").
 * @param {string|null} icon
 * @returns {string}
 */
export function laHudRenderIcon(icon) {
    if (!icon)
        return '';
    if (icon.endsWith('.svg')) {
        const isWhite = icon.includes('/white/') || icon.includes('modules/lancer-automations/');
        const filter = isWhite ? 'invert(1)' : 'none';
        return `<img src="${icon}" style="width:20px;height:20px;filter:${filter};margin-right:5px;vertical-align:middle;flex-shrink:0;border:none;outline:none;">`;
    }
    return `<i class="${icon}" style="font-size:1.15em;margin-right:5px;vertical-align:middle;flex-shrink:0;"></i>`;
}


/**
 * Builds a col4 item list for any Lancer item.
 *
 * @param {Item} item
 * @param {Object}  [opts]
 * @param {Array}   [opts.defaultActions=[]]  Items shown at the very top (e.g. SKIRMISH / BARRAGE)
 * @param {Item}    [opts.modItem=null]        Weapon mod item
 * @param {Function} [opts.showPopup=null]     (popup, rowEl) => void — if provided, actions get right-click detail popups
 * @param {Function} [opts.onActivate=null]   (action) => void — if provided, actions get an onClick handler
 * @returns {Array}
 */
export function laHudItemChildren(item, opts = {}) {
    const { defaultActions = [], modItem = null, showPopup = null, onActivate = null } = opts;
    const sys = item.system;
    const profiles = sys.profiles ?? [];
    const activeIdx = sys.selected_profile_index ?? 0;
    const taggedActions = [
        ...getItemActions(item).map(a => ({ a, source: item })),
        ...getItemActions(modItem).map(a => ({ a, source: modItem })),
    ];
    const items = [...defaultActions];

    // ── Profiles ──────────────────────────────────────────────────────────────
    if (profiles.length > 1) {
        items.push({ label: 'PROFILES', isSectionLabel: true });
        profiles.forEach((p, idx) => {
            const isActive = idx === activeIdx;
            const profileName = p.name || `Profile ${idx + 1}`;
            items.push({
                label: (isActive ? '● ' : '○ ') + profileName,
                icon: ICON_PROFILE,
                highlightBg: isActive ? '#cce0f5' : null,
                keepOpen: true,
                _profile: p,
                onClick: isActive ? null : async () => item.update({ 'system.selected_profile_index': idx }),
                refreshCol4: () => laHudItemChildren(item, opts),
                onRightClick: showPopup ? (row) => {
                    const bodyHtml = laRenderWeaponProfile(p, false);
                    const subtitle = [p.type, isActive ? 'Active' : null].filter(Boolean).join(' · ');
                    const popup = laDetailPopup('la-hud-popup la-hud-profile-popup', profileName, subtitle, bodyHtml, 'weapon');
                    showPopup(popup, row);
                } : null,
            });
        });
    }

    // ── Actions ───────────────────────────────────────────────────────────────
    if (taggedActions.length) {
        items.push({ label: 'ACTIONS', isSectionLabel: true });
        taggedActions.forEach(({ a, source }) => {
            const entry = {
                label: a.name,
                icon: getActivationIcon(a),
                onClick: onActivate ? () => onActivate(a, source) : null,
            };
            entry.onRightClick = (row) => {
                const bodyHtml = laRenderActionDetail(a, { sourceName: source?.name });
                const subtitle = a.activation ?? '';
                const popup = laDetailPopup('la-hud-popup la-hud-action-popup', a.name, subtitle, bodyHtml, activationTheme(a.activation));
                if (showPopup)
                    showPopup(popup, row);
            };
            items.push(entry);
        });
    }

    // ── Mod ───────────────────────────────────────────────────────────────────
    if (modItem) {
        items.push({ label: 'MOD', isSectionLabel: true });
        items.push({ label: modItem.name, icon: ICON_MOD });
    }

    return items;
}

/**
 * Appends an interactive uses/loading/charged pips section to a detail popup body.
 * Call as `postRender` on any item popup that might have limited/loading/recharge tags.
 * Does nothing if the item has none of those tags.
 * @param {any} item   Foundry Item document
 * @param {any} popup  jQuery popup element (from laDetailPopup)
 * @param {{ incDepth?: () => void, decDepth?: () => void, action?: any }} [depthCallbacks]  optional HUD refresh-suppression hooks + optional extra action with recharge
 */
export function appendItemPips(item, popup, depthCallbacks) {
    const sys = item?.system;
    const allTags = sys ? [...(sys.active_profile?.tags ?? []), ...(sys.all_base_tags ?? sys.tags ?? [])] : [];
    const hasLoading  = allTags.some(t => t.lid === 'tg_loading');
    const hasRecharge = allTags.some(t => t.lid === 'tg_recharge');
    const hasLimited  = allTags.some(t => t.lid === 'tg_limited');
    const hasExtraRecharge = !!depthCallbacks?.action?.recharge;
    if (!hasLoading && !hasRecharge && !hasLimited && !hasExtraRecharge)
        return;

    const S_LBL = 'font-size:0.7em;color:#888;text-transform:uppercase;letter-spacing:0.05em;min-width:54px;flex-shrink:0;';
    const S_PIP = 'cursor:pointer;font-size:1.3em;line-height:1;padding:0 2px;';
    const pipsWrap = $(`<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #2a2a2a;"></div>`);
    popup.children().last().prepend(pipsWrap);

    const rebuild = () => {
        pipsWrap.empty();
        const s = item.system;
        if (hasLoading) {
            const loaded = s.loaded !== false;
            const pip = $(`<span style="${S_PIP}color:${loaded ? '#3a9e6e' : '#c33'};">${loaded ? '⬢' : '⬡'}</span>`);
            pip.on('click', async () => {
                await /** @type {any} */ (item).update({ 'system.loaded': !item.system.loaded });
                rebuild();
            });
            pipsWrap.append($(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${S_LBL}">Loading</span>`), pip));
        }
        if (hasRecharge) {
            const charged = s.charged !== false;
            const pip = $(`<span style="${S_PIP}color:${charged ? '#3a9e6e' : '#c33'};">${charged ? '▣' : '□'}</span>`);
            pip.on('click', async () => {
                await /** @type {any} */ (item).update({ 'system.charged': !item.system.charged });
                rebuild();
            });
            pipsWrap.append($(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${S_LBL}">Charged</span>`), pip));
        }
        if (hasLimited && s.uses != null) {
            const isObj = typeof s.uses !== 'number';
            const val = isObj ? (s.uses.value ?? 0) : s.uses;
            const max = isObj ? (s.uses.max ?? 0) : s.uses;
            if (max > 0) {
                const usesRow = $(`<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;"></div>`).append($(`<span style="${S_LBL}">Uses</span>`));
                for (let i = 1; i <= max; i++) {
                    const n = i;
                    const pip = $(`<span style="${S_PIP}color:${n <= val ? '#3a9e6e' : '#444'};">${n <= val ? '⬢' : '⬡'}</span>`);
                    pip.on('click', async () => {
                        const newVal = Math.max(0, Math.min(max, n === val ? n - 1 : n));
                        await /** @type {any} */ (item).update(isObj ? { 'system.uses.value': newVal } : { 'system.uses': newVal });
                        rebuild();
                    });
                    usesRow.append(pip);
                }
                pipsWrap.append(usesRow);
            }
        }
    };
    rebuild();

    // Extra-action recharge pip (action-level, not item-level).
    // Uses the same "Charged" label + ▣/□ pip style as native tg_recharge items.
    const extraAction = depthCallbacks?.action;
    if (extraAction?.recharge && item) {
        const eaWrap = pipsWrap.length ? pipsWrap : $(`<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #2a2a2a;"></div>`);
        if (!pipsWrap.length) popup.children().last().prepend(eaWrap);
        const rebuildEa = () => {
            const ea = (item.getFlag?.('lancer-automations', 'extraActions') || []).find(a => a.name === extraAction.name);
            const charged = ea ? ea.charged !== false : extraAction.charged !== false;
            eaWrap.find('.la-ea-recharge-row').remove();
            const row = $(`<div class="la-ea-recharge-row" style="display:flex;align-items:center;gap:6px;"></div>`);
            row.append($(`<span style="${S_LBL}">Charged</span>`));
            const pip = $(`<span style="${S_PIP}color:${charged ? '#3a9e6e' : '#c33'};">${charged ? '▣' : '□'}</span>`);
            pip.on('click', async () => {
                const actions = item.getFlag?.('lancer-automations', 'extraActions') || [];
                const match = actions.find(a => a.name === extraAction.name);
                if (match) {
                    match.charged = !match.charged;
                    await item.setFlag('lancer-automations', 'extraActions', actions);
                    extraAction.charged = match.charged;
                }
                rebuildEa();
            });
            row.append(pip);
            eaWrap.append(row);
        };
        rebuildEa();
    }
}
