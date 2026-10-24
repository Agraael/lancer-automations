import { escapeHtml } from '../tools/string-utils.js';
import { weaponTypeIcon } from '../tah/item-helpers.js';
import { getMaxItemRanges_WithBonus } from '../tools/weapon-bonus-utils.js';

const RANGE_ORDER = ['Range', 'Threat', 'Thrown', 'Line', 'Cone', 'Blast', 'Burst'];
const installedForms = new WeakSet();

function sumByType(list)
{
    const byType = new Map();
    for (const entry of list)
    {
        const type = String(entry?.type ?? '');
        const val = String(entry?.val ?? '').trim();
        if (!type || !val)
            continue;
        const key = type.toLowerCase();
        if (!byType.has(key))
            byType.set(key, { type, vals: [] });
        byType.get(key).vals.push(val);
    }
    return [...byType.values()].map(group => ({ type: group.type, val: group.vals.join(' + ') }));
}

function shapeIsCustom(state)
{
    const shape = state.__laAttackShape;
    const defaults = state.__laAttackShapeDefaults;
    if (!shape || !defaults)
        return false;
    return shape.pattern !== defaults.pattern || Number(shape.size) !== Number(defaults.size) || Number(shape.range) !== Number(defaults.range);
}

function rangeEntries(state, nativeRanges)
{
    if (shapeIsCustom(state))
    {
        const shape = state.__laAttackShape;
        const entries = [];
        if (Number(shape.range) > 0)
            entries.push({ type: 'Range', val: Number(shape.range) });
        if (shape.pattern && shape.pattern !== 'target')
            entries.push({ type: shape.pattern[0].toUpperCase() + shape.pattern.slice(1), val: Math.max(1, Number(shape.size) || 1) });
        return entries;
    }
    return RANGE_ORDER.filter(type => Number(nativeRanges?.[type]) > 0).map(type => ({ type, val: Number(nativeRanges[type]) }));
}

function damageEntries(state, kind, item)
{
    if (kind === 'damage')
    {
        const total = state.data?.damage_hud_data?.base?.total;
        return sumByType([...(total?.damage ?? []), ...(total?.bonusDamage ?? [])]);
    }
    return sumByType(item?.currentProfile?.()?.damage ?? []);
}

export function laLiveLine(state, kind, nativeRanges)
{
    const item = state.data?.lancerItem ?? state.item ?? null;
    const profiled = item && typeof item.currentProfile === 'function' ? item : null;
    if (!profiled && kind !== 'damage')
        return null;
    const ranges = rangeEntries(state, nativeRanges);
    const damage = damageEntries(state, kind, profiled);
    return ranges.length || damage.length ? { ranges, damage } : null;
}

function liveLineHtml(ranges, damage)
{
    const rangeHtml = ranges.map(entry => `<span><i class="cci cci-${escapeHtml(entry.type.toLowerCase())}"></i>${escapeHtml(entry.val)}</span>`).join('');
    const damageHtml = damage.map(entry =>
    {
        const type = escapeHtml(String(entry.type).toLowerCase());
        return `<span><i class="cci cci-${type} damage--${type}"></i>${escapeHtml(entry.val)}</span>`;
    }).join('');
    if (!rangeHtml && !damageHtml)
        return '';
    return `${rangeHtml}${rangeHtml && damageHtml ? '<span class="b3-sep">//</span>' : ''}${damageHtml}`;
}

function maskIcon($icon, iconPath)
{
    if (!$icon.length || !iconPath || $icon.data('laMasked'))
        return;
    const url = foundry.utils.getRoute(iconPath);
    $icon.data('laMasked', true).css({
        fontSize: 0,
        display: 'inline-block',
        width: '26px',
        height: '26px',
        verticalAlign: 'middle',
        backgroundColor: 'currentColor',
        webkitMask: `url("${url}") center / contain no-repeat`,
        mask: `url("${url}") center / contain no-repeat`,
    });
}

function syncHeader(state, $form, kind, item)
{
    const $head = $form.children('.lancer-header').first();
    if (!$head.length)
        return;
    $head.addClass('b3-head');
    if (kind === 'damage' && item)
        maskIcon($head.children('i.cci-large-beam').first(), weaponTypeIcon(item));
    const data = kind === 'damage' ? state.data?.damage_hud_data : state.data?.acc_diff;
    const actor = state.actor;
    const tokenDoc = actor?.token ?? actor?.getActiveTokens?.()?.[0]?.document ?? null;
    const name = tokenDoc?.name || actor?.name || '';
    const img = tokenDoc?.texture?.src || actor?.img || '';
    const html = `<span class="b3-title">${escapeHtml(data?.title ?? state.data?.title ?? '')}</span><span class="b3-who">${img ? `<img src="${escapeHtml(img)}" alt="">` : ''}${escapeHtml(name)}</span>`;
    if ($head.data('laSig') === html)
        return;
    $head.children('.b3-title, .b3-who').remove();
    $head.append(html).data('laSig', html);
}

function syncLiveLine(state, $form, kind, nativeRanges)
{
    const line = laLiveLine(state, kind, nativeRanges);
    const html = line ? liveLineHtml(line.ranges, line.damage) : '';
    let $line = $form.children('.b3-profile');
    if (!html)
    {
        $line.remove();
        return;
    }
    if (!$line.length)
    {
        $line = $('<div class="b3-profile"></div>');
        const $body = $form.children('.lancer-hud-body').first();
        if ($body.length)
            $body.before($line);
        else
            $form.prepend($line);
    }
    if ($line.data('laSig') !== html)
        $line.html(html).data('laSig', html);
}

export async function laInstallRollCardHeader(state, $form)
{
    const form = $form?.[0];
    if (!form || installedForms.has(form))
        return;
    installedForms.add(form);
    const kind = form.id === 'damage-hud' ? 'damage' : 'accdiff';
    const item = state.data?.lancerItem ?? state.item ?? null;
    const hasProfile = !!item && typeof item.currentProfile === 'function';
    const nativeRanges = hasProfile ? await getMaxItemRanges_WithBonus(item, state.actor) : {};
    let queued = false;
    let observer = null;
    let hookId = null;
    const run = () =>
    {
        queued = false;
        if (!form.isConnected)
        {
            observer?.disconnect();
            if (hookId !== null)
                Hooks.off('lancer-automations.attackRangeMode', hookId);
            return;
        }
        const $live = $(form);
        syncHeader(state, $live, kind, item);
        syncLiveLine(state, $live, kind, nativeRanges);
    };
    const schedule = () =>
    {
        if (queued)
            return;
        queued = true;
        requestAnimationFrame(run);
    };
    observer = new MutationObserver(schedule);
    observer.observe(form, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    $(form).on('change.laB3Head input.laB3Head', schedule);
    hookId = Hooks.on('lancer-automations.attackRangeMode', schedule);
    run();
}
