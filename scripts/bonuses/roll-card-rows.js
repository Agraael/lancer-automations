import { escapeHtml } from "../tools/string-utils.js";

export function laSigned(value)
{
    return value > 0 ? `+${value}` : `${value}`;
}

export function laValueTag(text, tone)
{
    return `<span class="la2-val la2-tone-${tone}">${escapeHtml(text)}</span>`;
}

export function laPills(parts = [], note = null)
{
    if (!parts.length && !note)
        return '';
    const html = parts.map(part => `<span class="la2-pill${part.limit ? ' la2-pill-limit' : ''}">${part.limit ? '<i class="mdi mdi-timer-sand"></i>' : ''}${escapeHtml(part.text)}</span>`).join('');
    const noteHtml = note ? `<span class="la2-pill la2-pill-note">${escapeHtml(note)}</span>` : '';
    return `<span class="la2-pills">${html}${noteHtml}</span>`;
}

function attrsHtml(attrs)
{
    return Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('');
}

export function laRowHtml({ name, tag = '', parts = [], note = null, limit = false, on = true, disabled = false, scope = '', cls = '', inputCls = '', attrs = {} })
{
    const labelCls = ['container', scope, 'la2-row', limit ? 'la2-limit' : '', cls].filter(Boolean).join(' ');
    const boxCls = [inputCls, scope].filter(Boolean).join(' ');
    return `<label class="${labelCls}"${attrsHtml(attrs)}><input type="checkbox" class="${boxCls}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}>${nameHtml(name)}${tag}${laPills(parts, note)}</label>`;
}

function nameHtml(name)
{
    return `<span class="la2-name"><span class="la2-name-text">${escapeHtml(name)}</span></span>`;
}

const pannedRows = new WeakSet();

document.addEventListener('mouseenter', (event) =>
{
    const row = event.target instanceof Element ? event.target.closest('.la2-cardrows .la2-row') : null;
    const name = row?.querySelector(':scope > .la2-name');
    const text = name?.firstElementChild;
    if (!row || pannedRows.has(row) || !(name instanceof HTMLElement) || !(text instanceof HTMLElement))
        return;
    const overflow = text.scrollWidth - name.clientWidth;
    if (overflow <= 1)
        return;
    pannedRows.add(row);
    const startHold = 300;
    const pan = Math.min(2000, Math.max(500, overflow * 20));
    const endHold = 1200;
    const total = startHold + pan + endHold;
    const end = `translateX(${-overflow}px)`;
    const animation = text.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: startHold / total, easing: 'ease-in-out' },
        { transform: end, offset: (startHold + pan) / total },
        { transform: end, offset: 1 }
    ], { duration: total });
    row.addEventListener('mouseleave', () =>
    {
        animation.cancel();
        pannedRows.delete(row);
    }, { once: true });
}, true);

export function laGroupHtml(rowsHtml, cls = '')
{
    return rowsHtml ? `<div class="la2-group${cls ? ` ${cls}` : ''}"><span class="la2-eyebrow">LA</span>${rowsHtml}</div>` : '';
}

export function laDamageChips(entries = [])
{
    const chips = entries.map(entry =>
    {
        const type = escapeHtml(String(entry?.type ?? '').toLowerCase());
        return `<span class="la2-dmg" data-dmg-type="${escapeHtml(entry?.type ?? '')}" data-dmg-val="${escapeHtml(entry?.val ?? '')}"><i class="cci cci-${type} damage--${type}"></i>${escapeHtml(entry?.val ?? '')}</span>`;
    }).join('');
    return `<span class="la2-dmgtags">${chips}</span>`;
}

export function laInfoRowHtml({ name, tag = '', note = null, cls = '', attrs = {} })
{
    return `<div class="${['container', 'la2-row', 'la2-info', cls].filter(Boolean).join(' ')}"${attrsHtml(attrs)}><i class="mdi mdi-link-variant la2-linked"></i>${nameHtml(name)}${tag}${laPills([], note)}</div>`;
}

