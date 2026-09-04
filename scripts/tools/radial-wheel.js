import { playUiSound } from '../tah/sound.js';

const INNER_RING_MAX = 8;
const BUTTON_SIZE = 44;
const RING_GAP = 14;
const OUTER_RING_OFFSET = BUTTON_SIZE + RING_GAP;
const HOVER_DEAD_ZONE = 18;
// Past this the wheel stops claiming the cursor, so a click there just closes.
const SELECT_BOUND_EXTRA = 125;
const SELECT_BOUND_SCALE = 0.85;
const LABEL_SIDE_MARGIN = 26;
const LABEL_MIN_WIDTH = 170;
const LABEL_PADDING = 22;
const SHORT_CLICK_MS = 300;
const SHORT_CLICK_DIST = 6;

let _wheelEl = null;
let _labelEl = null;
let _buttons = [];
let _positions = [];
let _items = [];
let _center = null;
let _boundRadius = 0;
let _token = null;
let _hoverIndex = -1;
let _rightPress = null;
let _onKey = null;
let _onClickOutside = null;
let _onMouseUp = null;
let _onMouseMove = null;
let _onCloseCb = null;

export function isRadialWheelOpen()
{
    return !!_wheelEl;
}

export function closeRadialWheel({ silent = false } = {})
{
    if (!_wheelEl)
        return;
    if (!silent)
        playUiSound('details');
    const el = _wheelEl;
    el.classList.add('closing');
    setTimeout(() => el.remove(), 120);
    _wheelEl = null;
    _labelEl = null;
    if (_onKey)
        document.removeEventListener('keydown', _onKey, true);
    if (_onClickOutside)
    {
        document.removeEventListener('mousedown', _onClickOutside, true);
        document.removeEventListener('pointerdown', _onClickOutside, true);
    }
    if (_onMouseUp)
        document.removeEventListener('pointerup', _onMouseUp, true);
    if (_onMouseMove)
        globalThis.removeEventListener('mousemove', _onMouseMove, true);
    _onKey = null;
    _onClickOutside = null;
    _onMouseUp = null;
    _onMouseMove = null;
    _buttons = [];
    _positions = [];
    _items = [];
    _center = null;
    _boundRadius = 0;
    _token = null;
    _hoverIndex = -1;
    _rightPress = null;
    const closeCb = _onCloseCb;
    _onCloseCb = null;
    closeCb?.();
}

function tokenScreenCenter(token)
{
    const center = token.center;
    const globalPt = canvas.stage.toGlobal({ x: center.x, y: center.y });
    const rect = canvas.app.view.getBoundingClientRect();
    return { x: globalPt.x + rect.left, y: globalPt.y + rect.top };
}

// Positions root and buttons from the token's current screen spot, rerun on pan / zoom.
function layoutWheel()
{
    if (!_wheelEl || !_token)
        return;
    const { x: centerX, y: centerY } = tokenScreenCenter(_token);
    const scale = canvas.stage.scale.x || 1;
    const tokenDim = Math.max(_token.w ?? 0, _token.h ?? 0) * scale;
    const innerRadius = Math.min(160, Math.max(70, tokenDim / 2 + 36));
    const outerCount = Math.max(0, _items.length - INNER_RING_MAX);
    const outerRadius = innerRadius + OUTER_RING_OFFSET;
    _wheelEl.style.left = `${centerX}px`;
    _wheelEl.style.top = `${centerY}px`;
    _center = { x: centerX, y: centerY };
    _positions = [];
    _buttons.forEach((button, flatIndex) =>
    {
        const onInner = flatIndex < INNER_RING_MAX || outerCount === 0;
        const ringCount = onInner ? Math.min(_items.length, INNER_RING_MAX) : outerCount;
        const ringIndex = onInner ? flatIndex : flatIndex - INNER_RING_MAX;
        const stagger = onInner ? 0 : Math.PI / ringCount;
        const angle = (ringIndex / ringCount) * Math.PI * 2 - Math.PI / 2 + stagger;
        const radius = onInner ? innerRadius : outerRadius;
        const offsetX = Math.cos(angle) * radius;
        const offsetY = Math.sin(angle) * radius;
        button.style.transform = `translate(calc(${offsetX}px - 50%), calc(${offsetY}px - 50%))`;
        _positions.push({ x: offsetX, y: offsetY });
    });
    _boundRadius = ((outerCount > 0 ? outerRadius : innerRadius) + SELECT_BOUND_EXTRA) * SELECT_BOUND_SCALE;
    if (_labelEl)
        _labelEl.style.maxWidth = `${Math.max(LABEL_MIN_WIDTH, (innerRadius - LABEL_SIDE_MARGIN) * 2)}px`;
}

function setHover(index)
{
    if (index === _hoverIndex || !_wheelEl)
        return;
    const previous = _items[_hoverIndex];
    _hoverIndex = index;
    for (let btnIndex = 0; btnIndex < _buttons.length; btnIndex++)
        _buttons[btnIndex].classList.toggle('hover', btnIndex === index);
    previous?.onHoverChange?.(false);
    const hovered = _items[index];
    hovered?.onHoverChange?.(true);
    if (_labelEl)
    {
        _labelEl.textContent = hovered?.title ?? '';
        _labelEl.style.display = hovered ? '' : 'none';
        if (hovered)
            shrinkLabelToLines();
    }
    if (index >= 0)
        playUiSound('statusHover');
}

// max-content measures the unwrapped text, so a wrapped plate keeps the full cap width.
function shrinkLabelToLines()
{
    _labelEl.style.width = 'max-content';
    const range = document.createRange();
    range.selectNodeContents(_labelEl);
    const textWidth = range.getBoundingClientRect().width;
    if (textWidth > 0)
        _labelEl.style.width = `${Math.ceil(textWidth) + LABEL_PADDING}px`;
}

