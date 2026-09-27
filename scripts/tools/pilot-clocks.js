import { localize, localizeFormat, escapeHtml } from './string-utils.js';

const PATHS = { clocks: 'system.bond_state.clocks', burdens: 'system.bond_state.burdens' };
const DEFAULT_SEGMENTS = 6;
const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 12;

export function resolveClockPilot(tokenOrActor)
{
    const actor = tokenOrActor?.actor ?? tokenOrActor;
    if (!actor)
        return null;
    if (actor.type === 'pilot')
        return actor;
    if (actor.type === 'mech')
        return actor.system?.pilot?.value ?? null;
    return null;
}

export function pilotHasBond(pilot)
{
    if (!pilot)
        return false;
    if (pilot.system?.bond)
        return true;
    return !!pilot.items?.find((/** @type {any} */ owned) => owned.type === 'bond');
}

export function getCounters(pilot, kind)
{
    return pilot?.system?.bond_state?.[kind] ?? [];
}

function _plain(counter)
{
    return {
        lid: counter?.lid ?? '',
        name: counter?.name ?? '',
        min: counter?.min ?? 0,
        max: counter?.max ?? DEFAULT_SEGMENTS,
        default_value: counter?.default_value ?? 0,
        value: counter?.value ?? 0
    };
}

function _snapshot(pilot, kind)
{
    return getCounters(pilot, kind).map(_plain);
}

async function _write(pilot, kind, next)
{
    await pilot.update({ [PATHS[kind]]: next });
}

export async function addCounter(pilot, kind, name, segments = DEFAULT_SEGMENTS)
{
    const max = Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, Math.round(Number(segments) || DEFAULT_SEGMENTS)));
    const next = _snapshot(pilot, kind);
    next.push({
        lid: `la_${kind}_${foundry.utils.randomID(8)}`,
        name: String(name ?? '').trim(),
        min: 0,
        max,
        default_value: 0,
        value: 0
    });
    await _write(pilot, kind, next);
}

export async function setCounterValue(pilot, kind, index, value)
{
    const next = _snapshot(pilot, kind);
    const entry = next[index];
    if (!entry)
        return;
    const max = entry.max ?? DEFAULT_SEGMENTS;
    entry.value = Math.min(max, Math.max(entry.min ?? 0, Math.round(Number(value) || 0)));
    await _write(pilot, kind, next);
}

export async function renameCounter(pilot, kind, index, name)
{
    const next = _snapshot(pilot, kind);
    if (!next[index])
        return;
    next[index].name = String(name ?? '').trim();
    await _write(pilot, kind, next);
}

export async function deleteCounter(pilot, kind, index)
{
    const next = _snapshot(pilot, kind);
    if (!next[index])
        return;
    next.splice(index, 1);
    await _write(pilot, kind, next);
}

function _pipsHtml(counter, kind)
{
    const max = counter.max ?? DEFAULT_SEGMENTS;
    const value = counter.value ?? 0;
    const fill = kind === 'burdens' ? '#a52834' : '#3a9e6e';
    let out = '';
    for (let segment = 1; segment <= max; segment++)
    {
        const on = segment <= value;
        out += `<span class="la-clock-pip" data-segment="${segment}" style="width:11px;height:11px;border:1px solid ${on ? fill : 'var(--la-edge, #666)'};background:${on ? fill : 'transparent'};border-radius:1px;cursor:pointer;flex:0 0 auto;"></span>`;
    }
    return out;
}

function _listHtml(pilot, kind)
{
    const counters = getCounters(pilot, kind);
    if (!counters.length)
        return `<div style="padding:20px;text-align:center;color:var(--la-ink-dim);font-size:0.85em;">${localize('LA.clocks.none')}</div>`;
    return counters.map((counter, index) =>
    {
        const name = escapeHtml(counter.name || localize('LA.clocks.unnamed'));
        return `<div class="la-clock-row" data-index="${index}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid color-mix(in srgb, var(--la-ink), transparent 90%);">
            <span class="la-clock-name" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:bold;font-size:0.88em;cursor:text;">${name}</span>
            <span class="la-clock-pips" style="display:flex;gap:2px;flex:0 0 auto;">${_pipsHtml(counter, kind)}</span>
            <span data-count style="flex:0 0 auto;font-size:0.72em;opacity:0.7;font-variant-numeric:tabular-nums;">${counter.value ?? 0}/${counter.max ?? DEFAULT_SEGMENTS}</span>
            <a class="la-clock-del" style="flex:0 0 auto;padding:1px 6px;font-size:0.78em;cursor:pointer;opacity:0.6;"><i class="fas fa-times"></i></a>
        </div>`;
    }).join('');
}

