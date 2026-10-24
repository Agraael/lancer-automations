/* global $ */
import { playUiSound } from './sound.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag, setLAFlag } from '../tools/flag-utils.js';
// HUD item helpers: status badges, icons, col4 action/profile lists, and detail-popup pips.

import { getItemActions } from '../interactive/deployables.js';
import { laDetailPopup, laRenderActionDetail, laRenderWeaponProfile } from '../interactive/detail-renderers.js';
import { getActivationIcon, executeProfileSwitch, executeSimpleActivation } from '../tools/misc-tools.js';
import { getPerRoundLimit, getPerTurnLimit, getPerSceneLimit, getPerMissionLimit, getPerRoundLimitFromSub, getPerTurnLimitFromSub, getPerSceneLimitFromSub, getPerMissionLimitFromSub, getSubUses, getSubUsed, patchSubUses, itemAllTags, actionSubKey, subHasLimits, FREQ_SPECS, isPerFrequencyEnabled } from '../combat/per-frequency-tags.js';
import { openExtraConfigDialog } from '../interactive/extra-config-dialog.js';
import { localize, localizeFormat, escapeHtml } from '../tools/string-utils.js';
export { getActivationIcon } from '../tools/misc-tools.js';

const ICON_PROFILE = 'systems/lancer/assets/icons/weapon_profile.svg';
const ICON_MOD     = 'systems/lancer/assets/icons/weapon_mod.svg';

// Row icon size (px). Drives both svg images and mdi font glyphs so they match.
export const HUD_ICON_SIZE = 20;
export const HUD_WEAPON_ICON_SIZE = 30;

const GENERIC_ACTION_NAMES = new Set(['action', 'new action']);

/** Placeholder action names ("Action") display as the item's name. */
export function actionDisplayName(item, action)
{
    const name = String(action?.name ?? '').trim();
    if (!name || GENERIC_ACTION_NAMES.has(name.toLowerCase()))
        return item?.name ?? name;
    return name;
}

export const rechargeIcon = (/** @type {boolean} */ charged) =>
    `<span class="mdi ${charged ? 'mdi-square-circle' : 'mdi-square-outline'}"></span>`;

