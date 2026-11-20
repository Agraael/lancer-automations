import { escapeHtml, localize, localizeFormat } from '../tools/string-utils.js';
import { TF_NO_TEAM, TF_TEAM_PATH, tfGetTeam, tfGetTeams, tfTeamsColorSides } from '../tools/token-factions-utils.js';
import { VISIBILITIES, VISIBILITY_ICONS, draftToken, editReinforcementTokens, getReinforcements, landReinforcements, removeReinforcements, replaceReinforcementToken, teamHiddenIcon, teamLabelKey, teamShownIcon, updateReinforcements } from './reinforcements.js';

const FLYOUT_MARGIN = 8;

const DISPOSITION_ROWS = [
    { value: 1, key: 'f', short: 'F', label: 'TOKEN.DISPOSITION.FRIENDLY', color: 'FRIENDLY' },
    { value: 0, key: 'n', short: 'N', label: 'TOKEN.DISPOSITION.NEUTRAL', color: 'NEUTRAL' },
    { value: -1, key: 'h', short: 'H', label: 'TOKEN.DISPOSITION.HOSTILE', color: 'HOSTILE' },
    { value: -2, key: 's', short: 'S', label: 'TOKEN.DISPOSITION.SECRET', color: 'SECRET' },
];

let UnitMenu = null;
let UnitConfig = null;

const dispositionCss = key => foundry.utils.Color.from(CONFIG.Canvas.dispositionColors[key]).css;

const dispositionRow = value => DISPOSITION_ROWS.find(row => row.value === Number(value)) ?? DISPOSITION_ROWS[1];

function unitMenuClass()
{
    UnitMenu ??= class extends foundry.applications.ux.ContextMenu.implementation
    {
        /** @type {HTMLElement|null} */
        header = null;

        /** @type {HTMLElement|null} */
        teamRow = null;

        _setPosition(html, target, options)
        {
            html.classList.add('la-rf-menu');
            if (this.header)
                html.querySelector('menu')?.prepend(this.header);
            if (this.teamRow)
                html.querySelector('[data-group-id="edit"] > ol')?.prepend(this.teamRow);
            super._setPosition(html, target, options);
        }
    };
    return UnitMenu;
}

function unitConfigClass()
{
    UnitConfig ??= class ReinforcementTokenConfig extends foundry.applications.sheets.TokenConfig
    {
        async _processSubmitData(event, form, submitData)
        {
            const { entryId, combatId } = /** @type {any} */ (this.options).reinforcement;
            const combat = game.combats.get(combatId);
            this.document.updateSource(submitData);
            if (combat)
                await replaceReinforcementToken(entryId, this.document.toObject(), combat);
        }

        async _onRender(context, options)
        {
            await super._onRender(context, options);
            const content = this.element.querySelector('.window-content');
            if (!content || content.querySelector(':scope > .la-rf-config-note'))
                return;

            const note = document.createElement('p');
            note.className = 'la-rf-config-note';
            const icon = document.createElement('i');
            icon.className = 'fas fa-parachute-box';
            note.append(icon, ` ${localizeFormat('LA.reinforcement.configNote', { round: /** @type {any} */ (this.options).reinforcement.round })}`);
            content.prepend(note);
        }
    };
    return UnitConfig;
}

function openUnitConfig(entry, combat)
{
    const draft = /** @type {any} */ (new CONFIG.Token.documentClass({ ...foundry.utils.deepClone(entry.tokenData), _id: entry.id }, { parent: game.scenes.get(entry.sceneId) ?? null }));
    draft.update = async (changes) =>
    {
        draft.updateSource(changes);
        return draft;
    };

    const Sheet = unitConfigClass();
    new Sheet({ document: draft, reinforcement: { entryId: entry.id, combatId: combat.id, round: entry.round } }).render({ force: true });
}

function teamState(entry)
{
    const draft = draftToken(entry);
    if (tfTeamsColorSides())
    {
        const teamId = tfGetTeam(draft);
        const team = tfGetTeams().find(other => other.id === teamId);
        return team
            ? { value: team.id, name: team.name, color: team.color }
            : { value: TF_NO_TEAM, name: localize('LA.reinforcement.menu.noTeam'), color: null };
    }

    const row = dispositionRow(draft.disposition);
    return { value: String(row.value), name: localize(row.label), color: dispositionCss(row.color) };
}

