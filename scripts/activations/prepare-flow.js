import { injectExtraDataUtility } from './flows.js';
import { startPickCard, profileChips } from '../interactive/pick-card.js';
import { pickTokensCardless, cancelCardlessTokenPicker } from '../interactive/tools/pickTokensCardless.js';
import { createTokenMark } from '../interactive/target-shapes.js';
import { TG, RANGE_GLOW } from '../interactive/canvas-palette.js';
import { rangePulse, RANGE_PULSE_PRIORITY } from '../interactive/range-pulse-manager.js';
import { reloadOneWeapon, getWeapons } from '../interactive/actor-items.js';
import { executeSimpleActivation, executeInvade, executeSkirmish } from '../tools/misc-tools.js';
import { spendReactionForTape, setHeldReactionHook } from '../tools/action-economy.js';
import { getActorActionItems } from '../tools/actor-actions.js';
import { runActorAction } from './run-action.js';
import { MODULE_ID, BASIC_DETAIL, BOOST_DETAIL } from '../tools/constants.js';
import { localize, localizeFormat, escapeHtml } from '../tools/string-utils.js';
import { getLAFlags } from '../tools/flag-utils.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { flowActionTitle } from '../tools/flow-title.js';
import { currentTurnChips, recordAction, patchTapeEntry } from '../tah/action-tape.js';
import { applyEffectsToTokens, notifyEffectLine } from '../bonuses/flagged-effects.js';
import { isOrdnanceWeapon } from '../combat/action-limits.js';
import { queueActionFx, playPrepareFX } from '../fx/actionFX.js';
import { deleteDocumentRouted, asOwner } from '../socket.js';
import { computeSightlineRays, hasLineOfSight } from '../vision/losEngine.js';
import { getTokenVisionLOS } from '../vision/visionFromEdge.js';
import { blindedVisionEnabled } from '../vision/blindedVision.js';
import { getActorMaxThreat, getActorMaxReach_WithBonus, getSensorRange_WithBonus, getWeaponReachRange, getWeaponProfiles_WithBonus, weaponIgnoresLineOfSight } from '../tools/weapon-bonus-utils.js';
import { awaitMovementSettled } from '../movement/move-api.js';
import { _rulerMove } from '../movement/move-tracking.js';
import { trimPathToPosition } from '../movement/path-replay.js';

const STATUS_ID = 'preparing';
const PRESET_REACTION = 'Prepared Action';
const STATUS_ICON = `modules/${MODULE_ID}/icons/light-bulb.svg`;
const ICONS = `modules/${MODULE_ID}/icons`;
const MECH = ['mech', 'npc'];
const HELD_ACTIVATIONS = ['Quick', 'Quick Tech'];

const BASIC_TILES = [
    { name: 'Skirmish', kind: 'skirmish', labelKey: 'LA.tokenHud.label.skirmish', icon: `${ICONS}/skirmish.svg`, detail: BASIC_DETAIL.skirmish, types: MECH },
    { name: 'Ram', icon: `${ICONS}/ram.svg`, detail: BASIC_DETAIL.ram, types: MECH },
    { name: 'Grapple', icon: `${ICONS}/grappling.svg`, detail: BASIC_DETAIL.grapple, types: MECH },
    { name: 'Boost', icon: `${ICONS}/speedometer.svg`, detail: BOOST_DETAIL, types: [...MECH, 'pilot'] },
    { name: 'Hide', icon: 'systems/lancer/assets/icons/status_hidden.svg', detail: BASIC_DETAIL.hide, pilotDetail: BASIC_DETAIL.hidePilot, types: [...MECH, 'pilot'] },
    { name: 'Search', icon: `${ICONS}/search.svg`, detail: BASIC_DETAIL.search, pilotDetail: BASIC_DETAIL.searchPilot, types: [...MECH, 'pilot'] },
    { name: 'Lock On', labelKey: 'LA.tokenHud.label.lockOn', icon: 'systems/lancer/assets/icons/white/condition_lockon.svg', detail: BASIC_DETAIL.lockOn, types: MECH },
    { name: 'Scan', labelKey: 'LA.tokenHud.label.scan', icon: `${ICONS}/radar-sweep.svg`, detail: BASIC_DETAIL.scan, types: ['mech'] },
    { name: 'Bolster', labelKey: 'LA.tokenHud.label.bolster', icon: `${ICONS}/upgrade.svg`, detail: BASIC_DETAIL.bolster, types: MECH },
    { name: 'Invade', kind: 'invade', labelKey: 'LA.tokenHud.label.invade', icon: `${ICONS}/cpu-shot.svg`, detail: BASIC_DETAIL.invade, types: MECH },
    { name: 'Reload', kind: 'reload', labelKey: 'LA.tokenHud.label.reload', icon: 'mdi mdi-magazine-rifle', detailKey: 'LA.tokenHud.detail.reloadWeapon', types: ['pilot'] },
];

const WHERE_KEYS = ['adjacent', 'range', 'sight'];
const LEGACY_WHERE = { adjacent: 'adjacent', threat: 'range', sight: 'sight' };
const FIXED_SOURCES = ['threat', 'sensor', 'reach'];