export function activationTheme(/** @type {string|null|undefined} */ activation)
{
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

// Counter an action row reads: the action's own sub counter if it carries a frequency, else the item's.
function resolveActionScope(item, action, subKey = null)
{
    if (!action)
        return { sub: null, key: null };
    if (subKey)
        return { sub: action, key: subKey };
    const key = actionSubKey(item, action);
    if (key)
        return { sub: action, key };
    if (subHasLimits(action) || action._addedViaExtrasUI || item?.type === 'frame')
        return { sub: action, key: null };
    return { sub: null, key: null };
}

/**
 * Availability status of a Lancer item or standalone action object, for HUD badge display.
 * Checks loading, recharge, limited uses, disabled, destroyed, and cascading.
 * @param {Item|object} itemOrAction
 * @returns {{ labelPrefix: string, badge: string|null, badgeColor: string, unavailable: boolean, disabled: boolean, destroyed: boolean, cascading: boolean }}
 */
export function getItemStatus(itemOrAction, extraAction = null, { subKey = null } = {})
{
    const isItem = !!itemOrAction?.system;
    const sys = isItem ? itemOrAction.system : itemOrAction;
    const itemTags = itemAllTags(sys);

    const disabled = !!(sys.disabled);
    let unavailable = disabled;
    const destroyed = !!(sys.destroyed);
    const cascading = !!(sys.cascading);
    const parts = [];
    let badgeColor = '#3a9e6e'; // green = ready

    const pushLoaded = (loaded) =>
    {
        if (loaded === false)
        {
            parts.push('⬡'); unavailable = true; badgeColor = '#c33';
        }
        else
            parts.push('⬢');
    };
    const pushCharged = (charged) =>
    {
        if (charged === false)
        {
            parts.push(rechargeIcon(false)); unavailable = true; badgeColor = '#c33';
        }
        else
            parts.push(rechargeIcon(true));
    };
    const pushUses = (usesField) =>
    {
        let current = 0, max = 0;
        if (usesField != null)
        {
            if (typeof usesField === 'number')
                current = usesField;
            else
            {
                current = usesField.value ?? 0; max = usesField.max ?? 0;
            }
        }
        if (current <= 0)
        {
            unavailable = true; badgeColor = '#c33';
        }
        else if (current < max && badgeColor !== '#c33')
            badgeColor = '#cc7700';
        parts.push(`${current}/${max}`);
    };

    const perFreqOn = isPerFrequencyEnabled();
    const pushPerFreq = (max, used, iconReady, iconConsumed) =>
    {
        const ready = max - Math.min(max, used);
        if (ready <= 0)
        {
            unavailable = true; badgeColor = '#c33';
        }
        else if (ready < max && badgeColor !== '#c33')
            badgeColor = '#cc7700';
        const pips = [];
        for (let i = 0; i < max; i++)
        {
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
    if (perFreqOn)
    {
        const scoped = isItem ? resolveActionScope(itemOrAction, extraAction, subKey) : { sub: extraAction ?? sys, key: null };
        const freqSub = scoped.sub;
        const freqKey = scoped.key;
        const freqCtx = isItem && freqKey ? { item: itemOrAction, key: freqKey } : null;
        const perRound = Math.max(Number(itemTags.find(tag => tag.lid === 'tg_round')?.val ?? 0), freqSub ? getPerRoundLimitFromSub(freqSub, freqCtx) : getPerRoundLimit(itemOrAction));
        const perTurn = Math.max(Number(itemTags.find(tag => tag.lid === 'tg_turn')?.val ?? 0), freqSub ? getPerTurnLimitFromSub(freqSub, freqCtx) : getPerTurnLimit(itemOrAction));
        let perScene = 0;
        let perMission = 0;
        if (freqSub)
        {
            perScene = getPerSceneLimitFromSub(freqSub, freqCtx);
            perMission = getPerMissionLimitFromSub(freqSub, freqCtx);
        }
        else if (isItem && itemOrAction.type !== 'frame')
        {
            perScene = getPerSceneLimit(itemOrAction);
            perMission = getPerMissionLimit(itemOrAction);
        }
        const freqUsed = (field) => freqKey && isItem
            ? getSubUsed(itemOrAction, freqKey, field)
            : Number(sys[field]?.value ?? 0);
        const limits = { uses_per_round: perRound, uses_per_turn: perTurn, uses_per_scene: perScene, uses_per_mission: perMission };
        for (const spec of FREQ_SPECS)
        {
            if (limits[spec.field] > 0)
                pushPerFreq(limits[spec.field], freqUsed(spec.field), spec.ready, spec.off);
        }
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
    return { labelPrefix: '', badge, badgeColor, unavailable, disabled, destroyed, cascading };
}

export function statusKindOf(status)
{
    if (status.destroyed)
        return 'destroyed';
    if (status.cascading)
        return 'cascading';
    if (status.unavailable)
        return status.disabled ? 'unavailable' : 'spent';
    return null;
}

export function isWhiteIcon(icon)
{
    return typeof icon === 'string'
        && icon.endsWith('.svg')
        && !icon.includes('/black/')
        && (icon.includes('/white/') || icon.includes('modules/lancer-automations/') || icon.startsWith('icons/svg/'))
        && !icon.includes('modules/lancer-automations/icons/stats/');
}

export function tahScale()
{
    return Number(getModuleSetting('tah.uiScale')) || 1;
}

export function applyStripeStyle(row, stripe)
{
    row.data('restingBg', stripe.bg).data('restingBorder', stripe.border).data('hoverBg', stripe.hoverBg)
        .data('restingColor', stripe.color).data('hoverColor', stripe.hoverColor);
    row.css({ background: stripe.bg, borderLeftColor: stripe.border, color: stripe.color });
    if (stripe.light)
        row.addClass('la-hud-spent');
    // Keep leading icon visible on dark stripes: flip whatever invert state laHudRenderIcon left.
    const leadingIcon = row.find('img.la-hud-icon').first();
    if (leadingIcon.length && stripe.light)
        leadingIcon.css({ opacity: '0.6' });
    else if (leadingIcon.length)
    {
        const wasInverted = (leadingIcon.attr('style') || '').includes('invert(1)');
        leadingIcon.css({ filter: wasInverted ? 'none' : 'invert(1)', opacity: '0.55' });
    }
}

export function slideInCol(col, { duration = 140, guard = true } = {})
{
    col.stop(true).css({ opacity: 0, marginLeft: -10, ...(guard ? { pointerEvents: 'none' } : {}) }).show().animate({ opacity: 1, marginLeft: 0 }, duration, function()
    {
        if (guard)
            $(this).css('pointerEvents', '');
    });
}

export function laHudRenderIcon(icon, size = HUD_ICON_SIZE)
{
    if (!icon)
        return '';
    if (icon.endsWith('.svg'))
    {
        const isWhite = isWhiteIcon(icon);
        const filter = isWhite ? 'invert(1)' : 'none';
        const cls = isWhite ? 'la-hud-icon la-hud-icon--white' : 'la-hud-icon la-hud-icon--dark';
        // LA icons fill their viewBox edge-to-edge; system icons ship with whitespace. Pad to match.
        const pad = icon.includes('modules/lancer-automations/') ? 'padding:0.8px;box-sizing:border-box;' : '';
        return `<img class="${cls}" src="${escapeHtml(icon)}" style="width:${size}px;height:${size}px;${pad}filter:${filter};margin-right:5px;vertical-align:middle;flex-shrink:0;border:none;outline:none;">`;
    }
    return `<i class="${escapeHtml(icon)} la-hud-icon" style="font-size:${size}px;margin-right:5px;vertical-align:middle;flex-shrink:0;"></i>`;
}

/** Stripe palette for blocked / destroyed / cascading / unavailable / spent rows. */
export function laHudStripeStyle(item)
{
    if (item.stripeStyle)
        return item.stripeStyle;
    if (item.softDisabled)
    {
        return document.documentElement.classList.contains('la-dark')
            ? {
                bg: 'repeating-linear-gradient(45deg, #707070 0 6px, #5c5c5c 6px 12px)',
                hoverBg: 'repeating-linear-gradient(45deg, #858585 0 6px, #6e6e6e 6px 12px)',
                border: '#8f8f8f',
                color: '#eee',
                hoverColor: '#fff'
            }
            : {
                bg: 'repeating-linear-gradient(45deg, #3a3a3a 0 6px, #2f2f2f 6px 12px)',
                hoverBg: 'repeating-linear-gradient(45deg, #555 0 6px, #444 6px 12px)',
                border: '#666',
                color: '#bbb',
                hoverColor: '#ddd'
            };
    }
    if (item.statusKind === 'destroyed')
    {
        return {
            bg: 'repeating-linear-gradient(45deg, #5a2222 0 6px, #4a1c1c 6px 12px)',
            hoverBg: 'repeating-linear-gradient(45deg, #7a3535 0 6px, #6a2828 6px 12px)',
            border: '#a04444',
            color: '#e0b0b0',
            hoverColor: '#f0c8c8'
        };
    }
    if (item.statusKind === 'cascading')
    {
        return {
            bg: 'repeating-linear-gradient(45deg, #3f2259 0 6px, #331b49 6px 12px)',
            hoverBg: 'repeating-linear-gradient(45deg, #573078 0 6px, #482866 6px 12px)',
            border: '#8b4fd6',
            color: '#dcc4f5',
            hoverColor: '#ecdcff'
        };
    }
    if (item.statusKind === 'unavailable')
    {
        return {
            bg: 'repeating-linear-gradient(45deg, #5a4422 0 6px, #4a3818 6px 12px)',
            hoverBg: 'repeating-linear-gradient(45deg, #7a5c30 0 6px, #6a4c25 6px 12px)',
            border: '#a07744',
            color: '#e0c8a0',
            hoverColor: '#f0d8b8'
        };
    }
    if (item.statusKind === 'spent')
    {
        return {
            light: true,
            bg: 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--la-plate), var(--la-ink) 9%) 0 6px, var(--la-plate) 6px 12px)',
            hoverBg: 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--la-plate), var(--la-ink) 16%) 0 6px, color-mix(in srgb, var(--la-plate), var(--la-ink) 6%) 6px 12px)',
            border: '#8e8a86',
            color: 'color-mix(in srgb, var(--la-ink), transparent 40%)',
            hoverColor: 'var(--la-ink)',
            onDark: {
                bg: 'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.09) 0 6px, transparent 6px 12px), rgba(20, 20, 30, 0.9)',
                hoverBg: 'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.16) 0 6px, rgba(255, 255, 255, 0.05) 6px 12px), rgba(20, 20, 30, 0.9)',
                color: 'rgba(221, 221, 221, 0.6)',
                hoverColor: '#ddd'
            }
        };
    }
    return null;
}

