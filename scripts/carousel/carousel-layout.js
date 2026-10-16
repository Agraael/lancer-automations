const FLIP_MS = 200;
const ENTER_MS = 1000;
const ENTER_STAGGER_MS = 250;
const ENTER_SPREAD_MS = 1000;
const ENTER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EDGE_SPEED_PX = 7;

const _pendingScroll = new WeakMap();
let _edgeFrame = null;

export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function htmlToElement(html)
{
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
}

function placeAfter(parent, element, previous)
{
    const expected = previous ? previous.nextElementSibling : parent.firstElementChild;
    if (expected !== element)
        parent.insertBefore(element, expected);
}

function upsert(element, item)
{
    if (element && element.dataset.key === item.key)
        return element;
    const fresh = htmlToElement(item.html);
    fresh.dataset.key = item.key;
    if (element)
        element.replaceWith(fresh);
    return fresh;
}

function reconcileSlots(container, slots)
{
    const existing = new Map([...container.children].map(element => [element.dataset.id, element]));
    let previous = null;
    for (const slot of slots)
    {
        const element = upsert(existing.get(slot.id), slot);
        existing.delete(slot.id);
        placeAfter(container, element, previous);
        previous = element;
    }
    for (const stale of existing.values())
        stale.remove();
}

export function reconcileLanes(strip, lanes)
{
    const existing = new Map([...strip.children].map(element => [element.dataset.id, element]));
    let previous = null;
    for (const lane of lanes)
    {
        let element = existing.get(lane.key);
        existing.delete(lane.key);
        if (!element)
        {
            element = document.createElement('div');
            element.className = 'lac-lane';
            element.dataset.id = lane.key;
            element.append(document.createElement('div'));
            element.firstElementChild.className = 'lac-cards';
        }
        element.style.setProperty('--team', lane.color);
        const head = element.querySelector(':scope > .lac-head');
        const freshHead = upsert(head, lane.head);
        if (!head)
            element.prepend(freshHead);
        reconcileSlots(element.querySelector(':scope > .lac-cards'), lane.slots);
        placeAfter(strip, element, previous);
        previous = element;
    }
    for (const stale of existing.values())
        stale.remove();
}

export function indexSlots(strip)
{
    for (const lane of strip.children)
    {
        const cards = lane.querySelector(':scope > .lac-cards');
        const slots = [...cards.children];
        slots.forEach((slot, index) => slot.style.setProperty('--j', String(index)));
        cards.dataset.rest = String(Math.max(0, slots.findIndex(slot => slot.classList.contains('is-active'))));
    }
}

export function setPeak(cards, peak)
{
    cards.style.setProperty('--peak', String(peak));
    [...cards.children].forEach((slot, index) =>
    {
        slot.classList.toggle('win-l', index < peak);
        slot.classList.toggle('win-r', index > peak);
    });
}

export function resetPeaks(strip, keep = null)
{
    for (const cards of strip.querySelectorAll('.lac-cards'))
    {
        if (cards !== keep)
            setPeak(cards, Number(cards.dataset.rest) || 0);
    }
}

function contentOverflow(strip)
{
    const last = strip.lastElementChild;
    if (!last)
        return 0;
    return last.offsetLeft + last.offsetWidth + Number.parseFloat(getComputedStyle(strip).paddingRight) - strip.clientWidth;
}

export function fitStrip(strip, size, maxOverlap)
{
    for (const animation of strip.getAnimations({ subtree: true }))
    {
        if (animation.effect?.getKeyframes?.().some(frame => 'width' in frame))
            animation.finish();
    }
    strip.style.removeProperty('--ov');
    strip.classList.remove('is-overlap', 'is-scroll');
    const joints = strip.querySelectorAll('.lac-slot').length - strip.querySelectorAll('.lac-lane').length;
    const over = contentOverflow(strip);
    if (over > 1 && joints > 0)
    {
        const shift = Math.min(size * 1.25 * maxOverlap / 100 + 8, over / joints);
        strip.style.setProperty('--ov', `${shift.toFixed(1)}px`);
        strip.classList.toggle('is-overlap', shift > 8);
    }
    strip.classList.toggle('is-scroll', contentOverflow(strip) > 1);
}

export function edgeFade(strip)
{
    const max = strip.classList.contains('is-scroll') ? contentOverflow(strip) : 0;
    strip.classList.toggle('fade-l', max > 1 && strip.scrollLeft > 2);
    strip.classList.toggle('fade-r', max > 1 && strip.scrollLeft < max - 2);
}

const slotCenter = slot => slot.offsetLeft + slot.offsetWidth / 2;

