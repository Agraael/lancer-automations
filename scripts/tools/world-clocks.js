import { MODULE_ID } from './constants.js';
import { getModuleSetting } from './settings-utils.js';
import { escapeHtml, localize, localizeFormat } from './string-utils.js';
import { hasExecutorGM } from '../utils/lancer-token.js';
import { clampSegments, openCounterDialog } from './pilot-clocks.js';

const SETTING = 'worldClocks';
const SIZE_SETTING = 'clocks.panelSize';
const HIDDEN_SETTING = 'clocks.hiddenForMe';
const WINDOW_SETTING = 'clockWindowEnabled';
const PLAYER_GROUPS_SETTING = 'player-groups.groups';
const TONE_FILL = { progress: '#3a9e6e', threat: '#e8862e', neutral: '#4aa3d8' };

export const WORLD_CLOCK_TONES = Object.keys(TONE_FILL);

let lastLayout = null;
let lastValues = null;

function layoutOf(clocks)
{
    return JSON.stringify(clocks.map(clock => ({ ...clock, value: 0 })));
}

function snapshotValues()
{
    lastValues = new Map(getWorldClocks().map(clock => [clock.lid, clock.value]));
}

function fireValueHooks()
{
    const before = lastValues;
    snapshotValues();
    if (!before)
        return;

    for (const clock of getWorldClocks())
    {
        const from = before.get(clock.lid);
        if (from === undefined || from === clock.value)
            continue;
        Hooks.callAll(`${MODULE_ID}.worldClockChanged`, clock, from);
        if (clock.value >= clock.max && from < clock.max)
            Hooks.callAll(`${MODULE_ID}.worldClockFilled`, clock);
    }
}

Hooks.once('ready', snapshotValues);

export function registerWorldClockSettings()
{
    game.settings.register(MODULE_ID, SETTING, {
        scope: 'world',
        config: false,
        type: Array,
        default: [],
        onChange: (_value, _options, byUser) =>
        {
            const layout = layoutOf(getWorldClocks());
            const layoutChanged = layout !== lastLayout;
            lastLayout = layout;
            Hooks.callAll(`${MODULE_ID}.worldClocksChanged`, { layoutChanged, byUser });
            fireValueHooks();
        },
    });

    const notifyLocal = () => Hooks.callAll(`${MODULE_ID}.worldClocksChanged`, { layoutChanged: false, byUser: game.userId });
    game.settings.register(MODULE_ID, SIZE_SETTING, {
        scope: 'client',
        config: false,
        type: String,
        default: 'rings',
        onChange: notifyLocal,
    });
    game.settings.register(MODULE_ID, HIDDEN_SETTING, {
        scope: 'client',
        config: false,
        type: Array,
        default: [],
        onChange: notifyLocal,
    });
    game.settings.register(MODULE_ID, WINDOW_SETTING, {
        name: 'LA.settings.clockWindowEnabled.name',
        hint: 'LA.settings.clockWindowEnabled.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
        onChange: notifyLocal,
    });

    for (const hookName of ['createSetting', 'updateSetting'])
    {
        Hooks.on(hookName, (setting) =>
        {
            if (setting.key === PLAYER_GROUPS_SETTING)
                Hooks.callAll(`${MODULE_ID}.worldClocksChanged`, { layoutChanged: true });
        });
    }
}

function playerGroups()
{
    if (!game.modules.get('player-groups')?.active)
        return [];
    return Object.values(game.settings.get('player-groups', 'groups') ?? {}).filter(group => group?.id);
}

function audienceOf(clock)
{
    const groups = playerGroups().filter(group => clock.groups?.includes(group.id));
    const members = groups.flatMap(group => group.members ?? []);
    return { groups, memberIds: new Set([...clock.users, ...members]) };
}

export function getWorldClocks()
{
    const clocks = getModuleSetting(SETTING);
    return Array.isArray(clocks) ? clocks : [];
}

export function isClockWindowEnabled()
{
    return getModuleSetting(WINDOW_SETTING);
}

export function getPanelSize()
{
    return getModuleSetting(SIZE_SETTING) === 'open' ? 'open' : 'rings';
}

export function setPanelSize(size)
{
    return game.settings.set(MODULE_ID, SIZE_SETTING, size);
}

