/* global game, libWrapper, document */

import { playRollHudFx } from '../fx/actionFX.js';

const INTER_FLOW_DELAY_MS = 400;
let chain = Promise.resolve();
/** @type {Array<{ label: string, queuedAt: string }>} */
const queueLabels = [];

function _hhmmss()
{
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Depth counter set while we're running custom flow-body code (e.g. an
// activationCode) that may spawn child flows. While >0, queue() bypasses to
// avoid the parent-awaits-child deadlock. Mirror of cards.js _cardCallbackDepth
// + _runCardCallback.
let _flowBodyDepth = 0;

/** Wrap a flow-body callback so child flow.begin() bypass the queue. */
export async function runInFlowBody(asyncFn)
{
    _flowBodyDepth++;
    try
    {
        return await asyncFn();
    }
    finally
    {
        _flowBodyDepth--;
    }
}

// Separate chain for child flows spawned inside a flow body. Lets children
// serialize against each other (Lancer's HUD is singleton) without blocking
// on the parent flow that's currently awaiting them.
let innerChain = Promise.resolve();
// Number of queued flows currently executing (one per active chain). Used to
// derive the "waiting" count for the indicator: total - active.
let activeCount = 0;
let _lastQueuedState = null;

function _queueOn(getChain, setChain, fn, label, state = null)
{
    const wasIdle = queueLabels.length === 0;
    const prevState = _lastQueuedState;
    _lastQueuedState = state;
    queueLabels.push({ label, queuedAt: _hhmmss() });
    _renderIndicator();
    const next = getChain().then(async () =>
    {
        if (!wasIdle && (!state || state !== prevState))
            await new Promise(resolve => setTimeout(resolve, INTER_FLOW_DELAY_MS));
        activeCount++;
        _renderIndicator();
        try
        {
            const result = fn();
            setTimeout(() => _renderIndicator(), 50);
            setTimeout(() => _renderIndicator(), 250);
            return await result;
        }
        finally
        {
            activeCount--;
        }
    });
    setChain(next.catch(() =>
    {}).finally(() =>
    {
        queueLabels.shift();
        _renderIndicator();
    }));
    return next;
}

export function queue(fn, label = 'Flow', state = null)
{
    if (_flowBodyDepth > 0)
    {
        return _queueOn(() => innerChain, updated =>
        {
            innerChain = updated;
        }, fn, label, state);
    }
    return _queueOn(() => chain, updated =>
    {
        chain = updated;
    }, fn, label, state);
}

export function _flowQueueDebug()
{
    return {
        labels: queueLabels.map(q => q.label),
        active: activeCount,
        bodyDepth: _flowBodyDepth,
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

let _indicatorEl = null;

function _findActiveCard()
{
    const huds = document.querySelectorAll('.lancer-hud');
    if (huds.length)
        return /** @type {HTMLElement} */ (huds[huds.length - 1]);
    return null;
}

function _renderIndicator()
{
    const waiting = Math.max(0, queueLabels.length - Math.max(1, activeCount));
    const target = _findActiveCard();
    if (waiting <= 0 || !target)
    {
        if (_indicatorEl)
        {
            _indicatorEl.remove();
            _indicatorEl = null;
        }
        return;
    }
    if (!_indicatorEl)
    {
        _injectStyles();
        _indicatorEl = document.createElement('div');
        _indicatorEl.className = 'la-flow-queue-indicator';
    }
    if (_indicatorEl.parentElement !== target)
        target.insertBefore(_indicatorEl, target.firstChild);
    const tooltip = queueLabels.slice(Math.max(1, activeCount))
        .map((q, i) => `${i + 1}. ${q.label}`)
        .join('<br>');
    _indicatorEl.dataset.tooltip = tooltip;
    _indicatorEl.dataset.tooltipDirection = 'UP';
    _indicatorEl.innerHTML =
        `<i class="fas fa-hourglass-half la-fq-icon"></i>` +
        `<span class="la-fq-text"><b>${waiting}</b> flow${waiting === 1 ? '' : 's'} queued</span>`;
}

let _stylesInjected = false;
function _injectStyles()
{
    if (_stylesInjected)
        return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        .la-flow-queue-indicator {
            background: var(--primary-color, #b13a30);
            color: #ffffff;
            padding: 4px 12px;
            font-family: inherit;
            font-size: 0.82em;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            pointer-events: auto;
            cursor: help;
            border-bottom: 1px solid #000;
        }
        .la-flow-queue-indicator .la-fq-icon {
            color: #ffffff;
            animation: la-fq-pulse 1.6s ease-in-out infinite;
        }
        .la-flow-queue-indicator .la-fq-text b {
            color: #ffeb99;
            font-weight: 800;
            margin-right: 2px;
        }
        @keyframes la-fq-pulse {
            0%, 100% { opacity: 0.7; transform: rotate(0deg); }
            50%      { opacity: 1.0; transform: rotate(180deg); }
        }
    `;
    document.head.appendChild(style);
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
            }, _hudLabel(stepName, state), state);
        });
    }
}
