/* global $ */
import { playUiSound } from './sound.js';
/**
 * Generic HUD item children helpers for lancer-automations.
 * Builds col4 item lists from Foundry item data.
 * Designed to be extended for systems, traits, etc.
 */

import { getItemActions } from '../interactive/deployables.js';
import { laDetailPopup, laRenderActionDetail, laRenderWeaponProfile } from '../interactive/detail-renderers.js';
import { getActivationIcon } from '../tools/misc-tools.js';
import { getPerSceneLimit, getPerSceneLimitFromSub } from '../combat/per-frequency-tags.js';
export { getActivationIcon } from '../tools/misc-tools.js';

const ICON_PROFILE = 'systems/lancer/assets/icons/weapon_profile.svg';
const ICON_MOD     = 'systems/lancer/assets/icons/weapon_mod.svg';

export const rechargeIcon = (/** @type {boolean} */ charged) =>
    `<span class="mdi ${charged ? 'mdi-square-circle' : 'mdi-square-outline'}"></span>`;

export function activationTheme(/** @type {string|null|undefined} */ activation) {
    const normalized = (activation ?? '').toLowerCase().replaceAll(/[\s-]+/g, '_');
    if (normalized === 'protocol')
        return 'protocol';
    if (normalized === 'reaction')
        return 'reaction';
    if (normalized === 'free_action' || normalized === 'free')
        return 'free_action';
    if (normalized === 'invade')
        return 'invade';
    if (normalized === 'quick_tech' || normalized === 'full_tech')
        return 'tech';
    if (normalized === 'quick' || normalized === 'quick_action' || normalized === 'full' || normalized === 'full_action')
        return 'action';
    return 'weapon';
}

/**
 * Inspects any Lancer item OR standalone action object and returns its availability status
 * for display in the HUD. Checks: loading, recharge, limited uses, disabled, destroyed.
 * Works for weapons (uses active_profile tags), systems, traits, and any other item type.
 * For action objects (actor-level extras), reads tags / loaded / charged / uses directly.
 *
 * @param {Item|object} itemOrAction
 * @returns {{ labelPrefix: string, badge: string|null, badgeColor: string, unavailable: boolean, destroyed: boolean }}
 */
