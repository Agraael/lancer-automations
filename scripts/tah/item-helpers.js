/**
 * Generic HUD item children helpers for lancer-automations.
 * Builds col4 item lists from Foundry item data.
 * Designed to be extended for systems, traits, etc.
 */

import { getItemActions } from '../interactive/deployables.js';
import { laDetailPopup, laRenderActionDetail } from '../interactive/detail-renderers.js';

const ICON_PROFILE = 'systems/lancer/assets/icons/weapon_profile.svg';
const ICON_MOD     = 'systems/lancer/assets/icons/weapon_mod.svg';

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
 * Returns the icon for a Lancer activation. Accepts an action object or a plain activation string.
 * When the action has tech_attack:true, uses tech_quick/tech_full SVGs instead of hex icons.
 * @param {Object|string} actionOrActivation
 * @returns {string|null}
 */
export function getActivationIcon(actionOrActivation) {
    const isTech = actionOrActivation?.tech_attack === true;
    const activation = typeof actionOrActivation === 'string' ? actionOrActivation : (actionOrActivation?.activation || '');
    const a = activation.toLowerCase();
    if (isTech) {
        if (a.includes('full'))
            return 'systems/lancer/assets/icons/tech_full.svg';
        return 'systems/lancer/assets/icons/tech_quick.svg';
    }
    if (a.includes('full'))
        return 'mdi mdi-hexagon-slice-6';
    if (a.includes('protocol'))
        return 'systems/lancer/assets/icons/protocol.svg';
    if (a.includes('free'))
        return 'systems/lancer/assets/icons/free_action.svg';
    if (a.includes('reaction'))
        return 'systems/lancer/assets/icons/reaction.svg';
    if (a.includes('quick'))
        return 'mdi mdi-hexagon-slice-3';
    if (a.includes('invade'))
        return 'systems/lancer/assets/icons/tech_quick.svg';
    return null;
}

/**
 * Builds a col4 item list for any Lancer item.
 *
 * @param {Item} item
 * @param {Object}  [opts]
 * @param {Array}   [opts.defaultActions=[]]  Items shown at the very top (e.g. SKIRMISH / BARRAGE)
 * @param {Item}    [opts.modItem=null]        Weapon mod item
 * @param {Function} [opts.showPopup=null]     (popup, rowEl) => void — if provided, actions get right-click detail popups
 * @returns {Array}
 */
export function laHudItemChildren(item, opts = {}) {
    const { defaultActions = [], modItem = null, showPopup = null } = opts;
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
            items.push({
                label: (isActive ? '● ' : '○ ') + (p.name || `Profile ${idx + 1}`),
                icon: ICON_PROFILE,
                highlightBg: isActive ? '#cce0f5' : null,
                keepOpen: true,
                onClick: isActive ? null : async () => item.update({ 'system.selected_profile_index': idx }),
                refreshCol4: () => laHudItemChildren(item, opts),
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
                onClick: () => console.warn('[lancer-automations] TODO: activate action', a.name),
            };
            entry.onRightClick = (row) => {
                const bodyHtml = laRenderActionDetail(a, { sourceName: source?.name });
                const subtitle = a.activation ?? '';
                const popup = laDetailPopup('la-hud-popup la-hud-action-popup', a.name, subtitle, bodyHtml, 'system');
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