const RANGE_SOURCES = [
    { key: 'threat', icon: 'cci cci-threat' },
    { key: 'sensor', icon: 'cci cci-sensor' },
    { key: 'reach', icon: 'systems/lancer/assets/icons/nested_hexagons.svg' },
    { key: 'weapon', icon: 'cci cci-weapon' },
    { key: 'manual', icon: 'systems/lancer/assets/icons/range.svg' },
];

const WHEN_PRESETS = [
    { key: 'moves', triggers: ['onPreMove'], move: true },
    { key: 'attacks', triggers: ['onAttack', 'onTechAttack'] },
    { key: 'attacksMe', triggers: ['onAttack', 'onTechAttack'], me: true },
    { key: 'hits', triggers: ['onHit', 'onTechHit'] },
    { key: 'misses', triggers: ['onMiss', 'onTechMiss'] },
    { key: 'damages', triggers: ['onDamage'], damage: true },
    { key: 'damagesMe', triggers: ['onDamage'], damage: true, me: true },
    { key: 'action', triggers: ['onActivation'] },
    { key: 'reaction', triggers: ['onActivation'], reaction: true },
];

const DAMAGE_TYPES = [
    { name: 'All', icon: `${ICONS}/resist_all.svg` },
    { name: 'Kinetic', icon: 'systems/lancer/assets/icons/white/damage_kinetic.svg' },
    { name: 'Energy', icon: 'systems/lancer/assets/icons/white/damage_energy.svg' },
    { name: 'Explosive', icon: 'systems/lancer/assets/icons/white/damage_explosive.svg' },
    { name: 'Heat', icon: 'systems/lancer/assets/icons/white/damage_heat.svg' },
    { name: 'Burn', icon: 'systems/lancer/assets/icons/white/damage_burn.svg' },
    { name: 'Infection', icon: `${ICONS}/infection.svg`, setting: 'enableInfectionDamageIntegration' },
];

const _asked = new WeakMap();

function whenText(key, types, mark = name => name)
{
    const typed = types.length ? `${types.map(mark).join(` ${localize('LA.prepare.or')} `)} ` : '';
    if (key === 'damages')
        return localizeFormat('LA.prepare.when.damages.text', { types: typed });
    if (key === 'damagesMe')
        return localizeFormat('LA.prepare.when.damagesMe.text', { types: typed });

    return localize(`LA.prepare.when.${key}.text`);
}

function normalizePreset(preset)
{
    if (!preset || !LEGACY_WHERE[preset.when])
        return preset;

    const where = LEGACY_WHERE[preset.when];
    return { ...preset, when: 'moves', where, range: where === 'range' ? { source: 'threat', los: true } : null };
}

function presetOf(actor)
{
    return normalizePreset(getPrepared(actor)?.preset);
}

function rangeValue(range, actor)
{
    if (!actor)
        return 0;
    if (range?.source === 'sensor')
        return actor.type === 'pilot' ? 5 : getSensorRange_WithBonus(actor);
    if (range?.source === 'reach')
        return getActorMaxReach_WithBonus(actor);
    if (range?.source === 'manual')
        return Number(range.value) || 0;
    if (range?.source !== 'weapon')
        return getActorMaxThreat(actor) || 1;

    const weapon = actor.items.get(range.weaponId);
    return weapon ? getWeaponReachRange(weapon, actor) : 0;
}

function whereText(preset, moving, mark)
{
    let mode = 'text';
    if (moving)
        mode = preset.inside ? 'inside' : 'moving';

    if (preset.where !== 'range')
        return localizeFormat(`LA.prepare.where.${preset.where}.${mode}`, { key: mark(localize(`LA.prepare.where.${preset.where}.key`)) });

    const range = preset.range ?? {};
    let text;

    if (range.source === 'manual')
        text = localizeFormat('LA.prepare.range.within', { range: mark(String(range.value ?? 0)) });
    else if (range.source === 'weapon')
    {
        const weapon = mark(range.weaponName ?? '');
        text = localizeFormat(`LA.prepare.range.${{ inside: 'withinWeapon', moving: 'intoWeapon', text: 'inWeapon' }[mode]}`, { weapon });
    }
    else
    {
        const source = mark(localize(`LA.prepare.source.${range.source ?? 'threat'}`));
        text = localizeFormat(`LA.prepare.range.${{ inside: 'withinSource', moving: 'into', text: 'in' }[mode]}`, { source });
    }

    return range.los === false ? localizeFormat('LA.prepare.range.noLos', { text }) : text;
}

function eventText(preset, mark = name => name)
{
    const event = whenText(preset.when, preset.types ?? [], mark).trim();

    if (!preset.where)
        return event;
    if (preset.when === 'moves')
        return localizeFormat('LA.prepare.when.moves.where', { where: whereText(preset, true, mark) });
    return `${whereText(preset, false, mark)} ${event}`;
}

function weaponRangeChips(weapon, actor)
{
    const profiles = getWeaponProfiles_WithBonus(weapon, actor);
    const profile = profiles[weapon.system?.selected_profile_index ?? 0] ?? profiles[0];
    return profileChips({ range: profile?.range ?? [] });
}

