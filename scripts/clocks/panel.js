import { MODULE_ID } from '../tools/constants.js';
import { escapeHtml, localize } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { getCornerStack, isCornerBusy } from '../tools/corner-stack.js';
import { getHiddenForMe, getPanelSize, getWorldClocks, hideWorldClockForMe, isClockWindowEnabled, isWorldClockShownTo, openWorldClocksDialog, setPanelSize, setWorldClockValue, showHiddenForMe, worldClockActions, worldClockChip, worldClockFill } from '../tools/world-clocks.js';
import { pinnedClocks, unpinClock } from '../tools/clock-pins.js';
import { openRowActionsPopup } from '../tah/hud-popups.js';
import { playUiSound } from '../tah/sound.js';
import { paintSegments, pieHtml, ringHtml } from './glyphs.js';
import { SIZE_MS, fadeOut, fadeSegments, flashGlyph, peekIn, peekOut, popMs, popSegments, reduceMotion, resizeBox, showBanner, slideIn, slideOut, slideShift, staggerIn, staggerMs } from './motion.js';

const PANEL_ID = 'la-world-clocks';
const RING_SIZE = 24;
const PANEL_OUT_MS = 300;
const IDLE_MS = 6000;
const PEEK_MS = 4000;
const FULL_PAUSE_MS = 150;
const CUT_NAME_SLACK_PX = 4;
const OPEN_COLUMNS = 4;
const OPEN_LINES = 2;
const WHEEL_STEP_DELTA = 50;
const WHEEL_SETTLE_MS = 400;
const BLANK_LABEL = '\xa0';

const peeks = new Map();

let seenValues = null;
let shiftObserver = null;
let lastPanelTop = null;
let foldDismissed = false;
let idleTimer = null;
let idleRect = null;
let watchedPanel = null;
let clipTimer = null;
let closing = null;
let wheelCarry = 0;
let wheelTarget = null;
let wheelTimer = null;

function worldEntry(clock)
{
    const isGM = game.user.isGM;
    const hideAction = { label: localize('LA.clocks.hideForMe'), icon: 'mdi mdi-eye-off', onClick: () => hideWorldClockForMe(clock.lid) };
    return {
        key: clock.lid,
        section: 'world',
        name: clock.name,
        max: clock.max,
        value: clock.value,
        fill: worldClockFill(clock),
        editable: isGM,
        chip: isGM ? worldClockChip(clock) : null,
        subtitle: localize('LA.clocks.worldClock'),
        actions: () => (isGM ? [...worldClockActions(clock), hideAction] : [hideAction]),
        setValue: value => setWorldClockValue(clock.lid, value),
    };
}

function pinEntry(pin)
{
    const isBurden = pin.kind === 'burdens';
    return {
        key: pin.key,
        section: isBurden ? 'burdens' : 'pinned',
        name: pin.name,
        max: pin.max,
        value: pin.value,
        fill: pin.fill,
        editable: pin.pilot.isOwner,
        chip: { kind: 'pin', text: game.user.isGM ? pin.pilot.name : '' },
        subtitle: localize(isBurden ? 'LA.clocks.burden' : 'LA.clocks.pilotClock'),
        actions: () => [{ label: localize('LA.clocks.unpin'), icon: 'mdi mdi-pin-off', onClick: () => unpinClock(pin.key) }],
        setValue: pin.setValue,
    };
}

function shownWorldClocks()
{
    return getWorldClocks().filter(clock => isWorldClockShownTo(clock, game.user));
}

function entriesOf(clocks, pinList)
{
    const world = clocks.map(worldEntry);
    const pins = pinList.map(pinEntry);
    return [...world, ...pins.filter(entry => entry.section === 'pinned'), ...pins.filter(entry => entry.section === 'burdens')];
}

function panelEntries()
{
    const hidden = getHiddenForMe();
    return entriesOf(shownWorldClocks().filter(clock => !hidden.includes(clock.lid)), pinnedClocks());
}

function hiddenCount()
{
    const hidden = getHiddenForMe();
    return shownWorldClocks().filter(clock => hidden.includes(clock.lid)).length;
}

