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
let liftZones = [];

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
    if (document.getElementById('hudzone') === hudZone)
        return;
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
    const liftValue = lift > 0 ? `${lift}px` : '';
    if (chat.style.getPropertyValue('--la-chat-lift') === liftValue)
        return;
    if (liftValue)
        chat.style.setProperty('--la-chat-lift', liftValue);
    else
        chat.style.removeProperty('--la-chat-lift');
}

function onLiftMutations(records)
{
    const zones = HUD_ZONE_IDS.map(id => document.getElementById(id));
    if (records.some(record => record.target !== document.body) || zones.some((zone, index) => zone !== liftZones[index]))
        observeLiftZones();
}

function observeLiftZones()
{
    liftSizes.disconnect();
    liftChanges.disconnect();
    liftChanges.observe(document.body, { childList: true });
    liftZones = HUD_ZONE_IDS.map(id => document.getElementById(id));

    for (const zone of liftZones.filter(Boolean))
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
    liftChanges = new MutationObserver(onLiftMutations);
    observeLiftZones();
    window.addEventListener('resize', liftChat);
    Hooks.on('collapseSidebar', liftChat);
}

Hooks.once('ready', watchChatLift);