function preparedEffect(actor)
{
    return actor?.effects?.find(effect => effect.statuses?.has(STATUS_ID) && getLAFlags(effect)?.prepared) ?? null;
}

export function getPrepared(actor)
{
    return getLAFlags(preparedEffect(actor))?.prepared ?? null;
}

function tilePick(tile, actor)
{
    const detail = tile.detailKey ? localize(tile.detailKey) : ((actor.type === 'pilot' && tile.pilotDetail) || tile.detail);
    return { name: tile.name, kind: tile.kind ?? 'basic', icon: tile.icon, detail };
}

function heldPick({ action, sourceItem, rankIdx, activation })
{
    return {
        name: action.name,
        kind: 'item',
        icon: action.icon ?? sourceItem?.img ?? null,
        detail: action.detail ?? '',
        itemUuid: sourceItem?.uuid ?? null,
        activation,
        ...(rankIdx == null ? {} : { rankIdx }),
    };
}

function heldSub({ action, sourceItem })
{
    if (!sourceItem)
        return '';
    if (sourceItem.name !== action.name)
        return escapeHtml(sourceItem.name);

    const typeLabel = CONFIG.Item.typeLabels?.[sourceItem.type];
    return typeLabel ? game.i18n.localize(typeLabel) : '';
}

export async function pickPrepared(token, { preview = false, onPreview = null } = {})
{
    const actor = token.actor;
    const chips = token.combatant ? currentTurnChips(token) : [];
    const moved = chips.some(entry => entry.move && entry.moveKind !== 'forced' && entry.moveKind !== 'manual');
    const confirmText = localize('LA.prepare.confirm');

    const taken = (name) =>
    {
        const needle = name.toLowerCase();
        return chips.some(entry => !entry.move && (String(entry.name).toLowerCase() === needle || String(entry.name).toLowerCase().startsWith(`${needle}:`)));
    };

    const tiles = BASIC_TILES.filter(tile => tile.types.includes(actor.type)).map(tile => ({ ...tile, label: tile.labelKey ? localize(tile.labelKey) : tile.name }));

    const held = HELD_ACTIVATIONS
        .flatMap(activation => getActorActionItems(actor, activation).map((/** @type {any} */ entry) => ({ ...entry, activation })))
        .filter(({ action }) => action.name !== 'Prepare' && !action.laCombat);

    const filter = document.createElement('input');
    filter.type = 'text';
    filter.className = 'la-pick-filter';
    filter.placeholder = localize('LA.prepare.searchPlaceholder');
    filter.spellcheck = false;

    const typesHead = document.createElement('h3');
    typesHead.className = 'la-section-header lancer-border-primary';
    typesHead.textContent = localize('LA.prepare.damageType');

    const typesRow = document.createElement('div');
    typesRow.className = 'la-prep-types';

    for (const type of DAMAGE_TYPES.filter(entry => !entry.setting || getModuleSetting(entry.setting)))
    {
        const option = document.createElement('div');
        option.className = 'te-icon-option';
        option.dataset.type = type.name;
        option.title = type.name;

        const image = document.createElement('img');
        image.src = type.icon;
        image.width = 24;
        image.height = 24;
        option.append(image);
        typesRow.append(option);
    }

    let chosen = null;
    let trigger = '';
    let own = false;
    let whoTokens = [];
    let who = 'hostile';
    let when = 'attacks';
    let types = [];
    let where = null;
    let source = 'threat';
    let manualRange = 3;
    let los = true;
    let inside = false;
    let picking = false;
    let closed = false;
    let marks = [];

    const { weaponTypeIcon } = await import('../tah/item-helpers.js');
    const weapons = getWeapons(actor);
    const pulseOwner = `${MODULE_ID}:prepare`;
    let weaponId = weapons[0]?.id ?? null;

    const currentRange = () =>
    {
        if (where !== 'range')
            return null;
        if (source === 'weapon')
            return { source, los, weaponId, weaponName: actor.items.get(weaponId)?.name ?? '' };
        return source === 'manual' ? { source, los, value: manualRange } : { source, los };
    };

    const insideShown = () => when === 'moves' && !!where;
    const currentPreset = () => ({ when, types, where, range: currentRange(), ...(insideShown() && inside ? { inside: true } : {}) });

    const insideField = () =>
    {
        const field = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = inside;
        box.dataset.inside = '';
        const text = document.createElement('span');
        text.textContent = localize('LA.prepare.whereInside');
        field.append(box, text);
        return field;
    };

    const insideRow = document.createElement('div');
    insideRow.className = 'la-prep-range-opts la-prep-inside';

    const syncRangePulse = (show) =>
    {
        const range = show ? rangeValue(currentRange(), actor) : 0;

        if (range > 0)
            rangePulse.setRange(pulseOwner, { token, range, includeSelf: true, priority: RANGE_PULSE_PRIORITY.INTERACTIVE, glowColor: RANGE_GLOW[source], los });
        else
            rangePulse.clear(pulseOwner);
    };

    const rangeBlock = document.createElement('div');
    rangeBlock.className = 'la-prep-range';

    const sourceIcon = (icon) =>
    {
        if (!icon.includes('/'))
        {
            const glyph = document.createElement('i');
            glyph.className = icon;
            return glyph;
        }

        const image = document.createElement('img');
        image.src = icon;
        image.width = 20;
        image.height = 20;
        return image;
    };

    const weaponRow = (weapon) =>
    {
        const row = document.createElement('div');
        row.className = `la-choice-item${weapon.id === weaponId ? ' la-pick-row--picked' : ''}`;
        row.dataset.weapon = weapon.id;

        const image = document.createElement('img');
        image.src = weaponTypeIcon(weapon);

        const text = document.createElement('span');
        text.className = 'la-choice-text';

        const name = document.createElement('span');
        name.className = 'la-pick-name';
        name.textContent = weapon.name;

        const chips = document.createElement('span');
        chips.className = 'la-pick-chips';

        for (const chip of weaponRangeChips(weapon, actor))
        {
            const chipEl = document.createElement('span');
            chipEl.className = 'la-pick-chip';
            const glyph = document.createElement('i');
            glyph.className = `cci cci-${chip.type}`;
            chipEl.append(glyph, String(chip.val));
            chips.append(chipEl);
        }

        text.append(name, chips);
        row.append(image, text);
        return row;
    };

    const fillRangeBlock = () =>
    {
        const sources = document.createElement('div');
        sources.className = 'la-prep-types';

        for (const entry of RANGE_SOURCES)
        {
            const off = entry.key === 'weapon' && !weapons.length;
            const option = document.createElement('div');
            option.className = `te-icon-option${entry.key === source ? ' selected' : ''}${off ? ' la-prep-src-off' : ''}`;
            option.dataset.source = entry.key;
            option.title = off ? localize('LA.prepare.range.noWeapon') : localize(`LA.prepare.source.${entry.key}`);
            option.append(sourceIcon(entry.icon));

            if (FIXED_SOURCES.includes(entry.key))
            {
                const value = document.createElement('b');
                value.className = 'la-prep-src-val';
                value.textContent = String(rangeValue({ source: entry.key }, actor));
                option.append(value);
            }

            sources.append(option);
        }

        const label = document.createElement('span');
        label.className = 'la-prep-src-name';
        label.textContent = localize(`LA.prepare.source.${source}`);
        sources.append(label);

        const options = document.createElement('div');
        options.className = 'la-prep-range-opts';

        if (source === 'manual')
        {
            const field = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '1';
            input.max = '99';
            input.value = String(manualRange);
            input.dataset.manual = '';
            field.append(localize('LA.prepare.range.manual'), input);
            options.append(field);
        }

        const losField = document.createElement('label');
        const losBox = document.createElement('input');
        losBox.type = 'checkbox';
        losBox.checked = los;
        losBox.dataset.los = '';
        const losText = document.createElement('span');
        losText.textContent = localize('LA.prepare.range.los');
        losField.append(losBox, losText);
        options.append(losField);
        if (insideShown())
            options.append(insideField());

        const parts = [sources];

        if (source === 'weapon')
        {
            const list = document.createElement('div');
            list.className = 'la-prep-weapons';
            list.append(...weapons.map(weaponRow));
            parts.push(list);
        }

        rangeBlock.replaceChildren(...parts, options);
    };

    const whoStrip = document.createElement('div');
    whoStrip.className = 'la-pick-targets la-prep-who';

    const whoNames = (mark = name => name) => (who === 'token'
        ? whoTokens.map(entry => mark(entry.name)).join(` ${localize('LA.prepare.or')} `)
        : mark(localize(`LA.prepare.who.${who}`)));

    const rowFor = (name, pick, extra = {}) =>
    {
        const off = taken(pick.name);
        return /** @type {any} */ ({ ...extra, name: escapeHtml(name), icon: pick.icon, off, why: off ? localize('LA.prepare.taken') : '', pick });
    };

    const triggerRows = () =>
    {
        /** @type {any[]} */
        const whoRows = [
            { name: localize('LA.prepare.who.tokens'), icon: 'fas fa-crosshairs', picked: who === 'token', who: 'token' },
            ...['hostile', 'ally'].map(key => ({ name: localize(`LA.prepare.who.${key}`), picked: who === key, who: key })),
        ];

        /** @type {any[]} */
        const whereRows = WHERE_KEYS.map(key => ({ name: localize(`LA.prepare.where.${key}.tile`), picked: where === key, where: key }));

        /** @type {any[]} */
        const whenRows = WHEN_PRESETS.map(entry => ({ name: localize(`LA.prepare.when.${entry.key}.tile`), picked: when === entry.key, when: entry.key }));
        whoRows[0].section = localize('LA.prepare.whoHead');
        whereRows[0].section = localize('LA.prepare.whereHead');
        whenRows[0].section = localize('LA.prepare.whenHead');
        return [...whoRows, ...whereRows, ...whenRows];
    };

    const getRows = () =>
    {
        if (chosen)
            return own ? [] : triggerRows();

        const needle = filter.value.trim().toLowerCase();
        const basic = tiles.filter(tile => !needle || tile.label.toLowerCase().includes(needle));
        const found = needle ? held.filter(({ action, sourceItem }) => `${action.name} ${sourceItem?.name ?? ''}`.toLowerCase().includes(needle)) : [];

        const rows = [
            ...basic.map(tile => rowFor(tile.label, tilePick(tile, actor))),
            ...found.map(entry => rowFor(entry.action.name, heldPick(entry), { sub: heldSub(entry) })),
        ];

        if (basic.length)
            rows[0].section = localize('LA.prepare.basic');
        if (found.length)
            rows[basic.length].section = localize('LA.prepare.found');
        if (!rows.length)
            rows.push({ name: localize('LA.prepare.noMatch'), off: true });
        return rows;
    };

    const link = (key, icon, labelKey) => `<span data-head="${key}"><i class="${icon}"></i> ${localize(labelKey)}</span>`;
    const sentence = (links, body) => `<div class="la-prep-sentence"><span class="la-prep-links">${link('action', 'fas fa-rotate-left', 'LA.prepare.changeAction')}${links}</span>${body} <b>${escapeHtml(chosen.name)}</b>.</div>`;

    const getHead = () =>
    {
        if (!chosen)
            return '';
        if (own)
            return `${sentence(link('presets', 'fas fa-list', 'LA.prepare.presets'), `<em>${localize('LA.prepare.then')}</em>`)}<textarea class="la-prep-text" placeholder="${escapeHtml(localize('LA.prepare.triggerPlaceholder'))}"></textarea>`;

        const body = `<em>${localize('LA.prepare.sentenceWhen')}</em> ${whoNames(name => `<b>${escapeHtml(name)}</b>`)} ${eventText(currentPreset(), name => `<b>${escapeHtml(name)}</b>`)}<em>${localize('LA.prepare.sentenceThen')}</em>`;
        return sentence(link('own', 'fas fa-keyboard', 'LA.prepare.writeOwn'), body);
    };

    const textOf = card => String(card.element.find('.la-prep-text').val() ?? '').trim();

    const redraw = (card) =>
    {
        const preset = !!chosen && !own;
        card.refresh();

        const list = card.element.find('[data-role="pick-list"]');
        list.toggleClass('la-pick-list--tiles3', preset);

        const marked = preset && who === 'token' && !picking ? whoTokens : [];
        marks.forEach(mark => mark.destroy());
        marks = marked.map(entry => createTokenMark(entry, TG.placed));

        if (preset && picking)
        {
            const hint = document.createElement('span');
            hint.className = 'la-prep-who-hint';
            hint.textContent = localize('LA.prepare.whoPick');
            whoStrip.replaceChildren(hint);
            list.children('[data-pick-index="2"]').after(whoStrip);
        }
        else if (marked.length)
        {
            whoStrip.replaceChildren(...marked.map((entry) =>
            {
                const chip = document.createElement('div');
                chip.className = 'la-pick-tchip';

                const image = document.createElement('img');
                image.src = entry.document?.texture?.src ?? '';
                image.alt = '';

                const name = document.createElement('b');
                name.textContent = entry.name;

                const remove = document.createElement('span');
                remove.className = 'la-prep-who-x fas fa-times';
                remove.dataset.remove = entry.id;
                remove.title = localize('LA.prepare.whoRemove');
                chip.append(image, name, remove);
                return chip;
            }));

            list.children('[data-pick-index="2"]').after(whoStrip);
        }

        if (preset && where === 'range')
        {
            fillRangeBlock();
            list.children('[data-pick-index="5"]').after(rangeBlock);
        }
        else if (preset && insideShown())
        {
            insideRow.replaceChildren(insideField());
            list.children('[data-pick-index="5"]').after(insideRow);
        }

        syncRangePulse(preset && where === 'range');

        if (!preset || !WHEN_PRESETS.find(entry => entry.key === when)?.damage)
            return;

        for (const option of /** @type {HTMLElement[]} */ ([...typesRow.children]))
            option.classList.toggle('selected', option.dataset.type === 'All' ? !types.length : types.includes(option.dataset.type));
        list.append(typesHead, typesRow);
    };

    const show = (card, pick) =>
    {
        chosen = pick;
        filter.hidden = !!pick;
        redraw(card);
        card.setConfirm(confirmText, !!pick);
        if (pick && own)
            card.element.find('.la-prep-text').val(trigger).trigger('focus');
    };

    const pickWho = card => card.run(async () =>
    {
        const before = who === 'token' ? 'hostile' : who;
        picking = true;
        who = 'token';
        redraw(card);

        whoTokens = await pickTokensCardless(token, { includeSelf: false, preselected: whoTokens.map(entry => entry.id), markColor: TG.placed });
        picking = false;
        if (!whoTokens.length)
            who = before;
        if (!closed)
            redraw(card);
    });

    return startPickCard({
        title: localize('LA.prepare.title'),
        icon: STATUS_ICON,
        origin: token.name,
        originToken: preview ? null : token,
        urgent: preview,
        foot: moved && tiles.some(tile => tile.kind === 'skirmish') ? localize('LA.prepare.movedFoot') : '',
        confirmText,
        tiles: true,
        getHead,
        getRows,
        onHeadClick: (element, card) =>
        {
            if (own)
                trigger = textOf(card);
            if (element.dataset.head !== 'action')
                own = element.dataset.head === 'own';
            show(card, element.dataset.head === 'action' ? null : chosen);
        },
        onPick: (row, card) =>
        {
            if (row.pick)
                return show(card, row.pick);
            if (row.who === 'token')
                return pickWho(card);
            if (row.where)
                where = where === row.where ? null : row.where;

            who = row.who ?? who;
            when = row.when ?? when;
            redraw(card);
        },
        onConfirm: (card) =>
        {
            if (!chosen || picking)
                return;

            const preset = own ? null : { who, whoIds: who === 'token' ? whoTokens.map(entry => entry.id) : [], ...currentPreset() };
            const text = preset ? `${localize('LA.prepare.sentenceWhen')} ${whoNames()} ${eventText(preset)}` : textOf(card);
            card.finish({ ...chosen, trigger: text, ...(preset ? { preset } : {}), ...(moved ? { moved: true } : {}) });
        },
        onReady: (card) =>
        {
            card.element.find('[data-role="pick-head"]').before(filter);
            filter.addEventListener('input', () => redraw(card));

            whoStrip.addEventListener('click', (event) =>
            {
                const id = /** @type {HTMLElement} */ (event.target).closest('[data-remove]')?.getAttribute('data-remove');
                if (!id || picking)
                    return;

                whoTokens = whoTokens.filter(entry => entry.id !== id);
                if (!whoTokens.length)
                    who = 'hostile';
                redraw(card);
            });

            typesRow.addEventListener('click', (event) =>
            {
                const name = /** @type {HTMLElement} */ (event.target).closest('[data-type]')?.getAttribute('data-type');
                if (!name)
                    return;

                types = DAMAGE_TYPES.map(type => type.name).filter(type => name !== 'All' && type !== 'All' && (type === name) !== types.includes(type));
                redraw(card);
            });

            rangeBlock.addEventListener('click', (event) =>
            {
                const target = /** @type {HTMLElement} */ (event.target);
                const option = target.closest('[data-source]');
                const weapon = target.closest('[data-weapon]');

                if (option && !option.classList.contains('la-prep-src-off'))
                    source = option.getAttribute('data-source');
                else if (weapon)
                    weaponId = weapon.getAttribute('data-weapon');
                else
                    return;

                los = source !== 'weapon' || !weaponIgnoresLineOfSight(actor.items.get(weaponId));
                redraw(card);
            });

            const onOptionChange = (event) =>
            {
                const input = /** @type {HTMLInputElement} */ (event.target);

                if (input.matches('[data-los]'))
                    los = input.checked;
                else if (input.matches('[data-inside]'))
                    inside = input.checked;
                else if (input.matches('[data-manual]'))
                    manualRange = Math.min(99, Math.max(1, Math.round(Number(input.value)) || 1));
                else
                    return;

                redraw(card);
            };

            rangeBlock.addEventListener('change', onOptionChange);
            insideRow.addEventListener('change', onOptionChange);

            card.setConfirm(confirmText, false);
            onPreview?.(card);
        },
    }).finally(() =>
    {
        closed = true;
        if (picking)
            cancelCardlessTokenPicker();
        marks.forEach(mark => mark.destroy());
        rangePulse.clear(pulseOwner);
    });
}