export function laSplitGroupHtml(rows)
{
    if (!rows.length)
        return '';
    const half = Math.ceil(rows.length / 2);
    const cols = [rows.slice(0, half), rows.slice(half)].map(list => `<div class="la2-col">${list.join('')}</div>`).join('');
    return `<div class="la2-group la2-split"><span class="la2-eyebrow">LA</span>${cols}</div>`;
}

export function laCardSlot($body, slot)
{
    let $rows = $body.children('.la2-cardrows');
    if (!$rows.length)
    {
        $rows = $('<div class="la2-cardrows"><div class="la2-slot" data-slot="state"></div><div class="la2-slot" data-slot="vis"></div><div class="la2-slot" data-slot="bonus"></div><div class="la2-slot" data-slot="mod"></div></div>');
        $body.append($rows);
    }
    return $rows.children(`[data-slot="${slot}"]`);
}

export const LANCER_ROW_TAGS = {
    'Accurate (+1)': ['Accurate', '+1', 'acc'],
    'Smart (*)': ['Smart', 'E-Def', 'mod'],
    'Seeking (*)': ['Seeking', 'No cover', 'mod'],
    'Inaccurate (-1)': ['Inaccurate', '-1', 'diff'],
    'Impaired (-1)': ['Impaired', '-1', 'diff'],
    'Engaged (-1)': ['Engaged', '-1', 'diff'],
    'Thrown (*)': ['Thrown', 'Ranged', 'mod'],
    'Prone (+1)': ['Prone', '+1', 'acc'],
    'Stunned (EVA=5)': ['Stunned', 'Eva 5', 'mod'],
    'Lock On (+1)': ['Lock On', '+1', 'acc'],
    'Spotter (*)': ['Spotter', 'Best of 2', 'mod'],
    'Invisible (*)': ['Invisible', '50% miss', 'mod']
};

function lancerLabelText(label)
{
    const span = label.querySelector(':scope > span:not(.la2-name):not(.la2-val):not(.la2-pills)');
    return span ? span.textContent.replace(/\s+/g, ' ').trim() : '';
}

function isLancerLabel(label)
{
    return !label.classList.contains('la2-row') || label.classList.contains('b2t-row');
}

function svelteScope($form, selector)
{
    for (const element of $form.find(selector).toArray())
    {
        const found = Array.from(element.classList).find(cls => cls.startsWith('svelte-'));
        if (found)
            return found;
    }
    return '';
}

function cardEntry($card, targets)
{
    const forAttr = $card.find('label.target-name').attr('for') || '';
    const tail = forAttr.split('.').pop();
    return targets.find(entry => entry.targetUuid === forAttr || String(entry.targetUuid ?? '').split('.').pop() === tail) ?? null;
}

export function laTagLancerRows($form)
{
    for (const label of $form.find('label.container').toArray())
    {
        if (!isLancerLabel(label))
            continue;
        const text = lancerLabelText(label);
        const entry = LANCER_ROW_TAGS[text];
        if (!entry || label.dataset.laTag === text)
            continue;
        label.querySelectorAll(':scope > .la2-name, :scope > .la2-val').forEach(element => element.remove());
        label.classList.add('la2-row', 'b2t-row');
        label.dataset.laTag = text;
        label.insertAdjacentHTML('beforeend', `${nameHtml(entry[0])}${laValueTag(entry[1], entry[2])}`);
    }
}