export function getHiddenForMe()
{
    const hidden = getModuleSetting(HIDDEN_SETTING);
    return Array.isArray(hidden) ? hidden : [];
}

export function hideWorldClockForMe(lid)
{
    return game.settings.set(MODULE_ID, HIDDEN_SETTING, [...getHiddenForMe(), lid]);
}

export function showHiddenForMe()
{
    return game.settings.set(MODULE_ID, HIDDEN_SETTING, []);
}

export function isWorldClockShownTo(clock, user)
{
    if (clock.visibility === 'all')
        return true;
    if (clock.visibility === 'gm')
        return user.isGM;
    if (clock.visibility === 'users')
        return user.isGM || audienceOf(clock).memberIds.has(user.id);
    return false;
}

function writeClocks(clocks)
{
    return game.settings.set(MODULE_ID, SETTING, clocks);
}

function patchClock(lid, change)
{
    return writeClocks(getWorldClocks().map(clock => (clock.lid === lid ? { ...clock, ...change } : clock)));
}

function audienceOfChoice(choice)
{
    if (choice && typeof choice === 'object')
    {
        const users = choice.users ?? [];
        const groups = choice.groups ?? [];
        return { visibility: users.length || groups.length ? 'users' : 'hidden', users, groups };
    }

    const [kind, id] = String(choice ?? '').split(':');
    if (kind === 'user')
        return { visibility: 'users', users: [id], groups: [] };
    if (kind === 'group')
        return { visibility: 'users', users: [], groups: [id] };
    return { visibility: ['gm', 'all'].includes(kind) ? kind : 'hidden', users: [], groups: [] };
}

function audienceChoiceOf(clock)
{
    if (clock.visibility !== 'users')
        return clock.visibility;

    const users = clock.users ?? [];
    const groups = clock.groups ?? [];

    if (users.length === 1 && !groups.length)
        return `user:${users[0]}`;
    if (groups.length === 1 && !users.length)
        return `group:${groups[0]}`;
    return 'mixed';
}