function chatDetail(token, prepared)
{
    const trigger = prepared.trigger ? `<span class="la-prep-line">${escapeHtml(prepared.trigger)}</span>` : '';
    const rule = escapeHtml(localizeFormat('LA.prepare.rule', { name: token.name }));
    return `<span class="la-prep-chat"><span class="la-prep-line"><b>${localize('LA.prepare.holding')}</b> ${escapeHtml(prepared.name.toUpperCase())}</span>${trigger}<span class="la-prep-rule">${rule}</span></span>`;
}

async function preparePickStep(state)
{
    if (state.item || flowActionTitle(state) !== 'Prepare' || state.la_extraData?.prepared)
        return true;

    state = injectExtraDataUtility(state);
    const actor = state.actor;

    const token = canvas.tokens.get(state.la_extraData?.sourceTokenId)
        ?? (actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0]);

    if (!token)
        return true;

    const prepared = await pickPrepared(token);
    if (!prepared)
        return false;

    state.data.detail = chatDetail(token, prepared);
    state.injectFlowExtraData({ prepared });
    queueActionFx(() => playPrepareFX(token), token, 'prepare');
    return true;
}

export async function applyPrepared(token, prepared, tapeId = null)
{
    const previous = preparedEffect(token.actor);
    if (previous)
        await deleteDocumentRouted(previous, { laReason: 'replaced' });

    await applyEffectsToTokens({ tokens: [token], effectNames: [STATUS_ID], duration: { label: 'start', turns: 1 }, notify: false }, { prepared });
    await patchTapeEntry(token, tapeId, { effects: [{ targetID: token.id, name: STATUS_ID }] });
}

