const PAN_DELAY_MS = 300;
const PAN_HOLD_MS = 1000;
const PAN_HOSTS = '.la-choice-item, .la-pan-clip';

let hovered = null;
let pans = [];

function panOnce(clip)
{
    const text = clip.firstElementChild;

    if (!(text instanceof HTMLElement) || clip.scrollWidth <= clip.clientWidth)
        return null;

    clip.classList.add('la-panning');
    const overflow = text.offsetWidth - clip.clientWidth;

    if (overflow <= 0)
    {
        clip.classList.remove('la-panning');
        return null;
    }

    const travel = Math.min(2000, Math.max(500, overflow * 20));
    const total = PAN_DELAY_MS + travel + PAN_HOLD_MS;

    const pan = text.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: PAN_DELAY_MS / total },
        { transform: `translateX(${-overflow}px)`, offset: (PAN_DELAY_MS + travel) / total },
        { transform: `translateX(${-overflow}px)`, offset: 1 },
    ], { duration: total, iterations: 1, easing: 'linear' });

    pan.finished
        .catch(() => null)
        .then(() => clip.classList.remove('la-panning'));
    return pan;
}

function onHover(event)
{
    const target = event.target instanceof Element ? event.target : null;
    const host = target?.closest(PAN_HOSTS) ?? null;

    if (host === hovered)
        return;

    pans.forEach(pan => pan.cancel());
    hovered = host;
    const clips = !host || host.matches('.la-pan-clip') ? [host] : [...host.querySelectorAll('.la-pan-clip')];
    pans = clips.filter(Boolean).map(panOnce).filter(Boolean);
}

export function panClip(text, className = '')
{
    const clip = document.createElement('span');
    const inner = document.createElement('span');
    clip.className = `la-pan-clip ${className}`.trim();
    inner.textContent = text;
    clip.append(inner);
    return clip;
}

document.addEventListener('mouseover', onHover, { passive: true });
