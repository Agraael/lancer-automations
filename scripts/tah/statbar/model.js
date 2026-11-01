import { hasMechStats, corePowerState } from '../../utils/lancer-token.js';
import { FLAG_EXTRAS } from './config.js';
import { showsPilotStress } from './rules.js';
import { _resolveExtraBarValues, _groupExtrasIntoLines } from './extras.js';
import { getLAFlag } from '../../tools/flag-utils.js';
import { reactionCounts } from '../../combat/action-extras.js';

// Bar definitions

export const BAR_DEFS = [
    {
        id: 'hp',
        label: 'HP',
        color: 0x66cc66,
        getValue: actor => ({ value: actor.system?.hp?.value ?? 0, max: getEffectiveMax(actor, 'hp') }),
        editPath: 'system.hp.value',
    },
    {
        id: 'heat',
        label: 'Heat',
        color: 0xcc4422,
        getValue: actor => ({ value: actor.system?.heat?.value ?? 0, max: getEffectiveMax(actor, 'heat') }),
        editPath: 'system.heat.value',
    },
    {
        id: 'structure',
        label: 'STR',
        color: 0xffd633,
        getValue: actor => ({ value: actor.system?.structure?.value ?? 0, max: actor.system?.structure?.max ?? 0 }),
        editPath: 'system.structure.value',
        pips: true,
    },
    {
        id: 'stress',
        label: 'Stress',
        color: 0xff8822,
        getValue: actor => ({ value: actor.system?.stress?.value ?? 0, max: actor.system?.stress?.max ?? 0 }),
        editPath: 'system.stress.value',
        pips: true,
    },
    {
        id: 'overshield',
        label: 'OS',
        color: 0x48dee0,
        getValue: actor => ({ value: actor.system?.overshield?.value ?? 0, max: actor.system?.overshield?.max ?? 0 }),
        editPath: 'system.overshield.value',
        hideWhenZero: true,
    },
    {
        id: 'burn',
        label: 'Burn',
        color: 0xcc1a1a,
        getValue: actor => ({ value: actor.system?.burn ?? 0, max: 0 }),
        editPath: 'system.burn',
        softMax: 10,
        hideWhenZero: true,
    },
    {
        id: 'infection',
        label: 'Inf',
        color: 0x1a8844,
        getValue: actor => ({ value: actor.system?.infection ?? 0, max: 0 }),
        editPath: 'system.infection',
        softMax: 10,
        hideWhenZero: true,
    },
    {
        // Pilot-only bond stress; renders as a horizontal bar (no pips) in the heat slot.
        id: 'pilotStress',
        label: 'Stress',
        color: 0xd9b800,
        getValue: actor => ({
            value: actor.system?.bond_state?.stress?.value ?? 0,
            max: actor.system?.bond_state?.stress?.max ?? 8,
        }),
        editPath: 'system.bond_state.stress.value',
    },
];

function getVisibleBars(actor, tokenDoc = null)
{
    if (!actor)
        return [];
    const mechStats = hasMechStats(actor);
    const isPilot = actor.type === 'pilot';
    return BAR_DEFS.filter(def =>
    {
        // Pilots & deployables don't get structure/stress at all.
        if (!mechStats && (def.id === 'structure' || def.id === 'stress'))
            return false;
        // Pilots can't take heat or infection mechanically.
        if (isPilot && (def.id === 'heat' || def.id === 'infection'))
            return false;
        // pilotStress is pilot-only and gated on per-token / world setting.
        if (def.id === 'pilotStress' && (!isPilot || !showsPilotStress(tokenDoc)))
            return false;
        const barValue = def.getValue(actor);
        const value = barValue.value ?? 0;
        const max = barValue.max ?? 0;
        if (def.pips && max <= 0)
            return false;
        // No native heat track: show the heat bar only if heat or infection is non-zero.
        if (def.id === 'heat' && (actor.system?.heat?.max ?? 0) <= 0)
        {
            const infection = actor.system?.infection ?? 0;
            if (value <= 0 && infection <= 0)
                return false;
        }
        if (def.hideWhenZero && value <= 0)
            return false;
        if (def.hideWhenFull && max > 0 && value >= max)
            return false;
        return true;
    });
}

export function _hubRows(actor, tokenDoc)
{
    const visibleIds = new Set(getVisibleBars(actor, tokenDoc).map(def => def.id));
    const find = id => BAR_DEFS.find(def => def.id === id);
    const rows = [];
    if (hasMechStats(actor))
    {
        if (visibleIds.has('structure') || visibleIds.has('hp'))
            rows.push([find('structure'), find('hp')]);
        // Stress pairs with heat; drop both if heat is hidden to avoid an orphan row.
        if (visibleIds.has('heat'))
            rows.push([find('stress'), find('heat')]);
    }
    else
    {
        // Pilots/deployables: HP only; heat shown only if infection pushed it non-zero.
        if (visibleIds.has('hp'))
            rows.push([null, find('hp')]);
        if (visibleIds.has('pilotStress'))
            rows.push([null, find('pilotStress')]);
        else if (visibleIds.has('heat'))
            rows.push([null, find('heat')]);
    }
    return { visibleIds, rows };
}

export function _pipSlotCount(actor)
{
    return Math.min(4, Math.max(actor.system?.structure?.max ?? 0, actor.system?.stress?.max ?? 0, 1));
}

