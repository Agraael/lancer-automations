/* global console, JournalEntry, ChatMessage, Folder, Dialog, game, ui, CONST, fromUuidSync, fromUuid, renderTemplate, Hooks, $ */

import * as actionFX from '../fx/actionFX.js';
import { getStatIcon, getTierIcon } from './scan-icons.js';

const TPL = {
    overview:  'modules/lancer-automations/templates/scan-overview.html',
    chat:      'modules/lancer-automations/templates/scan-chat.html',
    chooser:   'modules/lancer-automations/templates/scan-chooser.html',
    sysOpts:   'modules/lancer-automations/templates/scan-system-options.html',
    gmInput:   'modules/lancer-automations/templates/scan-gm-input.html',
    generate:  'modules/lancer-automations/templates/scan-generate.html',
};

const SECTION_COLORS = {
    weapon:   '#b71c1c',
    system:   '#1a5c3a',
    tech:     '#0d6e6e',
    trait:    '#1565c0',
    template: '#105a5a',
    core:     '#7a2070',
    feature:  '#1a5c3a',
    range:    '#1565c0',
    damage:   '#b71c1c',
    onHit:    '#6a1b9a',
    effect:   '#e65100',
    trigger:  '#3a105c',
};

const FOLDER_NAME = 'SCAN Database';
const NAME_PREFIX = 'SCAN: ';
const NUMBER_PADDING = 3;