function teamRows()
{
    if (!tfTeamsColorSides())
        return DISPOSITION_ROWS.map(row => ({ value: String(row.value), name: localize(row.label), color: dispositionCss(row.color), colorEx: '#000000' }));

    /** @type {any[]} */
    const rows = [{ value: TF_NO_TEAM, name: localize('LA.reinforcement.menu.noTeam'), none: true }];
    for (const team of tfGetTeams())
    {
        const row = dispositionRow(team.gmDisposition);
        rows.push({ value: team.id, name: team.name, color: team.color, colorEx: team.colorEx || '#000000', defKey: row.key, defShort: row.short });
    }
    return rows;
}

function pickTeam(ids, combat, value)
{
    if (!tfTeamsColorSides())
        return editReinforcementTokens(ids, { disposition: Number(value) }, combat);

    const team = tfGetTeams().find(other => other.id === value);
    const changes = { [TF_TEAM_PATH]: value };
    if (team)
        changes.disposition = Number(team.gmDisposition);
    return editReinforcementTokens(ids, changes, combat);
}

function placeFlyout(nav, flyout)
{
    nav.append(flyout);
    const rect = flyout.getBoundingClientRect();
    if (rect.right > window.innerWidth - FLYOUT_MARGIN)
        flyout.classList.add('is-left');
    if (rect.bottom > window.innerHeight - FLYOUT_MARGIN)
        flyout.style.top = `${window.innerHeight - FLYOUT_MARGIN - rect.bottom}px`;
}

function toggleFlyout(menu, build)
{
    const nav = menu.element;
    const open = nav?.querySelector(':scope > .la-rf-flyout');
    if (open)
    {
        open.remove();
        return;
    }
    if (nav && ui.context === menu)
        placeFlyout(nav, build());
}

function teamFlyout(entry, combat, menu, ids)
{
    const current = teamState(entry).value;
    const rows = teamRows().map((row) =>
    {
        const chip = row.none
            ? '<span class="tf-chip tf-none"></span>'
            : `<span class="tf-chip" style="--ci: ${escapeHtml(row.color)}; --ce: ${escapeHtml(row.colorEx)};"></span>`;
        const mark = row.value === current ? `<span class="tf-muted">${localize('LA.reinforcement.menu.current')}</span>` : '';
        const pill = row.defKey ? `<span class="tf-pill tf-sm tf-${row.defKey}">${row.defShort}</span>` : '';
        return `<button type="button" class="tf-palette-row${row.value === current ? ' current' : ''}" data-rf-team="${escapeHtml(row.value)}">${chip}<span class="tf-palette-name">${escapeHtml(row.name)}</span>${mark}${pill}</button>`;
    }).join('');

    const flyout = document.createElement('div');
    flyout.className = 'la-rf-flyout tf-palette';
    flyout.setAttribute('style', DISPOSITION_ROWS.map(row => `--tf-${row.key}: ${dispositionCss(row.color)};`).join(' '));
    flyout.innerHTML = `<div class="tf-palette-head"><span>${localize(tfTeamsColorSides() ? 'LA.reinforcement.menu.team' : 'LA.reinforcement.menu.disposition')}</span>`
        + `<span class="tf-muted">${ids.length > 1 ? localizeFormat('LA.reinforcement.selectedCount', { count: ids.length }) : localize('LA.reinforcement.menu.thisUnitOnly')}</span></div><div class="tf-palette-list">${rows}</div>`;

    flyout.addEventListener('click', (event) =>
    {
        const row = /** @type {HTMLElement} */ (event.target).closest('[data-rf-team]');
        if (!row)
            return;
        menu.close();
        pickTeam(ids, combat, /** @type {HTMLElement} */ (row).dataset.rfTeam);
    });
    return flyout;
}

function teamRow(entry, combat, menu, ids)
{
    const state = teamState(entry);
    const row = document.createElement('li');
    row.className = 'la-rf-item';
    const glyph = document.createElement('i');
    glyph.className = 'fa-fw la-flag-wrap';
    glyph.insertAdjacentHTML('beforeend', teamShownIcon());
    const label = document.createElement('span');
    label.className = 'la-rf-team';
    const chip = document.createElement('span');
    chip.className = state.color ? 'la-rf-chip' : 'la-rf-chip is-none';
    if (state.color)
        chip.style.background = state.color;
    label.append(chip, state.name);
    const chevron = document.createElement('i');
    chevron.className = 'fas fa-chevron-right la-rf-more';
    row.append(glyph, label, chevron);
    row.addEventListener('click', () => toggleFlyout(menu, () => teamFlyout(entry, combat, menu, ids)));
    return row;
}

