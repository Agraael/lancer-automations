import { playUiSound } from '../tah/sound.js';
import { openRadialWheel, closeRadialWheel, isRadialWheelOpen } from '../tools/radial-wheel.js';

const MODULE_ID = 'lancer-automations';

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

// Bumps the layer override only; Foundry resets it at drag drop, so the change is per-drag.
function cycleDragMovementAction()
{
    const layer = /** @type {any} */ (canvas.tokens);
    const token = layer?._draggedToken;
    if (!token)
        return false;
    const items = buildItems(token);
    if (!items.length)
        return false;
    const keys = items.map(it => it.key);
    const currentAction = layer._dragMovementAction ?? token.document.movementAction;
    const idx = keys.indexOf(currentAction);
    const next = keys[(idx + 1 + keys.length) % keys.length];
    if (!next || next === currentAction)
        return false;
    layer._dragMovementAction = next;
    layer.recalculatePlannedMovementPaths?.();
    playUiSound('toggle');
    return true;
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
        name: 'Movement Type Wheel',
        hint: 'Outside a drag: open a radial picker. During a drag: cycle the active drag\'s action without touching the token.',
        editable: [{ key: 'KeyM' }],
        onDown: () =>
        {
            const layer = /** @type {any} */ (canvas.tokens);
            if (layer?._draggedToken)
            {
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