async function runHeldItem(token, prepared, extra)
{
    const actor = token.actor;

    const entry = getActorActionItems(actor, prepared.activation)
        .find(({ action, sourceItem }) => action.name === prepared.name && (sourceItem?.uuid ?? null) === prepared.itemUuid);

    if (!entry)
    {
        ui.notifications.warn(localizeFormat('LA.prepare.missing', { name: prepared.name }));
        return;
    }

    const { action, sourceItem: item, rankIdx, _coreActive } = /** @type {any} */ (entry);
    await runActorAction(actor, token, action, item, { rankIdx, coreActive: _coreActive, extra, wait: true });
}

async function endPreparing(target)
{
    const effect = preparedEffect(target?.actor ?? target);
    if (effect)
        await deleteDocumentRouted(effect, { laReason: 'used' });
}

export async function usePrepared(token, target = null)
{
    const effect = preparedEffect(token?.actor);
    if (!effect)
        return;

    const prepared = getLAFlags(effect).prepared;
    const extra = { asReaction: true, heldAction: true, sourceTokenId: token.id };

    if (prepared.kind === 'skirmish')
    {
        await executeSkirmish(token, null, target, prepared.moved ? weapon => !isOrdnanceWeapon(weapon) : null, {
            asReaction: true,
            heldAction: true,
            filterReason: weapon => (prepared.moved && isOrdnanceWeapon(weapon) ? localize('LA.prepare.ordnanceReason') : ''),
        });
    }
    else if (prepared.kind === 'invade')
        await executeInvade(token.actor, null, extra);
    else if (prepared.kind === 'reload')
    {
        if (await reloadOneWeapon(token))
            await recordAction(token, { name: 'Reload', activation: 'Reaction', icon: prepared.icon, tracker: await spendReactionForTape(token, { held: true }) });
    }
    else if (prepared.kind === 'item')
        await runHeldItem(token, prepared, extra);
    else
        await executeSimpleActivation(token.actor, { title: prepared.name, action: { name: prepared.name, activation: 'Quick' }, detail: prepared.detail }, extra);
}

