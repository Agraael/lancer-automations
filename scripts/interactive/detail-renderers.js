/* global $ */

/**
 * Shared popup rendering helpers for lancer-automations choice dialogs.
 * Used by combat.js (choseMount, choseSystem, choseTrait, chooseInvade)
 * and structure.js (showSystemTraumaDialog).
 */

import { getActivationIcon } from '../tools/misc-tools.js';
import { isWhiteIcon } from '../tah/item-helpers.js';

function activationChipContent(action)
{
    const oneIcon = (activation) =>
    {
        const icon = getActivationIcon({ activation, tech_attack: action.tech_attack });
        if (!icon)
            return '';
        if (icon.startsWith('mdi'))
            return `<i class="${icon}" style="margin-right:3px;vertical-align:-1px;"></i>`;
        return `<img src="${icon}" style="display:inline-block;width:0.95em;height:0.95em;margin-right:3px;vertical-align:-2px;filter:${isWhiteIcon(icon) ? 'none' : 'invert(1)'};">`;
    };
    return String(action.activation ?? '')
        .split('/')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => `${oneIcon(part)}${part}`)
        .join(' / ');
}

function activationChip(action)
{
    const content = activationChipContent(action);
    return content
        ? `<span style="display:inline-flex;align-items:center;margin-left:5px;padding:0 5px;background:rgba(255,255,255,0.1);border:1px solid #555;border-radius:3px;font-size:0.72em;color:#ccc;white-space:nowrap;vertical-align:middle;">${content}</span>`
        : '';
}

const RANGE_CCI = { range: 'cci-range', threat: 'cci-threat', thrown: 'cci-thrown', line: 'cci-line', cone: 'cci-cone', blast: 'cci-blast', burst: 'cci-burst' };

function rangeIcon(type)
{
    const cls = RANGE_CCI[String(type ?? '').toLowerCase()] ?? 'cci-range';
    return `<i class="cci ${cls}" style="vertical-align:-1px;margin-right:2px;"></i>`;
}

function damageIcon(type)
{
    const key = String(type ?? '').toLowerCase();
    return `<i class="cci cci-${key} damage--${key}" style="vertical-align:-1px;margin-right:2px;"></i>`;
}

// Layout utilities

/**
 * Returns a coloured section-label badge for detail popups.
 * @param {string} text
 * @param {string} bg  CSS colour
 * @returns {string}
 */
export function laPopupSectionLabel(text, bg)
{
    return `<span style="display:inline-block;background:${bg};color:#fff;font-size:0.65em;padding:1px 5px;border-radius:2px;font-weight:bold;letter-spacing:0.5px;margin-bottom:3px;">${text}</span>`;
}

/**
 * Binds the standard popup interactions: close button, mod-block toggle,
 * click-outside dismiss, and stopPropagation.
 * Called by both laPositionPopup (dialog context) and LancerHUD._showPopupAt (HUD context).
 * @param {JQuery} popup
 */