function displayName(entry)
{
    return entry.name || localize('LA.clocks.unnamed');
}

function sectionLabels(entries)
{
    const count = section => entries.filter(entry => entry.section === section).length;
    const mixed = count('world') > 0 && count('pinned') > 0;
    const besideBurdens = count('burdens') > 0 ? BLANK_LABEL : null;
    return {
        world: mixed ? localize('LA.tokenHud.label.environment') : besideBurdens,
        pinned: mixed ? localize('LA.clocks.pinned') : besideBurdens,
        burdens: localize('LA.clocks.tab.burdens'),
    };
}

function buildRow(entry)
{
    return htmlToElement(`<div class="lawc-row" data-key="${entry.key}"><span class="lawc-pie-slot"></span><span class="lawc-name"></span><span class="lawc-chip"></span></div>`);
}

function paintChip(row, chip)
{
    const chipEl = row.querySelector('.lawc-chip');
    chipEl.hidden = !chip;
    chipEl.className = `lawc-chip${chip ? ` lawc-chip--${chip.kind}` : ''}${chip?.kind === 'pin' && !chip.text ? ' lawc-chip--corner' : ''}`;
    chipEl.innerHTML = chip ? `${chip.kind === 'pin' ? '<i class="mdi mdi-pin"></i>' : ''}${escapeHtml(chip.text)}` : '';
}

function paintGlyph(node, entry, glyphHtml)
{
    const slot = node.querySelector('.lawc-pie-slot') ?? node;

    if (node.dataset.max !== String(entry.max))
    {
        node.dataset.max = String(entry.max);
        slot.replaceChildren(htmlToElement(glyphHtml(entry.max)));
    }

    paintSegments(slot, entry.value);
    node.style.setProperty('--lawc-tone', entry.fill);
    node.classList.toggle('lawc-row--editable', entry.editable);
}

function paintRow(row, entry)
{
    paintGlyph(row, entry, pieHtml);
    row.classList.toggle('lawc-row--done', entry.value >= entry.max);
    row.querySelector('.lawc-name').textContent = displayName(entry);
    paintChip(row, entry.chip);
}

function paintRing(ring, entry)
{
    paintGlyph(ring, entry, max => ringHtml(max, RING_SIZE));
    ring.dataset.tooltip = escapeHtml(`${entry.section === 'burdens' ? `${localize('LA.clocks.burden')}: ` : ''}${displayName(entry)} ${entry.value}/${entry.max}`);
}

function liveChildren(container)
{
    return [...container.children].filter(node => !node.classList.contains('lawc-leaving'));
}

function reconcile(container, items)
{
    const stale = new Map(liveChildren(container).map(node => [node.dataset.key, node]));
    items.forEach((item, position) =>
    {
        const node = stale.get(item.key) ?? item.build();
        stale.delete(item.key);
        item.paint(node);
        const current = liveChildren(container)[position];
        if (current !== node)
            container.insertBefore(node, current ?? null);
    });

    for (const node of stale.values())
    {
        if (node.classList.contains('lawc-section') || node.classList.contains('lawc-divider'))
        {
            node.remove();
            continue;
        }

        node.classList.add('lawc-leaving');
        slideOut(node, () => node.remove());
    }
}

function openColumns(entries)
{
    const count = section => entries.filter(entry => entry.section === section).length;
    const world = count('world');
    const pinned = count('pinned');
    const burdens = count('burdens');

    if (entries.length <= OPEN_COLUMNS)
        return { world, pinned, burdens, stacked: false };

    const stacked = pinned === 1 && burdens === 1;
    const half = amount => Math.ceil(amount / OPEN_LINES);
    const lowerColumns = stacked ? 1 : half(pinned) + half(burdens);
    return {
        world: Math.max(half(world), Math.min(world, OPEN_COLUMNS - lowerColumns)),
        pinned: stacked ? 1 : half(pinned),
        burdens: stacked ? 1 : half(burdens),
        stacked,
    };
}