function whereMatches(preset, holder, mover, step, api)
{
    const distance = step ? api.getMinGridDistance(mover, holder, { x: step.x, y: step.y, elevation: step.elevation }) : api.getTokenDistance(holder, mover);

    if (preset.where === 'adjacent')
        return distance <= 1;
    if (preset.where === 'range' && distance > rangeValue(preset.range, holder.actor))
        return false;
    if (preset.where === 'range' && preset.range?.los === false)
        return true;
    if (!step)
        return hasLineOfSight(holder, mover);
    if (distance > 1 && blindedVisionEnabled() && holder.actor?.statuses?.has('blinded'))
        return false;

    const cells = api.getOccupiedCenters(mover, { x: step.x, y: step.y });
    const sight = computeSightlineRays(holder, { x: step.cx, y: step.cy, h: getTokenVisionLOS(mover), cells });
    return !!sight && (sight.rays.some(ray => ray.clear) || !!sight.witness);
}

function moveStop(preset, triggerData, holder, api)
{
    const moveInfo = triggerData.moveInfo;
    const path = moveInfo?.pathHexes;

    if (!moveInfo || moveInfo.isInvoluntary || moveInfo.isUndo)
        return -1;
    if (!preset.where)
        return 0;
    if (whereMatches(preset, holder, triggerData.triggeringToken, null, api))
        return preset.inside ? 0 : -1;
    if (!path?.length)
        return -1;

    for (let index = Math.max(1, path.historyStartIndex); index < path.length; index++)
    {
        if (whereMatches(preset, holder, triggerData.triggeringToken, path[index], api))
            return index;
    }

    return -1;
}

