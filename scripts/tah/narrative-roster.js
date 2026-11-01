import { getModuleSetting } from '../tools/settings-utils.js';
import { MODULE_ID } from '../tools/constants.js';
import { openCursorMenu } from './cursor-menu.js';
import { localize, escapeHtml } from '../tools/string-utils.js';
import { cancelButton } from '../tools/dialog-utils.js';
import { BG_DEFAULT, BG_HOVER, BG_ACTIVE, TEXT_DEFAULT, TEXT_ACTIVE } from './hud-palette.js';

const NARRATIVE_TYPES = ['pilot', 'npc'];

export function getNarrativeLinkedActor()
{
    const uuid = getModuleSetting('tah.narrativeLinkedActorUuid');
    if (!uuid)
        return null;
    const actor = /** @type {any} */ (fromUuidSync(uuid));
    if (!actor || !NARRATIVE_TYPES.includes(actor.type))
        return null;
    return actor;
}

export function getNarrativeRoster()
{
    const stored = getModuleSetting('tah.narrativeRosterUuids');
    const uuids = Array.isArray(stored) && stored.length
        ? stored
        : [getModuleSetting('tah.narrativeLinkedActorUuid')].filter(Boolean);
    const seen = new Set();
    const pilots = [];
    for (const uuid of uuids)
    {
        if (!uuid || seen.has(uuid))
            continue;
        seen.add(uuid);
        const actor = /** @type {any} */ (fromUuidSync(uuid));
        if (actor?.isOwner && NARRATIVE_TYPES.includes(actor.type))
            pilots.push(actor);
    }
    return pilots;
}

export async function openNarrativePilotMenu({ setActor, onEnter, onLeave })
{
    const roster = getNarrativeRoster();
    if (!roster.length)
        return openNarrativeLinkDialog(setActor);

    const activeUuid = getModuleSetting('tah.narrativeLinkedActorUuid');
    const rows = roster.map(pilot => ({
        value: pilot.uuid,
        label: escapeHtml(pilot.name),
        glyph: pilot.uuid === activeUuid ? '●' : '○',
        cls: pilot.uuid === activeUuid ? 'la-menu-popup-active' : '',
    }));
    if (activeUuid)
        rows.push({ value: '', label: localize('LA.tokenHud.label.unlink'), glyph: '✕', cls: 'la-menu-popup-danger' });
    rows.push({ value: '__manage', label: localize('LA.tokenHud.label.manageRoster'), glyph: '⚙' });

    const picked = await openCursorMenu({
        head: localize('LA.tokenHud.label.linkedActor'),
        rows,
        onEnter,
        onLeave,
    });
    if (picked === null)
        return;
    if (picked === '__manage')
        return openNarrativeLinkDialog(setActor);
    if (picked !== activeUuid)
        await setActor(picked);
}

