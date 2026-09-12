// Uplink snapshot capture: turns roll HUD state into plain snapshots for the
// mirror cards, live on a timer or saved to a small localStorage history.

import { openUplinkPanel, closeUplinkPanel } from './panel.js';
import { resolveLiveRoll, getCachedRanges, getCachedBonusDamage, statRollLabel } from './live-rolls.js';
import { usesLineOfSight } from '../tah/hover.js';
import { weaponTypeIcon } from '../tah/item-helpers.js';
import { accDiffTargetToken } from '../combat/grid-helpers.js';

const SNAPSHOTS_KEY = 'la-uplink-snapshots';
const MAX_SNAPSHOTS = 12;

export function getSnapshots()
{
    try
    {
        const parsed = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (err)
    {
        return [];
    }
}

export function clearSnapshots()
{
    try
    {
        localStorage.removeItem(SNAPSHOTS_KEY);
    }
    catch (err)
    {
        // storage unavailable
    }
}

function saveSnapshot(snapshot)
{
    try
    {
        const stored = getSnapshots();
        stored.push(snapshot);
        while (stored.length > MAX_SNAPSHOTS)
            stored.shift();
        localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(stored));
    }
    catch (err)
    {
        // storage unavailable
    }
}

function tokenInfo(uuid)
{
    const doc = uuid ? fromUuidSync(uuid) : null;
    return { uuid, name: doc?.name || 'Unknown', img: doc?.actor?.img || doc?.texture?.src || '' };
}

function plainDamage(list)
{
    return (list || []).map(entry => ({ type: entry.type, val: entry.val }));
}

// DamageHudData.raw returns live class instances, so the fields are picked by hand.
function cloneDamageHud(hud)
{
    const weapon = hud.weapon;
    const base = hud.base;
    return {
        title: hud.title,
        weapon: weapon ? {
            overkill: !!weapon.overkill,
            reliable: !!weapon.reliable,
            reliableValue: Number(weapon.reliableValue) || 0,
            damage: plainDamage(weapon.damage),
            bonusDamage: plainDamage(weapon.bonusDamage)
        } : null,
        base: base ? {
            ap: !!base.ap,
            paracausal: !!base.paracausal,
            halfDamage: !!base.halfDamage,
            damage: plainDamage(base.damage),
            bonusDamage: plainDamage(base.bonusDamage)
        } : null,
        targets: (hud.targets || []).map(target => ({
            targetUuid: target.targetUuid,
            quality: Number(target.quality) || 0,
            ap: !!target.ap,
            paracausal: !!target.paracausal,
            halfDamage: !!target.halfDamage,
            damage: plainDamage(target.damage),
            bonusDamage: plainDamage(target.bonusDamage)
        })),
        hitResults: (hud.hitResults || []).map(result => ({
            targetUuid: result.targetUuid, total: result.total, hit: !!result.hit, crit: !!result.crit
        }))
    };
}

// acc_diff.raw is not JSON-safe (target plugins hold live tokens), so the
// fields are read through the getters instead.
function cloneAccDiff(accDiff)
{
    const weapon = accDiff.weapon;
    const base = accDiff.base;
    return {
        title: accDiff.title,
        weapon: weapon ? {
            accurate: !!weapon.accurate,
            inaccurate: !!weapon.inaccurate,
            seeking: !!weapon.seeking,
            smart: !!weapon.smart,
            melee: !!weapon.melee,
            thrown: !!weapon.thrown,
            engaged: !!weapon.engaged,
            tech: !!weapon.tech,
            impaired: !!weapon.impaired
        } : null,
        base: base ? {
            grit: Number(base.grit) || 0,
            flatBonus: Number(base.flatBonus) || 0,
            accuracy: Number(base.accuracy) || 0,
            difficulty: Number(base.difficulty) || 0
        } : null,
        targets: (accDiff.targets || []).map(target =>
        {
            const invisibility = target.plugins?.invisibility;
            return {
                targetUuid: target.targetUuid,
                accuracy: Number(target.accuracy) || 0,
                difficulty: Number(target.difficulty) || 0,
                cover: Number(target.cover) || 0,
                lockOn: !!target.usingLockOn,
                prone: !!target.prone,
                stunned: !!target.stunned,
                invisible: !!(invisibility && typeof invisibility === 'object' ? invisibility.data : invisibility)
            };
        })
    };
}