const WEAPON_SIZE_LEVEL = { aux: 0, auxiliary: 0, main: 1, heavy: 2, superheavy: 3 };

/** 0-3 for Aux / Main / Heavy / Superheavy, else null. NPC features carry it in weapon_type. */
export function weaponSizeLevel(weapon)
{
    const sys = weapon?.system;
    if (!sys)
        return null;
    const direct = String(sys.size ?? sys.type ?? '').toLowerCase().trim();
    if (direct in WEAPON_SIZE_LEVEL)
        return WEAPON_SIZE_LEVEL[direct];
    const npcType = String(sys.weapon_type ?? '').toLowerCase().trim();
    for (const key of ['superheavy', 'heavy', 'main', 'auxiliary', 'aux'])
    {
        if (npcType.startsWith(key))
            return WEAPON_SIZE_LEVEL[key];
    }
    return null;
}

const LA_WEAPON_ICONS = 'modules/lancer-automations/icons/weapon';
const WEAPON_TYPE_ICON = {
    cqb: `${LA_WEAPON_ICONS}/CQB_White.svg`,
    cannon: `${LA_WEAPON_ICONS}/Canon_V2_White.svg`,
    launcher: `${LA_WEAPON_ICONS}/Launcher_V2_White.svg`,
    melee: 'systems/lancer/assets/icons/white/melee.svg',
    nexus: `${LA_WEAPON_ICONS}/Nexus_White.svg`,
    rifle: `${LA_WEAPON_ICONS}/Rifle_White.svg`,
};

