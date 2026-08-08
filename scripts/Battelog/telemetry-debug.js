import { getTelemetry, BUCKETS } from './telemetry-store.js';
import { EVENT_TYPES } from './combat-telemetry.js';

const _escape = str => String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const BUCKET_COLOR = {
    players: '#7bd3ff',
    hostiles: '#c8353d',
    friendlies: '#3aa955',
    neutrals: '#d09024',
    secrets: '#6b45a8',
};

let _dialog = null;
let _combatId = null;
const _hiddenTypes = new Set();

function _telemetryCombats()
{
    return [...(game.combats ?? [])].filter(combat => combat.getFlag?.('lancer-automations', 'telemetry'));
}

function _pickCombat()
{
    const combats = _telemetryCombats();
    const chosen = combats.find(combat => combat.id === _combatId)
        ?? combats.find(combat => combat.active)
        ?? combats[0]
        ?? null;
    _combatId = chosen?.id ?? null;
    return chosen;
}

function _flatEntries(telemetry)
{
    const out = [];
    for (const bucket of BUCKETS)
    {
        for (const entry of telemetry[bucket] ?? [])
            out.push({ entry, bucket });
    }
    return out;
}

function _payloadHtml(event)
{
    const rest = { ...event };
    delete rest.type;
    delete rest.round;
    delete rest.seq;
    return `<span class="battelog-debug-payload" title="${_escape(JSON.stringify(event, null, 2))}">${_escape(JSON.stringify(rest))}</span>`;
}

function _contentHtml()
{
    const combats = _telemetryCombats();
    const combat = _pickCombat();
    const telemetry = combat ? getTelemetry(combat) : null;
    if (!combat || !telemetry)
        return '<p class="battelog-debug-empty">No telemetry-flagged combat. Enable the Battle Log and start a combat.</p>';

    const picker = combats.length > 1
        ? `<select class="battelog-debug-combat">${combats.map(entry =>
            `<option value="${entry.id}" ${entry.id === combat.id ? 'selected' : ''}>${_escape(entry.scene?.name ?? entry.id)}${entry.active ? ' (active)' : ''}</option>`).join('')}</select>`
        : '';

    const flat = _flatEntries(telemetry);
    const nameOf = new Map(flat.map(({ entry }) => [entry.tokenId, entry.name ?? entry.tokenId]));
    const colorOf = new Map(flat.map(({ entry, bucket }) => [entry.tokenId, BUCKET_COLOR[bucket] ?? '#888']));

    const rows = flat.map(({ entry, bucket }) =>
    {
        const destroyed = entry.events.some(ev => ev.type === 'destroyed');
        return `
            <tr>
                <td style="color:${BUCKET_COLOR[bucket] ?? '#888'};">${_escape(bucket)}</td>
                <td>${_escape(entry.name ?? '-')}${destroyed ? ' <i class="fas fa-skull" title="destroyed"></i>' : ''}</td>
                <td class="battelog-debug-id" title="actorId: ${_escape(entry.actorId)}">${_escape(entry.tokenId)}</td>
                <td style="text-align:right;">${entry.events.length}</td>
            </tr>`;
    }).join('');

    const events = flat
        .flatMap(({ entry }) => entry.events.map(event => ({ entry, event })))
        .sort((lhs, rhs) => (lhs.event.seq ?? 0) - (rhs.event.seq ?? 0) || (lhs.event.round ?? 0) - (rhs.event.round ?? 0));

    const countByType = new Map();
    for (const { event } of events)
        countByType.set(event.type, (countByType.get(event.type) ?? 0) + 1);
    const chips = EVENT_TYPES.map(type =>
        `<span class="battelog-debug-chip ${_hiddenTypes.has(type) ? 'off' : ''}" data-type="${type}">${type} <b>${countByType.get(type) ?? 0}</b></span>`).join('');

    const feed = events
        .filter(({ event }) => !_hiddenTypes.has(event.type))
        .map(({ entry, event }) => `
            <div class="battelog-debug-line">
                <span class="battelog-debug-round">R${event.round ?? '?'}</span>
                <span class="battelog-debug-seq">#${event.seq ?? '-'}</span>
                <span class="battelog-debug-type">${_escape(event.type)}</span>
                <span class="battelog-debug-owner" style="color:${colorOf.get(entry.tokenId) ?? '#888'};">${_escape(nameOf.get(entry.tokenId) ?? entry.tokenId)}</span>
                ${_payloadHtml(event)}
            </div>`).join('');

    return `
        <div class="battelog-debug-head">
            ${picker}
            <span>ROUND ${combat.round ?? 0} · SEQ ${telemetry.seq ?? 0} · ${events.length} EVENTS</span>
            <span class="battelog-debug-tools">
                <a class="battelog-debug-copy" title="Copy raw telemetry JSON"><i class="fas fa-copy"></i></a>
                <a class="battelog-debug-refresh" title="Refresh"><i class="fas fa-rotate"></i></a>
            </span>
        </div>
        <table class="battelog-debug-table">
            <thead><tr><th>bucket</th><th>name</th><th>tokenId</th><th style="text-align:right;">events</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="battelog-debug-chips">${chips}</div>
        <div class="battelog-debug-feed">${feed || '<div class="battelog-debug-empty">No events yet.</div>'}</div>
    `;
}