function commitItem(index)
{
    const item = _items[index];
    if (!item)
        return;
    playUiSound('toggle');
    _buttons[index]?.classList.add('validated');
    setTimeout(() =>
    {
        closeRadialWheel({ silent: true });
        item.onSelect();
    }, 180);
}

// Like a TAH row right-click: show details, keep the wheel open.
function rightClickItem(index)
{
    const item = _items[index];
    if (!item?.onRightClick)
        return;
    playUiSound('details');
    item.onRightClick(_buttons[index]);
}

function createButton(item, flatIndex)
{
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lancer-mw-btn${item.current ? ' current' : ''}`;
    button.title = item.title ?? '';
    item.buildContent?.(button);
    item.styleButton?.(button);
    button.addEventListener('click', (event) =>
    {
        event.preventDefault();
        event.stopPropagation();
        commitItem(flatIndex);
    });
    button.addEventListener('contextmenu', (event) =>
    {
        if (!item.onRightClick)
            return;
        event.preventDefault();
        event.stopPropagation();
        rightClickItem(flatIndex);
    });
    button.addEventListener('mouseenter', () => setHover(flatIndex));
    return button;
}

// Rebuilds the open wheel in place, no sound or animation.
export function refreshRadialWheel(items)
{
    if (!_wheelEl)
        return;
    if (!items?.length)
    {
        closeRadialWheel();
        return;
    }
    _items[_hoverIndex]?.onHoverChange?.(false);
    for (const button of _buttons)
        button.remove();
    _buttons = [];
    _items = items;
    _hoverIndex = -1;
    items.forEach((item, flatIndex) =>
    {
        const button = createButton(item, flatIndex);
        _buttons.push(button);
        if (_labelEl)
            _wheelEl.insertBefore(button, _labelEl);
        else
            _wheelEl.appendChild(button);
    });
    if (_labelEl)
        _labelEl.style.display = 'none';
    layoutWheel();
}

export function openRadialWheel({ token, items, rootClass = '', showLabel = false, onClose = null })
{
    closeRadialWheel({ silent: true });
    if (!token || !items?.length)
        return;

    const root = document.createElement('div');
    root.className = `lancer-radial-wheel ${rootClass}`.trim();

    _buttons = [];
    items.forEach((item, flatIndex) =>
    {
        const button = createButton(item, flatIndex);
        _buttons.push(button);
        root.appendChild(button);
    });

    if (showLabel)
    {
        _labelEl = document.createElement('div');
        _labelEl.className = 'lancer-rw-name-label';
        _labelEl.style.display = 'none';
        root.appendChild(_labelEl);
    }

    document.body.appendChild(root);
    _wheelEl = root;
    _items = items;
    _token = token;
    _hoverIndex = items.findIndex(item => item.current);
    _onCloseCb = onClose;
    layoutWheel();
    playUiSound('details');

    setTimeout(() =>
    {
        if (!_wheelEl)
            return;
        _onKey = (event) =>
        {
            if (event.key === 'Escape')
            {
                event.preventDefault(); closeRadialWheel();
            }
        };
        _onClickOutside = (event) =>
        {
            if (!_center)
                return;
            // Click on a button: let its own handler run, don't double-fire here.
            if (_wheelEl && _wheelEl.contains(/** @type {Node} */(event.target)))
                return;
            if (/** @type {HTMLElement} */ (event.target)?.closest?.('.la-hud-popup, #la-hud'))
                return;
            // Right button passes through untouched so canvas pan can start, close decided at release.
            if (event.button !== 0)
            {
                if (event.type === 'pointerdown' && event.button === 2)
                    _rightPress = { x: event.clientX, y: event.clientY, time: Date.now() };
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (_hoverIndex >= 0 && _items[_hoverIndex])
            {
                commitItem(_hoverIndex);
                return;
            }
            closeRadialWheel();
        };
        _onMouseUp = (event) =>
        {
            if (event.button !== 2 || !_rightPress)
                return;
            const press = _rightPress;
            _rightPress = null;
            const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
            if (Date.now() - press.time >= SHORT_CLICK_MS || moved >= SHORT_CLICK_DIST)
                return;
            if (_hoverIndex >= 0 && _items[_hoverIndex]?.onRightClick)
            {
                rightClickItem(_hoverIndex);
                return;
            }
            closeRadialWheel();
        };
        _onMouseMove = (event) =>
        {
            if (!_center)
                return;
            const cursorX = event.clientX - _center.x;
            const cursorY = event.clientY - _center.y;
            const reach = Math.hypot(cursorX, cursorY);
            if (reach < HOVER_DEAD_ZONE || reach > _boundRadius)
            {
                setHover(-1);
                return;
            }
            let nearest = -1;
            let nearestDist = Infinity;
            for (let posIndex = 0; posIndex < _positions.length; posIndex++)
            {
                const dist = Math.hypot(cursorX - _positions[posIndex].x, cursorY - _positions[posIndex].y);
                if (dist < nearestDist)
                {
                    nearestDist = dist;
                    nearest = posIndex;
                }
            }
            setHover(nearest);
        };
        document.addEventListener('keydown', _onKey, true);
        document.addEventListener('mousedown', _onClickOutside, true);
        document.addEventListener('pointerdown', _onClickOutside, true);
        document.addEventListener('pointerup', _onMouseUp, true);
        globalThis.addEventListener('mousemove', _onMouseMove, true);
    }, 0);
}

Hooks.on('canvasPan', () => layoutWheel());
Hooks.on('canvasReady', () => closeRadialWheel());
