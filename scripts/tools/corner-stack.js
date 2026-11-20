import { MODULE_ID } from './constants.js';

const STACK_ID = 'la-corner-stack';
const HUD_GAP = 8;
const HUD_ZONE_IDS = ['hudzone', 'la-hudzone'];

let stack = null;
let hudZone = null;
let hudWatchers = [];
let busy = false;
let liftSizes = null;
let liftChanges = null;

function reserveHudRoom()
{
    const stackRect = stack.getBoundingClientRect();
    const scale = stack.offsetWidth ? stackRect.width / stack.offsetWidth : 1;
    const inColumn = [...(hudZone?.children ?? [])].map(node => node.getBoundingClientRect()).filter(rect => rect.left < stackRect.right && rect.right > stackRect.left);

    if (!inColumn.length)
    {
        stack.style.removeProperty('--la-corner-limit');
        return;
    }

    const hudTop = Math.min(...inColumn.map(rect => rect.top));
    stack.style.setProperty('--la-corner-limit', `${Math.max(0, (hudTop - stackRect.top - HUD_GAP) / scale)}px`);
}

function readBusy()
{
    return !!hudZone?.childElementCount;
}

function refreshCorner()
{
    reserveHudRoom();
    const next = readBusy();
    if (next === busy)
        return;
    busy = next;
    Hooks.callAll(`${MODULE_ID}.cornerBusyChanged`, busy);
}

function watchHudZone()
{
    const zone = document.getElementById('hudzone');
    if (zone === hudZone)
        return;
    hudWatchers.forEach(watcher => watcher.disconnect());
    hudWatchers = [];
    hudZone = zone;
    if (!zone)
        return;

    const children = new MutationObserver(refreshCorner);
    children.observe(zone, { childList: true });
    const size = new ResizeObserver(refreshCorner);
    size.observe(zone);
    hudWatchers = [children, size];
}

function trackHudZone()
{
    watchHudZone();
    refreshCorner();
}

export function isCornerBusy()
{
    return busy;
}

export function getCornerStack()
{
    if (stack?.isConnected)
        return stack;
    stack = document.createElement('div');
    stack.id = STACK_ID;
    (document.getElementById('ui-right-column-1') ?? document.body).prepend(stack);
    new MutationObserver(trackHudZone).observe(document.body, { childList: true });
    new ResizeObserver(reserveHudRoom).observe(stack);
    watchHudZone();
    busy = readBusy();
    return stack;
}

function liftChat()
{
    const chat = document.getElementById('chat-notifications');
    if (!chat)
        return;

    const chatRect = chat.getBoundingClientRect();
    const scale = chat.offsetWidth ? chatRect.width / chat.offsetWidth : 1;

    const tops = HUD_ZONE_IDS.flatMap(id => [...(document.getElementById(id)?.children ?? [])])
        .map(node => node.getBoundingClientRect())
        .filter(rect => rect.height && rect.left < chatRect.right && rect.right > chatRect.left)
        .map(rect => rect.top);

    const inputRow = Number.parseFloat(getComputedStyle(chat).gridTemplateRows.split(' ').at(-1)) || 0;
    const lift = tops.length ? (chatRect.bottom - Math.min(...tops)) / scale + HUD_GAP - inputRow : 0;

    chat.classList.toggle('la-chat-lifted', lift > 0);
    if (lift > 0)
        chat.style.setProperty('--la-chat-lift', `${lift}px`);
    else
        chat.style.removeProperty('--la-chat-lift');
}

function observeLiftZones()
{
    liftSizes.disconnect();
    liftChanges.disconnect();
    liftChanges.observe(document.body, { childList: true });

    for (const zone of HUD_ZONE_IDS.map(id => document.getElementById(id)).filter(Boolean))
    {
        liftChanges.observe(zone, { childList: true });
        liftSizes.observe(zone);
        zone.addEventListener('transitionend', liftChat);
    }

    liftChat();
}

function watchChatLift()
{
    liftSizes = new ResizeObserver(liftChat);
    liftChanges = new MutationObserver(observeLiftZones);
    observeLiftZones();
    window.addEventListener('resize', liftChat);
    Hooks.on('collapseSidebar', liftChat);
}

Hooks.once('ready', watchChatLift);