function _rerender()
{
    const body = _dialog?.element?.[0]?.querySelector?.('.battelog-debug-body');
    if (!body)
        return;
    const feed = body.querySelector('.battelog-debug-feed');
    const atBottom = !feed || (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40);
    body.innerHTML = _contentHtml();
    const nextFeed = body.querySelector('.battelog-debug-feed');
    if (nextFeed && atBottom)
        nextFeed.scrollTop = nextFeed.scrollHeight;
}

function _onCombatChange(combat, changed)
{
    if (!_dialog)
        return;
    if (changed?.flags?.['lancer-automations']?.telemetry === undefined && changed?.round === undefined)
        return;
    _rerender();
}

export function openTelemetryDebugWindow()
{
    if (_dialog)
    {
        _dialog.bringToTop?.();
        _rerender();
        return _dialog;
    }
    const hookId = Hooks.on('updateCombat', _onCombatChange);
    const deleteHookId = Hooks.on('deleteCombat', () => _rerender());
    const dlg = new Dialog({
        title: 'Battle Log · Telemetry Debug',
        content: `<div class="battelog-debug-body">${_contentHtml()}</div>`,
        buttons: {
            _hidden: { label: '',
                callback: () =>
                {} },
        },
        default: '_hidden',
        render: (html) =>
        {
            const $root = html instanceof $ ? html : $(html);
            $root.on('change', '.battelog-debug-combat', function ()
            {
                _combatId = String($(this).val());
                _rerender();
            });
            $root.on('click', '.battelog-debug-chip', function ()
            {
                const type = String($(this).data('type'));
                if (_hiddenTypes.has(type))
                    _hiddenTypes.delete(type);
                else
                    _hiddenTypes.add(type);
                _rerender();
            });
            $root.on('click', '.battelog-debug-refresh', () => _rerender());
            $root.on('click', '.battelog-debug-copy', () =>
            {
                const combat = _pickCombat();
                const telemetry = combat ? getTelemetry(combat) : null;
                if (!telemetry)
                    return;
                const json = JSON.stringify(telemetry, null, 2);
                if (game.clipboard?.copyPlainText)
                    game.clipboard.copyPlainText(json);
                else
                    navigator.clipboard?.writeText(json);
                ui.notifications?.info('Telemetry JSON copied.');
            });
            const feed = $root[0]?.querySelector?.('.battelog-debug-feed');
            if (feed)
                feed.scrollTop = feed.scrollHeight;
        },
        close: () =>
        {
            Hooks.off('updateCombat', hookId);
            Hooks.off('deleteCombat', deleteHookId);
            _dialog = null;
        },
    }, {
        classes: ['lancer-dialog-base', 'lancer-no-title', 'battelog-dialog', 'battelog-debug-dialog'],
        width: 680,
        resizable: true,
    });
    _dialog = dlg;
    dlg.render(true);
    return dlg;
}
