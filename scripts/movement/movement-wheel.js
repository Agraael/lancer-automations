import { playUiSound } from '../tah/sound.js';
import { floatDragFeedback } from './keybindings.js';
import { localize } from '../tools/string-utils.js';
import { openRadialWheel, closeRadialWheel, isRadialWheelOpen } from '../tools/radial-wheel.js';

import { MODULE_ID } from '../tools/constants.js';

function targetToken()
{
    const layer = /** @type {any} */ (canvas.tokens);
    return layer?._draggedToken ?? layer?.controlled?.[0] ?? null;
}

function localizedLabel(key, cfg)
{
    const raw = cfg?.label ?? key;
    try
    {
        return game.i18n?.localize?.(raw) ?? raw;
    }
    catch
    {
        return raw;
    }
}

const HIDDEN_ACTIONS = new Set();

function buildItems(token)
{
    const actions = /** @type {any} */ (CONFIG).Token?.movement?.actions ?? {};
    const current = token.document.movementAction;
    const items = [];
    for (const [key, cfg] of Object.entries(actions))
    {
        if (HIDDEN_ACTIONS.has(key))
            continue;
        const canSelect = /** @type {any} */ (cfg)?.canSelect;
        const isSelectable = key === current || (typeof canSelect === 'function' ? canSelect(token.document) : true);
        if (isSelectable)
            items.push({ key, cfg, current: key === current });
    }
    return items;
}

function commitSelection(key, token)
{
    if (!key || !token?.document)
        return;
    const layer = /** @type {any} */ (canvas.tokens);
    if (layer)
        layer._dragMovementAction = null;
    token.document.update({ movementAction: key });
    layer?.recalculatePlannedMovementPaths?.();
}

function buildIconContent(cfg, buttonEl)
{
    const img = /** @type {any} */ (cfg)?.img;
    const iconClass = /** @type {any} */ (cfg)?.icon || 'fa-solid fa-circle-question';
    if (img)
    {
        const url = /^(?:https?:|data:|\/)/.test(img) ? img : `/${img}`;
        const span = document.createElement('span');
        span.className = 'lancer-mw-icon';
        span.style.setProperty('--icon-url', `url("${url}")`);
        buttonEl.appendChild(span);
        return;
    }
    buttonEl.innerHTML = `<i class="${iconClass}"></i>`;
}

function openWheel(token)
{
    const moveItems = buildItems(token);
    if (!moveItems.length)
        return;
    openRadialWheel({
        token,
        rootClass: 'lancer-movement-wheel',
        showLabel: true,
        items: moveItems.map(({ key, cfg, current }) => ({
            key,
            title: localizedLabel(key, cfg),
            current,
            buildContent: (buttonEl) => buildIconContent(cfg, buttonEl),
            onSelect: () => commitSelection(key, token)
        }))
    });
}

export function toggleMovementWheel()
{
    if (isRadialWheelOpen())
    {
        closeRadialWheel(); return;
    }
    const token = targetToken();
    if (!token)
        return;
    openWheel(token);
}

Hooks.once('init', () =>
{
    game.keybindings.register(MODULE_ID, 'movementWheel', {
        name: 'LA.keybindings.movementWheel.name',
        hint: 'LA.keybindings.movementWheel.hint',
        editable: [{ key: 'KeyM' }],
        onDown: () =>
        {
            // Core Tab already cycles the action mid-drag, and handles shift-reverse.
            if (/** @type {any} */ (canvas.tokens)?._draggedToken)
                return false;
            toggleMovementWheel();
            return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
});

// Core's Tab cycle is silent; give it the wheel's feedback.
Hooks.once('ready', () =>
{
    if (!game.modules.get('lib-wrapper')?.active)
        return;
    libWrapper.register(MODULE_ID, 'foundry.canvas.layers.TokenLayer.prototype._onCycleViewKey', function(wrapped, event)
    {
        const dragging = !!this._draggedToken;
        const handled = wrapped.call(this, event);
        if (handled && dragging)
        {
            playUiSound('toggle');
            const label = CONFIG.Token?.movement?.actions?.[this._dragMovementAction]?.label;
            if (label)
                floatDragFeedback(localize(label));
        }
        return handled;
    }, 'WRAPPER');
});