export function laSyncInvisibility(state)
{
    const $form = $('form[id^="accdiff"]');
    const targets = state?.data?.acc_diff?.targets ?? [];
    if ($form.length === 0 || targets.length === 0)
        return;
    const setBlur = ($scope, on) => $scope.find('.lancer-hit-thumb, .total-container').toggleClass('accdiff-total-invisibility', on);
    if (targets.length === 1)
    {
        const on = !!targets[0].plugins?.invisibility?.uiState;
        $form.find('.accdiff-grid__section label.container').filter(function ()
        {
            return isLancerLabel(this) && lancerLabelText(this) === 'Invisible (*)';
        }).children('input[type="checkbox"]').prop('checked', on);
        setBlur($form.find('.accdiff-footer'), on);
        return;
    }
    $form.find('.accdiff-target').each(function ()
    {
        const entry = cardEntry($(this), targets);
        if (!entry)
            return;
        const on = !!entry.plugins?.invisibility?.uiState;
        setBlur($(this), on);
        $(this).find('.la2-vis-invis > input').prop('checked', on);
    });
}

export function laStatesHtml({ lockOn, prone, stunned })
{
    const states = [];
    if (lockOn)
        states.push(['Lock On', '+1', 'acc']);
    if (prone)
        states.push(['Prone', '+1', 'acc']);
    if (stunned)
        states.push(['Stunned', 'Eva 5', 'mod']);
    return states.length ? `<div class="b2t-states">${states.map(([name, tag, tone]) => `<span class="b2t-st">${escapeHtml(name)}${laValueTag(tag, tone)}</span>`).join('')}</div>` : '';
}

export function laSyncTargetCards(state, $form)
{
    const targets = state?.data?.acc_diff?.targets ?? [];
    if (targets.length < 2)
        return;
    const scope = svelteScope($form, 'label.container');
    $form.find('.accdiff-target').each(function ()
    {
        const $card = $(this);
        const entry = cardEntry($card, targets);
        const $body = $card.find('.accdiff-target-body').first();
        if (!entry || $body.length === 0)
            return;

        const stateHtml = laStatesHtml({ lockOn: entry.usingLockOn, prone: entry.prone, stunned: entry.stunned });
        const $stateSlot = laCardSlot($body, 'state');
        if ($stateSlot.data('laSig') !== stateHtml)
            $stateSlot.data('laSig', stateHtml).html(stateHtml);

        const $visSlot = laCardSlot($body, 'vis');
        if (entry.plugins?.invisibility && !$visSlot.children('.la2-vis-invis').length)
        {
            const $row = $(laRowHtml({ name: 'Invisible', tag: laValueTag('50% miss', 'mod'), on: !!entry.plugins.invisibility.uiState, scope, cls: 'la2-card la2-vis la2-vis-invis' }));
            $visSlot.prepend($row);
            $row.children('input').on('change', function ()
            {
                const plugin = cardEntry($card, state.data?.acc_diff?.targets ?? [])?.plugins?.invisibility;
                if (plugin)
                    plugin.uiState = $(this).is(':checked');
                laSyncInvisibility(state);
            });
        }
        const $spotter = $visSlot.children('.la2-vis-spot');
        if (entry.plugins?.spotter && entry.usingLockOn)
        {
            if (!$spotter.length)
                $visSlot.append(laRowHtml({ name: 'Spotter', tag: laValueTag('Best of 2', 'mod'), on: !!entry.plugins.spotter.uiState, disabled: true, scope, cls: 'la2-card la2-vis la2-vis-spot' }));
        }
        else
            $spotter.remove();
    });
}

const taggedForms = new WeakSet();

export function laInstallRollCardTags(state, $form)
{
    const form = $form?.[0];
    if (!form || taggedForms.has(form))
        return;
    taggedForms.add(form);
    let queued = false;
    let observer = null;
    const run = () =>
    {
        queued = false;
        if (!form.isConnected)
        {
            observer?.disconnect();
            return;
        }
        const $live = $(form);
        laTagLancerRows($live);
        laSyncTargetCards(state, $live);
        laSyncInvisibility(state);
    };
    const schedule = () =>
    {
        if (queued)
            return;
        queued = true;
        requestAnimationFrame(run);
    };
    observer = new MutationObserver(schedule);
    observer.observe(form, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    $(form).on('change.laRollTags', schedule);
    run();
}
