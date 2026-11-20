import { MODULE_ID } from './constants.js';
import { getLAFlag, getLAFlags, setLAFlag } from './flag-utils.js';
import { getCounters, setCounterLid, setCounterValue } from './pilot-clocks.js';

const FLAG = 'pinnedClocks';
const KIND_FILL = { clocks: '#3a9e6e', burdens: '#d0403f' };

function storedPins()
{
    const pins = getLAFlag(game.user, FLAG);
    return Array.isArray(pins) ? pins : [];
}

function pinKey(pin)
{
    return `${pin.pilotId}.${pin.lid}`;
}

export function pinnedClocks()
{
    const entries = [];

    for (const pin of storedPins())
    {
        const pilot = game.actors.get(pin.pilotId);
        const index = getCounters(pilot, pin.kind).findIndex(counter => counter.lid === pin.lid);

        if (index < 0)
            continue;

        const counter = getCounters(pilot, pin.kind)[index];
        entries.push({
            key: pinKey(pin),
            pilot,
            kind: pin.kind,
            name: counter.name,
            max: counter.max,
            value: counter.value ?? 0,
            fill: KIND_FILL[pin.kind],
            setValue: value => setCounterValue(pilot, pin.kind, index, value),
        });
    }

    return entries;
}

export function isClockPinned(pilot, kind, index)
{
    const lid = getCounters(pilot, kind)[index]?.lid;
    return !!lid && storedPins().some(pin => pin.pilotId === pilot.id && pin.kind === kind && pin.lid === lid);
}

export async function toggleClockPin(pilot, kind, index)
{
    if (isClockPinned(pilot, kind, index))
    {
        const lid = getCounters(pilot, kind)[index].lid;
        await setLAFlag(game.user, FLAG, storedPins().filter(pin => !(pin.pilotId === pilot.id && pin.kind === kind && pin.lid === lid)));
        return;
    }

    const lid = getCounters(pilot, kind)[index]?.lid || await setCounterLid(pilot, kind, index);
    if (lid)
        await setLAFlag(game.user, FLAG, [...storedPins(), { pilotId: pilot.id, kind, lid }]);
}

export function unpinClock(key)
{
    return setLAFlag(game.user, FLAG, storedPins().filter(pin => pinKey(pin) !== key));
}

function notifyPanel(byUser)
{
    Hooks.callAll(`${MODULE_ID}.worldClocksChanged`, { layoutChanged: false, byUser });
}

Hooks.on('updateUser', (user, change, _options, byUser) =>
{
    if (user.isSelf && getLAFlags(change)?.[FLAG] !== undefined)
        notifyPanel(byUser);
});

Hooks.on('updateActor', (actor, change, _options, byUser) =>
{
    if (change.system?.bond_state && storedPins().some(pin => pin.pilotId === actor.id))
        notifyPanel(byUser);
});

Hooks.on('deleteActor', (actor, _options, byUser) =>
{
    if (storedPins().some(pin => pin.pilotId === actor.id))
        notifyPanel(byUser);
});