export function _armorTicks(actor)
{
    if (!game.user?.isGM && !actor.isOwner)
        return 0;
    return Math.max(0, Math.min(8, actor.system?.armor ?? 0));
}

export function _hubExtraLines(actor, tokenDoc)
{
    const extras = (getLAFlag(tokenDoc, FLAG_EXTRAS) ?? []).filter(/** @type {any} */ extra => _resolveExtraBarValues(actor, extra).ownerOk);
    return _groupExtrasIntoLines(extras).map(line => line.entries.map(({ entry, width }) =>
    {
        const { value, max } = _resolveExtraBarValues(actor, entry);
        const stops = entry?.color?.stops?.length ? entry.color.stops : ['#888888'];
        return { entry, width, value, max, segments: Math.max(1, Math.round(max)), color: stops[0] };
    }));
}

export function getStatHubModel(token)
{
    const actor = token?.actor;
    const tokenDoc = token?.document;
    if (!actor || !tokenDoc)
        return null;
    const { visibleIds, rows } = _hubRows(actor, tokenDoc);
    const read = def => def && visibleIds.has(def.id) ? { id: def.id, color: hex(def.color), ...def.getValue(actor) } : null;
    return {
        pipSlots: hasMechStats(actor) ? _pipSlotCount(actor) : 0,
        rows: rows.map(([pips, bar]) => ({ pips: read(pips), bar: read(bar) })),
        overshield: visibleIds.has('hp') ? Math.max(0, actor.system?.overshield?.value ?? 0) : 0,
        burn: visibleIds.has('hp') && visibleIds.has('burn') ? actor.system?.burn ?? 0 : 0,
        infection: visibleIds.has('heat') && visibleIds.has('infection') ? actor.system?.infection ?? 0 : 0,
        danger: visibleIds.has('heat') && (actor.system?.heat?.max ?? 0) > 0,
        armor: visibleIds.has('hp') ? _armorTicks(actor) : 0,
        extras: _hubExtraLines(actor, tokenDoc).map(line => line.map(item => ({
            id: item.entry.id,
            width: item.width,
            value: item.value,
            max: item.entry?.segmented ? item.segments : item.max,
            segmented: !!item.entry?.segmented,
            color: item.color,
        }))),
    };
}

// Effective max: bar grows if value or overshield exceeds nominal max.
export function getEffectiveMax(actor, statKey)
{
    const sys = actor?.system;
    if (!sys)
        return 0;
    if (statKey === 'hp')
    {
        const max = sys.hp?.max ?? 0;
        const value = Math.max(0, sys.hp?.value ?? 0);
        const os = Math.max(0, sys.overshield?.value ?? 0);
        // Largest of max, HP, or overshield. OS doesn't stack on HP for sizing.
        return Math.max(max, value, os);
    }
    if (statKey === 'heat')
    {
        const ownMax = sys.heat?.max ?? 0;
        const value = Math.max(0, sys.heat?.value ?? 0);
        const fallbackMax = ownMax > 0 ? ownMax : (sys.hp?.max ?? 0);
        return Math.max(fallbackMax, value);
    }
    return 0;
}

// Parse "#rrggbb" into a 0xrrggbb integer (PIXI fill format). Falls back to gray.
export function _parseHex(hex)
{
    if (typeof hex !== 'string')
        return 0x888888;
    const stripped = hex.trim().replace(/^#/, '');
    const parsed = parseInt(stripped, 16);
    return Number.isFinite(parsed) ? (parsed & 0xffffff) : 0x888888;
}

function _clockSnapshot(actor)
{
    const state = actor?.system?.bond_state;
    if (!state)
        return null;
    const snap = {};
    for (const kind of ['clocks', 'burdens'])
    {
        for (const counter of state[kind] ?? [])
        {
            if (counter?.lid)
                snap[counter.lid] = { name: counter.name ?? '', value: counter.value ?? 0, burden: kind === 'burdens' };
        }
    }
    return snap;
}

export function snapshotValues(actor, tokenDoc = null)
{
    const extras = getLAFlag(tokenDoc,FLAG_EXTRAS) ?? [];
    const extrasSnap = {};
    for (const extra of extras)
    {
        if (!extra?.id)
            continue;
        extrasSnap[extra.id] = _resolveExtraBarValues(actor, extra).value;
    }
    return {
        hp: actor.system?.hp?.value ?? 0,
        heat: actor.system?.heat?.value ?? 0,
        structure: actor.system?.structure?.value ?? 0,
        stress: actor.system?.stress?.value ?? 0,
        pilotStress: actor.system?.bond_state?.stress?.value ?? 0,
        bondXp: actor.system?.bond_state?.xp?.value ?? 0,
        clocks: _clockSnapshot(actor),
        overshield: actor.system?.overshield?.value ?? 0,
        burn: actor.system?.burn ?? 0,
        infection: actor.system?.infection ?? 0,
        reaction: reactionCounts(actor).left,
        armor: actor.system?.armor ?? 0,
        repairs: actor.system?.repairs?.value ?? 0,
        overcharge: actor.system?.overcharge ?? 0,
        coreActive: corePowerState(actor).active,
        coreCharged: corePowerState(actor).charged,
        extras: extrasSnap,
    };
}

export function hex(colorInt)
{
    return '#' + colorInt.toString(16).padStart(6, '0');
}
