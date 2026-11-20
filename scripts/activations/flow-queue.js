/* global game, libWrapper, document */

import { playRollHudFx } from '../fx/actionFX.js';
import { setFlowChain, setStackWaiting, getFlowBodyDepth, stepFlowBody } from '../interactive/stack-indicator.js';

const INTER_FLOW_DELAY_MS = 400;

/** Wrap a flow-body callback so child flow.begin() go first in line. */
export async function runInFlowBody(asyncFn)
{
    stepFlowBody(1);

    try
    {
        return await asyncFn();
    }
    finally
    {
        stepFlowBody(-1);
    }
}

const waiting = [];
const active = [];
let held = null;
let idle = null;
let lastState = null;

const ownedByHold = entry => !!held && !entry.hold && !entry.reaction && !!held.owns(entry.state);

function canStart(entry)
{
    if (entry.hold)
        return !held;
    if (entry.reaction)
        return !active.some(other => other.reaction || other.hud);
    return active.length === 0 && (!held || ownedByHold(entry));
}

function pickNext()
{
    const reaction = waiting.find(entry => entry.reaction);
    if (reaction)
        return canStart(reaction) ? reaction : null;

    const owned = waiting.find(ownedByHold);
    if (owned)
        return canStart(owned) ? owned : null;

    const head = waiting.find(entry => !entry.reaction);
    return head && canStart(head) ? head : null;
}

function syncIdle()
{
    const busy = active.length > 0 || waiting.length > 0 || !!held;

    if (busy && !idle)
    {
        let resolve;
        const promise = new Promise((done) =>
        {
            resolve = done;
        });
        idle = { promise, resolve };
        setFlowChain(promise);
    }
    else if (!busy && idle)
    {
        idle.resolve();
        idle = null;
        setFlowChain(Promise.resolve());
    }
}

function pump()
{
    for (let next = pickNext(); next; next = pickNext())
    {
        waiting.splice(waiting.indexOf(next), 1);

        if (next.hold)
            runHold(next);
        else
            runStep(next);
    }

    syncIdle();
    _renderIndicator();
}

async function runStep(entry)
{
    active.push(entry);

    try
    {
        if (!entry.wasIdle && (!entry.state || entry.state !== lastState))
            await new Promise(resolve => setTimeout(resolve, INTER_FLOW_DELAY_MS));
        const result = entry.fn();
        setTimeout(() => _renderIndicator(), 50);
        setTimeout(() => _renderIndicator(), 250);
        entry.resolve(await result);
    }
    catch (error)
    {
        entry.reject(error);
    }
    finally
    {
        active.splice(active.indexOf(entry), 1);
        lastState = entry.state;
        pump();
    }
}

async function runHold(entry)
{
    held = entry;

    try
    {
        entry.resolve(await entry.fn());
    }
    catch (error)
    {
        entry.reject(error);
    }
    finally
    {
        held = null;
        pump();
    }
}

export function queue(fn, label = 'Flow', state = null, hud = false)
{
    return new Promise((resolve, reject) =>
    {
        const wasIdle = active.length === 0 && waiting.length === 0;
        const reaction = state ? !!state.__laReaction : getFlowBodyDepth() > 0;
        waiting.push({ fn, label, state, hud, reaction, wasIdle, resolve, reject });
        pump();
    });
}

export function holdFlowLine(owns, fn, label = 'Action')
{
    if (getFlowBodyDepth() > 0)
        return fn();

    return new Promise((resolve, reject) =>
    {
        waiting.push({ hold: true, owns, fn, label, resolve, reject });
        pump();
    });
}

export const reactionPending = () => [...active, ...waiting].some(entry => entry.reaction);

export function _flowQueueDebug()
{
    return {
        labels: [...active, ...waiting].map(entry => entry.label),
        active: active.length,
        bodyDepth: getFlowBodyDepth(),
        held: held?.label ?? null,
    };
}

function _hudLabel(stepName, state)
{
    const item = state?.item?.name;
    const actor = state?.actor?.name;

    if (item)
        return `${stepName}: ${item}`;
    if (actor)
        return `${stepName}: ${actor}`;
    return stepName;
}

function _renderIndicator()
{
    setStackWaiting('flows', waiting.map(entry => entry.label));
}

// Lancer flow steps that open the .lancer-hud roll card.
const HUD_STEPS_TO_QUEUE = [
    'showAttackHUD',
    'showDamageHUD',
    'showStatRollHUD',
];

const PRE_HUD_STEPS_TO_QUEUE = [
    'setDamageTargets',
];

export function initFlowQueue()
{
    const flowSteps = game.lancer?.flowSteps;
    if (!flowSteps)
        return;

    const flowNames = new Set([...(game.lancer?.flows?.values?.() ?? [])].map(FlowClass => FlowClass?.name).filter(Boolean));

    for (const name of flowNames)
    {
        Hooks.on(`lancer.preFlow.${name}`, (flow) =>
        {
            if (getFlowBodyDepth() > 0 && flow?.state)
                flow.state.__laReaction = true;
        });
    }

    for (const stepName of [...HUD_STEPS_TO_QUEUE, ...PRE_HUD_STEPS_TO_QUEUE])
    {
        const original = flowSteps.get(stepName);
        if (!original)
            continue;

        const isHud = HUD_STEPS_TO_QUEUE.includes(stepName);
        flowSteps.set(stepName, async function (state, options)
        {
            return queue(() =>
            {
                if (isHud)
                    playRollHudFx(stepName, state);
                return original(state, options);
            }, _hudLabel(stepName, state), state, isHud);
        });
    }
}