// Read on the roller's client because only it has the dialog DOM: weapon must
// use LoS (no arcing or seeking tag) and the dialog's LoS toggle must be on.
function losActive(kind, state)
{
    if (!usesLineOfSight(null, state.item ?? null, null))
        return false;
    const selector = kind === 'damage' ? '#damage-hud .la-tg-los' : 'form[id^="accdiff"] .la-tg-los';
    const losToggle = /** @type {HTMLInputElement|null} */ (document.querySelector(selector));
    return losToggle ? losToggle.checked : true;
}

function rowInfo(row)
{
    return {
        label: row.querySelector('span')?.textContent.trim() || '',
        on: !!row.querySelector('input[type="checkbox"]')?.checked
    };
}

function rowDamage(row)
{
    return Array.from(row.querySelectorAll('i.cci')).map(icon => ({
        type: icon.dataset.tooltip || '',
        val: /** @type {HTMLInputElement|null} */ (icon.nextElementSibling)?.value ?? ''
    }));
}

// LA-injected rows of the open attack/stat dialog, read on the roller's client.
function accDiffLaRows(raw)
{
    const form = document.querySelector('form[id^="accdiff"]');
    if (!form)
        return null;
    const global = { acc: [], diff: [] };
    for (const row of form.querySelectorAll('.csm-global-bonus-row'))
    {
        const info = rowInfo(row);
        global[/\(-\d+\)\s*$/.test(info.label) ? 'diff' : 'acc'].push(info);
    }
    const targets = {};
    for (const card of form.querySelectorAll('.accdiff-target'))
    {
        const tokenId = (card.querySelector('label.target-name')?.getAttribute('for') || '').split('.').pop();
        const target = (raw.targets || []).find(entry => accDiffTargetToken(entry)?.id === tokenId);
        const rows = Array.from(card.querySelectorAll('.accdiff-target-body label[class*="csm-tgt-bonus-"], .accdiff-target-body .la-tmod-row')).map(rowInfo);
        if (target && rows.length)
            targets[target.targetUuid] = rows;
    }
    const flatInput = /** @type {HTMLInputElement|null} */ (form.querySelector('.la-stat-flat-mod input'));
    return {
        global,
        modifiers: Array.from(form.querySelectorAll('.la-target-modifier-section .la-tmod-row')).map(rowInfo),
        targets,
        flat: flatInput ? Number(flatInput.value) || 0 : null
    };
}

// Per-card rows are index-aligned with damage_hud_data.targets, like the injection.
function damageLaRows()
{
    const form = document.getElementById('damage-hud');
    if (!form)
        return null;
    const withDamage = row => ({ ...rowInfo(row), damage: rowDamage(row) });
    return {
        global: Array.from(form.querySelectorAll('.csm-bonus-container .csm-bonus-config-row')).map(withDamage),
        targets: Array.from(form.querySelectorAll('.damage-hud-target-card')).map(card =>
            Array.from(card.querySelectorAll('.csm-bonus-config-row, label[class*="la-tmod-dmg-"]')).map(withDamage))
    };
}

function rollerTokenUuid(state)
{
    return state.actor?.token?.uuid ?? state.actor?.getActiveTokens?.()?.[0]?.document?.uuid ?? null;
}

function attackDamage(state)
{
    const item = state.data?.lancerItem ?? state.item;
    const profile = item?.currentProfile?.();
    const plain = plainDamage(profile?.damage);
    return plain.length ? plain : null;
}

// The unmodified profile line, so the mirror can grey it out when bonuses changed it.
function attackDamageBase(state)
{
    const item = state.data?.lancerItem ?? state.item;
    const raw = item?.type === 'mech_weapon' ? item.system?.active_profile?.damage
        : item?.type === 'pilot_weapon' ? item.system?.damage : null;
    const plain = plainDamage(Array.isArray(raw) ? raw : []);
    return plain.length ? plain : null;
}