export function getItemStatus(itemOrAction, extraAction = null) {
    const isItem = !!itemOrAction?.system;
    const sys = isItem ? itemOrAction.system : itemOrAction;
    const activeTags = isItem ? (sys.active_profile?.tags ?? []) : [];
    const baseTags   = sys.all_base_tags ?? sys.tags ?? [];
    const itemTags = [...activeTags, ...baseTags];

    let unavailable = !!(sys.disabled);
    const destroyed = !!(sys.destroyed);
    const parts = [];
    let badgeColor = '#3a9e6e'; // green = ready

    const pushLoaded = (loaded) => {
        if (loaded === false) {
            parts.push('⬡'); unavailable = true; badgeColor = '#c33';
        } else
            parts.push('⬢');
    };
    const pushCharged = (charged) => {
        if (charged === false) {
            parts.push(rechargeIcon(false)); unavailable = true; badgeColor = '#c33';
        } else
            parts.push(rechargeIcon(true));
    };
    const pushUses = (usesField) => {
        let val = 0, max = 0;
        if (usesField != null) {
            if (typeof usesField === 'number')
                val = usesField;
            else {
                val = usesField.value ?? 0; max = usesField.max ?? 0;
            }
        }
        if (val <= 0) {
            unavailable = true; badgeColor = '#c33';
        } else if (val < max && badgeColor !== '#c33')
            badgeColor = '#cc7700';
        parts.push(`${val}/${max}`);
    };

    const perFreqOn = (() => { try { return !!game.settings.get('lancer-automations', 'enablePerRoundTurnTags'); } catch { return false; } })();
    const pushPerFreq = (max, used, iconReady, iconConsumed) => {
        const ready = max - Math.min(max, used);
        if (ready <= 0) {
            unavailable = true; badgeColor = '#c33';
        } else if (ready < max && badgeColor !== '#c33')
            badgeColor = '#cc7700';
        const pips = [];
        for (let i = 0; i < max; i++) {
            const isReady = i < ready;
            pips.push(`<span class="mdi ${isReady ? iconReady : iconConsumed}" style="color:${isReady ? '#3a9e6e' : '#c33'};"></span>`);
        }
        parts.push(pips.join(''));
    };

    if (itemTags.some(tag => tag.lid === 'tg_loading'))
        pushLoaded(sys.loaded);
    if (itemTags.some(tag => tag.lid === 'tg_recharge'))
        pushCharged(sys.charged);
    if (itemTags.some(tag => tag.lid === 'tg_limited'))
        pushUses(sys.uses);
    if (perFreqOn) {
        const perRound = Number(itemTags.find(tag => tag.lid === 'tg_round')?.val ?? 0);
        const perTurn = Number(itemTags.find(tag => tag.lid === 'tg_turn')?.val ?? 0);
        let perScene = 0;
        if (extraAction) perScene = getPerSceneLimitFromSub(extraAction);
        else if (isItem && itemOrAction.type !== 'frame') perScene = getPerSceneLimit(itemOrAction);
        if (perRound > 0) pushPerFreq(perRound, Number(sys.uses_per_round?.value ?? 0), 'mdi-restart', 'mdi-restart-off');
        if (perTurn > 0) pushPerFreq(perTurn, Number(sys.uses_per_turn?.value ?? 0), 'mdi-circle-slice-8', 'mdi-circle-outline');
        if (perScene > 0) pushPerFreq(perScene, Number(sys.uses_per_scene?.value ?? 0), 'mdi-cog', 'mdi-cog-off');
    }

    // Item-attached extra: action.tags are guaranteed disjoint from itemTags (deduped at add-time).
    const actionTags = isItem && extraAction?._addedViaExtrasUI ? (extraAction.tags ?? []) : [];
    if (actionTags.some(tag => tag.lid === 'tg_loading'))
        pushLoaded(extraAction.loaded);
    if (actionTags.some(tag => tag.lid === 'tg_recharge'))
        pushCharged(extraAction.charged);
    if (actionTags.some(tag => tag.lid === 'tg_limited'))
        pushUses(extraAction.uses);

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
        const isWhite = icon.includes('/white/')
            || icon.includes('modules/lancer-automations/')
            || icon.startsWith('icons/svg/');
        const filter = isWhite ? 'invert(1)' : 'none';
        const cls = isWhite ? 'la-hud-icon la-hud-icon--white' : 'la-hud-icon la-hud-icon--dark';
        return `<img class="${cls}" src="${icon}" style="width:20px;height:20px;filter:${filter};margin-right:5px;vertical-align:middle;flex-shrink:0;border:none;outline:none;">`;
    }
    return `<i class="${icon} la-hud-icon" style="font-size:1.15em;margin-right:5px;vertical-align:middle;flex-shrink:0;"></i>`;
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
    const activeProfileActions = profiles[activeIdx]?.actions ?? [];
    const taggedActions = [
        ...getItemActions(item).map(a => ({ a, source: item })),
        ...activeProfileActions.map(a => ({ a, source: item })),
        ...getItemActions(modItem).map(a => ({ a, source: modItem })),
    ];
    // Dedupe by (name, activation, source).
    const _seenActions = new Set();
    const _dedupedActions = [];
    for (const entry of taggedActions) {
        const key = `${entry.source?.id ?? '?'}|${entry.a?.name ?? ''}|${entry.a?.activation ?? ''}`;
        if (_seenActions.has(key)) continue;
        _seenActions.add(key);
        _dedupedActions.push(entry);
    }
    taggedActions.length = 0;
    taggedActions.push(..._dedupedActions);
    const items = [...defaultActions];

    // ── Profiles ──────────────────────────────────────────────────────────────
    if (profiles.length > 1) {
        items.push({ label: 'PROFILES', isSectionLabel: true });
        profiles.forEach((profile, idx) => {
            const isActive = idx === activeIdx;
            const profileName = profile.name || `Profile ${idx + 1}`;
            items.push({
                label: (isActive ? '● ' : '○ ') + profileName,
                icon: ICON_PROFILE,
                highlightBg: isActive ? '#cce0f5' : null,
                keepOpen: true,
                _profile: profile,
                onClick: isActive ? null : async () => item.update({ 'system.selected_profile_index': idx }),
                refreshCol4: () => laHudItemChildren(item, opts),
                onRightClick: showPopup ? (row) => {
                    const bodyHtml = laRenderWeaponProfile(profile, false);
                    const subtitle = [profile.type, isActive ? 'Active' : null].filter(Boolean).join(' · ');
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
 * @param {{ incDepth?: () => void, decDepth?: () => void, action?: any, subData?: any }} [depthCallbacks]  optional HUD refresh-suppression hooks + optional extra action with recharge + optional sub-entry (trait/core_system) to restrict per-scene detection
 */
export function appendItemPips(item, popup, depthCallbacks) {
    const action = depthCallbacks?.action;
    const subData = depthCallbacks?.subData;
    const isActorExtra = item?.documentName === 'Actor' && action?._addedViaExtrasUI === true;
    const sys = item?.system;
    const allTags = isActorExtra
        ? (action?.tags ?? [])
        : (sys ? [...(sys.active_profile?.tags ?? []), ...(sys.all_base_tags ?? sys.tags ?? [])] : []);
    const hasLoading  = allTags.some(tag => tag.lid === 'tg_loading');
    const hasRecharge = allTags.some(tag => tag.lid === 'tg_recharge');
    const hasLimited  = allTags.some(tag => tag.lid === 'tg_limited');
    const perFreqOn = (() => { try { return !!game.settings.get('lancer-automations', 'enablePerRoundTurnTags'); } catch { return false; } })();
    const perRoundMax = perFreqOn ? Number(allTags.find(tag => tag.lid === 'tg_round')?.val ?? 0) : 0;
    const perTurnMax = perFreqOn ? Number(allTags.find(tag => tag.lid === 'tg_turn')?.val ?? 0) : 0;
    const sub = subData ?? action;
    const perSceneMax = !perFreqOn || isActorExtra ? 0
        : sub ? getPerSceneLimitFromSub(sub)
        : (item?.type === 'frame' ? 0 : getPerSceneLimit(item));
    const hasExtraRecharge = !!action?.recharge && !isActorExtra;
    const isCoreActive = !!action && item?.type === 'frame' && (
        (item.system?.core_system?.active_actions ?? []).some(/** @type {any} */ candidate => candidate === action || candidate?.name === action?.name)
        || action?.name === item.system?.core_system?.active_name
        || action?.name === item.system?.core_system?.name
    );
    if (!hasLoading && !hasRecharge && !hasLimited && !hasExtraRecharge && !perRoundMax && !perTurnMax && !perSceneMax && !isCoreActive)
        return;

    const S_LBL = 'font-size:0.7em;color:#888;text-transform:uppercase;letter-spacing:0.05em;min-width:54px;flex-shrink:0;';
    const S_PIP = 'cursor:pointer;font-size:1.3em;line-height:1;padding:0 2px;';
    const pipsWrap = $(`<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #2a2a2a;"></div>`);
    popup.children().last().prepend(pipsWrap);

    const readState = () => {
        if (isActorExtra) {
            const list = item.getFlag?.('lancer-automations', 'extraActions') || [];
            return list.find(entry => entry.name === action.name) ?? action;
        }
        return item.system;
    };
    const patchState = async (patch) => {
        if (isActorExtra) {
            const list = item.getFlag?.('lancer-automations', 'extraActions') || [];
            const idx = list.findIndex(entry => entry.name === action.name);
            if (idx < 0)
                return;
            const next = list.slice();
            next[idx] = { ...next[idx], ...patch };
            await item.setFlag('lancer-automations', 'extraActions', next);
        } else {
            const flat = {};
            for (const [key, val] of Object.entries(patch))
                flat[`system.${key}`] = val;
            await /** @type {any} */ (item).update(flat);
        }
    };

    const rebuild = () => {
        pipsWrap.empty();
        const state = readState();
        if (hasLoading) {
            const loaded = state.loaded !== false;
            const pip = $(`<span style="${S_PIP}color:${loaded ? '#3a9e6e' : '#c33'};">${loaded ? '⬢' : '⬡'}</span>`);
            pip.on('click', async () => {
                playUiSound('toggle');
                await patchState({ loaded: !loaded });
                rebuild();
            });
            pipsWrap.append($(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${S_LBL}">Loading</span>`), pip));
        }
        if (hasRecharge) {
            const charged = state.charged !== false;
            const pip = $(`<span style="${S_PIP}color:${charged ? '#3a9e6e' : '#c33'};font-size:1em;">${rechargeIcon(charged)}</span>`);
            pip.on('click', async () => {
                playUiSound('toggle');
                await patchState({ charged: !charged });
                rebuild();
            });
            pipsWrap.append($(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${S_LBL}">Charged</span>`), pip));
        }
        if (hasLimited && state.uses != null) {
            const isObj = typeof state.uses !== 'number';
            const val = isObj ? (state.uses.value ?? 0) : state.uses;
            const max = isObj ? (state.uses.max ?? 0) : state.uses;
            if (max > 0) {
                const usesRow = $(`<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;"></div>`).append($(`<span style="${S_LBL}">Uses</span>`));
                for (let i = 1; i <= max; i++) {
                    const pipIdx = i;
                    const pip = $(`<span style="${S_PIP}color:${pipIdx <= val ? '#3a9e6e' : '#444'};">${pipIdx <= val ? '⬢' : '⬡'}</span>`);
                    pip.on('click', async () => {
                        playUiSound('toggle');
                        const newVal = Math.max(0, Math.min(max, pipIdx === val ? pipIdx - 1 : pipIdx));
                        await patchState(isObj ? { uses: { ...state.uses, value: newVal } } : { uses: newVal });
                        rebuild();
                    });
                    usesRow.append(pip);
                }
                pipsWrap.append(usesRow);
            }
        }
        const inCombat = !!game.combat?.started;
        const renderFreqRow = (label, max, used, fieldKey, iconReady, iconConsumed, dim) => {
            const usesRow = $(`<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;${dim ? 'opacity:0.5;' : ''}"></div>`).append($(`<span style="${S_LBL}">${label}</span>`));
            for (let i = 1; i <= max; i++) {
                const pipIdx = i;
                const consumed = pipIdx <= used;
                const pip = $(`<span style="${S_PIP}color:${consumed ? '#c33' : '#3a9e6e'};"><span class="mdi ${consumed ? iconConsumed : iconReady}"></span></span>`);
                pip.on('click', async () => {
                    playUiSound('toggle');
                    const newUsed = pipIdx === used ? pipIdx - 1 : pipIdx;
                    await patchState({ [fieldKey]: { value: Math.max(0, Math.min(max, newUsed)) } });
                    rebuild();
                });
                usesRow.append(pip);
            }
            pipsWrap.append(usesRow);
        };
        if (perRoundMax > 0)
            renderFreqRow('Per round', perRoundMax, Number(state.uses_per_round?.value ?? 0), 'uses_per_round', 'mdi-restart', 'mdi-restart-off', !inCombat);
        if (perTurnMax > 0)
            renderFreqRow('Per turn', perTurnMax, Number(state.uses_per_turn?.value ?? 0), 'uses_per_turn', 'mdi-circle-slice-8', 'mdi-circle-outline', !inCombat);
        if (perSceneMax > 0)
            renderFreqRow('Per scene', perSceneMax, Number(state.uses_per_scene?.value ?? 0), 'uses_per_scene', 'mdi-cog', 'mdi-cog-off', false);
        if (isCoreActive) {
            const actor = item.parent ?? item.actor;
            const charged = (actor?.system?.core_energy ?? 0) > 0;
            const row = $(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${S_LBL}">Core Power</span>`));
            const pip = $(`<span style="${S_PIP}color:${charged ? '#3a9e6e' : '#c33'};"><i class="mdi ${charged ? 'mdi-battery' : 'mdi-battery-off'}"></i></span>`);
            pip.on('click', async (ev) => {
                ev.stopPropagation();
                playUiSound('toggle');
                const live = (actor?.system?.core_energy ?? 0) > 0;
                await actor?.update({ 'system.core_energy': live ? 0 : 1 });
                rebuild();
            });
            row.append(pip);
            pipsWrap.append(row);
        }
    };
    rebuild();

    // Item-attached extras-UI action: render a second pip row whose tags are disjoint from the
    // item's (dedup guaranteed at add-time). State reads/writes go to the flag entry by name.
    const isItemDoc = item?.documentName === 'Item';
    if (isItemDoc && action?._addedViaExtrasUI && Array.isArray(action.tags) && action.tags.length) {
        const actHasLoading  = action.tags.some(t => t.lid === 'tg_loading');
        const actHasRecharge = action.tags.some(t => t.lid === 'tg_recharge');
        const actHasLimited  = action.tags.some(t => t.lid === 'tg_limited');
        if (actHasLoading || actHasRecharge || actHasLimited) {
            const readAct = () => (item.getFlag?.('lancer-automations', 'extraActions') || [])
                .find(entry => entry.name === action.name) ?? action;
            const patchAct = async (patch) => {
                const list = item.getFlag?.('lancer-automations', 'extraActions') || [];
                const idx = list.findIndex(entry => entry.name === action.name);
                if (idx < 0)
                    return;
                const next = list.slice();
                next[idx] = { ...next[idx], ...patch };
                await item.setFlag('lancer-automations', 'extraActions', next);
            };
            const actWrap = $(`<div class="la-ea-pips" style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #2a2a2a;"></div>`);
            popup.children().last().prepend(actWrap);
            const rebuildAct = () => {
                actWrap.empty();
                const state = readAct();
                if (actHasLoading) {
                    const loaded = state.loaded !== false;
                    const pip = $(`<span style="${S_PIP}color:${loaded ? '#3a9e6e' : '#c33'};">${loaded ? '⬢' : '⬡'}</span>`);
                    pip.on('click', async () => {
                        playUiSound('toggle'); await patchAct({ loaded: !loaded }); rebuildAct();
                    });
                    actWrap.append($(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${S_LBL}">Loading*</span>`), pip));
                }
                if (actHasRecharge) {
                    const charged = state.charged !== false;
                    const pip = $(`<span style="${S_PIP}color:${charged ? '#3a9e6e' : '#c33'};font-size:1em;">${rechargeIcon(charged)}</span>`);
                    pip.on('click', async () => {
                        playUiSound('toggle'); await patchAct({ charged: !charged }); rebuildAct();
                    });
                    actWrap.append($(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${S_LBL}">Charged*</span>`), pip));
                }
                if (actHasLimited && state.uses != null) {
                    const isObj = typeof state.uses !== 'number';
                    const val = isObj ? (state.uses.value ?? 0) : state.uses;
                    const max = isObj ? (state.uses.max ?? 0) : state.uses;
                    if (max > 0) {
                        const usesRow = $(`<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;"></div>`).append($(`<span style="${S_LBL}">Uses*</span>`));
                        for (let i = 1; i <= max; i++) {
                            const pipIdx = i;
                            const pip = $(`<span style="${S_PIP}color:${pipIdx <= val ? '#3a9e6e' : '#444'};">${pipIdx <= val ? '⬢' : '⬡'}</span>`);
                            pip.on('click', async () => {
                                playUiSound('toggle');
                                const newVal = Math.max(0, Math.min(max, pipIdx === val ? pipIdx - 1 : pipIdx));
                                await patchAct(isObj ? { uses: { ...state.uses, value: newVal } } : { uses: newVal });
                                rebuildAct();
                            });
                            usesRow.append(pip);
                        }
                        actWrap.append(usesRow);
                    }
                }
            };
            rebuildAct();
        }
    }

    // Extra-action recharge pip (action-level, not item-level).
    // Uses the same "Charged" label + ▣/□ pip style as native tg_recharge items.
    const extraAction = depthCallbacks?.action;
    if (extraAction?.recharge && item && !extraAction._addedViaExtrasUI) {
        const eaWrap = pipsWrap.length ? pipsWrap : $(`<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #2a2a2a;"></div>`);
        if (!pipsWrap.length)
            popup.children().last().prepend(eaWrap);
        const rebuildEa = () => {
            const eaEntry = (item.getFlag?.('lancer-automations', 'extraActions') || []).find(entry => entry.name === extraAction.name);
            const charged = eaEntry ? eaEntry.charged !== false : extraAction.charged !== false;
            eaWrap.find('.la-ea-recharge-row').remove();
            const row = $(`<div class="la-ea-recharge-row" style="display:flex;align-items:center;gap:6px;"></div>`);
            row.append($(`<span style="${S_LBL}">Charged</span>`));
            const pip = $(`<span style="${S_PIP}color:${charged ? '#3a9e6e' : '#c33'};font-size:1em;">${rechargeIcon(charged)}</span>`);
            pip.on('click', async () => {
                playUiSound('toggle');
                const actions = item.getFlag?.('lancer-automations', 'extraActions') || [];
                const match = actions.find(entry => entry.name === extraAction.name);
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