function blockItems(entries)
{
    const labels = sectionLabels(entries);
    const columns = openColumns(entries);
    return ['world', 'pinned', 'burdens']
        .map(section => ({ section, list: entries.filter(entry => entry.section === section) }))
        .filter(({ list }) => list.length)
        .map(({ section, list }) => ({
            key: `block:${section}`,
            build: () => htmlToElement(`<div class="lawc-block" data-key="block:${section}"><div class="lawc-section"></div><div class="lawc-flow"></div></div>`),
            paint: (node) =>
            {
                const label = node.querySelector('.lawc-section');
                label.hidden = !labels[section];
                label.textContent = labels[section] ?? '';
                node.querySelector('.lawc-flow').style.setProperty('--lawc-cols', String(columns[section]));
                reconcile(node.querySelector('.lawc-flow'), list.map(entry => ({ key: entry.key, build: () => buildRow(entry), paint: row => paintRow(row, entry) })));
            },
        }));
}

function ringItems(entries)
{
    const hasOthers = entries.some(entry => entry.section !== 'burdens');
    const items = [];
    let dividerPlaced = false;

    for (const entry of entries)
    {
        if (entry.section === 'burdens' && hasOthers && !dividerPlaced)
        {
            dividerPlaced = true;
            items.push({ key: 'divider', build: () => htmlToElement('<span class="lawc-divider" data-key="divider"></span>'), paint: () => undefined });
        }

        items.push({ key: entry.key, build: () => htmlToElement(`<span class="lawc-ring" data-key="${entry.key}"></span>`), paint: node => paintRing(node, entry) });
    }

    return items;
}

function paintBar(panel, entries, size, hidden = hiddenCount())
{
    const titleKey = entries.some(entry => entry.section === 'burdens') ? 'LA.tokenHud.label.clocksBurdens' : 'LA.clocks.tab.clocks';
    panel.querySelector('.lawc-title').textContent = `${localize(titleKey)} · ${entries.length}`;
    const unhide = panel.querySelector('[data-action="unhide"]');
    unhide.hidden = !hidden || size !== 'open';
    unhide.querySelector('.lawc-hidden-count').textContent = String(hidden);
    const empty = !entries.length && !hidden;
    panel.classList.toggle('lawc-empty', empty);
    panel.querySelector('[data-action="size"]').hidden = empty;
}

function clearPeeks()
{
    for (const { node, timer } of peeks.values())
    {
        clearTimeout(timer);
        node.remove();
    }

    peeks.clear();
}

function showPeek(panel, entry)
{
    const known = peeks.get(entry.key);
    clearTimeout(known?.timer);
    const node = known?.node ?? htmlToElement('<div class="lawc-peek"><span class="lawc-name"></span><span class="lawc-count"></span></div>');
    node.style.setProperty('--lawc-tone', entry.fill);
    node.classList.toggle('lawc-row--done', entry.value >= entry.max);
    node.querySelector('.lawc-name').textContent = displayName(entry);
    node.querySelector('.lawc-count').textContent = `${entry.value}/${entry.max}`;

    if (!known)
    {
        const column = panel.querySelector('.lawc-peeks') ?? panel.appendChild(htmlToElement('<div class="lawc-peeks"></div>'));
        column.appendChild(node);
        peekIn(node);
    }

    const timer = setTimeout(() =>
    {
        peeks.delete(entry.key);
        peekOut(node, () => node.remove());
    }, PEEK_MS);

    peeks.set(entry.key, { node, timer });
    return node;
}

function animateValue(node, from, entry, peek)
{
    if (entry.value < from)
    {
        fadeSegments(node, from, entry.value);
        return;
    }

    popSegments(node, from, entry.value);
    if (entry.value < entry.max)
        return;
    setTimeout(() =>
    {
        if (node.classList.contains('lawc-ring'))
            flashGlyph(node);
        showBanner(peek ?? node, localize('LA.clocks.complete'));
    }, popMs(entry.value - from) + FULL_PAUSE_MS);
}