/**
 * Build a plain snapshot of the roll HUD state, or null when the flow has none.
 * Safe against a mid-teardown state, used both live and at resolve time.
 * @param {'attack'|'tech'|'damage'|'hase'} kind
 * @param {any} state
 */
export function captureSnapshot(kind, state)
{
    try
    {
        let raw = null;
        let totals = null;
        if (kind === 'damage')
        {
            const hud = state.data?.damage_hud_data;
            if (!hud)
                return null;
            raw = cloneDamageHud(hud);
        }
        else
        {
            const accDiff = state.data?.acc_diff;
            if (!accDiff)
                return null;
            raw = cloneAccDiff(accDiff);
            totals = {
                base: Number(accDiff.base?.total) || 0,
                targets: (accDiff.targets || []).map(target => ({ uuid: target.targetUuid, total: Number(target.total) || 0 }))
            };
        }

        const targetUuids = (raw.targets || []).map(target => target.targetUuid);
        const contest = state.la_extraData?.contest;
        const targetTokenId = state.la_extraData?.targetTokenId;
        const check = kind === 'hase' && !contest ? {
            targetVal: state.la_extraData?.targetVal ?? null,
            targetName: targetTokenId ? (canvas.tokens?.get?.(targetTokenId)?.name || '') : ''
        } : null;
        return {
            id: foundry.utils.randomID(),
            ts: Date.now(),
            kind,
            user: game.user?.name || '',
            actorName: state.actor?.name || '',
            actorImg: state.actor?.img || '',
            weaponIcon: kind === 'attack' || kind === 'damage' ? (weaponTypeIcon(state.data?.lancerItem ?? state.item) || '') : '',
            attackDamage: kind === 'attack' || kind === 'tech' ? attackDamage(state) : null,
            attackDamageBase: kind === 'attack' ? attackDamageBase(state) : null,
            attackBonusDamage: kind === 'attack' || kind === 'tech' ? getCachedBonusDamage(state) : null,
            itemName: state.item?.name || '',
            title: state.data?.title || '',
            raw,
            totals,
            losActive: losActive(kind, state),
            rollerTokenUuid: rollerTokenUuid(state),
            ranges: kind === 'hase' ? null : getCachedRanges(state),
            checkLabel: kind === 'hase' ? statRollLabel(state) : '',
            statBonus: kind === 'hase' ? Number(state.data?.bonus) || 0 : null,
            laRows: kind === 'damage' ? damageLaRows() : accDiffLaRows(raw),
            check,
            la: {
                knockback: state.data?._csmKnockback ?? null,
                noBonusDmg: state.la_extraData?._csmNoBonusDmg ?? null,
                throttled: state.la_extraData?._laThrottled ?? null
            },
            targets: targetUuids.map(tokenInfo),
            contest: contest ? {
                stat: contest.stat || '',
                actorUuid: contest.actorUuid || null,
                name: contest.actorUuid ? tokenInfo(contest.actorUuid).name : '',
                targetVal: state.la_extraData?.targetVal ?? null
            } : null
        };
    }
    catch (err)
    {
        console.warn('lancer-automations | uplink snapshot failed', err);
        return null;
    }
}

/**
 * Called from the post-HUD flow steps: saves the resolved state to history and
 * closes the roll's live entry. Never throws into the flow.
 * @param {'attack'|'tech'|'damage'|'hase'} kind
 * @param {any} state
 */
export function recordRollSnapshot(kind, state)
{
    const snapshot = captureSnapshot(kind, state);
    if (snapshot)
        saveSnapshot(snapshot);
    resolveLiveRoll(state);
}

Hooks.on('lancer-automations.ready', (api) =>
{
    api.uplink = {
        snapshots: getSnapshots,
        clear: clearSnapshots,
        open: openUplinkPanel,
        close: closeUplinkPanel
    };
});
