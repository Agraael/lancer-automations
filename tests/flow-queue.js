/**
 * Flow Queue Test Suite
 * Run via:  api.tests.flowQueue.runAll()
 *   or individual tests:  api.tests.flowQueue.basicSequential()
 */

/* global game, $ */

import { queue, runInFlowBody, _flowQueueDebug } from '../scripts/activations/flow-queue.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function pass(name) {
    console.log(`%c✅ PASS: ${name}`, 'color:limegreen; font-weight:bold;');
}
function fail(name, reason) {
    console.error(`❌ FAIL: ${name} — ${reason}`);
}
function assert(cond, name, reason) {
    if (cond) pass(name);
    else fail(name, reason);
}

/** A fake flow body: resolves after `ms` and records the order it ran. */
function makeFlow(ms, order, tag) {
    return async () => {
        order.push(`start:${tag}`);
        await delay(ms);
        order.push(`end:${tag}`);
        return tag;
    };
}

// ─── Test 1: two top-level flows queue sequentially ───────────────────
async function basicSequential() {
    console.log('%c── Test: basic sequential ──', 'color:cyan;');
    const order = [];
    const p1 = queue(makeFlow(200, order, 'A'), 'A');
    const p2 = queue(makeFlow(200, order, 'B'), 'B');
    await Promise.all([p1, p2]);
    assert(
        JSON.stringify(order) === JSON.stringify(['start:A', 'end:A', 'start:B', 'end:B']),
        'basic sequential ordering',
        `got ${JSON.stringify(order)}`,
    );
}

// ─── Test 2: indicator appears when 2+ flows queued ───────────────────
async function indicatorAppears() {
    console.log('%c── Test: indicator appears ──', 'color:cyan;');
    // Indicator only renders when there's a .lancer-hud target. Inject a fake
    // one so _renderIndicator has somewhere to attach.
    const fakeHud = document.createElement('div');
    fakeHud.className = 'lancer-hud';
    document.body.appendChild(fakeHud);
    try {
        const p1 = queue(makeFlow(400, [], 'P1'), 'P1');
        const p2 = queue(makeFlow(100, [], 'P2'), 'P2');
        await delay(150);
        const indicator = $('.la-flow-queue-indicator');
        assert(indicator.length === 1, 'indicator present while queued', `got ${indicator.length}`);
        assert(/1\s+flow/i.test(indicator.text()), 'indicator says "1 flow queued"', `text: "${indicator.text()}"`);
        await Promise.all([p1, p2]);
        await delay(50);
        assert($('.la-flow-queue-indicator').length === 0, 'indicator gone after queue drains', '');
    } finally {
        fakeHud.remove();
    }
}

// ─── Test 3: re-entry — child inside body bypasses parent ─────────────
async function reentryBypass() {
    console.log('%c── Test: re-entry bypass ──', 'color:cyan;');
    const order = [];
    let parentDone = false;
    const parent = queue(async () => {
        order.push('start:parent');
        // The parent's body wraps in runInFlowBody so children bypass.
        await runInFlowBody(async () => {
            // Spawn 2 children in parallel (Promise.all).
            await Promise.all([
                queue(makeFlow(150, order, 'child1'), 'child1'),
                queue(makeFlow(150, order, 'child2'), 'child2'),
            ]);
        });
        order.push('end:parent');
        parentDone = true;
    }, 'parent');
    await parent;
    assert(parentDone, 'parent finished (no deadlock)', '');
    // Children should have serialized: child1 fully before child2.
    const i1s = order.indexOf('start:child1');
    const i1e = order.indexOf('end:child1');
    const i2s = order.indexOf('start:child2');
    assert(i1s >= 0 && i1e >= 0 && i2s >= 0, 'all child events recorded', `order: ${order.join(',')}`);
    assert(i1e < i2s, 'child2 starts only after child1 ends', `order: ${order.join(',')}`);
}

// ─── Test 4: top-level flow queues behind active parent re-entry ─────
async function topLevelWaitsForParent() {
    console.log('%c── Test: top-level waits for parent ──', 'color:cyan;');
    const order = [];
    const parent = queue(async () => {
        order.push('start:parent');
        await runInFlowBody(async () => {
            await queue(makeFlow(150, order, 'child1'), 'child1');
        });
        order.push('end:parent');
    }, 'parent');
    // Fire a sibling top-level shortly after parent starts. Should queue behind parent.
    await delay(10);
    const sibling = queue(makeFlow(50, order, 'sibling'), 'sibling');
    await Promise.all([parent, sibling]);
    const iParentEnd = order.indexOf('end:parent');
    const iSiblingStart = order.indexOf('start:sibling');
    assert(iParentEnd < iSiblingStart, 'sibling waited for parent to finish', `order: ${order.join(',')}`);
}

// ─── Test 5: inter-flow delay (~400 ms) ───────────────────────────────
async function interFlowDelay() {
    console.log('%c── Test: inter-flow delay ──', 'color:cyan;');
    const stamps = [];
    const p1 = queue(async () => { stamps.push(performance.now()); }, 'A');
    const p2 = queue(async () => { stamps.push(performance.now()); }, 'B');
    await Promise.all([p1, p2]);
    const gap = stamps[1] - stamps[0];
    assert(gap >= 350 && gap <= 700, `gap ≈ 400ms (got ${gap.toFixed(0)}ms)`, `gap=${gap}`);
}

// ─── Test 6: queue label introspection ────────────────────────────────
async function debugLabels() {
    console.log('%c── Test: debug labels ──', 'color:cyan;');
    let snapshot = null;
    const p1 = queue(async () => {
        await delay(100);
        snapshot = _flowQueueDebug();
    }, 'INSPECTED');
    const p2 = queue(makeFlow(50, [], 'NEXT'), 'NEXT');
    await Promise.all([p1, p2]);
    assert(snapshot && snapshot.labels.includes('INSPECTED'),
        'labels include first flow while running',
        `snapshot=${JSON.stringify(snapshot)}`);
    assert(snapshot && snapshot.labels.includes('NEXT'),
        'labels include queued second flow',
        `snapshot=${JSON.stringify(snapshot)}`);
}

// ─── Run All ──────────────────────────────────────────────────────────
async function runAll() {
    console.log('%c╔══════════════════════════════════════╗', 'color:gold;');
    console.log('%c║   Flow Queue Test Suite              ║', 'color:gold;');
    console.log('%c╚══════════════════════════════════════╝', 'color:gold;');
    await basicSequential();
    await delay(200);
    await indicatorAppears();
    await delay(200);
    await reentryBypass();
    await delay(200);
    await topLevelWaitsForParent();
    await delay(200);
    await interFlowDelay();
    await delay(200);
    await debugLabels();
    console.log('%c╔══════════════════════════════════════╗', 'color:gold;');
    console.log('%c║   All tests complete!                ║', 'color:gold;');
    console.log('%c╚══════════════════════════════════════╝', 'color:gold;');
}

export const FlowQueueTests = {
    basicSequential,
    indicatorAppears,
    reentryBypass,
    topLevelWaitsForParent,
    interFlowDelay,
    debugLabels,
    runAll,
};
