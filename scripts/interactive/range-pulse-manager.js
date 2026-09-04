/* global Hooks, console */
// Single-active, priority-arbitrated owner of the gray range pulse: only the highest-priority request renders. style:ignore

import { createPulsingRangeHighlight } from "./canvas-helpers.js";
import { awaitMovementSettled } from "../movement/move-api.js";
import { invalidateLosCaches } from "../vision/lancerDetectionModes.js";

export const RANGE_PULSE_PRIORITY = Object.freeze({
    INTERACTIVE: 60,
    ATTACK_CARD: 40,
    HOVER: 20,
    MEASURE: 10,
});

const requests = new Map();
let seqCounter = 0;
let activeOwner = null;
let activeDestroy = null;
let activeSignature = null;

function pickWinner()
{
    let winner = null;
    for (const [ownerId, request] of requests)
    {
        if (!winner
            || request.priority > winner.request.priority
            || (request.priority === winner.request.priority && request.seq > winner.request.seq))

            winner = { ownerId, request };

    }
    return winner;
}

function destroyActive()
{
    if (activeDestroy)
    {
        try
        {
            activeDestroy();
        }
        catch (err)
        {
            console.warn("lancer-automations | range pulse destroy failed", err);
        }
    }
    activeOwner = null;
    activeDestroy = null;
    activeSignature = null;
}

function reconcile()
{
    const winner = pickWinner();
    if (!winner)
    {
        destroyActive();
        return;
    }
    if (winner.ownerId === activeOwner && winner.request.signature === activeSignature)
        return;
    destroyActive();
    activeOwner = winner.ownerId;
    activeSignature = winner.request.signature;
    try
    {
        activeDestroy = winner.request.build() ?? null;
    }
    catch (err)
    {
        console.warn("lancer-automations | range pulse build failed", err);
        activeDestroy = null;
    }
}

export const rangePulse = {
    set(ownerId, { priority = 0, build = null, signature = null } = {})
    {
        const seq = ++seqCounter;
        requests.set(ownerId, { priority, build, seq, signature: signature ?? `seq:${seq}` });
        reconcile();
    },
    setRange(ownerId, { token = null, range = 0, priority = 0, includeSelf = false, glowColor = undefined, ...opts } = {})
    {
        const signature = `${token?.document?.id ?? "pt"}|${range}|${includeSelf}|${glowColor ?? ""}|${opts.los === true}|${opts.freeRange ?? 0}`;
        this.set(ownerId, {
            priority,
            signature,
            build: () => createPulsingRangeHighlight(token, range, { includeSelf, ...(glowColor !== undefined ? { glowColor } : {}), ...opts }),
        });
    },
    clear(ownerId)
    {
        if (requests.delete(ownerId))
            reconcile();
    },
    has(ownerId)
    {
        return requests.has(ownerId);
    },
    activeOwner()
    {
        return activeOwner;
    },
    clearAll()
    {
        requests.clear();
        destroyActive();
    },
};

Hooks.on("canvasTearDown", () => rangePulse.clearAll());

// A settled move gets the same treatment as a re-toggle: destroy the active build, create it fresh.
Hooks.on("updateToken", (tokenDoc, changes) =>
{
    if (!("x" in changes) && !("y" in changes))
        return;
    if (!requests.size)
        return;
    awaitMovementSettled(tokenDoc)
        .then(() => new Promise(resolve => setTimeout(resolve, 100)))
        .then(() =>
        {
            if (!requests.size)
                return;
            invalidateLosCaches();
            destroyActive();
            reconcile();
        });
});
