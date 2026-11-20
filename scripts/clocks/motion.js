const POP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SLIDE_EASE = 'cubic-bezier(0.075, 0.82, 0.165, 1)';
const SEGMENT_STAGGER_MS = 70;
const POP_MS = 300;
const SLIDE_IN_MS = 300;
const SLIDE_OUT_MS = 250;
const BANNER_MS = 1500;
const FADE_OUT_MS = 120;
const STAGGER_MS = 25;

export const SIZE_MS = 300;

export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function popSegments(root, from, to)
{
    if (reduceMotion())
        return;

    for (let segment = from + 1; segment <= to; segment++)
    {
        root.querySelector(`[data-segment="${segment}"]`)?.animate(
            [{ transform: 'scale(1.5)', filter: 'brightness(3)' }, { transform: 'scale(1)', filter: 'brightness(1)' }],
            { duration: POP_MS, delay: (segment - from - 1) * SEGMENT_STAGGER_MS, easing: POP_EASE, fill: 'backwards' }
        );
    }
}

export function popMs(count)
{
    return POP_MS + ((count - 1) * SEGMENT_STAGGER_MS);
}

export function fadeSegments(root, from, to)
{
    if (reduceMotion())
        return;
    for (let segment = to + 1; segment <= from; segment++)
        root.querySelector(`[data-segment="${segment}"]`)?.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220 });
}

export function flashGlyph(root)
{
    if (reduceMotion())
        return;
    root.querySelector('.lawc-pie')?.animate(
        [{ filter: 'brightness(1)' }, { filter: 'brightness(2.6) drop-shadow(0 0 6px #fff)' }, { filter: 'brightness(1)' }],
        { duration: 420, iterations: 2 }
    );
}

export function showBanner(row, text)
{
    if (reduceMotion())
        return;

    const banner = document.createElement('div');
    banner.className = 'lawc-banner';
    banner.textContent = text;
    row.appendChild(banner);
    banner.animate([
        { clipPath: 'inset(0 100% 0 0)', opacity: 1, offset: 0 },
        { clipPath: 'inset(0 0 0 0)', opacity: 1, offset: 0.2 },
        { clipPath: 'inset(0 0 0 0)', opacity: 1, offset: 0.75 },
        { clipPath: 'inset(0 0 0 0)', opacity: 0, offset: 1 },
    ], { duration: BANNER_MS, easing: 'ease-out', fill: 'forwards' });
    setTimeout(() => banner.remove(), BANNER_MS);
}

function openKeyframes(node)
{
    const style = getComputedStyle(node);
    return {
        closed: { transform: 'translateX(40px)', opacity: 0, height: '0px', marginTop: '0px', paddingTop: '0px', paddingBottom: '0px' },
        open: { transform: 'none', opacity: 1, height: `${node.offsetHeight}px`, marginTop: style.marginTop, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom },
    };
}

export function slideIn(node)
{
    if (reduceMotion())
        return;

    const { closed, open } = openKeyframes(node);
    node.animate([closed, open], { duration: SLIDE_IN_MS, easing: SLIDE_EASE });
}

export function slideOut(node, done)
{
    if (reduceMotion())
    {
        done();
        return;
    }

    const { closed, open } = openKeyframes(node);
    node.animate([open, closed], { duration: SLIDE_OUT_MS, easing: 'ease-in', fill: 'forwards' });
    setTimeout(done, SLIDE_OUT_MS);
}

export function resizeBox(node, from, to, hold = false)
{
    if (reduceMotion() || (from.width === to.width && from.height === to.height))
        return null;
    return node.animate(
        [{ width: `${from.width}px`, height: `${from.height}px` }, { width: `${to.width}px`, height: `${to.height}px` }],
        { duration: SIZE_MS, easing: SLIDE_EASE, fill: hold ? 'forwards' : 'none' }
    );
}

export function fadeOut(nodes)
{
    if (reduceMotion())
        return;
    nodes.forEach(node => node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_OUT_MS, fill: 'forwards' }));
}

export function peekIn(node)
{
    if (reduceMotion())
        return;
    node.animate(
        [{ width: '0px', minWidth: '0px', paddingInline: '0px', opacity: 0 }, { width: `${node.offsetWidth}px`, opacity: 1 }],
        { duration: SIZE_MS, easing: SLIDE_EASE }
    );
}

export function peekOut(node, done)
{
    if (reduceMotion())
    {
        done();
        return;
    }

    node.animate(
        [{ width: `${node.offsetWidth}px`, opacity: 1 }, { width: '0px', minWidth: '0px', paddingInline: '0px', opacity: 0 }],
        { duration: SLIDE_OUT_MS, easing: 'ease-in', fill: 'forwards' }
    );
    setTimeout(done, SLIDE_OUT_MS);
}

export function staggerMs(count)
{
    return SLIDE_IN_MS + (count * STAGGER_MS);
}

export function staggerIn(nodes)
{
    if (reduceMotion())
        return;
    nodes.forEach((node, index) => node.animate(
        [{ transform: 'translateX(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: SLIDE_IN_MS, delay: index * STAGGER_MS, easing: SLIDE_EASE, fill: 'backwards' }
    ));
}

export function slideShift(node, distance)
{
    if (reduceMotion())
        return;
    node.animate([{ transform: `translateY(${distance}px)` }, { transform: 'none' }], { duration: 220, easing: POP_EASE });
}