const WEAPON_TYPE_ICON_FALLBACK = 'systems/lancer/assets/icons/white/mech_weapon.svg';

/** Weapon-type icon path. Mech weapons type per profile, NPC features fold it into weapon_type ("Main Cannon"). */
export function weaponTypeIcon(weapon)
{
    const sys = weapon?.system;
    if (!sys)
        return WEAPON_TYPE_ICON_FALLBACK;
    const profile = sys.active_profile ?? sys.profiles?.[sys.selected_profile_index ?? 0];
    const words = `${profile?.type ?? ''} ${sys.weapon_type ?? ''}`.toLowerCase().split(/[^a-z]+/);
    for (const word of words)
    {
        if (Object.hasOwn(WEAPON_TYPE_ICON, word))
            return WEAPON_TYPE_ICON[word];
    }
    return WEAPON_TYPE_ICON_FALLBACK;
}

/** Four-segment size rule drawn left of the weapon icon, filling upward; inherits currentColor. */
export function laHudSizeMark(level)
{
    if (level == null)
        return '';
    const length = 3.4;
    const gap = 2;
    const thickness = 2;
    const total = length * 4 + gap * 3;
    let bars = '';
    for (let step = 0; step < 4; step++)
    {
        const dim = step <= level ? '' : ' opacity="0.25"';
        const offset = total - (step + 1) * length - step * gap;
        bars += `<rect x="0" y="${offset.toFixed(2)}" width="${thickness}" height="${length}" fill="currentColor"${dim}/>`;
    }
    return `<svg class="la-hud-size-mark" width="${thickness}" height="${total.toFixed(2)}" viewBox="0 0 ${thickness} ${total.toFixed(2)}" fill="none" aria-hidden="true">${bars}</svg>`;
}

export function getDeployableIcon(depInfo)
{
    const type = String(depInfo?.type ?? '');
    if (/mine/i.test(type))
        return 'systems/lancer/assets/icons/white/mine.svg';
    if (/drone/i.test(type))
        return 'systems/lancer/assets/icons/white/drone.svg';
    return 'systems/lancer/assets/icons/white/deployable.svg';
}


/**
 * Builds a col4 item list for any Lancer item.
 *
 * @param {Item} item
 * @param {Object}  [opts]
 * @param {Array}   [opts.defaultActions=[]]  Items shown at the very top (e.g. SKIRMISH / BARRAGE)
 * @param {Item}    [opts.modItem=null]        Weapon mod item
 * @param {Function} [opts.showPopup=null]     (popup, rowEl) => void - if provided, actions get right-click detail popups
 * @param {Function} [opts.onActivate=null]   (action) => void - if provided, actions get an onClick handler
 * @param {Function} [opts.actionPopup=null]  (action, source) => (rowEl) => void - replaces the default action right-click popup
 * @returns {Array}
 */
