import { getLAFlag, setLAFlag } from '../tools/flag-utils.js';

export const TAPE_FLAG = 'actionTape';
const MAX_ENTRIES = 80;

const _queues = new Map();

async function applyNow(combatant, op)
{
    const entries = [...getLAFlag(combatant, TAPE_FLAG, [])];
    if (op?.kind === 'append' && op.entry)
    {
        entries.push(op.entry);
        await setLAFlag(combatant, TAPE_FLAG, entries.slice(-MAX_ENTRIES));
        return op.entry;
    }
    if (op?.kind === 'patch')
    {
        const at = entries.findIndex(entry => entry.id === op.id);
        if (at < 0)
            return null;
        const current = entries[at];
        const tracker = op.data?.tracker && current.tracker
            ? { before: current.tracker.before, after: op.data.tracker.after }
            : (op.data?.tracker ?? current.tracker);
        entries[at] = { ...current, ...op.data, ...(tracker ? { tracker } : {}) };
        await setLAFlag(combatant, TAPE_FLAG, entries);
        return entries[at];
    }
    if (op?.kind === 'remove')
    {
        const at = entries.findIndex(entry => entry.id === op.id);
        if (at < 0)
            return null;
        const [removed] = entries.splice(at, 1);
        await setLAFlag(combatant, TAPE_FLAG, entries);
        return removed;
    }
    return null;
}

export function applyTapeOp(combatant, op)
{
    const queued = (_queues.get(combatant.id) ?? Promise.resolve())
        .catch(() => null)
        .then(() => applyNow(combatant, op));
    _queues.set(combatant.id, queued);
    return queued;
}