export async function openNarrativeLinkDialog(setActor)
{
    const owned = (game.actors?.contents ?? []).filter(entry => entry.isOwner);
    const pilots = owned.filter(entry => entry.type === 'pilot');
    const npcs = owned.filter(entry => entry.type === 'npc');
    const current = getModuleSetting('tah.narrativeLinkedActorUuid');
    const currentActor = current ? /** @type {any} */ (fromUuidSync(current)) : null;
    const roster = getNarrativeRoster().map(entry => entry.uuid);
    const subtitle = currentActor ? `Driving: ${escapeHtml(currentActor.name)}` : 'Nothing linked';
    const tokenImg = (entry) => entry?.prototypeToken?.texture?.src || entry?.img || 'icons/svg/mystery-man.svg';
    const cardHtml = (entry) =>
    {
        const sel = roster.includes(entry.uuid);
        const active = entry.uuid === current;
        return `<div class="la-narrative-pilot-card${sel ? ' selected' : ''}" data-uuid="${entry.uuid}" data-name="${escapeHtml(entry.name.toLowerCase())}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid ${sel ? 'var(--primary-color)' : '#999'};border-radius:3px;background:${sel ? BG_HOVER : BG_DEFAULT};cursor:pointer;transition:background 0.1s, border-color 0.1s;">
            <img src="${escapeHtml(tokenImg(entry))}" style="width:40px;height:40px;object-fit:cover;border:1px solid #999;border-radius:3px;background:#1a1a1a;flex-shrink:0;">
            <span style="flex:1;font-weight:600;color:var(--la-ink);">${escapeHtml(entry.name)}</span>
            <span class="la-narrative-pilot-active" style="font-size:0.75em;letter-spacing:1px;color:var(--primary-color);${active ? '' : 'visibility:hidden;'}">DRIVING</span>
        </div>`;
    };
    const listHtml = (entries, emptyText) => entries.length
        ? entries.map(cardHtml).join('')
        : `<div style="font-size:0.85em;color:#888;font-style:italic;">${emptyText}</div>`;
    const tabStyle = (on) => `flex:1;padding:4px 8px;font-weight:600;font-size:0.85em;letter-spacing:0.5px;text-transform:uppercase;border:1px solid ${on ? 'var(--primary-color)' : '#999'};border-radius:3px;background:${on ? BG_ACTIVE : BG_DEFAULT};color:${on ? TEXT_ACTIVE : TEXT_DEFAULT};cursor:pointer;`;
    const byUuid = new Map(owned.map(entry => [entry.uuid, entry]));
    const chipHtml = (uuid) =>
    {
        const entry = byUuid.get(uuid);
        if (!entry)
            return '';
        const active = uuid === current;
        return `<div class="la-narrative-chip" data-uuid="${uuid}" title="Remove from roster" style="display:inline-flex;align-items:center;gap:5px;padding:2px 6px 2px 2px;border:1px solid ${active ? 'var(--primary-color)' : '#999'};border-radius:3px;background:${active ? BG_HOVER : BG_DEFAULT};cursor:pointer;max-width:100%;">
            <img src="${escapeHtml(tokenImg(entry))}" style="width:22px;height:22px;object-fit:cover;border-radius:2px;background:#1a1a1a;flex-shrink:0;">
            <span style="font-weight:600;font-size:0.82em;color:var(--la-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(entry.name)}</span>
            <i class="fas fa-times" style="font-size:0.75em;opacity:0.6;"></i>
        </div>`;
    };
    const rosterEmpty = '<div style="font-size:0.85em;color:#888;font-style:italic;align-self:center;">Nothing linked yet. Pick from the lists below.</div>';
    const content = `
        <div class="lancer-dialog-base">
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">NARRATIVE HUD ROSTER</div>
                <div class="lancer-dialog-subtitle">${subtitle}</div>
            </div>
            <div class="lancer-info-box">
                <i class="fas fa-info-circle"></i>
                <span>Pick who the narrative HUD can drive. Swap between them from the link icon in the HUD name band.</span>
            </div>
            <div style="margin-top:12px;">
                <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.85em;font-weight:600;margin-bottom:4px;">
                    <span>Linked</span>
                    <span class="la-narrative-roster-count" style="color:var(--primary-color);">${roster.length}</span>
                </label>
                <div class="la-narrative-roster" style="display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px;height:62px;overflow-y:auto;padding:4px;margin-bottom:10px;border:1px solid #999;border-radius:3px;background:color-mix(in srgb, var(--la-plate), #000 4%);">
                    ${roster.length ? roster.map(chipHtml).join('') : rosterEmpty}
                </div>
                <div style="display:flex;gap:4px;margin-bottom:6px;">
                    <button type="button" class="la-narrative-tab" data-tab="pilot" style="${tabStyle(true)}">${localize('LA.tokenHud.label.pilots')} <span data-count>${pilots.length}</span></button>
                    <button type="button" class="la-narrative-tab" data-tab="npc" style="${tabStyle(false)}">${localize('LA.tokenHud.label.npcs')} <span data-count>${npcs.length}</span></button>
                </div>
                <input type="text" class="la-narrative-search" placeholder="${localize('LA.common.searchByName')}" style="width:100%;margin-bottom:6px;">
                <div class="la-narrative-pilot-list" data-list="pilot" style="display:flex;flex-direction:column;gap:4px;height:280px;overflow-y:auto;padding:2px;">
                    ${listHtml(pilots, 'No pilot found.')}
                </div>
                <div class="la-narrative-pilot-list" data-list="npc" style="display:none;flex-direction:column;gap:4px;height:280px;overflow-y:auto;padding:2px;">
                    ${listHtml(npcs, 'No NPC found.')}
                </div>
                <input type="hidden" name="pilot-uuid" value="${roster.join(',')}">
            </div>
        </div>
    `;
    const dlg = new Dialog({
        title: localize('LA.dialogTitle.linkNarrativeHud'),
        content,
        buttons: {
            link: {
                icon: '<i class="fas fa-link"></i>',
                label: localize('LA.tokenHud.label.link'),
                callback: async (html) =>
                {
                    const raw = String(/** @type {any} */ (html).find('[name="pilot-uuid"]').val() || '');
                    const picked = raw ? raw.split(',').filter(Boolean) : [];
                    await game.settings.set(MODULE_ID, 'tah.narrativeRosterUuids', picked);
                    const active = picked.includes(current) ? current : (picked[0] ?? '');
                    await setActor(active);
                },
            },
            unlink: {
                icon: '<i class="fas fa-unlink"></i>',
                label: localize('LA.tokenHud.label.unlinkAll'),
                callback: async () =>
                {
                    await game.settings.set(MODULE_ID, 'tah.narrativeRosterUuids', []);
                    await setActor('');
                },
            },
            cancel: cancelButton(),
        },
        default: 'link',
        render: (html) =>
        {
            const $html = /** @type {any} */ (html);

            const setCard = (uuid, on) =>
            {
                $html.find(`.la-narrative-pilot-card[data-uuid="${uuid}"]`).toggleClass('selected', on).css({
                    background: on ? BG_HOVER : BG_DEFAULT,
                    'border-color': on ? 'var(--primary-color)' : '#999',
                });
            };
            const syncRoster = () =>
            {
                const picked = $html.find('.la-narrative-pilot-card.selected')
                    .map((_index, el) => String($(el).attr('data-uuid') || '')).get();
                $html.find('[name="pilot-uuid"]').val(picked.join(','));
                $html.find('.la-narrative-roster-count').text(picked.length);
                $html.find('.la-narrative-roster').html(picked.length ? picked.map(chipHtml).join('') : rosterEmpty);
                $html.find('.la-narrative-chip').on('click', function ()
                {
                    setCard(String($(this).attr('data-uuid') || ''), false);
                    syncRoster();
                });
            };

            $html.find('.la-narrative-pilot-card').on('click', function ()
            {
                const $card = $(this);
                setCard(String($card.attr('data-uuid') || ''), !$card.hasClass('selected'));
                syncRoster();
            });
            syncRoster();

            const showTab = (tab) =>
            {
                $html.find('.la-narrative-tab').each((_index, el) =>
                {
                    const on = $(el).attr('data-tab') === tab;
                    $(el).css({
                        background: on ? BG_ACTIVE : BG_DEFAULT,
                        color: on ? TEXT_ACTIVE : TEXT_DEFAULT,
                        'border-color': on ? 'var(--primary-color)' : '#999',
                    });
                });
                $html.find('.la-narrative-pilot-list').each((_index, el) =>
                {
                    $(el).css('display', $(el).attr('data-list') === tab ? 'flex' : 'none');
                });
            };
            $html.find('.la-narrative-tab').on('click', function ()
            {
                showTab(String($(this).attr('data-tab') || 'pilot'));
            });

            const search = $html.find('.la-narrative-search');
            search.on('input', () =>
            {
                const query = String(search.val() || '').trim().toLowerCase();
                $html.find('.la-narrative-pilot-list').each((_index, el) =>
                {
                    const list = $(el);
                    let shown = 0;
                    list.find('.la-narrative-pilot-card').each((_cardIndex, cardEl) =>
                    {
                        const hit = !query || String($(cardEl).attr('data-name') || '').includes(query);
                        $(cardEl).css('display', hit ? 'flex' : 'none');
                        if (hit)
                            shown++;
                    });
                    $html.find(`.la-narrative-tab[data-tab="${list.attr('data-list')}"] [data-count]`).text(shown);
                });
            });
            $html.closest('.app').find('.dialog-buttons').css({
                display: 'flex', 'flex-direction': 'row', 'align-items': 'center', flex: '0 0 auto', gap: '6px',
            });
        },
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 480 }).render(true);
    return dlg;
}