function audienceOptionsHtml(clock)
{
    const current = clock ? audienceChoiceOf(clock) : null;
    const option = (value, label) => `<option value="${value}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const optionGroup = (labelKey, options) => (options.length ? `<optgroup label="${escapeHtml(localize(labelKey))}">${options.join('')}</optgroup>` : '');
    const mixed = current === 'mixed' ? `<option value="mixed" selected disabled>${escapeHtml(worldClockChip(clock).text)}</option>` : '';
    const fixed = ['hidden', 'gm', 'all'].map(visibility => option(visibility, localize(`LA.clocks.visibility.${visibility}`))).join('');
    const groups = optionGroup('LA.clocks.popup.groups', playerGroups().map(group => option(`group:${group.id}`, group.name)));
    const players = optionGroup('LA.clocks.popup.chosen', game.users.filter(user => !user.isGM).map(user => option(`user:${user.id}`, user.name)));
    return `${mixed}${fixed}${groups}${players}`;
}

function toneOptionsHtml(current)
{
    return WORLD_CLOCK_TONES.map(tone => `<option value="${tone}"${tone === current ? ' selected' : ''}>${localize(`LA.clocks.tone.${tone}`)}</option>`).join('');
}

function newClockLid()
{
    return `la_world_${foundry.utils.randomID(8)}`;
}

export function addWorldClock(name, segments, tone, audienceChoice, lid = newClockLid())
{
    return writeClocks([...getWorldClocks(), {
        lid,
        name: String(name ?? '').trim(),
        min: 0,
        max: clampSegments(segments),
        default_value: 0,
        value: 0,
        tone: WORLD_CLOCK_TONES.includes(tone) ? tone : 'progress',
        ...audienceOfChoice(audienceChoice),
    }]);
}

function chatWhisperFor(clock)
{
    if (clock.visibility === 'all')
        return [];

    const gmIds = game.users.filter(user => user.isGM).map(user => user.id);
    return clock.visibility === 'users' ? [...new Set([...gmIds, ...audienceOf(clock).memberIds])] : gmIds;
}

function postClockFilled(clock)
{
    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ alias: localize('LA.tokenHud.label.environment') }),
        content: localizeFormat('LA.clocks.chatFilled', { name: `<strong>${escapeHtml(clock.name || localize('LA.clocks.unnamed'))}</strong>` }),
        whisper: chatWhisperFor(clock),
    });
}

export function setWorldClockValue(lid, value)
{
    const clock = getWorldClocks().find(entry => entry.lid === lid);
    if (!clock)
        return undefined;

    const next = Math.min(clock.max, Math.max(clock.min, Math.round(Number(value) || 0)));
    if (next >= clock.max && clock.value < clock.max)
        postClockFilled(clock);
    return patchClock(lid, { value: next });
}

export function renameWorldClock(lid, name)
{
    return patchClock(lid, { name: String(name ?? '').trim() });
}

export function setWorldClockTone(lid, tone)
{
    return WORLD_CLOCK_TONES.includes(tone) ? patchClock(lid, { tone }) : undefined;
}

export function setWorldClockVisibility(lid, visibility)
{
    return patchClock(lid, { visibility, users: [], groups: [] });
}

function toggleAudience(lid, field, id)
{
    const clock = getWorldClocks().find(entry => entry.lid === lid);
    if (!clock)
        return undefined;

    const shared = clock.visibility === 'users';
    const audience = { users: shared ? clock.users : [], groups: shared ? clock.groups ?? [] : [] };
    audience[field] = audience[field].includes(id) ? audience[field].filter(entry => entry !== id) : [...audience[field], id];
    const nobody = !audience.users.length && !audience.groups.length;
    return patchClock(lid, { visibility: nobody ? 'gm' : 'users', ...audience });
}

export function removeWorldClock(lid)
{
    return writeClocks(getWorldClocks().filter(clock => clock.lid !== lid));
}

export function worldClockChip(clock)
{
    if (clock.visibility !== 'users')
        return { kind: clock.visibility, text: localize(`LA.clocks.chip.${clock.visibility}`) };

    const { groups, memberIds } = audienceOf(clock);
    const names = [...groups.map(group => group.name), ...clock.users.map(userId => game.users.get(userId)?.name)].filter(Boolean);
    return { kind: 'users', text: names.length === 1 ? names[0] : localizeFormat('LA.clocks.chip.players', { count: memberIds.size }) };
}

export function worldClockFill(clock)
{
    return TONE_FILL[clock?.tone] ?? TONE_FILL.progress;
}

export function worldClockActions(clock)
{
    const lid = clock.lid;
    const live = () => getWorldClocks().find(entry => entry.lid === lid);
    const visibilityIcons = { hidden: 'fas fa-eye-slash', gm: 'fas fa-user-shield', all: 'fas fa-users' };
    const groups = playerGroups();
    return [
        { section: localize('LA.clocks.popup.show') },
        ...Object.keys(visibilityIcons).map(visibility => ({
            label: localize(`LA.clocks.visibility.${visibility}`),
            icon: visibilityIcons[visibility],
            stayOpen: true,
            isActive: () => live()?.visibility === visibility,
            onClick: () => setWorldClockVisibility(lid, visibility),
        })),
        ...(groups.length ? [{ section: localize('LA.clocks.popup.groups') }] : []),
        ...groups.map(group => ({
            label: escapeHtml(group.name),
            icon: 'fas fa-people-group',
            stayOpen: true,
            isActive: () => live()?.visibility === 'users' && !!live().groups?.includes(group.id),
            onClick: () => toggleAudience(lid, 'groups', group.id),
        })),
        { section: localize('LA.clocks.popup.chosen') },
        ...game.users.filter(user => !user.isGM).map(user => ({
            label: escapeHtml(user.name),
            icon: 'fas fa-user',
            stayOpen: true,
            isActive: () => live()?.visibility === 'users' && live().users.includes(user.id),
            onClick: () => toggleAudience(lid, 'users', user.id),
        })),
        { section: localize('LA.clocks.popup.color') },
        ...WORLD_CLOCK_TONES.map(tone => ({
            label: localize(`LA.clocks.tone.${tone}`),
            icon: 'fas fa-circle',
            iconColor: TONE_FILL[tone],
            stayOpen: true,
            isActive: () => live()?.tone === tone,
            onClick: () => setWorldClockTone(lid, tone),
        })),
        { section: localize('LA.clocks.popup.clock') },
        { label: localize('LA.clocks.reset'), icon: 'fas fa-undo', onClick: () => setWorldClockValue(lid, 0) },
        { label: localize('LA.common.remove'), icon: 'fas fa-trash', danger: true, onClick: () => removeWorldClock(lid) },
    ];
}

export function openWorldClocksDialog()
{
    const lidAt = index => getWorldClocks()[index]?.lid;
    const rowSelect = 'height:22px;margin:0;padding:0 2px;font-size:0.76em;';
    openCounterDialog({
        windowTitle: localize('LA.dialogTitle.worldClocks'),
        heading: localize('LA.clocks.tab.clocks'),
        subtitle: localize('LA.tokenHud.label.environment'),
        tabs: [{ kind: 'clocks', label: localize('LA.clocks.tab.clocks'), enabled: true }],
        note: '',
        width: 640,
        addFieldsHtml: `<select id="la-clock-tone" style="flex:0 0 auto;width:auto;">${toneOptionsHtml('progress')}</select><select id="la-clock-audience" style="flex:0 0 130px;width:130px;">${audienceOptionsHtml()}</select>`,
        rowFieldsHtml: clock => `<select class="la-clock-row-field" data-field="tone" style="flex:0 0 76px;width:76px;${rowSelect}">${toneOptionsHtml(clock.tone)}</select><select class="la-clock-row-field" data-field="audience" style="flex:0 0 110px;width:110px;${rowSelect}">${audienceOptionsHtml(clock)}</select>`,
        setRowField: (index, field, value) => (field === 'tone' ? setWorldClockTone(lidAt(index), value) : patchClock(lidAt(index), audienceOfChoice(value))),
        list: () => getWorldClocks(),
        fill: (_kind, clock) => worldClockFill(clock),
        setValue: (_kind, index, value) => setWorldClockValue(lidAt(index), value),
        rename: (_kind, index, name) => renameWorldClock(lidAt(index), name),
        remove: (_kind, index) => removeWorldClock(lidAt(index)),
        add: (_kind, name, segments, tone, audienceChoice) => addWorldClock(name, segments, tone, audienceChoice),
    });
}

const GM_OPS = {
    add: addWorldClock,
    tick: (lid, amount) =>
    {
        const clock = getWorldClocks().find(entry => entry.lid === lid);
        return clock ? setWorldClockValue(lid, clock.value + amount) : undefined;
    },
    setValue: setWorldClockValue,
    setTone: setWorldClockTone,
    setAudience: patchClock,
    remove: removeWorldClock,
};

export function runWorldClockOp(method, args)
{
    return GM_OPS[method]?.(...args);
}

async function routeOp(method, ...args)
{
    if (game.user.isGM || !hasExecutorGM())
        return runWorldClockOp(method, args);

    const { socketRequestWithAck } = await import('../socket.js');
    return socketRequestWithAck('worldClockOp', { method, args });
}

function findWorldClock(lidOrName)
{
    const clocks = getWorldClocks();
    return clocks.find(clock => clock.lid === lidOrName) ?? clocks.find(clock => clock.name === lidOrName) ?? null;
}

function routeOpOnClock(method, lidOrName, ...args)
{
    const clock = findWorldClock(lidOrName);
    if (clock)
        return routeOp(method, clock.lid, ...args);
    console.warn(`lancer-automations | No world clock named or identified "${lidOrName}".`);
    return Promise.resolve();
}

export const WorldClocksAPI = {
    getWorldClocks,
    getWorldClock: findWorldClock,
    createWorldClock: async (name, { segments, tone, visibility } = {}) =>
    {
        const lid = newClockLid();
        await routeOp('add', name, segments, tone, visibility, lid);
        return lid;
    },
    tickWorldClock: (lidOrName, amount = 1) => routeOpOnClock('tick', lidOrName, amount),
    setWorldClockValue: (lidOrName, value) => routeOpOnClock('setValue', lidOrName, value),
    setWorldClockTone: (lidOrName, tone) => routeOpOnClock('setTone', lidOrName, tone),
    setWorldClockVisibility: (lidOrName, visibility) => routeOpOnClock('setAudience', lidOrName, audienceOfChoice(visibility)),
    removeWorldClock: lidOrName => routeOpOnClock('remove', lidOrName),
};