function playChangeSound(from, entry, byUser)
{
    if (entry.value <= from)
        return;
    if (entry.value >= entry.max)
        playUiSound('details');
    else if (byUser !== game.userId)
        playUiSound('toggle');
}

function onPointerWhileIdle(event)
{
    if (!idleRect || event.clientX < idleRect.left || event.clientX > idleRect.right || event.clientY < idleRect.top || event.clientY > idleRect.bottom)
        return;
    wakePanel(watchedPanel);
}

function goIdle(panel)
{
    if (!panel.isConnected)
        return;

    if (panel.matches(':hover') || document.querySelector('.la-hud-popup'))
    {
        wakePanel(panel);
        return;
    }

    watchedPanel = panel;
    idleRect = panel.getBoundingClientRect();
    panel.classList.add('lawc-idle');
    window.addEventListener('pointermove', onPointerWhileIdle, { passive: true });
}

function wakePanel(panel)
{
    window.removeEventListener('pointermove', onPointerWhileIdle);
    panel.classList.remove('lawc-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => goIdle(panel), IDLE_MS);
}

function effectiveSize()
{
    const saved = getPanelSize();
    return saved === 'open' && isCornerBusy() && !foldDismissed ? 'rings' : saved;
}

function clockNodes(list, size)
{
    if (size === 'open')
        return [...list.querySelectorAll('.lawc-row:not(.lawc-leaving)')];

    const strip = list.querySelector('.lawc-strip');
    return strip ? liveChildren(strip) : [];
}

function animateChanges(panel, entries, size, byUser)
{
    const before = seenValues;
    seenValues = new Map(entries.map(entry => [entry.key, entry.value]));
    if (!before)
        return;

    const list = panel.querySelector('.lawc-main .lawc-list');
    const nodes = clockNodes(list, size);

    for (const entry of entries)
    {
        const from = before.get(entry.key);
        if (from === entry.value)
            continue;
        wakePanel(panel);
        if (from !== undefined)
            playChangeSound(from, entry, byUser);

        const node = nodes.find(child => child.dataset.key === entry.key);
        if (!node)
            continue;
        if (from === undefined)
        {
            clipWhileMoving(panel, SIZE_MS);
            slideIn(node);
        }
        else
            animateValue(node, from, entry, size === 'rings' ? showPeek(panel, entry) : null);
    }
}

function entryOfNode(node)
{
    return panelEntries().find(entry => entry.key === node?.dataset.key);
}

function onSizeClick()
{
    if (getPanelSize() === 'open' && effectiveSize() === 'rings')
    {
        foldDismissed = true;
        renderPanel();
        return;
    }

    foldDismissed = getPanelSize() !== 'open' && isCornerBusy();
    setPanelSize(getPanelSize() === 'open' ? 'rings' : 'open');
}

function onPanelClick(event)
{
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'add')
        openWorldClocksDialog();
    else if (action === 'size')
        onSizeClick();
    else if (action === 'unhide')
        showHiddenForMe();
    else if (action === 'tour')
        import('../setup/tour.js').then(module => module.startTourAt('clocks-tour'));
    if (action)
        return;

    const segment = event.target.closest('.lawc-seg');
    const entry = entryOfNode(segment?.closest('.lawc-row, .lawc-ring'));

    if (!entry?.editable)
        return;

    const number = Number(segment.dataset.segment);
    playUiSound('toggle');
    entry.setValue(entry.value === number ? number - 1 : number);
}

function onPanelContextMenu(event)
{
    const node = event.target.closest('.lawc-row, .lawc-ring');
    const entry = entryOfNode(node);

    if (!entry)
        return;
    event.preventDefault();
    openRowActionsPopup(displayName(entry), entry.subtitle, entry.actions(), $(node));
}