function menuHeader(entry, count)
{
    const header = document.createElement('li');
    header.className = 'la-rf-menu-unit';
    const art = document.createElement('img');
    art.src = entry.tokenData.texture?.src ?? '';
    art.alt = '';
    const name = document.createElement('span');
    name.textContent = entry.tokenData.name ?? '';
    header.append(art, name);

    if (entry.edited)
    {
        const edited = document.createElement('em');
        edited.className = 'la-rf-edited';
        const pen = document.createElement('i');
        pen.className = 'fas fa-pen';
        edited.append(pen, ` ${localize('LA.reinforcement.edited')}`);
        header.append(edited);
    }

    if (count > 1)
    {
        const group = document.createElement('em');
        group.className = 'la-rf-edited';
        group.textContent = localizeFormat('LA.reinforcement.selectedCount', { count });
        header.append(group);
    }
    return header;
}

export function openEntryMenu(entry, combat, event, ids = [entry.id])
{
    const group = getReinforcements(combat).filter(other => ids.includes(other.id));
    const several = group.length > 1;
    const byRound = group.filter(other => !other.clock);
    const canSooner = byRound.filter(other => other.round - 1 > (combat.round ?? 0));
    const shift = (entries, step) => updateReinforcements(entries.map(other => ({ id: other.id, changes: { round: other.round + step } })), combat);
    const setAll = changes => updateReinforcements(ids.map(id => ({ id, changes })), combat);

    const items = [
        {
            name: several ? 'LA.reinforcement.laterAll' : localizeFormat('LA.reinforcement.later', { round: entry.round + 1 }),
            icon: '<i class="fas fa-plus"></i>',
            group: 'round',
            condition: byRound.length > 0,
            callback: () => shift(byRound, 1),
        },
        {
            name: several ? 'LA.reinforcement.soonerAll' : localizeFormat('LA.reinforcement.sooner', { round: entry.round - 1 }),
            icon: '<i class="fas fa-minus"></i>',
            group: 'round',
            condition: canSooner.length > 0,
            callback: () => shift(canSooner, -1),
        },
        {
            name: 'LA.reinforcement.editToken',
            icon: '<i class="fas fa-cog"></i>',
            group: 'edit',
            callback: () => openUnitConfig(entry, combat),
        },
        ...VISIBILITIES.map(visibility => ({
            name: `LA.reinforcement.visibility.${visibility}`,
            icon: `<i class="fas ${VISIBILITY_ICONS[visibility]}"></i>`,
            group: 'visibility',
            classes: visibility === entry.visibility ? 'la-rf-current' : '',
            callback: () => setAll({ visibility }),
        })),
        {
            name: teamLabelKey(entry.teamHidden ? 'show' : 'hide'),
            icon: `<i class="la-flag-wrap">${teamHiddenIcon()}</i>`,
            group: 'visibility',
            classes: entry.teamHidden ? 'la-rf-current' : '',
            callback: () => setAll({ teamHidden: !entry.teamHidden }),
        },
        {
            name: 'LA.reinforcement.landNow',
            icon: '<i class="fas fa-arrow-down"></i>',
            group: 'act',
            callback: () => landReinforcements(ids, combat),
        },
        {
            name: 'LA.common.remove',
            icon: '<i class="fas fa-trash"></i>',
            group: 'act',
            callback: () => removeReinforcements(ids, combat),
        },
    ];

    ui.context?.close(/** @type {any} */ ({ animate: false }));
    const target = document.createElement('div');
    const menu = new (unitMenuClass())(target, '', items, { jQuery: false, fixed: true });
    menu.header = menuHeader(entry, group.length);
    menu.teamRow = teamRow(entry, combat, menu, ids);
    ui.context = menu;
    menu.render(target, { event });
}

export function openReinforcementMenu(combat, id, event, ids = [id])
{
    const entry = getReinforcements(combat).find(other => other.id === id);
    if (entry && game.user.isGM)
        openEntryMenu(entry, combat, event, ids);
}