/** @returns {Promise<void>} */
export async function openClocksDialog(tokenOrActor)
{
    const pilot = resolveClockPilot(tokenOrActor);
    if (!pilot)
    {
        ui.notifications.warn(localize('LA.notify.selectAPilotOrMechToken'));
        return;
    }
    const hasBond = pilotHasBond(pilot);

    const tabBtn = (kind, label, enabled) =>
        `<a class="la-ctab${kind === 'clocks' ? ' active' : ''}" data-kind="${kind}" style="padding:4px 12px;font-size:0.8em;cursor:${enabled ? 'pointer' : 'default'};text-align:center;border:1px solid var(--la-edge);border-radius:3px;background:${kind === 'clocks' ? 'var(--primary-color)' : 'color-mix(in srgb, var(--la-plate), var(--la-ink) 8%)'};color:${kind === 'clocks' ? '#fff' : 'var(--la-ink)'};user-select:none;opacity:${enabled ? 1 : 0.38};pointer-events:${enabled ? 'auto' : 'none'};">${label}</a>`;

    const BODY = `
        <div class="lancer-dialog-header" style="margin:-8px -8px 8px -8px;">
            <h1 class="lancer-dialog-title" style="font-size:1em;">${localize('LA.clocks.title')}</h1>
            <p class="lancer-dialog-subtitle" style="font-size:0.78em;">${escapeHtml(pilot.name)}</p>
        </div>
        <nav style="display:flex;gap:3px;margin-bottom:6px;">
            ${tabBtn('clocks', localize('LA.clocks.tab.clocks'), true)}
            ${tabBtn('burdens', localize('LA.clocks.tab.burdens'), hasBond)}
        </nav>
        <div id="la-clock-list" style="max-height:280px;min-height:64px;overflow-y:auto;border:1px solid var(--la-edge);border-radius:3px;">${_listHtml(pilot, 'clocks')}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
            <input type="text" id="la-clock-new" placeholder="${localize('LA.common.name')}" style="flex:1 1 auto;min-width:0;">
            <input type="number" id="la-clock-seg" value="${DEFAULT_SEGMENTS}" min="${MIN_SEGMENTS}" max="${MAX_SEGMENTS}" style="flex:0 0 56px;width:56px;text-align:center;">
            <button type="button" id="la-clock-add" style="flex:0 0 auto;width:auto;margin:0;white-space:nowrap;"><i class="fas fa-plus"></i> ${localize('LA.common.add')}</button>
        </div>
        ${hasBond ? '' : `<p style="margin:6px 0 0;font-size:0.74em;opacity:0.7;font-style:italic;">${localize('LA.clocks.noBond')}</p>`}`;

    new Dialog({
        title: localizeFormat('LA.dialogTitle.clocksFor', { name: pilot.name }),
        content: BODY,
        buttons: { close: { label: localize('LA.common.close') } },
        render: (html) =>
        {
            let kind = 'clocks';
            const dialogApp = html.closest('.app').length ? ui.windows[Number(html.closest('.app').data('appid'))] : null;
            const resize = () => dialogApp?.setPosition?.({ height: 'auto' });
            const repaint = () =>
            {
                html.find('#la-clock-list').html(_listHtml(pilot, kind));
                resize();
            };

            html.find('.la-ctab').on('click', function ()
            {
                kind = String($(this).data('kind'));
                html.find('.la-ctab').removeClass('active').css({ background: 'color-mix(in srgb, var(--la-plate), var(--la-ink) 8%)', color: 'var(--la-ink)' });
                $(this).addClass('active').css({ background: 'var(--primary-color)', color: '#fff' });
                repaint();
            });

            html.on('click', '.la-clock-pip', async (ev) =>
            {
                ev.preventDefault();
                ev.stopPropagation();
                const pip = $(ev.currentTarget);
                const index = Number(pip.closest('.la-clock-row').data('index'));
                const segment = Number(pip.data('segment'));
                const current = getCounters(pilot, kind)[index]?.value ?? 0;
                const next = current === segment ? segment - 1 : segment;
                await setCounterValue(pilot, kind, index, next);
                const fill = kind === 'burdens' ? '#a52834' : '#3a9e6e';
                pip.closest('.la-clock-row').find('.la-clock-pip').each((idx, node) =>
                {
                    const on = (idx + 1) <= next;
                    node.style.borderColor = on ? fill : 'var(--la-edge, #666)';
                    node.style.background = on ? fill : 'transparent';
                });
                pip.closest('.la-clock-row').find('[data-count]').text(`${next}/${getCounters(pilot, kind)[index]?.max ?? DEFAULT_SEGMENTS}`);
            });

            html.on('click', '.la-clock-del', async (ev) =>
            {
                ev.preventDefault();
                ev.stopPropagation();
                const index = Number($(ev.currentTarget).closest('.la-clock-row').data('index'));
                await deleteCounter(pilot, kind, index);
                repaint();
            });

            html.on('click', '.la-clock-name', (ev) =>
            {
                const span = $(ev.currentTarget);
                const index = Number(span.closest('.la-clock-row').data('index'));
                const currentName = getCounters(pilot, kind)[index]?.name ?? '';
                const input = $(`<input type="text" style="flex:1;min-width:0;font-size:0.88em;">`).val(currentName);
                span.replaceWith(input);
                input.trigger('focus').trigger('select');
                const commit = async () =>
                {
                    await renameCounter(pilot, kind, index, String(input.val()));
                    repaint();
                };
                input.on('blur', commit);
                input.on('keydown', (keyEv) =>
                {
                    if (keyEv.key === 'Enter')
                        input.trigger('blur');
                });
            });

            html.find('#la-clock-add').on('click', async () =>
            {
                const name = String(html.find('#la-clock-new').val()).trim();
                if (!name)
                {
                    ui.notifications.warn(localize('LA.notify.enterAName'));
                    return;
                }
                await addCounter(pilot, kind, name, Number(html.find('#la-clock-seg').val()));
                html.find('#la-clock-new').val('');
                repaint();
            });
        }
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 420, height: 'auto', resizable: false }).render(true);
}