function onPanelWheel(event)
{
    const list = event.currentTarget.querySelector('.lawc-list');
    if (event.currentTarget.dataset.size !== 'open' || list.scrollWidth <= list.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        return;
    event.preventDefault();
    wheelCarry += event.deltaMode ? event.deltaY * WHEEL_STEP_DELTA : event.deltaY;
    if (Math.abs(wheelCarry) < WHEEL_STEP_DELTA)
        return;

    const pitch = parseFloat(getComputedStyle(list.querySelector('.lawc-row')).width) + parseFloat(getComputedStyle(list).columnGap);
    const column = Math.round((wheelTarget ?? list.scrollLeft) / pitch) + Math.sign(wheelCarry);
    wheelCarry = 0;
    wheelTarget = Math.max(0, Math.min(column * pitch, list.scrollWidth - list.clientWidth));
    list.scrollTo({ left: wheelTarget, behavior: reduceMotion() ? 'auto' : 'smooth' });
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() =>
    {
        wheelTarget = null;
    }, WHEEL_SETTLE_MS);
}

function watchPanelShift(panel)
{
    lastPanelTop = panel.offsetTop;
    shiftObserver?.disconnect();
    shiftObserver = new ResizeObserver(() =>
    {
        const top = panel.offsetTop;
        if (top !== lastPanelTop)
            slideShift(panel, lastPanelTop - top);
        lastPanelTop = top;
        if (panel.classList.contains('lawc-idle'))
            idleRect = panel.getBoundingClientRect();
    });
    shiftObserver.observe(panel);
    shiftObserver.observe(getCornerStack());
}

function panelHtml()
{
    const addButton = game.user.isGM ? `<button type="button" data-action="add" data-tooltip="${localize('LA.common.add')}"><i class="lawc-empty-icon mdi mdi-clock-outline"></i><i class="fas fa-plus"></i></button>` : '';
    return `<div id="${PANEL_ID}"><div class="lau-bar"><span class="lawc-title"></span><span class="lau-spacer"></span><button type="button" data-action="unhide" data-tooltip="${localize('LA.clocks.showHidden')}" hidden><i class="mdi mdi-eye-off"></i> <span class="lawc-hidden-count"></span></button>${addButton}<button type="button" data-action="tour" data-tooltip="${localize('LA.configUi.startTour')}"><i class="fas fa-circle-question"></i></button><button type="button" data-action="size"><i class="mdi mdi-chevron-up"></i></button></div><div class="lawc-frame lawc-main"><div class="lawc-list"></div></div></div>`;
}

function createPanel()
{
    const panel = htmlToElement(panelHtml());
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('contextmenu', onPanelContextMenu);
    panel.addEventListener('wheel', onPanelWheel, { passive: false });
    getCornerStack().append(panel);
    watchPanelShift(panel);
    wakePanel(panel);
    return panel;
}

function removePanel(panel)
{
    if (!panel || panel.classList.contains('lawc-out'))
        return;
    clearTimeout(idleTimer);
    window.removeEventListener('pointermove', onPointerWhileIdle);
    stopClosing(panel);
    clearPeeks();

    if (reduceMotion())
    {
        panel.remove();
        return;
    }

    panel.classList.add('lawc-out');
    setTimeout(() =>
    {
        if (panel.classList.contains('lawc-out'))
            panel.remove();
    }, PANEL_OUT_MS);
}

function hintCutNames(list)
{
    for (const name of list.querySelectorAll('.lawc-name'))
    {
        if (name.scrollHeight > name.clientHeight + CUT_NAME_SLACK_PX)
            name.dataset.tooltip = escapeHtml(name.textContent);
        else
            delete name.dataset.tooltip;
    }
}

function paintMain(list, entries, size)
{
    if (size === 'open')
    {
        list.classList.toggle('lawc-list--stacked', openColumns(entries).stacked);
        reconcile(list, blockItems(entries));
        hintCutNames(list);
    }

    if (size === 'rings')
    {
        const strip = list.querySelector('.lawc-strip') ?? list.appendChild(htmlToElement('<div class="lawc-strip"></div>'));
        reconcile(strip, ringItems(entries));
    }
}

function boxOf(panel)
{
    return { width: panel.offsetWidth, height: panel.offsetHeight };
}

function repaintList(main, list, entries, size)
{
    list.replaceChildren();
    main.hidden = !entries.length;
    paintMain(list, entries, size);
}

