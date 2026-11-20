const HUD_ZONE_CARDS = '#hudzone > .la-info-card, #la-hudzone > .la-info-card';
const waitingBySource = new Map();
let stylesInjected = false;
let flowChain = Promise.resolve();
let flowBodyDepth = 0;

export const getFlowChain = () => flowChain;
export const getFlowBodyDepth = () => flowBodyDepth;

export function stepFlowBody(delta)
{
    flowBodyDepth += delta;
}

export function setFlowChain(next)
{
    flowChain = next;
}

function injectStyles()
{
    if (stylesInjected)
        return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
        .la-card-queue-banner {
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
            border-bottom: 1px solid #000;
            cursor: help;
        }
        .la-card-queue-banner i {
            color: #ffffff;
            animation: la-card-queue-pulse 1.6s ease-in-out infinite;
        }
        .la-card-queue-banner b {
            color: #ffeb99;
            font-weight: 800;
            margin-right: 2px;
        }
        @keyframes la-card-queue-pulse {
            0%, 100% { opacity: 0.7; transform: rotate(0deg); }
            50%      { opacity: 1.0; transform: rotate(180deg); }
        }
    `;
    document.head.appendChild(style);
}

const isShown = element => element.offsetHeight > 0;

function drawBanner(slot, target, titles, noun)
{
    const existing = document.querySelector(`.la-card-queue-banner[data-slot="${slot}"]`);

    if (!target || titles.length === 0)
    {
        existing?.remove();
        return;
    }

    injectStyles();
    const holder = target.querySelector('.lancer-hud') ?? target;
    const banner = /** @type {HTMLElement} */ (existing ?? document.createElement('div'));

    banner.className = 'la-card-queue-banner';
    banner.dataset.slot = slot;
    banner.dataset.tooltip = titles.map((title, index) => `${index + 1}. ${title}`).join('<br>');
    banner.dataset.tooltipDirection = 'UP';
    banner.innerHTML = `<i class="fas fa-hourglass-half"></i><span><b>${titles.length}</b> ${noun}${titles.length === 1 ? '' : 's'} queued</span>`;

    if (banner.parentElement !== holder)
        holder.prepend(banner);
}

export function renderStackIndicator()
{
    const cards = /** @type {any[]} */ ([...document.querySelectorAll(HUD_ZONE_CARDS)]).filter(card => !card._laClosing);
    const tools = cards.filter(card => !card._laPrompt);
    const prompts = cards.filter(card => card._laPrompt);
    const hiddenTitles = list => list.filter(card => !isShown(card)).map(card => card._laCardTitle || 'Card');
    const hudFront = [...document.querySelectorAll('.lancer-hud')].findLast(hud => !hud.closest('.la-info-card') && isShown(hud));
    const flowFront = hudFront ?? prompts.findLast(isShown) ?? null;

    drawBanner('card', tools.findLast(isShown) ?? null, [...hiddenTitles(tools), ...(waitingBySource.get('cards') ?? [])], 'card');
    drawBanner('hud', flowFront, [...hiddenTitles(prompts), ...(waitingBySource.get('flows') ?? []), ...(waitingBySource.get('flowCards') ?? [])], 'flow');
}

export function setStackWaiting(source, titles)
{
    waitingBySource.set(source, titles);
    renderStackIndicator();
}