function _fmtTags(tags) {
    if (!tags?.length)
        return [];
    return tags.map((tag) => {
        const baseName = tag.name ?? tag.lid?.replace(/^tg_/, '') ?? '';
        const name = tag.val !== undefined && tag.val !== null && String(tag.val).length
            ? baseName.replace('{VAL}', tag.val)
            : baseName;
        if (!name)
            return null;
        const rawDesc = String(tag.description ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const description = rawDesc.replace('{VAL}', tag.val ?? '');
        return { name, description, lid: tag.lid ?? '' };
    }).filter(Boolean);
}

function _fmtRanges(ranges) {
    if (!ranges?.length)
        return [];
    return ranges.map((range) => ({ type: range.type, val: range.val }));
}

function _fmtDamages(damages) {
    if (!damages?.length)
        return [];
    return damages.map((damage) => ({ type: damage.type, val: damage.val }));
}

function _formatActions(actions) {
    if (!actions?.length)
        return [];
    return actions.map((action) => ({
        name: action.name,
        activation: action.activation,
        trigger: action.trigger,
        detail: action.detail,
    }));
}

function _buildMechWeapon(slot) {
    const weaponData = slot.weapon?.value;
    if (!weaponData)
        return null;
    const profile = weaponData.system.profiles?.[weaponData.system.selected_profile_index || 0];
    if (!profile)
        return null;
    const w = {
        name: weaponData.name,
        subtitle: [weaponData.system.size, profile.type].filter(Boolean).join(' · '),
        ranges: _fmtRanges(profile.range),
        damages: _fmtDamages(profile.damage),
        tags: _fmtTags(profile.tags),
        onHit: profile.on_hit || '',
        effect: profile.effect || '',
        trigger: '',
        unloaded: weaponData.system.tags?.some((t) => t.is_loading) && !weaponData.system.loaded,
        uses: weaponData.system.uses?.max > 0 ? `${weaponData.system.uses.value}/${weaponData.system.uses.max}` : null,
    };
    if (slot.mod?.value) {
        const m = slot.mod.value;
        w.mod = {
            name: m.name,
            effect: m.system.effect || '',
            addedTags: _fmtTags(m.system.added_tags),
            actions: _formatActions(m.system.actions),
        };
    }
    return w;
}

function _buildMechSystem(sysObj) {
    const sysData = sysObj.value;
    if (!sysData)
        return null;
    return {
        name: sysData.name,
        subtitle: [sysData.system.type, sysData.system.sp ? `${sysData.system.sp} SP` : null].filter(Boolean).join(' · '),
        effect: sysData.system.effect || '',
        actions: _formatActions(sysData.system.actions),
        tags: _fmtTags(sysData.system.tags),
        isTech: sysData.system.type === 'Tech',
    };
}

function _buildMechTrait(trait) {
    return {
        name: trait.name,
        description: trait.description || '',
        actions: _formatActions(trait.actions),
    };
}

function _buildCoreBonus(cb) {
    return {
        name: cb.name,
        effect: cb.system.effect || '',
        description: cb.system.description || '',
    };
}

function _buildCorePower(frame) {
    const cs = frame?.system?.core_system;
    if (!cs)
        return null;
    return {
        name: cs.name || 'Core Power',
        passiveName: cs.passive_name || '',
        passiveEffect: cs.passive_effect || '',
        activeName: cs.active_name || '',
        activeEffect: cs.active_effect || '',
        activation: cs.activation || '',
        description: cs.description || '',
        tags: _fmtTags(cs.tags),
        actions: _formatActions(cs.active_actions ?? cs.actions ?? []),
    };
}

function _buildTalent(t) {
    const sys = t.system ?? {};
    const currRank = sys.curr_rank ?? 0;
    const ranks = (sys.ranks ?? []).map((r, i) => ({
        index: i + 1,
        name: r?.name || '',
        description: r?.description || '',
        actions: _formatActions(r?.actions ?? []),
        acquired: i < currRank,
    }));
    return {
        name: t.name,
        currRank,
        ranks,
    };
}

function _buildNpcFeature(item, tier) {
    const isExoticUnknown = item.system.origin?.name === 'EXOTIC' && !item.system.origin.base;
    if (isExoticUnknown) {
        return { isExoticUnknown: true, name: 'UNKNOWN EXOTIC SYSTEM', description: '???' };
    }
    let desc = item.system.effect || 'No description given.';
    if (item.system.trigger)
        desc = `<strong>Trigger:</strong> ${item.system.trigger}<br>${desc}`;
    return {
        isExoticUnknown: false,
        name: item.name,
        description: desc,
        tags: _fmtTags(item.system.tags),
    };
}

function _buildNpcWeapon(item, tier) {
    const isExoticUnknown = item.system.origin?.name === 'EXOTIC' && !item.system.origin.base;
    if (isExoticUnknown) {
        return { isExoticUnknown: true, name: 'UNKNOWN EXOTIC WEAPON' };
    }
    const tIdx = (tier || 1) - 1;
    const attackBonus = item.system.attack_bonus?.[tIdx];
    const acc = item.system.accuracy?.[tIdx];
    return {
        isExoticUnknown: false,
        name: item.name,
        attackBonus: attackBonus !== undefined ? `+${attackBonus}` : '',
        accuracyText: acc ? `${acc > 0 ? '+' : ''}${acc} ${acc > 0 ? 'ACC' : 'DIFF'}` : '',
        ranges: _fmtRanges(item.system.range),
        damages: _fmtDamages(item.system.damage?.[tIdx]),
        tags: _fmtTags(item.system.tags),
        unloaded: item.system.tags?.some((t) => t.is_loading) && !item.system.loaded,
        uses: item.system.uses?.max > 0 ? `${item.system.uses.value}/${item.system.uses.max}` : null,
        trigger: item.system.trigger || '',
        onHit: item.system.on_hit || '',
        effect: item.system.effect || '',
    };
}

function _zeroPad(n, places) {
    return String(n).padStart(places, '0');
}

function _scanningUserFromToken(token) {
    const actor = token?.actor;
    if (!actor) return null;
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const ownership = actor.ownership ?? {};
    const candidates = Object.entries(ownership)
        .filter(([uid, lvl]) => uid !== 'default' && Number(lvl) >= OWNER)
        .map(([uid]) => game.users.get(uid))
        .filter((user) => user && !user.isGM);
    if (!candidates.length) return null;
    return candidates.find((user) => user.active) ?? candidates[0];
}

function _defaultOwnershipForScan(user = game.user, scanningToken = null) {
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    // GM with a player-owned token controlled: treat that player as the scanner
    if (user?.isGM && scanningToken) {
        const tokenOwner = _scanningUserFromToken(scanningToken);
        if (tokenOwner) {
            user = tokenOwner;
        }
    }
    if (user?.isGM) {
        return { default: OWNER };
    }
    let mode;
    try {
        mode = game.settings.get('lancer-automations', 'scanPlayerOwnershipMode') || 'all';
    } catch {
        mode = 'all';
    }
    if (mode === 'all') {
        return { default: OWNER };
    }
    if (mode === 'group' && game.modules.get('player-groups')?.active) {
        const ownership = { default: NONE };
        const groups = game.settings.get('player-groups', 'groups') ?? {};
        for (const group of Object.values(groups)) {
            if (!Array.isArray(group?.members) || !group.members.includes(user?.id)) {
                continue;
            }
            for (const uid of group.members) {
                ownership[uid] = OWNER;
            }
        }
        if (user?.id) {
            ownership[user.id] = OWNER;
        }
        return ownership;
    }
    const ownership = { default: NONE };
    if (user?.id) {
        ownership[user.id] = OWNER;
    }
    return ownership;
}

function _ownershipSummary(ownership) {
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    if (!ownership) {
        return 'No ownership set.';
    }
    if (ownership.default === OWNER) {
        return 'Owner: all players';
    }
    const ownerIds = Object.entries(ownership)
        .filter(([uid, lvl]) => uid !== 'default' && lvl === OWNER)
        .map(([uid]) => uid);
    if (!ownerIds.length) {
        return 'Owner: nobody (GM only)';
    }
    const names = ownerIds
        .map((id) => game.users.get(id)?.name)
        .filter(Boolean);
    if (!names.length) {
        return 'Owner: (unknown)';
    }
    if (names.length === 1) {
        return `Owner: ${names[0]}`;
    }
    return `Owner: ${names.length} players (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})`;
}

function _getOwnerRows() {
    const rows = [
        { kind: 'all', id: 'default', key: 'default', name: 'All Players', isAll: true },
    ];
    if (game.modules.get('player-groups')?.active) {
        const groups = game.settings.get('player-groups', 'groups') ?? {};
        for (const group of Object.values(groups)) {
            if (group?.id)
                rows.push({ kind: 'group', id: group.id, key: `g-${group.id}`, name: group.name || 'Unnamed Group', isGroup: true });
        }
    }
    for (const user of game.users.filter((u) => !u.isGM))
        rows.push({ kind: 'user', id: user.id, key: `u-${user.id}`, name: user.name });
    return rows;
}

function _buildOwnershipFromForm(html) {
    const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
    const groupPicks = [];
    const userPicks = {};
    html.find('.la-scan-owner-select').each(function () {
        const raw = String(this.value ?? '');
        if (raw === '')
            return;
        const lvl = Number(raw);
        const kind = this.dataset.kind;
        const id = this.dataset.id;
        if (kind === 'all')
            ownership.default = lvl;
        else if (kind === 'group')
            groupPicks.push({ id, lvl });
        else if (kind === 'user')
            userPicks[id] = lvl;
    });
    if (groupPicks.length) {
        const groups = game.settings.get('player-groups', 'groups') ?? {};
        for (const { id, lvl } of groupPicks) {
            for (const uid of groups[id]?.members ?? []) {
                if (userPicks[uid] === undefined)
                    ownership[uid] = lvl;
            }
        }
    }
    for (const [uid, lvl] of Object.entries(userPicks))
        ownership[uid] = lvl;
    return ownership;
}

function _getAllJournalsInFolder(folder) {
    let journals = [...folder.contents];
    const subfolders = game.folders.filter((f) => f.type === 'JournalEntry' && f.folder?.id === folder.id);
    for (const sub of subfolders)
        journals = journals.concat(_getAllJournalsInFolder(sub));
    return journals;
}

/** @param {Token|TokenDocument} target @param {string} customName @param {string} scanIndex */
function _buildScanData(target, customName = '', scanIndex = '') {
    const actor = target.actor ?? target.document?.actor;
    const items = actor.items;
    const isMech = actor.type === 'mech' && actor.system.loadout;
    const isNpc = actor.type === 'npc';

    const data = {
        name: customName?.trim() || actor.name,
        img: actor.img,
        actorType: actor.type,
        isMech,
        isNpc,
        scanIndex,
        scanTimestamp: new Date().toLocaleString(),
        scanner: game.user.name,
        section: SECTION_COLORS,
    };

    let classOrFrame = '';
    let levelOrTier = '';

    if (isMech) {
        const frameData = actor.system.loadout?.frame?.value;
        classOrFrame = frameData?.name ?? 'UNKNOWN FRAME';
        let pilotActor = null;
        if (actor.system.pilot?.id)
            pilotActor = /** @type {any} */ (fromUuidSync(actor.system.pilot.id));
        levelOrTier = pilotActor ? `LL${pilotActor.system.level || 0}` : 'LL?';

        data.coreBonuses = [];
        data.talents = [];
        if (pilotActor?.items) {
            for (const cb of pilotActor.items.filter((item) => item.type === 'core_bonus'))
                data.coreBonuses.push(_buildCoreBonus(cb));
            for (const talent of pilotActor.items.filter((item) => item.type === 'talent'))
                data.talents.push(_buildTalent(talent));
        }

        data.corePower = _buildCorePower(frameData);
        data.traits = (frameData?.system?.traits ?? []).map(_buildMechTrait);

        data.weapons = [];
        for (const mount of actor.system.loadout.weapon_mounts ?? []) {
            for (const slot of mount.slots ?? []) {
                const builtWeapon = _buildMechWeapon(slot);
                if (builtWeapon)
                    data.weapons.push(builtWeapon);
            }
        }

        const allSystems = [];
        for (const sysSlot of actor.system.loadout.systems ?? []) {
            const sys = _buildMechSystem(sysSlot);
            if (sys)
                allSystems.push(sys);
        }
        data.systems = allSystems.filter((entry) => !entry.isTech);
        data.techSystems = allSystems.filter((entry) => entry.isTech);

        data.templates = [];
        data.npcFeatureGroups = [];
    } else if (isNpc) {
        const classes = items.filter((item) => item.is_npc_class());
        classOrFrame = classes.length ? classes[0].name : 'UNKNOWN';
        levelOrTier = `Tier ${actor.system.tier ?? '?'}`;
        data.tierIcon = getTierIcon(actor.system.tier);

        const classItems = items.filter((item) => item.is_npc_class());
        const templateItems = items.filter((item) => item.is_npc_template());
        data.npcClasses = classItems.map((cls) => ({ name: cls.name, img: cls.img }));
        data.npcTemplates = templateItems.map((tpl) => ({ name: tpl.name, img: tpl.img }));
        data.templates = data.npcTemplates;

        const features = items.filter((item) => item.is_npc_feature());
        const tier = actor.system.tier;
        const origins = [];
        for (const feature of features) {
            const originName = feature.system.origin?.name;
            if (originName && !origins.includes(originName))
                origins.push(originName);
        }
        data.npcFeatureGroups = origins.map((origin) => {
            const inOrigin = features.filter((feature) => feature.system.origin?.name === origin);
            return {
                origin,
                weapons: inOrigin.filter((feature) => feature.system.type === 'Weapon').map((feature) => _buildNpcWeapon(feature, tier)),
                tech: inOrigin.filter((feature) => feature.system.type === 'Tech').map((feature) => _buildNpcFeature(feature, tier)),
                features: inOrigin.filter((feature) => feature.system.type !== 'Weapon' && feature.system.type !== 'Tech').map((feature) => _buildNpcFeature(feature, tier)),
            };
        });

        // flat lists grouped by item kind (weapons, systems, traits), each item tagged with origin
        const _withOrigin = (feature, builder) => ({ ...builder(feature, tier), origin: feature.system.origin?.name ?? '' });
        data.npcWeaponsFlat = features
            .filter((feature) => feature.system.type === 'Weapon')
            .map((feature) => _withOrigin(feature, _buildNpcWeapon));
        data.npcSystemsFlat = features
            .filter((feature) => feature.system.type !== 'Weapon' && feature.system.type !== 'Trait')
            .map((feature) => _withOrigin(feature, _buildNpcFeature));
        data.npcTraitsFlat = features
            .filter((feature) => feature.system.type === 'Trait')
            .map((feature) => _withOrigin(feature, _buildNpcFeature));

        data.weapons = [];
        data.systems = [];
        data.techSystems = [];
        data.traits = [];
        data.coreBonuses = [];
    }

    data.classOrFrame = classOrFrame;
    data.levelOrTier = levelOrTier;
    data.subtitle = `${classOrFrame}${levelOrTier ? ` · ${levelOrTier}` : ''}${scanIndex ? ` · SCAN ${scanIndex}` : ''}`;

    data.hase = {
        hull: actor.system.hull || 0,
        agi:  actor.system.agi  || 0,
        sys:  actor.system.sys  || 0,
        eng:  actor.system.eng  || 0,
    };
    data.haseList = [
        { label: 'Hull', value: data.hase.hull, icon: getStatIcon('Hull') },
        { label: 'Agi',  value: data.hase.agi,  icon: getStatIcon('Agi')  },
        { label: 'Sys',  value: data.hase.sys,  icon: getStatIcon('Sys')  },
        { label: 'Eng',  value: data.hase.eng,  icon: getStatIcon('Eng')  },
    ];

    /** @param {string} label @param {any} value @param {{max?: number, isHeat?: boolean}} [opts] */
    const cell = (label, value, opts = {}) => ({
        label,
        value: value ?? 0,
        max: opts.max,
        hasBar: opts.max !== undefined,
        isHeat: !!opts.isHeat,
        pct: opts.max ? Math.max(0, Math.min(100, ((Number(value) || 0) / opts.max) * 100)) : 0,
        icon: getStatIcon(label),
    });
    // Lancer caps live on either .max or .value; take the larger.
    const cap = (f) => Math.max(Number(f?.max) || 0, Number(f?.value) || 0);
    data.journalStats = [
        cell('HP', cap(actor.system.hp)),
        cell('Structure', cap(actor.system.structure)),
        cell('Armor', actor.system.armor),
        cell('Evasion', actor.system.evasion),
        cell('Heat Cap', cap(actor.system.heat)),
        cell('Stress', cap(actor.system.stress)),
        cell('E-Def', actor.system.edef),
        cell('Sensors', actor.system.sensor_range || 10),
        cell('Speed', actor.system.speed),
        cell('Save', actor.system.save),
        cell('Size', actor.system.size),
        cell('Activations', actor.system.activations || 1),
    ];

    data.chatStats = [
        cell('HP', actor.system.hp?.value, { max: cap(actor.system.hp) }),
        cell('Heat', actor.system.heat?.value, { max: cap(actor.system.heat), isHeat: true }),
        cell('Armor', actor.system.armor),
        cell('Speed', actor.system.speed),
        cell('E-Def', actor.system.edef),
    ];
    data.chatStats2 = [
        cell('Structure', actor.system.structure?.value, { max: cap(actor.system.structure) }),
        cell('Stress', actor.system.stress?.value, { max: cap(actor.system.stress) }),
    ];

    return data;
}

// Delegate to v3's ScanFlow so the system's own scan entry points route through LA's overridden steps.
export async function performSystemScan(target, createJournal = false, customName = '', ownership = null) {
    const actor = target.actor;
    if (!actor)
        return;
    const Flow = /** @type {any} */ (game).lancer?.flows?.get('ScanFlow');
    if (!Flow) {
        ui.notifications.error('lancer-automations: ScanFlow not registered.');
        return;
    }
    const flow = new Flow(actor.uuid, { target });
    flow.state.data.la_customName = customName;
    flow.state.data.la_ownership = ownership;
    flow.state.data.la_chatCard = true;
    flow.state.data.la_createJournal = !!createJournal;
    flow.state.data.la_useCustomJournal = _useLAJournal();
    await flow.begin();
}

/** @param {Token|TokenDocument} target @param {string} customName @param {object|null} ownership */
export async function createScanJournalEntry(target, customName = '', ownership = null) {
    if (!JournalEntry.canUserCreate(game.user)) {
        ui.notifications.error(`${game.user.name} attempted to run SCAN to Journal but lacks proper permissions. Please correct and try again.`);
        return null;
    }
    const actor = target.actor;
    if (!actor)
        return null;
    const Flow = /** @type {any} */ (game).lancer?.flows?.get('ScanFlow');
    if (!Flow) {
        ui.notifications.error('lancer-automations: ScanFlow not registered.');
        return null;
    }
    const flow = new Flow(actor.uuid, { target });
    flow.state.data.la_customName = customName;
    flow.state.data.la_ownership = ownership;
    flow.state.data.la_chatCard = false;
    flow.state.data.la_createJournal = true;
    flow.state.data.la_useCustomJournal = _useLAJournal();
    await flow.begin();

    // LA-mode stashes the index/uuid directly on state from _createLAJournalEntry
    if (flow.state.data.la_useCustomJournal && flow.state.data.la_journalUuid) {
        return { scanIndex: flow.state.data.la_scanIndex || '', uuid: flow.state.data.la_journalUuid };
    }
    const folder = game.folders.getName(FOLDER_NAME);
    if (!folder)
        return null;
    const matching = folder.contents.filter((entry) => entry.name.includes(actor.name) && entry.name.startsWith(NAME_PREFIX));
    if (!matching.length)
        return null;
    const entry = matching.sort((a, b) => (b._stats?.modifiedTime ?? 0) - (a._stats?.modifiedTime ?? 0))[0];
    const m = entry.name.match(/SCAN:\s*(\d+)/i);
    return { scanIndex: m ? m[1] : '', uuid: entry.uuid };
}

async function laPrintScanCard(state) {
    // Per-flow flag wins; fall back to the system's scanOutputs setting.
    const allowChat = state.data?.la_chatCard ?? null;
    if (allowChat === false)
        return true;
    if (allowChat === null) {
        const scanOutputs = game.settings.get(game.system.id, 'scanOutputs');
        if (!['both', 'chat'].includes(scanOutputs))
            return true;
    }
    if (!state.data?.target)
        throw new TypeError('Scan flow requires a target.');

    const customName = state.data.la_customName || '';
    const data = _buildScanData(state.data.target, customName);
    data.journalUuid = null;

    const content = await renderTemplate(TPL.chat, data);
    await ChatMessage.create({
        author: game.user.id,
        content,
        flags: { core: { canPopout: true } },
    });
    return true;
}

async function laPostProcessScanJournal(state) {
    const allowJournal = state.data?.la_createJournal ?? null;
    if (allowJournal === false)
        return true;
    // LA-mode already wrote the page in _createLAJournalEntry; skip post-process
    if (state.data?.la_useCustomJournal)
        return true;
    if (allowJournal === null) {
        const scanOutputs = game.settings.get(game.system.id, 'scanOutputs');
        if (!['both', 'journal'].includes(scanOutputs))
            return true;
    }
    if (!state.data?.target)
        return true;
    const actor = state.data.target.actor;
    if (!actor)
        return true;

    const folder = game.folders.getName(FOLDER_NAME);
    if (!folder)
        return true;
    const matching = folder.contents.filter((entry) => entry.name.includes(actor.name) && entry.name.startsWith(NAME_PREFIX));
    if (!matching.length)
        return true;
    const entry = matching.sort((a, b) => (b._stats?.modifiedTime ?? 0) - (a._stats?.modifiedTime ?? 0))[0];

    const m = entry.name.match(/SCAN:\s*(\d+)/i);
    const scanIndex = m ? m[1] : '';
    const customName = state.data.la_customName || '';
    const data = _buildScanData(state.data.target, customName, scanIndex);
    const html = await renderTemplate(TPL.overview, data);

    const page = entry.pages.contents[0];
    if (page)
        await page.update({ text: { content: html } });
    const finalOwnership = state.data.la_ownership ?? _defaultOwnershipForScan(game.user);
    await entry.update({
        ownership: finalOwnership,
        'flags.lancer-automations.scan': {
            actorUuid: actor.uuid,
            actorName: actor.name,
            actorImg: actor.img,
            scanIndex,
            scannedAt: Date.now(),
        },
    });
    return true;
}

async function _createLAJournalEntry(target, customName = '', ownership = null) {
    if (!JournalEntry.canUserCreate(game.user)) {
        ui.notifications.error(`${game.user.name} attempted to run SCAN to Journal but lacks proper permissions. Please correct and try again.`);
        return null;
    }
    let folder = game.folders.getName(FOLDER_NAME);
    if (!folder) {
        try {
            folder = await Folder.create({ name: FOLDER_NAME, type: 'JournalEntry' });
        } catch {
            ui.notifications.error(`${FOLDER_NAME} does not exist and must be created manually.`);
            return null;
        }
    }
    const allJournals = _getAllJournalsInFolder(folder);
    const actor = target.actor;
    const matching = allJournals.filter((e) => e.name.includes(actor.name));

    let scanIndex;
    let entry;
    let entryName;
    if (matching.length === 1) {
        entry = matching[0];
        entryName = entry.name;
        const m = entryName.match(/SCAN:\s*(\d+)/i);
        scanIndex = m ? m[1] : _zeroPad(allJournals.filter((e) => e.name.startsWith(NAME_PREFIX)).length + 1, NUMBER_PADDING);
    } else {
        const count = allJournals.filter((e) => e.name.startsWith(NAME_PREFIX)).length + 1;
        scanIndex = _zeroPad(count, NUMBER_PADDING);
        const labelName = customName?.trim()?.length ? customName.trim() : actor.name;
        entryName = `${NAME_PREFIX}${scanIndex} - ${labelName}`;
    }

    const data = _buildScanData(target, customName, scanIndex);
    const html = await renderTemplate(TPL.overview, data);

    if (matching.length === 1) {
        const pages = entry.pages.contents;
        if (pages.length === 0) {
            await entry.createEmbeddedDocuments('JournalEntryPage', [{ name: entryName, type: 'text', text: { content: html }, sort: 0 }]);
        } else {
            await pages[0].update({ name: entryName, text: { content: html } });
            if (pages.length > 1)
                await entry.deleteEmbeddedDocuments('JournalEntryPage', pages.slice(1).map((p) => p.id));
        }
    } else {
        entry = await JournalEntry.create({ folder: folder.id, name: entryName });
        await entry.createEmbeddedDocuments('JournalEntryPage', [
            { name: entryName, type: 'text', text: { content: html }, sort: 0 },
        ]);
    }

    const finalOwnership = ownership ?? _defaultOwnershipForScan(game.user);
    await entry.update({
        ownership: finalOwnership,
        'flags.lancer-automations.scan': {
            actorUuid: actor.uuid,
            actorName: actor.name,
            actorImg: actor.img,
            scanIndex,
            scannedAt: Date.now(),
        },
    });
    return { scanIndex, uuid: entry.uuid };
}

function _useLAJournal() {
    try {
        return game.settings.get('lancer-automations', 'scanJournalSource') === 'lancer-automations';
    } catch {
        return false;
    }
}

function _wrapPrintScanCard(flowSteps) {
    const original = flowSteps.get('printScanCard');
    if (!original || original.__laWrapped)
        return;
    const wrapped = async function laPrintScanCardGate(state) {
        if (state.data?.la_chatCard === false)
            return true;
        const useLA = state.data?.la_useCustomJournal ?? _useLAJournal();
        if (useLA) {
            return laPrintScanCard(state);
        }
        return original(state);
    };
    wrapped.__laWrapped = true;
    flowSteps.set('printScanCard', wrapped);
}

function _wrapCreateScanJournal(flowSteps) {
    const original = flowSteps.get('createScanJournal');
    if (!original || original.__laWrapped)
        return;
    const wrapped = async function laCreateScanJournalGate(state) {
        if (state.data?.la_createJournal === false)
            return true;
        // system-triggered scans don't set la_useCustomJournal, so fall back to the setting
        const useCustom = state.data?.la_useCustomJournal ?? _useLAJournal();
        if (useCustom) {
            const target = state.data?.target;
            if (target) {
                const result = await _createLAJournalEntry(target, state.data?.la_customName || '', state.data?.la_ownership ?? null);
                if (result) {
                    state.data.la_useCustomJournal = true;
                    state.data.la_scanIndex = result.scanIndex;
                    state.data.la_journalUuid = result.uuid;
                }
            }
            return true;
        }
        return original(state);
    };
    wrapped.__laWrapped = true;
    flowSteps.set('createScanJournal', wrapped);
}

export function registerScanFlowSteps(flowSteps, flows) {
    _wrapPrintScanCard(flowSteps);
    _wrapCreateScanJournal(flowSteps);
    flowSteps.set('lancer-automations:postProcessScanJournal', laPostProcessScanJournal);
    flows.get('ScanFlow')?.insertStepAfter('createScanJournal', 'lancer-automations:postProcessScanJournal');
}

export async function performGMInputScan(targets, scanTitle, requestingUserName = null) {
    const targetArray = Array.isArray(targets) ? targets : [targets];
    const targetNames = targetArray.map((t) => t.name).join(', ');

    const content = await renderTemplate(TPL.gmInput, {
        scanTitle,
        targetNames,
        targetCount: targetArray.length,
        requestingUserName,
        isHidden: scanTitle === 'Hidden Information',
    });

    new Dialog({
        title: `${scanTitle} - ${targetNames}`,
        content,
        buttons: {
            submit: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Send to Chat',
                callback: async (html) => {
                    const info = String(html.find('[name="scan-info"]').val()).trim();
                    const chat = await renderTemplate(TPL.chat, {
                        name: targetNames,
                        subtitle: scanTitle,
                        gmInputBody: info || null,
                        isGmInput: true,
                        section: SECTION_COLORS,
                    });
                    ChatMessage.create({
                        author: game.user.id,
                        content: chat,
                        whisper: game.user.isGM ? [] : [game.user.id],
                        flags: { core: { canPopout: true } },
                    });
                },
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'submit',
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 520 }).render(true);
}

export async function showSystemScanDialog(targets) {
    const targetArray = Array.isArray(targets) ? targets : [targets];

    if (!game.user.isGM) {
        for (const target of targetArray) {
            game.socket.emit('module.lancer-automations', {
                action: 'scanSystemOptionsRequest',
                payload: {
                    targetId: target.id,
                    targetName: target.name,
                    requestingUserId: game.user.id,
                    requestingUserName: game.user.name,
                },
            });
        }
        ui.notifications.info(`Scan request sent to GM for ${targetArray.length} target${targetArray.length > 1 ? 's' : ''}.`);
        return;
    }

    const targetNames = targetArray.map((t) => t.name).join(', ');

    const defaultOwnership = _defaultOwnershipForScan(game.user, canvas.tokens?.controlled?.[0]);

    const content = await renderTemplate(TPL.sysOpts, {
        targetNames,
        targetCount: targetArray.length,
        isMulti: targetArray.length > 1,
        ownerRows: _getOwnerRows(),
        defaultOwnershipSummary: _ownershipSummary(defaultOwnership),
    });

    const dlg = new Dialog({
        title: 'System Scan Options',
        content,
        buttons: {
            scan: {
                icon: '<i class="fas fa-radar"></i>',
                label: 'Execute Scan',
                callback: async (html) => {
                    const $card = html.find('.lancer-toggle-card');
                    const createJournal = $card.data('create-journal') === true;
                    const customName = String(html.find('[name="custom-journal-name"]').val()).trim();
                    const useCustom = html.find('.la-scan-owner-grid-wrap').is(':visible');
                    const ownership = useCustom ? _buildOwnershipFromForm(html) : defaultOwnership;

                    if (createJournal && !game.user.isGM) {
                        for (const target of targetArray) {
                            game.socket.emit('module.lancer-automations', {
                                action: 'scanSystemJournalRequest',
                                payload: {
                                    targetId: target.id,
                                    targetName: target.name,
                                    customName,
                                    ownership,
                                    requestingUserId: game.user.id,
                                    requestingUserName: game.user.name,
                                },
                            });
                        }
                        ui.notifications.info(`Journal creation request sent to GM for ${targetArray.length} target${targetArray.length > 1 ? 's' : ''}`);
                    }

                    for (const target of targetArray)
                        await performSystemScan(target, createJournal && game.user.isGM, customName, ownership);
                },
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'scan',
        render: (html) => {
            html.find('.lancer-toggle-card').on('click', function () {
                const $card = $(this);
                const next = !$card.data('create-journal');
                $card.data('create-journal', next);
                $card.toggleClass('active', next);
                $card.find('.lancer-toggle-card-icon i')
                    .toggleClass('far fa-square', !next)
                    .toggleClass('fas fa-check-square', next);
                html.find('.la-scan-custom-name').toggle(next);
                dlg.setPosition({ height: 'auto' });
            });

            html.find('.la-scan-owner-toggle').on('click', function () {
                const $wrap = html.find('.la-scan-owner-grid-wrap');
                const willOpen = !$wrap.is(':visible');
                $wrap.toggle(willOpen);
                $(this).text(willOpen ? 'Use Default' : 'Custom Ownership');
                dlg.setPosition({ height: 'auto' });
            });

            const root = html[0];
            const groupSels = Array.from(root.querySelectorAll('.la-scan-owner-select[data-kind="group"]'));
            const userSels = Array.from(root.querySelectorAll('.la-scan-owner-select[data-kind="user"]'));
            const groups = game.modules.get('player-groups')?.active
                ? (game.settings.get('player-groups', 'groups') ?? {})
                : {};
            const membersByGroup = new Map(groupSels.map((sel) => [sel.dataset.id, groups[sel.dataset.id]?.members ?? []]));

            const refreshGroup = (gid) => {
                const gSel = groupSels.find((sel) => sel.dataset.id === gid);
                if (!gSel)
                    return;
                const members = membersByGroup.get(gid) ?? [];
                let shared;
                for (const uid of members) {
                    const uSel = userSels.find((sel) => sel.dataset.id === uid);
                    if (!uSel)
                        continue;
                    if (shared === undefined)
                        shared = uSel.value;
                    else if (shared !== uSel.value) {
                        shared = null; break;
                    }
                }
                gSel.value = shared == null ? '' : shared;
            };

            for (const gSel of groupSels) {
                gSel.addEventListener('change', () => {
                    if (gSel.value === '')
                        return;
                    for (const uid of membersByGroup.get(gSel.dataset.id) ?? []) {
                        const uSel = userSels.find((sel) => sel.dataset.id === uid);
                        if (uSel)
                            uSel.value = gSel.value;
                    }
                });
            }
            for (const uSel of userSels) {
                uSel.addEventListener('change', () => {
                    const uid = uSel.dataset.id;
                    for (const [gid, members] of membersByGroup) {
                        if (members.includes(uid))
                            refreshGroup(gid);
                    }
                });
            }
        },
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 480 });
    dlg.render(true);
}

/** @returns {Promise<void>} */
export async function executeScanOnActivation(reactorToken) {
    const api = game.modules.get('lancer-automations')?.api;
    let targets = Array.from(game.user.targets);

    if (!targets.length && api?.chooseToken && reactorToken) {
        const sensorRange = reactorToken.actor?.system?.sensor_range ?? 10;
        const chosen = await api.chooseToken(reactorToken, {
            range: sensorRange,
            count: 1,
            title: 'SCAN — Select Target',
            description: `Choose a target within Sensors (${sensorRange})`,
            filter: (t) => t.actor?.type !== 'deployable',
        });
        if (chosen?.length)
            targets = chosen;
    }

    if (!targets.length) {
        ui.notifications.warn('No targets selected for Scan!');
        return;
    }

    const targetNames = targets.map((t) => t.name).join(', ');

    if (reactorToken) {
        for (const target of targets)
            await actionFX.playScanFX(reactorToken, target);
    }

    const content = await renderTemplate(TPL.chooser, {
        targetNames,
        targetCount: targets.length,
        isMulti: targets.length > 1,
    });

    new Dialog({
        title: 'SCAN Action',
        content,
        buttons: {
            scan: {
                icon: '<i class="fas fa-radar"></i>',
                label: 'Scan',
                callback: async (html) => {
                    const $sel = html.find('.lancer-scaling-card.selected');
                    const scanType = ($sel.data('scan-type')) || 'system';
                    if (scanType === 'system') {
                        showSystemScanDialog(targets);
                        return;
                    }
                    const scanTitle = scanType === 'hidden' ? 'Hidden Information' : 'Generic/Public Information';
                    if (game.user.isGM) {
                        performGMInputScan(targets, scanTitle);
                    } else {
                        for (const target of targets) {
                            game.socket.emit('module.lancer-automations', {
                                action: 'scanInfoRequest',
                                payload: {
                                    targetId: target.id,
                                    targetName: target.name,
                                    scanTitle,
                                    requestingUserId: game.user.id,
                                    requestingUserName: game.user.name,
                                },
                            });
                        }
                        ui.notifications.info(`Scan request sent to GM for ${targets.length} target${targets.length > 1 ? 's' : ''}`);
                    }
                },
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'scan',
        render: (html) => {
            html.find('.lancer-scaling-card').first().addClass('selected');
            html.find('.lancer-scaling-card').on('click', function () {
                html.find('.lancer-scaling-card').removeClass('selected');
                $(this).addClass('selected');
            });
        },
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 540 }).render(true);
}

/** Helper: wire group→members propagation + members→group reflection on the ownership grid. */
function _bindOwnerGroupSync(html) {
    const root = html[0] ?? html;
    const groupSels = Array.from(root.querySelectorAll('.la-scan-owner-select[data-kind="group"]'));
    const userSels = Array.from(root.querySelectorAll('.la-scan-owner-select[data-kind="user"]'));
    const groups = game.modules.get('player-groups')?.active
        ? (game.settings.get('player-groups', 'groups') ?? {})
        : {};
    const membersByGroup = new Map(groupSels.map((sel) => [sel.dataset.id, groups[sel.dataset.id]?.members ?? []]));
    const refreshGroup = (gid) => {
        const gSel = groupSels.find((sel) => sel.dataset.id === gid);
        if (!gSel)
            return;
        const members = membersByGroup.get(gid) ?? [];
        let shared;
        for (const uid of members) {
            const uSel = userSels.find((sel) => sel.dataset.id === uid);
            if (!uSel)
                continue;
            if (shared === undefined)
                shared = uSel.value;
            else if (shared !== uSel.value) {
                shared = null;
                break;
            }
        }
        gSel.value = shared == null ? '' : shared;
    };
    for (const gSel of groupSels) {
        gSel.addEventListener('change', () => {
            if (gSel.value === '')
                return;
            for (const uid of membersByGroup.get(gSel.dataset.id) ?? []) {
                const uSel = userSels.find((sel) => sel.dataset.id === uid);
                if (uSel)
                    uSel.value = gSel.value;
            }
        });
    }
    for (const uSel of userSels) {
        uSel.addEventListener('change', () => {
            const uid = uSel.dataset.id;
            for (const [gid, members] of membersByGroup) {
                if (members.includes(uid))
                    refreshGroup(gid);
            }
        });
    }
}

/**
 * TAH "Generate Scan" — picks chat-only / chat+journal / journal-only and runs the scan.
 * @returns {Promise<void>}
 */
export async function executeGenerateScan(targetsArg) {
    const targetArray = Array.isArray(targetsArg) ? targetsArg : [targetsArg];
    if (!targetArray.length) {
        ui.notifications.warn('No targets selected for Generate Scan.');
        return;
    }
    const targetNames = targetArray.map((t) => t.name).join(', ');
    const defaultOwnership = _defaultOwnershipForScan(game.user, canvas.tokens?.controlled?.[0]);
    const content = await renderTemplate(TPL.generate, {
        targetNames,
        isMulti: targetArray.length > 1,
        ownerRows: _getOwnerRows(),
        defaultOwnershipSummary: _ownershipSummary(defaultOwnership),
    });

    const dlg = new Dialog({
        title: 'Generate Scan',
        content,
        buttons: {
            ok: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Generate',
                callback: async (html) => {
                    const $sel = html.find('.lancer-scaling-card.selected');
                    const mode = String($sel.data('mode') ?? 'chat');
                    const customName = String(html.find('[name="custom-journal-name"]').val() ?? '').trim();
                    const useCustom = html.find('.la-scan-owner-grid-wrap').is(':visible');
                    const ownership = useCustom ? _buildOwnershipFromForm(html) : defaultOwnership;
                    for (const target of targetArray) {
                        if (mode === 'chat')
                            await performSystemScan(target, false, customName);
                        else if (mode === 'both')
                            await performSystemScan(target, true, customName, ownership);
                        else if (mode === 'journal')
                            await createScanJournalEntry(target, customName, ownership);
                    }
                },
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'ok',
        render: (html) => {
            html.find('.lancer-scaling-card').first().addClass('selected');
            html.find('.lancer-scaling-card').on('click', function () {
                html.find('.lancer-scaling-card').removeClass('selected');
                $(this).addClass('selected');
                const mode = $(this).data('mode');
                html.find('.la-scan-journal-options').toggle(mode === 'both' || mode === 'journal');
                dlg.setPosition({ height: 'auto' });
            });
            html.find('.la-scan-owner-toggle').on('click', function () {
                const $wrap = html.find('.la-scan-owner-grid-wrap');
                const willOpen = !$wrap.is(':visible');
                $wrap.toggle(willOpen);
                $(this).text(willOpen ? 'Use Default' : 'Custom Ownership');
                dlg.setPosition({ height: 'auto' });
            });
            _bindOwnerGroupSync(html);
        },
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 580 });
    dlg.render(true);
}

Hooks.on('renderChatMessageHTML', (_msg, htmlOrEl) => {
    const root = htmlOrEl instanceof HTMLElement ? htmlOrEl : htmlOrEl[0];
    root?.querySelector('.la-scan-open-btn')?.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const uuid = ev.currentTarget.dataset.journalUuid;
        if (!uuid)
            return;
        const doc = await fromUuid(uuid);
        if (doc?.sheet)
            doc.sheet.render(true);
    });
});

/** @returns {Promise<{updated:string[], missing:string[], skipped:string[]}>} */
export async function regenerateScans(opts = {}) {
    const { filter = null, dryRun = false } = opts;
    const folder = game.folders.getName(FOLDER_NAME);
    const journals = folder ? _getAllJournalsInFolder(folder) : [];
    /** @type {{updated:string[], missing:string[], skipped:string[]}} */
    const results = { updated: [], missing: [], skipped: [] };

    for (const entry of journals) {
        if (filter && !filter(entry)) {
            results.skipped.push(entry.name);
            continue;
        }

        const flag = entry.flags?.['lancer-automations']?.scan;
        let actor = null;
        if (flag?.actorUuid) {
            try {
                actor = /** @type {any} */ (await fromUuid(flag.actorUuid));
            } catch { /* ignore */ }
        }
        if (!actor && flag?.actorName)
            actor = game.actors.find((candidate) => candidate.name === flag.actorName);
        if (!actor) {
            const m = entry.name.match(/^SCAN:\s*\d+\s*-\s*(.+)$/);
            if (m)
                actor = game.actors.find((candidate) => candidate.name === m[1].trim());
        }

        if (!actor) {
            results.missing.push(entry.name);
            continue;
        }

        if (dryRun) {
            results.updated.push(entry.name);
            continue;
        }

        try {
            const idxMatch = entry.name.match(/SCAN:\s*(\d+)/i);
            const scanIndex = idxMatch ? idxMatch[1] : (flag?.scanIndex ?? '');
            const data = _buildScanData(/** @type {any} */ ({ actor }), '', scanIndex);
            const html = await renderTemplate(TPL.overview, data);

            const pages = entry.pages.contents;
            if (pages.length === 0) {
                await entry.createEmbeddedDocuments('JournalEntryPage', [{
                    name: entry.name, type: 'text', text: { content: html }, sort: 0,
                }]);
            } else {
                await pages[0].update({ name: entry.name, text: { content: html } });
                if (pages.length > 1)
                    await entry.deleteEmbeddedDocuments('JournalEntryPage', pages.slice(1).map((p) => p.id));
            }

            await entry.update({
                'flags.lancer-automations.scan': {
                    actorUuid: actor.uuid,
                    actorName: actor.name,
                    actorImg: actor.img,
                    scanIndex,
                    scannedAt: flag?.scannedAt ?? Date.now(),
                    regeneratedAt: Date.now(),
                },
            });
            results.updated.push(entry.name);
        } catch (e) {
            console.error('lancer-automations | regenerateScans failed for', entry.name, e);
            results.missing.push(entry.name);
        }
    }

    ui.notifications.info(`Regenerated ${results.updated.length}, missing ${results.missing.length}, skipped ${results.skipped.length}.`);
    console.log('lancer-automations | regenerateScans summary', results);
    return results;
}

export const ScanAPI = {
    executeScanOnActivation,
    executeGenerateScan,
    regenerateScans,
};