export function laHudItemChildren(item, opts = {})
{
    const { defaultActions = [], modItem = null, showPopup = null, onActivate = null, actionPopup = null } = opts;
    const sys = item.system;
    const profiles = sys.profiles ?? [];
    const activeIdx = sys.selected_profile_index ?? 0;
    const activeProfileActions = profiles[activeIdx]?.actions ?? [];
    const taggedActions = [
        ...getItemActions(item).map(action => ({ action, source: item })),
        ...activeProfileActions.map(action => ({ action, source: item })),
        ...getItemActions(modItem).map(action => ({ action, source: modItem })),
    ];
    // Dedupe by (name, activation, source).
    const _seenActions = new Set();
    const _dedupedActions = [];
    for (const entry of taggedActions)
    {
        const key = `${entry.source?.id ?? '?'}|${entry.action?.name ?? ''}|${entry.action?.activation ?? ''}`;
        if (_seenActions.has(key))
            continue;
        _seenActions.add(key);
        _dedupedActions.push(entry);
    }
    taggedActions.length = 0;
    taggedActions.push(..._dedupedActions);
    const items = [...defaultActions];

    // Actions
    if (taggedActions.length)
    {
        taggedActions.forEach(({ action, source }) =>
        {
            const status = getItemStatus(source, action);
            const entry = {
                label: action.name,
                action,
                icon: getActivationIcon(action),
                badge: status.badge,
                badgeColor: status.badgeColor,
                statusKind: statusKindOf(status),
                onClick: onActivate ? () => onActivate(action, source) : null,
            };
            entry.onRightClick = actionPopup ? actionPopup(action, source) : (row) =>
            {
                const bodyHtml = laRenderActionDetail(action, { sourceName: source?.name });
                const subtitle = action.activation ?? '';
                const popup = laDetailPopup('la-hud-popup la-hud-action-popup', action.name, subtitle, bodyHtml, activationTheme(action.activation));
                if (showPopup)
                    showPopup(popup, row);
            };
            items.push(entry);
        });
    }

    // Profiles
    if (profiles.length > 1)
    {
        items.push({ label: localize('LA.tokenHud.profiles'), isSectionLabel: true });
        profiles.forEach((profile, idx) =>
        {
            const isActive = idx === activeIdx;
            const profileName = profile.name || `Profile ${idx + 1}`;
            items.push({
                label: (isActive ? '● ' : '○ ') + profileName,
                icon: ICON_PROFILE,
                stripeStyle: isActive ? {
                    bg: 'repeating-linear-gradient(45deg, #2e5a80 0 6px, #26496a 6px 12px)',
                    hoverBg: 'repeating-linear-gradient(45deg, #3f74a3 0 6px, #356088 6px 12px)',
                    border: '#5b9bd5',
                    color: '#d8ebfb',
                    hoverColor: '#ecf5fd'
                } : null,
                keepOpen: true,
                clickSound: 'toggle',
                _profile: profile,
                favKey: `${item.uuid ?? item.id}|profile-${idx}`,
                onClick: isActive
                    ? () => ui.notifications.info(localizeFormat('LA.notify.alreadyActiveProfile', { name: profileName }))
                    : () => executeProfileSwitch(item, idx),
                refreshCol4: () => laHudItemChildren(item, opts),
                onRightClick: showPopup ? (row) =>
                {
                    const bodyHtml = laRenderWeaponProfile(profile, false);
                    const subtitle = [profile.type, item.name, isActive ? 'Active' : null].filter(Boolean).join(' · ');
                    const popup = laDetailPopup('la-hud-popup la-hud-profile-popup', profileName, subtitle, bodyHtml, 'weapon');
                    showPopup(popup, row);
                } : null,
            });
        });
    }

    // Mod
    if (modItem)
    {
        items.push({ label: localize('LA.tokenHud.mod'), isSectionLabel: true });
        items.push({
            label: modItem.name,
            icon: ICON_MOD,
            favKey: `${modItem.uuid ?? modItem.id}|mod`,
            onClick: () => executeSimpleActivation(item.actor, {
                title: modItem.name,
                action: { name: modItem.name, activation: 'Mod' },
                detail: modItem.system?.effect ?? ''
            }, { item: modItem, hostWeapon: item }),
        });
    }

    return items;
}

const PIP_LABEL_STYLE = 'font-size:0.7em;color:#888;text-transform:uppercase;letter-spacing:0.05em;min-width:54px;flex-shrink:0;';
const PIP_STYLE = 'cursor:pointer;font-size:1.3em;line-height:1;padding:0 2px;';
const PIP_WRAP_STYLE = 'display:flex;flex-direction:column;gap:5px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #2a2a2a;';

function pickPipValue(pipIdx, current, max)
{
    return Math.max(0, Math.min(max, pipIdx === current ? pipIdx - 1 : pipIdx));
}

function prependPipWrap(popup, cls = null)
{
    const wrap = $(`<div${cls ? ` class="${cls}"` : ''} style="${PIP_WRAP_STYLE}"></div>`);
    popup.children().last().prepend(wrap);
    return wrap;
}

function autoConsumeRow(item)
{
    const cfgRow = $(`<div style="display:flex;justify-content:flex-end;margin-bottom:2px;"><span class="la-ec-open" title="Auto-consume settings" style="cursor:pointer;font-size:0.68em;color:#888;text-transform:uppercase;letter-spacing:0.05em;"><i class="fas fa-sliders"></i> Auto-consume</span></div>`);
    cfgRow.find('.la-ec-open').on('click', () => openExtraConfigDialog(item));
    return cfgRow;
}

function readExtraActionEntry(doc, action)
{
    return (getLAFlag(doc, 'extraActions') || []).find(entry => entry.name === action.name) ?? action;
}

async function patchExtraActionEntry(doc, actionName, patch)
{
    const list = getLAFlag(doc, 'extraActions') || [];
    const idx = list.findIndex(entry => entry.name === actionName);
    if (idx < 0)
        return;
    const next = list.slice();
    next[idx] = { ...next[idx], ...patch };
    await setLAFlag(doc, 'extraActions', next);
}

