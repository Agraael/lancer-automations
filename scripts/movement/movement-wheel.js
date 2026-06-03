/* global canvas, CONFIG, game, document, globalThis, Hooks, foundry */

import { playUiSound } from '../tah/sound.js';

const MODULE_ID = 'lancer-automations';

let _wheelEl = null;
let _onKey = null;
let _onClickOutside = null;
let _onMouseMove = null;
let _items = [];
let _center = null;
let _hoverIndex = -1;
let _heldOpen = false;
let _token = null;

function closeWheel({ silent = false } = {}) {
    if (!_wheelEl) return;
    if (!silent) playUiSound('details');
    _wheelEl.remove();
    _wheelEl = null;
    if (_onKey) document.removeEventListener('keydown', _onKey, true);
    if (_onClickOutside) {
        document.removeEventListener('mousedown', _onClickOutside, true);
        document.removeEventListener('pointerdown', _onClickOutside, true);
    }
    if (_onMouseMove) globalThis.removeEventListener('mousemove', _onMouseMove, true);
    _onKey = null;
    _onClickOutside = null;
    _onMouseMove = null;
    _items = [];
    _center = null;
    _hoverIndex = -1;
    _heldOpen = false;
    _token = null;
}

function targetToken() {
    const layer = /** @type {any} */ (canvas.tokens);
    return layer?._draggedToken ?? layer?.controlled?.[0] ?? null;
}

function tokenScreenCenter(token) {
    const c = token.center;
    const g = canvas.stage.toGlobal({ x: c.x, y: c.y });
    const r = canvas.app.view.getBoundingClientRect();
    return { x: g.x + r.left, y: g.y + r.top };
}

function localizedLabel(key, cfg) {
    const raw = cfg?.label ?? key;
    try { return game.i18n?.localize?.(raw) ?? raw; } catch { return raw; }
}

function buildItems(token) {
    const actions = /** @type {any} */ (CONFIG).Token?.movement?.actions ?? {};
    const current = token.document.movementAction;
    const out = [];
    for (const [key, cfg] of Object.entries(actions)) {
        const canSel = /** @type {any} */ (cfg)?.canSelect;
        const ok = key === current || (typeof canSel === 'function' ? canSel(token.document) : true);
        if (ok) out.push({ key, cfg, current: key === current });
    }
    return out;
}

function commitSelection(key, token) {
    if (!key || !token?.document) return;
    const layer = /** @type {any} */ (canvas.tokens);
    if (layer) layer._dragMovementAction = null;
    token.document.update({ movementAction: key });
    layer?.recalculatePlannedMovementPaths?.();
}

// Bumps the layer override only; Foundry resets it at drag drop, so the change is per-drag.
function cycleDragMovementAction() {
    const layer = /** @type {any} */ (canvas.tokens);
    const token = layer?._draggedToken;
    if (!token) return false;
    const items = buildItems(token);
    if (!items.length) return false;
    const keys = items.map(it => it.key);
    const cur = layer._dragMovementAction ?? token.document.movementAction;
    const idx = keys.indexOf(cur);
    const next = keys[(idx + 1 + keys.length) % keys.length];
    if (!next || next === cur) return false;
    layer._dragMovementAction = next;
    layer.recalculatePlannedMovementPaths?.();
    playUiSound('toggle');
    return true;
}

function setHover(idx) {
    if (idx === _hoverIndex || !_wheelEl) return;
    _hoverIndex = idx;
    for (let i = 0; i < _wheelEl.children.length; i++) {
        const btn = /** @type {HTMLElement} */ (_wheelEl.children[i]);
        btn.classList.toggle('hover', i === idx);
    }
    if (idx >= 0) playUiSound('statusHover');
}

function angleToIndex(angle) {
    if (!_items.length) return -1;
    const n = _items.length;
    let normalized = angle + Math.PI / 2;
    while (normalized < 0) normalized += Math.PI * 2;
    while (normalized >= Math.PI * 2) normalized -= Math.PI * 2;
    return Math.round(normalized / (Math.PI * 2) * n) % n;
}