function clipWhileMoving(panel, duration)
{
    panel.classList.add('lawc-resizing');
    clearTimeout(clipTimer);
    clipTimer = setTimeout(() => panel.classList.remove('lawc-resizing'), duration);
}

function slideContentIn(panel, nodes)
{
    clipWhileMoving(panel, Math.max(SIZE_MS, staggerMs(nodes.length)));
    staggerIn(nodes);
}

function settleBox(panel, from)
{
    const to = boxOf(panel);
    if (from.width === to.width && from.height === to.height)
        return;
    clipWhileMoving(panel, SIZE_MS);
    resizeBox(panel, from, to);
}

function openList(panel, main, list, entries, from)
{
    clearPeeks();
    repaintList(main, list, entries, 'open');
    resizeBox(panel, from, boxOf(panel));
    slideContentIn(panel, [...list.querySelectorAll('.lawc-section:not([hidden]), .lawc-row')]);
}

function stopClosing(panel)
{
    if (!closing)
        return;
    clearTimeout(closing.timer);
    closing.sizing?.cancel();
    closing = null;
    panel.classList.remove('lawc-closing');
}

function finishClosing(panel, main, list)
{
    stopClosing(panel);
    repaintList(main, list, panelEntries(), 'rings');
    slideContentIn(panel, [...list.querySelector('.lawc-strip').children]);
}

function closeList(panel, main, list, entries, from)
{
    const rows = [...list.children];
    repaintList(main, list, entries, 'rings');
    const to = boxOf(panel);
    panel.classList.add('lawc-closing', 'lawc-resizing');
    clearTimeout(clipTimer);
    main.hidden = false;
    list.replaceChildren(...rows);
    fadeOut(rows);
    closing = { sizing: resizeBox(panel, from, to, true), timer: setTimeout(() => finishClosing(panel, main, list), SIZE_MS) };
}

function renderMain(panel, entries, size)
{
    const main = panel.querySelector('.lawc-main');
    const list = main.querySelector('.lawc-list');

    if (closing && size === 'rings')
        return;

    const from = boxOf(panel);
    const previous = closing ? 'rings' : panel.dataset.size;
    stopClosing(panel);
    panel.dataset.size = size;

    if (previous === 'rings' && size === 'open')
    {
        openList(panel, main, list, entries, from);
        return;
    }

    if (previous === 'open' && size === 'rings' && !reduceMotion())
    {
        closeList(panel, main, list, entries, from);
        return;
    }

    if (previous === 'open' && size === 'rings')
    {
        repaintList(main, list, entries, size);
        return;
    }

    main.hidden = !entries.length;
    paintMain(list, entries, size);
    if (previous)
        settleBox(panel, from);
}

function renderPanel({ byUser } = {})
{
    const entries = panelEntries();
    const existing = document.getElementById(PANEL_ID);
    const empty = !entries.length && !hiddenCount();

    if (!isClockWindowEnabled() || (empty && !game.user.isGM))
    {
        removePanel(existing);
        seenValues = new Map();
        return;
    }

    if (existing?.classList.contains('lawc-out'))
    {
        existing.classList.remove('lawc-out');
        wakePanel(existing);
    }

    const panel = existing ?? createPanel();
    const size = empty ? 'rings' : effectiveSize();
    paintBar(panel, entries, size);
    renderMain(panel, entries, size);
    animateChanges(panel, entries, size, byUser);
}

export function clockPanelPreview({ clocks = [], pins = [], size = 'open', hidden = 0 })
{
    const entries = entriesOf(clocks, pins);
    const panel = htmlToElement(panelHtml());
    panel.dataset.size = size;
    paintBar(panel, entries, size, hidden);
    paintMain(panel.querySelector('.lawc-list'), entries, size);
    return panel;
}

Hooks.once('ready', () => renderPanel());
Hooks.on(`${MODULE_ID}.worldClocksChanged`, renderPanel);
Hooks.on(`${MODULE_ID}.cornerBusyChanged`, (busy) =>
{
    if (!busy)
        foldDismissed = false;
    renderPanel();
});
