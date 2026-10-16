import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { escapeHtml, localize, localizeFormat } from '../tools/string-utils.js';
import { EVENT_FLAG, eventRound, eventRoundsLeft } from './carousel-view.js';

const SETTING_RECENT = 'carouselEvents';
const RECENT_MAX = 10;

const elementOf = html => (html instanceof HTMLElement ? html : html?.[0]);

export function registerEventSettings()
{
    game.settings.register(MODULE_ID, SETTING_RECENT, {
        scope: 'world',
        config: false,
        type: Array,
        default: [],
    });
}

function recentEvents()
{
    const recent = getModuleSetting(SETTING_RECENT);
    return Array.isArray(recent) ? recent : [];
}

function formHtml(recent)
{
    const tiles = recent.map((entry, index) =>
        `<button type="button" class="lac-recent" data-index="${index}" data-tooltip="${escapeHtml(entry.name)}" style="background-image:url(&quot;${escapeHtml(entry.img)}&quot;)"></button>`
    ).join('');
    const label = key => escapeHtml(localize(key));
    return `<div class="lancer-dialog-header"><div class="lancer-dialog-title">${label('LA.carousel.addEvent.title')}</div></div>
        <form class="lac-add-event">
            ${tiles ? `<div class="lac-recent-row">${tiles}</div>` : ''}
            <div class="form-group"><label>${label('LA.carousel.addEvent.name')}</label><input type="text" name="name"/></div>
            <div class="form-group"><label>${label('LA.carousel.addEvent.img')}</label><file-picker type="image" name="img"></file-picker></div>
            <div class="form-group"><label>${label('LA.carousel.addEvent.duration')}</label><input type="number" name="duration" min="0" step="1"/></div>
            <div class="form-group"><label>${label('LA.carousel.addEvent.hidden')}</label><input type="checkbox" name="hidden"/></div>
        </form>`;
}

function bindRecent(html, recent)
{
    const form = elementOf(html)?.querySelector('form.lac-add-event');
    form?.addEventListener('click', event =>
    {
        const tile = event.target.closest('.lac-recent');
        const entry = tile ? recent[Number(tile.dataset.index)] : null;
        if (!entry)
            return;
        form.elements.name.value = entry.name ?? '';
        form.querySelector('file-picker[name="img"]').value = entry.img ?? '';
        form.elements.duration.value = entry.duration || '';
        form.elements.hidden.checked = !!entry.hidden;
    });
}

function readEventForm(html)
{
    const form = elementOf(html)?.querySelector('form.lac-add-event');
    const data = form ? new foundry.applications.ux.FormDataExtended(form).object : {};
    const name = String(data.name ?? '').trim();
    const img = String(data.img ?? '').trim();
    if (!name || !img)
        throw new Error(localize('LA.carousel.addEvent.error'));
    return { name, img, duration: Math.max(0, Math.floor(Number(data.duration) || 0)), hidden: !!data.hidden };
}

async function submitEvent(combat, { name, img, duration, hidden })
{
    await combat.createEmbeddedDocuments('Combatant', [{
        name,
        img,
        hidden,
        flags: { [MODULE_ID]: { [EVENT_FLAG]: { duration, roundCreated: eventRound(combat) } } },
    }]);
    const recent = recentEvents().filter(entry => entry.name !== name || entry.img !== img);
    await game.settings.set(MODULE_ID, SETTING_RECENT, [{ name, img, duration, hidden }, ...recent].slice(0, RECENT_MAX));
}

export function openAddEvent(combat)
{
    const recent = recentEvents();
    new Dialog({
        title: localize('LA.carousel.addEvent.title'),
        content: formHtml(recent),
        buttons: {
            add: {
                icon: '<i class="fa-solid fa-plus"></i>',
                label: localize('LA.carousel.addEvent.title'),
                callback: html => submitEvent(combat, readEventForm(html)),
            },
        },
        default: 'add',
        render: html => bindRecent(html, recent),
    }, { width: 400, classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
}

async function expireEvents(combat)
{
    const expired = combat.combatants.filter(combatant => eventRoundsLeft(getLAFlag(combatant, EVENT_FLAG), combat) === 0);
    if (!expired.length)
        return;
    await combat.deleteEmbeddedDocuments('Combatant', expired.map(combatant => combatant.id));
    for (const combatant of expired)
    {
        ChatMessage.create({
            content: localizeFormat('LA.carousel.event.expired', { name: `<strong>${escapeHtml(combatant.name)}</strong>` }),
            whisper: ChatMessage.getWhisperRecipients('GM'),
            style: CONST.CHAT_MESSAGE_STYLES.OTHER,
        });
    }
}

export function initEventExpiry()
{
    Hooks.on('updateCombat', (combat, changed) =>
    {
        if ('round' in changed && game.users.activeGM?.isSelf)
            expireEvents(combat);
    });
}