export function laBindPopupBehavior(popup)
{
    popup.find('.la-detail-close').on('click', () => popup.remove());
    popup.on('click', '.la-mod-block', function()
    {
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
export function laPositionPopup(popup, html)
{
    $('body').append(popup);
    const dlg = html.closest('.app');
    const dlgOffset = dlg.offset() ?? { left: 100, top: 100 };
    const dlgWidth = dlg.outerWidth() ?? 480;
    const popupWidth = popup.outerWidth(), popupHeight = popup.outerHeight();
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
    let popupLeft = dlgOffset.left + dlgWidth + 8;
    if (popupLeft + popupWidth > viewportWidth - 10)
        popupLeft = dlgOffset.left - popupWidth - 8;
    let popupTop = dlgOffset.top;
    if (popupTop + popupHeight > viewportHeight - 10)
        popupTop = viewportHeight - popupHeight - 10;
    const finalLeft = Math.max(10, popupLeft);
    popup.css({ left: finalLeft - 20, top: Math.max(10, popupTop), opacity: 0 });
    popup.animate({ left: finalLeft, opacity: 1 }, { duration: 150, easing: 'swing' });
    laBindPopupBehavior(popup);
}

// Content renderers

/**
 * Strips raw HTML from Lancer item data and returns clean, readable HTML.
 * Block-level tags (p, br, li, div) become newlines; remaining tags are stripped.
 * Use this on any `action.detail`, `system.effect`, description, etc. before embedding.
 * @param {string} rawHtml
 * @returns {string}  Plain text with <br> separators, safe to embed in innerHTML
 */
export function laFormatDetailHtml(rawHtml)
{
    if (!rawHtml)
        return '';
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

// Resolve a tag lid to its Lancer-configured display name (tags stored as bare {lid}).
function tagConfigName(lid)
{
    if (!lid)
        return null;
    try
    {
        const lancer = /** @type {any} */ (globalThis).game;
        return lancer?.settings?.get(lancer.system.id, 'tagConfig')?.[lid]?.name ?? null;
    }
    catch
    {
        return null;
    }
}

/**
 * Renders a flex row of tag chips.
 * @param {Array} tags
 * @param {Function} [resolveStr]  Optional string resolver (e.g. tier resolution)
 * @returns {string}
 */
export function laRenderTags(tags, resolveStr)
{
    if (!tags?.length)
        return '';
    const resolve = resolveStr ?? (str => str);
    const chips = tags.map(tag =>
    {
        const raw = String(tag._resolvedName ?? tag.name ?? tagConfigName(tag.lid) ?? tag.lid ?? tag.id ?? '');
        const text = resolve(raw).replaceAll('{VAL}', resolve(String(tag.val ?? '')));
        return `<span style="background:rgba(255,255,255,0.1);border:1px solid #555;border-radius:3px;padding:1px 6px;font-size:0.75em;color:#ccc;white-space:nowrap;">${text}</span>`;
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
export function laRenderTextSection(label, text, labelColor, resolveStr)
{
    if (!text)
        return '';
    const resolve = resolveStr ?? (s => s);
    return `<div style="margin-bottom:6px;">${laPopupSectionLabel(label, labelColor)}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(resolve(text))}</div></div>`;
}

/**
 * @param {Array} actions
 * @param {Function} [resolveStr]
 * @returns {string}
 */
export function laRenderActions(actions, resolveStr)
{
    if (!actions?.length)
        return '';
    const resolve = resolveStr ?? (s => s);
    const items = actions.map(action =>
    {
        const effectHtml = laFormatDetailHtml(resolve(action.detail || action.effect || ''));
        return `<div style="margin-top:4px;padding:4px 6px;background:rgba(255,255,255,0.04);border-radius:3px;">
            <div style="font-size:0.78em;font-weight:bold;color:#ccc;display:flex;align-items:center;flex-wrap:wrap;">${action.name || ''}${activationChip(action)}</div>
            ${effectHtml ? `<div style="font-size:0.78em;color:#aaa;margin-top:2px;line-height:1.3;">${effectHtml}</div>` : ''}
        </div>`;
    }).join('');
    return `<div style="margin-bottom:4px;">${laPopupSectionLabel('ACTIONS', '#1a5c3a')}${items}</div>`;
}

/**
 * @param {Array} deployableActors
 * @returns {string}
 */
// Strip the trailing " [owner]" suffix a deploy adds to token names; display-only.
export function stripDeployOwner(name)
{
    const stripped = String(name ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    return stripped || String(name ?? '');
}

export function laRenderDeployables(deployableActors, opts = {})
{
    if (!deployableActors?.length)
        return '';
    const { label = 'DEPLOYABLE', metas = null } = opts;
    const items = deployableActors.map((deployable, idx) =>
    {
        const sys = deployable.system;
        const statPairs = [
            sys?.hp?.max != null ? `HP ${sys.hp.max}` : null,
            sys?.size != null ? `Size ${sys.size}` : null,
            sys?.armor != null && sys.armor > 0 ? `Armor ${sys.armor}` : null,
            sys?.evasion != null ? `Evasion ${sys.evasion}` : null,
            sys?.edef != null ? `E-Def ${sys.edef}` : null,
            sys?.speed != null && sys.speed > 0 ? `Speed ${sys.speed}` : null,
            sys?.heatcap != null && sys.heatcap > 0 ? `Heat ${sys.heatcap}` : null,
            sys?.save != null && sys.save > 0 ? `Save ${sys.save}` : null
        ].filter(Boolean);
        const depDetail = laFormatDetailHtml(sys?.detail || sys?.effect || '');
        const depTags = laRenderTags(sys?.tags ?? []);
        const activationLabel = activationChip({ activation: sys?.activation });
        const typeChip = sys?.type ? `<span style="font-size:0.62em;font-weight:bold;color:#c084fc;background:rgba(124,58,237,0.22);border:1px solid rgba(124,58,237,0.5);border-radius:3px;padding:0 4px;margin-left:5px;text-transform:uppercase;letter-spacing:0.3px;">${sys.type}</span>` : '';
        const hasBody = !!(depDetail || depTags);
        const meta = metas?.[idx];
        const metaHtml = meta ? `<div style="font-size:0.72em;color:#e8a030;font-weight:bold;margin-bottom:2px;">Range ${meta.range} · Count ${meta.count === -1 ? '∞' : meta.count}</div>` : '';
        const actionsHtml = (sys?.actions ?? []).map(/** @type {any} */ action =>
        {
            const triggerHtml = action.trigger ? `<div style="font-size:0.8em;color:#aaa;margin-top:2px;"><span style="font-weight:bold;color:#c084fc;">TRIGGER</span> ${action.trigger}</div>` : '';
            const detailHtml  = action.detail  ? `<div style="font-size:0.8em;color:#bbb;margin-top:2px;line-height:1.35;">${laFormatDetailHtml(action.detail)}</div>` : '';
            const freqHtml    = action.frequency ? `<span style="font-size:0.75em;color:#888;margin-left:4px;">${action.frequency}</span>` : '';
            return `<div style="margin-top:4px;padding:3px 5px;background:rgba(74,16,112,0.15);border-left:2px solid #7c3aed;border-radius:2px;">
                <div style="font-size:0.82em;font-weight:bold;color:#c084fc;display:flex;align-items:center;flex-wrap:wrap;">${action.name}${activationChip(action)}${freqHtml}</div>
                ${triggerHtml}${detailHtml}
            </div>`;
        }).join('');
        return `<div style="margin-top:4px;padding:5px 7px;background:rgba(74,16,112,0.1);border:1px solid rgba(74,16,112,0.35);border-radius:3px;">
            <div style="font-size:0.85em;font-weight:bold;color:#c084fc;margin-bottom:3px;display:flex;align-items:center;flex-wrap:wrap;">${stripDeployOwner(deployable.name)}${typeChip}${activationLabel}</div>
            ${metaHtml}
            ${statPairs.length ? `<div style="font-size:0.8em;color:#aaa;display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${hasBody ? '4' : '0'}px;">${statPairs.map(pair => `<span>${pair}</span>`).join('')}</div>` : ''}
            ${depTags}
            ${depDetail ? `<div style="font-size:0.77em;color:#bbb;line-height:1.3;">${depDetail}</div>` : ''}
            ${actionsHtml}
        </div>`;
    }).join('');
    return `<div style="margin-bottom:4px;">${laPopupSectionLabel(label, '#4a1070')}${items}</div>`;
}

/**
 * Renders LA extra statuses attached to an item as item templates
 * (`item.effects` with `flags['lancer-automations'].isItemTemplate === true`).
 * @param {any} item
 * @returns {string}
 */
export function laRenderItemStatusTemplates(item)
{
    const templates = /** @type {any[]} */ (Array.from(item?.effects ?? []))
        .filter(effect => effect.flags?.['lancer-automations']?.isItemTemplate === true);
    if (!templates.length)
        return '';
    const rows = templates.map(effect =>
    {
        const img = effect.img ? `<img src="${effect.img}" style="width:18px;height:18px;border:none;flex-shrink:0;background:rgba(0,0,0,0.3);border-radius:2px;padding:1px;">` : '';
        return `<div style="margin-top:3px;padding:4px 6px;background:rgba(61,90,160,0.1);border:1px solid rgba(61,90,160,0.35);border-radius:3px;display:flex;align-items:center;gap:6px;">
            ${img}
            <span style="font-size:0.78em;font-weight:bold;color:#9bb0e0;">${effect.name || ''}</span>
        </div>`;
    }).join('');
    return `<div style="margin-bottom:4px;">${laPopupSectionLabel('ATTACHED STATUSES', '#3d5aa0')}${rows}</div>`;
}

/**
 * One-line summary of a single bonus data struct (type + optional subtype + val).
 * @param {any} bonus
 * @returns {string}
 */
function _summarizeBonusData(bonus)
{
    if (!bonus)
        return '';
    const type = bonus.type ?? '';
    const subtype = bonus.subtype ? ` [${bonus.subtype}]` : '';
    let extra = '';
    if (bonus.stat)
        extra = ` ${bonus.stat}`;
    else if (Array.isArray(bonus.damageTypes) && bonus.damageTypes.length)
        extra = ` ${bonus.damageTypes.join(', ')}`;
    else if (Array.isArray(bonus.effects) && bonus.effects.length)
        extra = ` ${bonus.effects.join(', ')}`;
    else if (Array.isArray(bonus.rollTypes) && bonus.rollTypes.length)
        extra = ` (${bonus.rollTypes.join(', ')})`;
    const val = bonus.val !== undefined ? ` ${bonus.val}` : '';
    return `${type}${subtype}${extra}${val}`;
}

/**
 * Renders LA extra bonuses attached to an item as bonus templates
 * (`item.flags['lancer-automations'].bonusTemplates`).
 * @param {any} item
 * @returns {string}
 */
export function laRenderItemBonusTemplates(item)
{
    const templates = /** @type {any[]} */ (item?.getFlag?.('lancer-automations', 'bonusTemplates') || []);
    if (!templates.length)
        return '';
    const rows = templates.map(template =>
    {
        const bonus = template.bonusData ?? {};
        const name = bonus.name || 'Bonus';
        let summary = '';
        if (bonus.type === 'multi' && Array.isArray(bonus.bonuses) && bonus.bonuses.length)
        {
            const subs = bonus.bonuses.map(sub =>
                `<div style="font-size:0.72em;color:#a5c7e8;margin-left:10px;">· ${_summarizeBonusData(sub)}</div>`
            ).join('');
            summary = `<span style="font-size:0.75em;color:#888;margin-left:6px;">multi</span>${subs}`;
        }
        else
            summary = `<span style="font-size:0.75em;color:#888;margin-left:6px;">${_summarizeBonusData(bonus)}</span>`;
        return `<div style="margin-top:3px;padding:4px 6px;background:rgba(21,101,192,0.08);border:1px solid rgba(21,101,192,0.35);border-radius:3px;">
            <div><span style="font-size:0.78em;font-weight:bold;color:#a5c7e8;">${name}</span>${summary}</div>
        </div>`;
    }).join('');
    return `<div style="margin-bottom:4px;">${laPopupSectionLabel('ATTACHED BONUSES', '#1565c0')}${rows}</div>`;
}

/**
 * Renders every LA extra layered onto an item: extra actions, extra deployables,
 * attached status templates, attached bonus templates. Returns '' if the item has none.
 * @param {any} item
 * @returns {Promise<string>}
 */
export async function laRenderItemExtras(item)
{
    if (!item)
        return '';
    const laFlags = item.flags?.['lancer-automations'] ?? {};
    let html = '';

    // Auto-consume status block (always shown when the item has any consumable resources).
    try
    {
        const { renderConsumeStatusHtml } = await import('./extra-config.js');
        html += renderConsumeStatusHtml(item);
    }
    catch (err)
    {
        console.warn('lancer-automations | consume-status render failed:', err);
    }

    const extraActions = /** @type {any[]} */ (laFlags.extraActions ?? []);
    if (extraActions.length)
    {
        const items = extraActions.map(action =>
        {
            const effectHtml = laFormatDetailHtml(action.detail || action.effect || '');
            return `<div style="margin-top:4px;padding:4px 6px;background:rgba(255,255,255,0.04);border-radius:3px;">
                <div style="font-size:0.78em;font-weight:bold;color:#ccc;display:flex;align-items:center;flex-wrap:wrap;">${action.name || ''}${activationChip(action)}</div>
                ${effectHtml ? `<div style="font-size:0.78em;color:#aaa;margin-top:2px;line-height:1.3;">${effectHtml}</div>` : ''}
            </div>`;
        }).join('');
        html += `<div style="margin-bottom:4px;">${laPopupSectionLabel('EXTRA ACTIONS', '#1a5c3a')}${items}</div>`;
    }

    const lids = /** @type {string[]} */ (laFlags.extraDeployables ?? []);
    const uuids = /** @type {string[]} */ (laFlags.extraDeployableActors ?? []);
    if (lids.length || uuids.length)
    {
        const { resolveDeployable, getItemDeployables, resolveDeployRangeCount } = await import('./deployables.js');
        const ownerActor = item.parent?.documentName === 'Actor' ? item.parent : null;
        const survivors = new Set(getItemDeployables(item, ownerActor));
        const combined = [...lids, ...uuids].filter(key => survivors.has(key));
        const resolved = [];
        for (const entry of combined)
        {
            const isUuid = typeof entry === 'string' && entry.includes('.');
            try
            {
                if (isUuid)
                {
                    const doc = await fromUuid(entry);
                    resolved.push(doc ?? { name: entry, _fallback: true });
                }
                else
                {
                    const { deployable } = (await resolveDeployable(entry, ownerActor)) ?? {};
                    resolved.push(deployable ?? { name: entry, _fallback: true });
                }
            }
            catch (err)
            {
                console.warn('lancer-automations | resolve extra deployable failed:', err);
                resolved.push({ name: entry, _fallback: true });
            }
        }
        if (resolved.length)
        {
            const real = [];
            const realMetas = [];
            let fallbackHtml = '';
            resolved.forEach((deployable, idx) =>
            {
                if (deployable._fallback === true || !deployable.system)
                {
                    fallbackHtml += `<div style="margin-top:4px;padding:5px 7px;background:rgba(74,16,112,0.1);border:1px solid rgba(74,16,112,0.35);border-radius:3px;"><div style="font-size:0.78em;font-weight:bold;color:#c084fc;">${deployable.name}</div></div>`;
                    return;
                }
                real.push(deployable);
                realMetas.push(resolveDeployRangeCount(item, combined[idx], ownerActor));
            });
            if (real.length)
                html += laRenderDeployables(real, { label: 'EXTRA DEPLOYABLE', metas: realMetas });
            if (fallbackHtml)
                html += `<div style="margin-bottom:4px;">${real.length ? '' : laPopupSectionLabel('EXTRA DEPLOYABLE', '#4a1070')}${fallbackHtml}</div>`;
        }
    }

    html += laRenderItemStatusTemplates(item);
    html += laRenderItemBonusTemplates(item);

    return html;
}

function _renderAttackLine(bonus, acc)
{
    if (!bonus && !acc)
        return '';
    let parts = [];
    if (bonus)
        parts.push(`+${bonus} <i class="cci cci-reticule" title="Flat Attack Bonus"></i>`);
    if (acc > 0)
        parts.push(`+${acc} <i class="cci cci-accuracy" title="Accuracy"></i>`);
    else if (acc < 0)
        parts.push(`${acc} <i class="cci cci-difficulty" title="Difficulty"></i>`);
    return `<div style="font-size:0.88em;color:#ccc;margin-bottom:4px;">${parts.join('&nbsp;&nbsp;')}</div>`;
}

export function laRenderWeaponProfile(profile, showName)
{
    const nameHdr = showName && profile.name
        ? `<div style="font-size:0.75em;font-weight:bold;color:#aaa;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;margin-top:2px;">${profile.name}</div>`
        : '';
    const wpnAttackHtml = _renderAttackLine(profile.attack_bonus ?? 0, profile.accuracy ?? 0);
    const damageHtml = (() =>
    {
        if (!profile.damage?.length)
            return '';
        const dmgStr = profile.damage.map(dmg => `${damageIcon(dmg.type)}<b>${dmg.val}</b> ${dmg.type}`).join(' + ');
        let baseStr = '';
        if (profile.base_damage?.length)
        {
            const changed = profile.damage.length !== profile.base_damage.length
                || profile.damage.some((d, i) =>
                {
                    const b = profile.base_damage[i];
                    return !b || String(b.val) !== String(d.val) || b.type !== d.type;
                });
            if (changed)
                baseStr = ` <span style="color:#777;font-size:0.85em;">(base: ${profile.base_damage.map(d => `${d.val} ${d.type}`).join(' + ')})</span>`;
        }
        return `<div>${laPopupSectionLabel('DAMAGE', '#b71c1c')}<div style="font-size:0.88em;color:#eee;margin-top:2px;">${dmgStr}${baseStr}</div></div>`;
    })();
    const rangeHtml = (() =>
    {
        if (!profile.range?.length)
            return '';
        const rangeStr = profile.range.map(rng => `${rangeIcon(rng.type)}<b>${rng.val}</b> ${rng.type}`).join(' · ');
        let baseStr = '';
        if (profile.base_range?.length)
        {
            const changed = profile.range.some(r =>
            {
                const base = profile.base_range.find(b => b.type === r.type);
                return !base || String(base.val) !== String(r.val);
            }) || profile.base_range.some(b => !profile.range.find(r => r.type === b.type));
            if (changed)
                baseStr = ` <span style="color:#777;font-size:0.85em;">(base: ${profile.base_range.map(r => `${r.val} ${r.type}`).join(' · ')})</span>`;
        }
        return `<div>${laPopupSectionLabel('RANGE', '#1565c0')}<div style="font-size:0.88em;color:#eee;margin-top:2px;">${rangeStr}${baseStr}</div></div>`;
    })();
    const tagsHtml = laRenderTags(profile.tags);
    const onHitHtml = profile.on_hit
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('ON HIT', '#6a1b9a')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(profile.on_hit)}</div></div>`
        : '';
    const effectHtml = profile.effect
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('EFFECT', '#e65100')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(profile.effect)}</div></div>`
        : '';
    const dmgRangeSep = (damageHtml && rangeHtml)
        ? '<div style="width:1px;background:rgba(255,255,255,0.15);"></div>'
        : '';
    const dmgRangeRow = (damageHtml || rangeHtml)
        ? `<div style="display:flex;gap:10px;align-items:stretch;margin-bottom:6px;">${damageHtml}${dmgRangeSep}${rangeHtml}</div>`
        : '';
    return `${nameHdr}${wpnAttackHtml}${dmgRangeRow}${tagsHtml}${onHitHtml}${effectHtml}`;
}

/**
 * Renders a weapon mod block.
 * @param {string} modName
 * @param {Object} modItem  The mod item (modItem.system has effect, tags, etc.)
 * @returns {string}
 */
export function laRenderWeaponMod(modName, modItem)
{
    const system = modItem?.system;
    const modEffect = laFormatDetailHtml(system?.effect || system?.description || '');
    const modActionsHtml = laRenderActions(system?.actions ?? []);
    const modTagsArr = system?.tags ?? [];
    const modTagsHtml = modTagsArr.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;">${modTagsArr.map(tag =>
        {
            const tagText = String(tag.name ?? tag.lid ?? tag.id ?? '').replaceAll('{VAL}', tag.val ?? '');
            return `<span style="background:rgba(255,255,255,0.08);border:1px solid #555;border-radius:3px;padding:0 5px;font-size:0.72em;color:#ccc;">${tagText}</span>`;
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
 * Renders a bonus array (LA bonus structs) as a compact list section.
 * @param {any[]} bonuses
 * @returns {string}
 */
function laRenderBonusList(bonuses)
{
    if (!bonuses?.length)
        return '';
    const activeKeys = (map) => Object.entries(map ?? {}).filter(([, isActive]) => isActive).map(([k]) => k);
    const lines = bonuses.map(bonus =>
    {
        // Lancer system bonuses use `lid`; LA custom bonuses use `type`
        const kind = bonus.lid ?? bonus.type ?? '';
        if (kind === 'accuracy')
            return `Accuracy +${bonus.val}`;
        if (kind === 'difficulty')
            return `Difficulty +${bonus.val}`;
        if (kind === 'stat')
        {
            const name = (bonus.stat ?? bonus.id ?? '').split('.').pop() || kind;
            if ((bonus.statMode || 'add') === 'replace')
                return `${name} = ${bonus.val}`;
            return `${name} ${Number.parseInt(bonus.val) >= 0 ? '+' : ''}${bonus.val}`;
        }
        if (kind === 'damage')
        {
            const mode = bonus.damageMode || 'add';
            const entries = bonus.damage || [];
            if (mode === 'change_type')
            {
                const parts = entries.map(dmg =>
                {
                    const from = (dmg.from && dmg.from !== 'all') ? dmg.from : 'All';
                    return `${from} → ${dmg.to}`;
                });
                return `Change Type: ${parts.join(', ')}`;
            }
            const body = entries.map(dmg => `${dmg.val} ${dmg.type}`).join(' + ');
            if (mode === 'replace')
                return `Replace: ${body}`;
            if (mode === 'add_base')
                return `Add: ${body}`;
            return body;
        }
        if (kind === 'tag')
            return bonus.removeTag ? `Remove Tag: ${bonus.tagName}` : `${bonus.tagMode === 'override' ? 'Set' : 'Add'} Tag: ${bonus.tagName}${bonus.val ? ` ${bonus.val}` : ''}`;
        if (kind === 'range')
        {
            // Lancer system format: range_types map + optional weapon_types/weapon_sizes filters
            const rangeTypes = activeKeys(bonus.range_types);
            const weaponTypes = activeKeys(bonus.weapon_types);
            const sign = Number.parseInt(bonus.val) >= 0 ? '+' : '';
            const rangeStr = rangeTypes.length ? rangeTypes.join('/') : (bonus.rangeType ?? 'Range');
            const filterStr = weaponTypes.length < 6 && weaponTypes.length > 0 ? ` (${weaponTypes.join('/')})` : '';
            return `${sign}${bonus.val} ${rangeStr}${filterStr}`;
        }
        if (kind === 'immunity')
        {
            if (bonus.subtype === 'effect' && bonus.effects)
                return `Immunity: ${bonus.effects.join(', ')}`;
            if (bonus.subtype === 'damage' || bonus.subtype === 'resistance')
                return `${bonus.subtype}: ${(bonus.damageTypes || []).join(', ')}`;
            return `Immunity: ${bonus.subtype}`;
        }
        if (kind === 'multi' && Array.isArray(bonus.bonuses))
            return bonus.bonuses.map(innerBonus => laRenderBonusList([innerBonus])).join('');
        return kind || '?';
    });
    return `<div style="margin-bottom:4px;">${laPopupSectionLabel('BONUSES', '#1565c0')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.6;">${lines.map(line => `<div>· ${line}</div>`).join('')}</div></div>`;
}

/**
 * Renders the full body HTML for a weapon mod detail popup.
 * Shows: actions, tags, added weapon bonuses (tags/damage/range), effect.
 * Does NOT show the flavor description.
 * @param {any} modItem  Foundry Item document (type weapon_mod)
 * @returns {string}
 */
export function laRenderModBody(modItem)
{
    const system = modItem?.system;
    const actionsHtml = laRenderActions(system?.actions ?? []);
    const tagsHtml    = laRenderTags(system?.tags ?? []);
    const bonusesHtml = laRenderBonusList(system?.bonuses ?? []);
    const addedParts  = [];
    if (system?.added_tags?.length)
        addedParts.push(`Tags: ${system.added_tags.map(tag => String(tag.name ?? tag.lid ?? '').replaceAll('{VAL}', tag.val ?? '')).join(', ')}`);
    if (system?.added_damage?.length)
        addedParts.push(`+Damage: ${system.added_damage.map(dmg => `${damageIcon(dmg.type)}${dmg.val} ${dmg.type}`).join(' + ')}`);
    if (system?.added_range?.length)
        addedParts.push(`+Range: ${system.added_range.map(rng => `${rangeIcon(rng.type)}${rng.val} ${rng.type}`).join(', ')}`);
    const addedHtml = addedParts.length
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('ADDS', '#ff8c00')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.6;">${addedParts.map(part => `<div>· ${part}</div>`).join('')}</div></div>`
        : '';
    const effectHtml = system?.effect
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('EFFECT', '#ff6400')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(system.effect)}</div></div>`
        : '';
    return actionsHtml + tagsHtml + addedHtml + bonusesHtml + effectHtml;
}

/**
 * Renders body HTML for a core system popup (passive section + counters/resources).
 * @param {any} cs  frame.system.core_system object
 * @returns {string}
 */
export function laRenderCoreSystemBody(cs)
{
    const activeName     = cs?.active_name ?? '';
    const activeEffect   = cs?.active_effect ?? '';
    const activeActions  = cs?.active_actions ?? [];
    const passiveName    = cs?.passive_name ?? '';
    const passiveEffect  = cs?.passive_effect ?? '';
    const passiveActions = cs?.passive_actions ?? [];
    const counters       = cs?.counters ?? [];

    const activeEffectHtml = activeEffect
        ? `<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${activeName ? `<b>${activeName}</b><br>` : ''}${laFormatDetailHtml(activeEffect)}</div>`
        : '';
    const activeActionsHtml = laRenderActions(activeActions);
    const activeHtml = (activeEffectHtml || activeActionsHtml)
        ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('ACTIVE', '#b45309')}${activeEffectHtml}${activeActionsHtml}</div>`
        : '';

    const passiveEffectHtml = passiveEffect
        ? `<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${passiveName ? `<b>${passiveName}</b><br>` : ''}${laFormatDetailHtml(passiveEffect)}</div>`
        : '';
    const passiveActionsHtml = laRenderActions(passiveActions);
    const passiveHtml = (passiveEffectHtml || passiveActionsHtml)
        ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('PASSIVE', '#1565c0')}${passiveEffectHtml}${passiveActionsHtml}</div>`
        : '';

    const countersHtml = counters.length
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('RESOURCES', '#1a3a5c')}${counters.map(counter =>
            `<div style="margin-top:4px;padding:4px 6px;background:rgba(255,255,255,0.04);border-radius:3px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:0.78em;font-weight:bold;color:#ccc;">${counter.name}</span>
                <span style="font-size:0.78em;color:#aaa;">${counter.value ?? counter.default_value ?? 0} / ${counter.max ?? 0}</span>
            </div>`).join('')}</div>`
        : '';

    return activeHtml + passiveHtml + countersHtml;
}

/**
 * Renders the full body HTML for a core bonus detail popup.
 * Shows: tags, bonuses, effect. Does NOT show the flavor description.
 * @param {any} cbItem  Foundry Item document (type core_bonus)
 * @returns {string}
 */
export function laRenderCoreBonusBody(cbItem)
{
    const system = cbItem?.system;
    const tagsHtml    = laRenderTags(system?.tags ?? []);
    const bonusesHtml = laRenderBonusList(system?.bonuses ?? []);
    const effectHtml  = system?.effect
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('EFFECT', '#c084fc')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(system.effect)}</div></div>`
        : '';
    return tagsHtml + bonusesHtml + effectHtml;
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
export function laRenderWeaponBody(profiles, opts = {})
{
    const { actions = [], modName = null, modItem = null, activeProfileIndex = 0, switchable = false } = opts;
    const actionsHtml = laRenderActions(actions);

    let profilesHtml = '';
    if (profiles.length <= 1)
        profilesHtml = profiles.map(profile => laRenderWeaponProfile(profile, false)).join('');
    else
    {
        const blocks = profiles.map((profile, idx) =>
        {
            const inner   = laRenderWeaponProfile(profile, false);
            const name    = (profile.name || 'Profile').toUpperCase();
            const isActive = idx === activeProfileIndex;
            const blockStyle = isActive
                ? 'margin-bottom:6px;padding:5px 7px;background:repeating-linear-gradient(45deg, #16283a 0 6px, #101f2e 6px 12px);border:1px solid rgba(160,160,160,0.35);border-left:3px solid #3a78b5;border-radius:3px;cursor:pointer;'
                : 'margin-bottom:6px;padding:5px 7px;background:rgba(20,20,20,0.95);border:1px solid rgba(160,160,160,0.35);border-radius:3px;cursor:pointer;';
            const nameStyle = isActive
                ? 'font-size:0.75em;font-weight:bold;color:#bbb;letter-spacing:0.4px;display:flex;justify-content:space-between;align-items:center;'
                : 'font-size:0.75em;font-weight:bold;color:#e06060;letter-spacing:0.4px;display:flex;justify-content:space-between;align-items:center;';
            const bodyDisplay = isActive ? 'block' : 'none';
            const toggleChar  = isActive ? '▼' : '▶';
            const setDot = switchable
                ? `<span class="la-profile-set" data-profile-idx="${idx}" title="${isActive ? 'Active profile' : 'Switch to this profile'}" style="cursor:${isActive ? 'default' : 'pointer'};color:${isActive ? '#5b9bd5' : '#777'};margin-right:5px;">${isActive ? '●' : '○'}</span>`
                : '';
            return `<div class="la-mod-block" style="${blockStyle}">
                <div style="${nameStyle}">
                    <span>${setDot}${name}</span>
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
export function laRenderActionDetail(action, opts = {})
{
    if (!action)
        return '';
    const { sourceName = null } = opts;
    const sourceHtml = sourceName
        ? `<div style="font-size:0.72em;color:#777;margin-bottom:6px;">From: ${sourceName}</div>`
        : '';
    // Attack roll info: just flat bonus and accuracy
    let attackHtml = '';
    if (action.attack_bonus)
    {
        const tier = (opts.tier ?? 1) - 1;
        const bonus = Array.isArray(action.attack_bonus) ? (action.attack_bonus[tier] ?? action.attack_bonus[0] ?? 0) : (action.attack_bonus || 0);
        const acc = Array.isArray(action.accuracy) ? (action.accuracy[tier] ?? 0) : (action.accuracy || 0);
        attackHtml = _renderAttackLine(bonus, acc);
    }
    const rangeHtml = action.range?.length
        ? `<div>${laPopupSectionLabel('RANGE', '#1565c0')}<div style="font-size:0.88em;color:#eee;margin-top:2px;">${action.range.map(rng => `${rangeIcon(rng.type)}<b>${rng.val}</b> ${rng.type}`).join(' · ')}</div></div>`
        : '';
    // Damage: handle both flat [{type,val}] and tiered [[{type,val}],[...],[...]]
    let damageHtml = '';
    if (action.damage?.length)
    {
        const tier = (opts.tier ?? 1) - 1;
        const dmgArr = Array.isArray(action.damage[0]) ? (action.damage[tier] ?? action.damage[0]) : action.damage;
        if (dmgArr?.length)
            damageHtml = `<div>${laPopupSectionLabel('DAMAGE', '#b71c1c')}<div style="font-size:0.88em;color:#eee;margin-top:2px;">${dmgArr.map(dmg => `${damageIcon(dmg.type)}<b>${dmg.val}</b> ${dmg.type}`).join(' + ')}</div></div>`;
    }
    const onHitHtml = action.on_hit
        ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('ON HIT', '#b71c1c')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(action.on_hit)}</div></div>`
        : '';
    const triggerHtml = action.trigger
        ? `<div style="margin-bottom:6px;">${laPopupSectionLabel('TRIGGER', '#1a5c3a')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${laFormatDetailHtml(action.trigger)}</div></div>`
        : '';
    const actionTags = [...(action.tags ?? [])];
    if (action.activation && !actionTags.some(tag => tag.lid?.includes('action') || tag.lid?.includes('protocol') || tag.lid?.includes('reaction') || tag.lid?.includes('tech')))
        actionTags.unshift({ name: activationChipContent(action) });
    if (action.recharge && !actionTags.some(tag => tag.lid === 'tg_recharge'))
        actionTags.push({ lid: 'tg_recharge', val: String(action.recharge), name: 'Recharge {VAL}+' });
    const tagsHtml = laRenderTags(actionTags);
    const detail = laFormatDetailHtml(action.detail || action.effect || '');
    const detailHtml = detail
        ? `<div style="margin-bottom:4px;">${laPopupSectionLabel('EFFECT', '#e65100')}<div style="font-size:0.82em;color:#bbb;margin-top:2px;line-height:1.4;">${detail}</div></div>`
        : '';
    const dmgRangeSep = (damageHtml && rangeHtml)
        ? '<div style="width:1px;background:rgba(255,255,255,0.15);"></div>'
        : '';
    const dmgRangeRow = (damageHtml || rangeHtml)
        ? `<div style="display:flex;gap:10px;align-items:stretch;margin-bottom:6px;">${damageHtml}${dmgRangeSep}${rangeHtml}</div>`
        : '';
    const body = sourceHtml + attackHtml + dmgRangeRow + onHitHtml + triggerHtml + tagsHtml + detailHtml;
    return body || '<div style="font-size:0.82em;color:#888;">No description.</div>';
}

// Popup container

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
    mod:         { border: '#5a3010', gradFrom: '#2d1808', gradTo: '#1a0e04', headerBorder: '#7a4015' },
    resource:    { border: '#6a6a10', gradFrom: '#363608', gradTo: '#1f1f04', headerBorder: '#8a8a18' },
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
export function laDetailPopup(cssClass, title, subtitle, bodyHtml, theme = 'weapon')
{
    const themeColors = THEMES[theme] ?? THEMES.default;
    const displayTitle = title.toLowerCase().replaceAll(/\b\w/g, letter => letter.toUpperCase())
        .replace(/^[ivxl]+(?=:)/i, numeral => numeral.toUpperCase());
    return $(`
        <div class="${cssClass}" style="position:fixed;z-index:10000;background:#181818;border:1px solid ${themeColors.border};border-radius:4px;min-width:260px;max-width:380px;box-shadow:0 4px 24px rgba(0,0,0,0.9);color:#ddd;font-family:inherit;">
            <div style="background:linear-gradient(90deg,${themeColors.gradFrom},${themeColors.gradTo});padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${themeColors.headerBorder};border-radius:4px 4px 0 0;">
                <div>
                    <div style="font-weight:bold;font-size:0.95em;color:#fff;">${displayTitle}</div>
                    <div class="la-detail-subtitle" style="font-size:0.72em;color:#aaa;">${subtitle}</div>
                </div>
                <span class="la-detail-close" style="cursor:pointer;color:#aaa;font-size:0.95em;padding:2px 6px;border-radius:3px;background:rgba(255,255,255,0.05);">✕</span>
            </div>
            <div style="padding:10px 12px;overflow-y:auto;max-height:400px;">${bodyHtml}</div>
        </div>`);
}