function openWheel(token, heldOpen) {
    const items = buildItems(token);
    if (!items.length) return;

    const { x: cx, y: cy } = tokenScreenCenter(token);
    const scale = canvas.stage.scale.x || 1;
    const tokenDim = Math.max(token.w ?? 0, token.h ?? 0) * scale;
    const radius = Math.min(160, Math.max(70, tokenDim / 2 + 36));

    const root = document.createElement('div');
    root.className = 'lancer-movement-wheel';
    root.style.left = `${cx}px`;
    root.style.top = `${cy}px`;

    items.forEach(({ key, cfg, current }, i) => {
        const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2;
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `lancer-mw-btn${current ? ' current' : ''}`;
        btn.style.transform = `translate(calc(${dx}px - 50%), calc(${dy}px - 50%))`;
        const img = /** @type {any} */ (cfg)?.img;
        const iconCls = /** @type {any} */ (cfg)?.icon || 'fa-solid fa-circle-question';
        if (img) {
            const url = /^(?:https?:|data:|\/)/.test(img) ? img : `/${img}`;
            const span = document.createElement('span');
            span.className = 'lancer-mw-icon';
            span.style.setProperty('--icon-url', `url("${url}")`);
            btn.appendChild(span);
        } else {
            btn.innerHTML = `<i class="${iconCls}"></i>`;
        }
        btn.title = localizedLabel(key, cfg);
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            playUiSound('toggle');
            commitSelection(key, _token);
            closeWheel({ silent: true });
        });
        btn.addEventListener('mouseenter', () => setHover(i));
        root.appendChild(btn);
    });

    document.body.appendChild(root);
    _wheelEl = root;
    _items = items;
    _center = { x: cx, y: cy, radius };
    _heldOpen = heldOpen;
    _hoverIndex = items.findIndex(it => it.current);
    _token = token;
    playUiSound('details');

    setTimeout(() => {
        _onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); closeWheel(); }
        };
        _onClickOutside = (e) => {
            if (!_center) return;
            // Click on a button: let its own click handler run, don't double-fire here.
            if (_wheelEl && _wheelEl.contains(/** @type {Node} */(e.target))) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (_hoverIndex >= 0 && _items[_hoverIndex]) {
                playUiSound('toggle');
                commitSelection(_items[_hoverIndex].key, _token);
                closeWheel({ silent: true });
                return;
            }
            closeWheel();
        };
        _onMouseMove = (e) => {
            if (!_center) return;
            const dx = e.clientX - _center.x;
            const dy = e.clientY - _center.y;
            if (Math.hypot(dx, dy) < 18) {
                setHover(-1);
                return;
            }
            setHover(angleToIndex(Math.atan2(dy, dx)));
        };
        document.addEventListener('keydown', _onKey, true);
        document.addEventListener('mousedown', _onClickOutside, true);
        document.addEventListener('pointerdown', _onClickOutside, true);
        globalThis.addEventListener('mousemove', _onMouseMove, true);
    }, 0);
}

export function toggleMovementWheel() {
    if (_wheelEl) { closeWheel(); return; }
    const token = targetToken();
    if (!token) return;
    openWheel(token, false);
}

Hooks.once('init', () => {
    game.keybindings.register(MODULE_ID, 'movementWheel', {
        name: 'Movement Type Wheel',
        hint: 'Outside a drag: open a radial picker. During a drag: cycle the active drag\'s action without touching the token.',
        editable: [{ key: 'KeyM' }],
        onDown: () => {
            const layer = /** @type {any} */ (canvas.tokens);
            if (layer?._draggedToken) {
                cycleDragMovementAction();
                return true;
            }
            toggleMovementWheel();
            return true;
        },
        repeat: false,
        precedence: foundry.helpers.interaction.ClientKeybindings?.PRECEDENCE?.PRIORITY ?? 2
    });
});

Hooks.on('canvasPan', closeWheel);
Hooks.on('canvasReady', closeWheel);