function appendResourcePips(wrap, state, { hasLoading, hasRecharge, hasLimited, patch, rebuild, suffix = '' })
{
    if (hasLoading)
    {
        const loaded = state.loaded !== false;
        const pip = $(`<span style="${PIP_STYLE}color:${loaded ? '#3a9e6e' : '#c33'};">${loaded ? '⬢' : '⬡'}</span>`);
        pip.on('click', async () =>
        {
            playUiSound('toggle');
            await patch({ loaded: !loaded });
            rebuild();
        });
        wrap.append($(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${PIP_LABEL_STYLE}">Loading${suffix}</span>`), pip));
    }
    if (hasRecharge)
    {
        const charged = state.charged !== false;
        const pip = $(`<span style="${PIP_STYLE}color:${charged ? '#3a9e6e' : '#c33'};font-size:1em;">${rechargeIcon(charged)}</span>`);
        pip.on('click', async () =>
        {
            playUiSound('toggle');
            await patch({ charged: !charged });
            rebuild();
        });
        wrap.append($(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${PIP_LABEL_STYLE}">Charged${suffix}</span>`), pip));
    }
    if (!hasLimited || state.uses == null)
        return;
    const isObj = typeof state.uses !== 'number';
    const current = isObj ? (state.uses.value ?? 0) : state.uses;
    const max = isObj ? (state.uses.max ?? 0) : state.uses;
    if (!(max > 0))
        return;
    const usesRow = $(`<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;"></div>`).append($(`<span style="${PIP_LABEL_STYLE}">Uses${suffix}</span>`));
    for (let pipIdx = 1; pipIdx <= max; pipIdx++)
    {
        const pip = $(`<span style="${PIP_STYLE}color:${pipIdx <= current ? '#3a9e6e' : '#444'};">${pipIdx <= current ? '⬢' : '⬡'}</span>`);
        pip.on('click', async () =>
        {
            playUiSound('toggle');
            const newVal = pickPipValue(pipIdx, current, max);
            await patch(isObj ? { uses: { ...state.uses, value: newVal } } : { uses: newVal });
            rebuild();
        });
        usesRow.append(pip);
    }
    wrap.append(usesRow);
}

/**
 * Appends an interactive uses/loading/charged pips section to a detail popup body.
 * Call as `postRender` on any item popup that might have limited/loading/recharge tags.
 * Does nothing if the item has none of those tags.
 * @param {any} item   Foundry Item document
 * @param {any} popup  jQuery popup element (from laDetailPopup)
 * @param {{ incDepth?: () => void, decDepth?: () => void, action?: any, subData?: any, subKey?: string }} [depthCallbacks]  optional HUD refresh-suppression hooks + optional extra action with recharge + optional sub-entry (trait/rank/core_system) to restrict per-freq detection + flag key for sub-scoped usage
 */
export function appendItemPips(item, popup, depthCallbacks)
{
    const action = depthCallbacks?.action;
    const subData = depthCallbacks?.subData;
    const isActorExtra = item?.documentName === 'Actor' && action?._addedViaExtrasUI === true;
    const scoped = subData || isActorExtra || item?.documentName !== 'Item'
        ? { sub: subData ?? action ?? null, key: depthCallbacks?.subKey ?? null }
        : resolveActionScope(item, action, depthCallbacks?.subKey ?? null);
    const subKey = scoped.key;
    const sys = item?.system;
    const allTags = isActorExtra
        ? (action?.tags ?? [])
        : itemAllTags(sys);
    const hasLoading  = allTags.some(tag => tag.lid === 'tg_loading');
    const hasRecharge = allTags.some(tag => tag.lid === 'tg_recharge');
    const hasLimited  = allTags.some(tag => tag.lid === 'tg_limited');
    const perFreqOn = isPerFrequencyEnabled();
    const subEntry = scoped.sub;
    const subCtx = item?.documentName === 'Item' && subKey ? { item, key: subKey } : null;
    const perRoundMax = perFreqOn ? Math.max(Number(allTags.find(tag => tag.lid === 'tg_round')?.val ?? 0), subEntry ? getPerRoundLimitFromSub(subEntry, subCtx) : getPerRoundLimit(item)) : 0;
    const perTurnMax = perFreqOn ? Math.max(Number(allTags.find(tag => tag.lid === 'tg_turn')?.val ?? 0), subEntry ? getPerTurnLimitFromSub(subEntry, subCtx) : getPerTurnLimit(item)) : 0;
    const perSceneMax = !perFreqOn || isActorExtra ? 0
        : subEntry ? getPerSceneLimitFromSub(subEntry, subCtx)
            : (item?.type === 'frame' ? 0 : getPerSceneLimit(item));
    const perMissionMax = !perFreqOn || isActorExtra ? 0
        : subEntry ? getPerMissionLimitFromSub(subEntry, subCtx)
            : (item?.type === 'frame' ? 0 : getPerMissionLimit(item));
    const hasExtraRecharge = !!action?.recharge && !isActorExtra;
    const isCoreActive = !!action && item?.type === 'frame' && (
        (item.system?.core_system?.active_actions ?? []).some(/** @type {any} */ candidate => candidate === action || candidate?.name === action?.name)
        || action?.name === item.system?.core_system?.active_name
        || action?.name === item.system?.core_system?.name
    );
    if (!hasLoading && !hasRecharge && !hasLimited && !hasExtraRecharge && !perRoundMax && !perTurnMax && !perSceneMax && !perMissionMax && !isCoreActive)
        return;

    const pipsWrap = prependPipWrap(popup);
    if (item?.documentName === 'Item')
        pipsWrap.append(autoConsumeRow(item));

    const readState = () =>
    {
        if (subKey)
            return getSubUses(item, subKey);
        if (isActorExtra)
            return readExtraActionEntry(item, action);
        return item.system;
    };
    const patchState = async (patch) =>
    {
        if (subKey)
        {
            await patchSubUses(item, subKey, patch);
            return;
        }
        if (isActorExtra)
            await patchExtraActionEntry(item, action.name, patch);
        else
        {
            const flat = {};
            for (const [key, value] of Object.entries(patch))
                flat[`system.${key}`] = value;
            await /** @type {any} */ (item).update(flat);
        }
    };

    const rebuild = () =>
    {
        pipsWrap.empty();
        const state = readState();
        appendResourcePips(pipsWrap, state, { hasLoading, hasRecharge, hasLimited, patch: patchState, rebuild });
        const inCombat = !!game.combat?.started;
        const renderFreqRow = (label, max, used, fieldKey, iconReady, iconConsumed, dim) =>
        {
            const usesRow = $(`<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;${dim ? 'opacity:0.5;' : ''}"></div>`).append($(`<span style="${PIP_LABEL_STYLE}">${label}</span>`));
            for (let pipIdx = 1; pipIdx <= max; pipIdx++)
            {
                const consumed = pipIdx <= used;
                const pip = $(`<span style="${PIP_STYLE}color:${consumed ? '#c33' : '#3a9e6e'};"><span class="mdi ${consumed ? iconConsumed : iconReady}"></span></span>`);
                pip.on('click', async () =>
                {
                    playUiSound('toggle');
                    await patchState({ [fieldKey]: { value: pickPipValue(pipIdx, used, max) } });
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
            renderFreqRow('Per encounter', perSceneMax, Number(state.uses_per_scene?.value ?? 0), 'uses_per_scene', 'mdi-cog', 'mdi-cog-off', false);
        if (perMissionMax > 0)
            renderFreqRow('Per mission', perMissionMax, Number(state.uses_per_mission?.value ?? 0), 'uses_per_mission', 'mdi-flag', 'mdi-flag-off', false);
        if (isCoreActive)
        {
            const actor = item.parent ?? item.actor;
            const charged = (actor?.system?.core_energy ?? 0) > 0;
            const row = $(`<div style="display:flex;align-items:center;gap:6px;"></div>`).append($(`<span style="${PIP_LABEL_STYLE}">Core Power</span>`));
            const pip = $(`<span style="${PIP_STYLE}color:${charged ? '#3a9e6e' : '#c33'};"><i class="mdi ${charged ? 'mdi-battery' : 'mdi-battery-off'}"></i></span>`);
            pip.on('click', async (ev) =>
            {
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

    // Item-attached extras-UI action: a second pip row whose tags are disjoint from the item's (deduped at add-time), state living on the flag entry by name.
    const isItemDoc = item?.documentName === 'Item';
    if (isItemDoc && action?._addedViaExtrasUI && Array.isArray(action.tags) && action.tags.length)
    {
        const actionHasLoading  = action.tags.some(tag => tag.lid === 'tg_loading');
        const actionHasRecharge = action.tags.some(tag => tag.lid === 'tg_recharge');
        const actionHasLimited  = action.tags.some(tag => tag.lid === 'tg_limited');
        if (actionHasLoading || actionHasRecharge || actionHasLimited)
        {
            const actionWrap = prependPipWrap(popup, 'la-ea-pips');
            const rebuildAction = () =>
            {
                actionWrap.empty();
                appendResourcePips(actionWrap, readExtraActionEntry(item, action), {
                    hasLoading: actionHasLoading,
                    hasRecharge: actionHasRecharge,
                    hasLimited: actionHasLimited,
                    patch: (patch) => patchExtraActionEntry(item, action.name, patch),
                    rebuild: rebuildAction,
                    suffix: '*',
                });
            };
            rebuildAction();
        }
    }

    // Extra-action recharge pip (action-level, not item-level), same "Charged" label and ▣/□ style as native tg_recharge items.
    const extraAction = depthCallbacks?.action;
    if (extraAction?.recharge && item && !extraAction._addedViaExtrasUI)
    {
        const extraActionWrap = pipsWrap;
        const rebuildExtraAction = () =>
        {
            const extraActionEntry = (getLAFlag(item,'extraActions') || []).find(entry => entry.name === extraAction.name);
            const charged = extraActionEntry ? extraActionEntry.charged !== false : extraAction.charged !== false;
            extraActionWrap.find('.la-ea-recharge-row').remove();
            const row = $(`<div class="la-ea-recharge-row" style="display:flex;align-items:center;gap:6px;"></div>`);
            row.append($(`<span style="${PIP_LABEL_STYLE}">Charged</span>`));
            const pip = $(`<span style="${PIP_STYLE}color:${charged ? '#3a9e6e' : '#c33'};font-size:1em;">${rechargeIcon(charged)}</span>`);
            pip.on('click', async () =>
            {
                playUiSound('toggle');
                const actions = getLAFlag(item,'extraActions') || [];
                const match = actions.find(entry => entry.name === extraAction.name);
                if (match)
                {
                    match.charged = !match.charged;
                    await setLAFlag(item,'extraActions', actions);
                    extraAction.charged = match.charged;
                }
                rebuildExtraAction();
            });
            row.append(pip);
            extraActionWrap.append(row);
        };
        rebuildExtraAction();
    }
}

// Uses pips for a bond power; calendar icons regardless of the per-X frequency text.
export function appendBondPowerPips(bond, powerIdx, popup)
{
    const power = /** @type {any} */ (bond)?.system?.powers?.[powerIdx];
    if (!power?.uses || !(power.uses.max > 0))
        return;
    const S_PIP = 'cursor:pointer;font-size:1.15em;line-height:1;padding:0 2px;';
    const wrap = prependPipWrap(popup);
    const pipHolder = $(`<div></div>`);
    wrap.append(pipHolder);
    const max = power.uses.max;
    const rebuild = (/** @type {number} */ value) =>
    {
        pipHolder.empty();
        const row = $(`<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;"></div>`).append($(`<span style="${PIP_LABEL_STYLE}">${escapeHtml(power.frequency || 'Uses')}</span>`));
        for (let slot = 1; slot <= max; slot++)
        {
            const filled = slot <= value;
            const pip = $(`<span style="${S_PIP}color:${filled ? '#3a9e6e' : '#444'};"><i class="mdi ${filled ? 'mdi-calendar-today' : 'mdi-calendar-blank'}"></i></span>`);
            const pipIdx = slot;
            pip.on('click', async () =>
            {
                playUiSound('toggle');
                const target = pickPipValue(pipIdx, value, max);
                await bond.update({ [`system.powers.${powerIdx}.uses.value`]: target });
                rebuild(target);
            });
            row.append(pip);
        }
        pipHolder.append(row);
    };
    rebuild(power.uses.value ?? 0);
}

// Consume pips for a merged reserve group (each copy is a binary system.used); clicking pip N sets N available.
export function appendReservePips(group, popup)
{
    if (!Array.isArray(group) || !group.length || !group[0]?.system?.consumable)
        return;
    const total = group.length;
    const wrap = prependPipWrap(popup);
    wrap.append(autoConsumeRow(group[0]));
    const pipHolder = $(`<div></div>`);
    wrap.append(pipHolder);
    const rebuild = () =>
    {
        pipHolder.empty();
        const available = group.filter(copy => !copy.system?.used).length;
        const row = $(`<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;"></div>`).append($(`<span style="${PIP_LABEL_STYLE}">Uses</span>`));
        for (let slot = 1; slot <= total; slot++)
        {
            const pipIdx = slot;
            const filled = pipIdx <= available;
            const pip = $(`<span style="${PIP_STYLE}color:${filled ? '#3a9e6e' : '#444'};">${filled ? '⬢' : '⬡'}</span>`);
            pip.on('click', async () =>
            {
                playUiSound('toggle');
                const target = pickPipValue(pipIdx, available, total);
                await _setReserveAvailable(group, target);
                rebuild();
            });
            row.append(pip);
        }
        pipHolder.append(row);
    };
    rebuild();
}

async function _setReserveAvailable(group, available)
{
    const updates = group
        .map((copy, idx) => (!!copy.system?.used === (idx >= available)) ? null : copy.update({ 'system.used': idx >= available }))
        .filter(Boolean);
    await Promise.all(updates);
}