function scrollToCenter(strip, center)
{
    const left = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, center - strip.clientWidth / 2));
    _pendingScroll.set(strip, left);
    strip.scrollTo({ left, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

export function resumeScroll(strip)
{
    const left = _pendingScroll.get(strip);
    if (left !== undefined)
        strip.scrollTo({ left, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

export function cancelScroll(strip)
{
    _pendingScroll.delete(strip);
}

export function stopEdgeScroll()
{
    cancelAnimationFrame(_edgeFrame);
    _edgeFrame = null;
}

export function bindEdges(main)
{
    const strip = main.querySelector('.lac-strip');
    strip.addEventListener('scrollend', () => cancelScroll(strip));
    for (const edge of main.querySelectorAll('.lac-edge'))
    {
        const direction = Number(edge.dataset.dir);
        edge.addEventListener('pointerenter', () =>
        {
            cancelScroll(strip);
            stopEdgeScroll();
            const step = () =>
            {
                const max = strip.scrollWidth - strip.clientWidth;
                strip.scrollLeft += direction * EDGE_SPEED_PX;
                const done = direction < 0 ? strip.scrollLeft <= 0 : strip.scrollLeft >= max - 1;
                _edgeFrame = done ? null : requestAnimationFrame(step);
            };
            _edgeFrame = requestAnimationFrame(step);
        });
        edge.addEventListener('pointerleave', stopEdgeScroll);
    }
}

export function centerActive(strip)
{
    const slot = strip.querySelector('.lac-slot.is-active');
    if (slot)
        scrollToCenter(strip, slotCenter(slot));
}

export function revealSlot(strip, slot)
{
    if (!slot || !strip.classList.contains('is-scroll'))
        return;
    const center = slotCenter(slot);
    const margin = slot.offsetWidth / 2;
    const viewLeft = _pendingScroll.get(strip) ?? strip.scrollLeft;
    if (center - margin < viewLeft || center + margin > viewLeft + strip.clientWidth)
        scrollToCenter(strip, center);
}

export function panNames(root)
{
    for (const clip of root.querySelectorAll('.lac-name-clip'))
    {
        const band = clip.parentElement;
        const over = (clip.firstElementChild?.offsetWidth ?? 0) - clip.clientWidth;
        band.classList.toggle('is-pan', over > 1);
        if (over > 1)
        {
            band.style.setProperty('--pan', `${-over}px`);
            band.style.setProperty('--pan-t', `${Math.max(2.5, over / 16).toFixed(2)}s`);
        }
    }
}

function uiScale(root)
{
    return root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
}

export function captureRects(root)
{
    const rects = new Map();
    for (const element of root.querySelectorAll('[data-flip]'))
    {
        const rect = element.getBoundingClientRect();
        rects.set(element.dataset.id, { x: rect.left, y: rect.top, width: element.offsetWidth });
    }
    return rects;
}

function playEnter(elements)
{
    const stagger = Math.min(ENTER_STAGGER_MS, ENTER_SPREAD_MS / Math.max(1, elements.length - 1));
    elements.forEach((element, index) => element.animate(
        [{ transform: 'translateY(-150%)' }, { transform: 'none' }],
        { duration: ENTER_MS, easing: ENTER_EASING, delay: index * stagger, fill: 'backwards' }
    ));
}

export function playFlip(root, previous, enterAll = false)
{
    if (reduceMotion())
        return;
    const scale = uiScale(root) || 1;
    const all = [...root.querySelectorAll('[data-flip]')];
    const entering = all.filter(element => enterAll || !previous.has(element.dataset.id));
    playEnter(entering);
    const elements = all.filter(element => !entering.includes(element));
    const finalWidths = new Map(elements.map(element => [element, element.offsetWidth]));
    const growing = elements.filter(element =>
    {
        const before = previous.get(element.dataset.id);
        return before && before.width !== finalWidths.get(element);
    });
    for (const element of growing)
    {
        element.style.transition = 'none';
        element.style.width = `${previous.get(element.dataset.id).width}px`;
    }
    const middle = new Map(elements.map(element => [element, element.getBoundingClientRect()]));
    for (const element of growing)
    {
        element.style.width = '';
        element.animate([{ width: `${previous.get(element.dataset.id).width}px` }, { width: `${finalWidths.get(element)}px` }], { duration: FLIP_MS, easing: 'ease-in-out' });
    }
    for (const element of elements)
    {
        const before = previous.get(element.dataset.id);
        if (!before)
            continue;
        const rect = middle.get(element);
        const dx = (before.x - rect.left) / scale;
        const dy = (before.y - rect.top) / scale;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
            element.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: 'ease-in-out' });
    }
    requestAnimationFrame(() => growing.forEach(element => element.style.removeProperty('transition')));
}