function standsAt(mover, position)
{
    const doc = canvas.tokens.get(mover.id)?.document;
    return !!doc && Math.round(doc.x) === Math.round(position.x) && Math.round(doc.y) === Math.round(position.y);
}

async function arrivesAt(mover, position)
{
    for (let attempt = 0; attempt < 600 && canvas.tokens.get(mover.id); attempt++)
    {
        if (standsAt(mover, position))
        {
            await awaitMovementSettled(mover.document);
            return true;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
}

function interceptMove(triggerData, holder, api)
{
    const mover = triggerData.triggeringToken;
    const preset = presetOf(holder.actor);
    const index = preset ? moveStop(preset, triggerData, holder, api) : -1;
    const tokens = { originToken: holder, relatedToken: mover };

    if (index < 0)
        return;

    if (index === 0)
    {
        const start = { x: mover.document.x, y: mover.document.y };

        triggerData.cancelTriggeredMove('', false, null, async () =>
        {
            await askPrepared(triggerData, holder, api);
            return !standsAt(mover, start);
        }, null, tokens);

        return;
    }

    const path = triggerData.moveInfo.pathHexes;
    const position = path.getPathPositionAt(index) ?? path[index];
    const route = triggerData.originalPath ?? [];
    const action = route.find(waypoint => waypoint?.action)?.action;
    const trimmed = trimPathToPosition(mover, route, triggerData.startPos, position, action);
    const tail = trimmed ? route.filter(waypoint => !trimmed.includes(waypoint)) : [{ ...triggerData.endPos, ...(action ? { action } : {}) }];
    const skip = { _cancelledBy: [{ tokenId: holder.id, reactionName: PRESET_REACTION }] };

    triggerData.changeTriggeredMove(position, skip, '', false, null, null, async () =>
    {
        if (!(await arrivesAt(mover, position)))
            return;

        await askPrepared(triggerData, holder, api);
        if (index < path.length - 1 && tail.length && standsAt(mover, position))
            await _rulerMove(mover, tail, { ...skip, isDrag: true, useRuler: true, teleport: !!triggerData.moveInfo.isTeleport });
    }, tokens);
}

function presetMatches(triggerType, triggerData, holder, api)
{
    const preset = holder.actor?.statuses?.has(STATUS_ID) ? presetOf(holder.actor) : null;
    const entry = WHEN_PRESETS.find(candidate => candidate.key === preset?.when);
    const source = triggerData.triggeringToken;
    const flowState = triggerData.flowState;

    if (!entry || !source || !entry.triggers.includes(triggerType))
        return false;
    if (flowState && typeof flowState === 'object' && _asked.get(flowState)?.has(holder.id))
        return false;
    if (preset.who === 'token' ? !preset.whoIds?.includes(source.id) : !(preset.who === 'ally' ? api.isFriendly : api.isHostile)(holder, source))
        return false;
    if (entry.move)
        return moveStop(preset, triggerData, holder, api) >= 0;
    if (triggerType === 'onActivation' && !!entry.reaction !== (triggerData.actionType === 'Reaction' || !!triggerData.extraData?.asReaction))
        return false;
    if (entry.me && ![...(triggerData.targets ?? []), triggerData.target].some(target => target?.id === holder.id))
        return false;
    if (entry.damage && preset.types?.length && !(triggerData.types ?? []).some(type => preset.types.includes(type)))
        return false;
    return !preset.where || whereMatches(preset, holder, source, null, api);
}

async function askPrepared(triggerData, holder, api)
{
    const prepared = getPrepared(holder.actor);
    const source = triggerData.triggeringToken;
    const flowState = triggerData.flowState;

    if (!prepared?.preset)
        return;
    if (flowState && typeof flowState === 'object')
        _asked.set(flowState, (_asked.get(flowState) ?? new Set()).add(holder.id));

    const title = localizeFormat('LA.prepare.askTitle', { name: prepared.name.toUpperCase() });
    const happened = escapeHtml(`${source.name} ${eventText(normalizePreset(prepared.preset))}`);

    const { confirmed } = await api.askCard({
        title,
        description: `${happened}. ${localize('LA.prepare.ask')}`,
        icon: STATUS_ICON,
        originToken: holder,
        relatedToken: source,
        owner: holder,
        yesText: localize('LA.prepare.use'),
        noText: localize('LA.prepare.letPass'),
    });

    if (confirmed)
        await asOwner(holder, { title, relatedToken: source }).usePrepared(holder, source);
}

function onPreparedEnded(effect, options, userId)
{
    if (userId !== game.userId || options?.laReason === 'replaced' || !effect.statuses?.has(STATUS_ID))
        return;

    const prepared = getLAFlags(effect)?.prepared;
    const token = effect.parent?.token?.object ?? effect.parent?.getActiveTokens?.()?.[0];

    if (!prepared || !token)
        return;

    const key = options?.laReason === 'used' ? 'used' : (options?.laReason === 'expired' ? 'lost' : 'dropped');
    notifyEffectLine(token, prepared.name, localize(`LA.prepare.${key}`), STATUS_ICON);
}

export function registerPrepareFlow(flowSteps, flows)
{
    flowSteps.set(`${MODULE_ID}:preparePick`, preparePickStep);
    flows.get('SimpleActivationFlow')?.insertStepBefore('printActionUseCard', `${MODULE_ID}:preparePick`);
    Hooks.on('deleteActiveEffect', onPreparedEnded);
    setHeldReactionHook(endPreparing);

    Hooks.on(`${MODULE_ID}.ready`, (api) =>
    {
        const shared = {
            triggerSelf: false,
            triggerOther: true,
            autoActivate: true,
            isReaction: false,
            checkReaction: false,
            outOfCombat: true,
            evaluate: function (triggerType, triggerData, reactorToken)
            {
                return presetMatches(triggerType, triggerData, reactorToken, api);
            },
            activationType: 'code',
            activationMode: 'instead',
        };

        api.registerDefaultGeneralAutomations({
            [PRESET_REACTION]: {
                category: 'General',
                reactions: [
                    {
                        ...shared,
                        triggers: [...new Set(WHEN_PRESETS.filter(entry => !entry.move).flatMap(entry => entry.triggers))],
                        comments: 'Prepare presets: asks to take the prepared action',
                        activationCode: async function (_triggerType, triggerData, reactorToken, _item, _activationName, api)
                        {
                            await askPrepared(triggerData, reactorToken, api);
                        },
                    },
                    {
                        ...shared,
                        triggers: ['onPreMove'],
                        comments: 'Prepare movement presets: stops the mover, then asks to take the prepared action',
                        requireCanProvoke: true,
                        activationCode: function (_triggerType, triggerData, reactorToken, _item, _activationName, api)
                        {
                            interceptMove(triggerData, reactorToken, api);
                        },
                    },
                ],
            },
        });
    });
}
