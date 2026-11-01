import { sightlineModeActive } from "../../movement/token-ruler.js";
import { getModuleSetting } from "../../tools/settings-utils.js";
import { MODULE_ID } from "../../tools/constants.js";
import { playUiSound } from "../../tah/sound.js";
import { isTypingTarget } from "../keybindings.js";
import { injectStyles } from "./measureStyles.js";

// Screen-space cursor that follows the mouse, showing the matching scene-control tool's icon.
let _toolCursorEl = null;
let _toolCursorKind = null;
let _toolCursorShown = false;

function ensureToolCursorEl()
{
    if (_toolCursorEl)
        return _toolCursorEl;
    injectStyles();
    const el = document.createElement('div');
    el.className = 'la-mt-distance-cursor';
    document.body.appendChild(el);
    _toolCursorEl = el;
    return el;
}

function positionToolCursor()
{
    if (!_toolCursorEl)
        return;
    _toolCursorEl.style.left = `${Math.round(_gLastClient.x)}px`;
    _toolCursorEl.style.top = `${Math.round(_gLastClient.y)}px`;
}

// 'ruler' -> fa-ruler glyph (matches the Measure Distance tool); 'target' -> the target-laser icon.
function setToolCursorKind(kind)
{
    if (kind === _toolCursorKind)
        return;
    _toolCursorKind = kind;
    const icon = document.createElement('i');
    if (kind === 'target')
        icon.className = 'mdi mdi-target';
    else
        icon.className = kind === 'eye' ? 'fa-solid fa-eye' : 'fa-solid fa-ruler';
    _toolCursorEl.classList.toggle('kind-ruler', kind !== 'target');
    _toolCursorEl.replaceChildren(icon);
}

function showToolCursor(show, kind)
{
    _toolCursorShown = show;
    if (!show)
    {
        if (_toolCursorEl)
            _toolCursorEl.style.display = 'none';
        return;
    }
    ensureToolCursorEl();
    setToolCursorKind(kind);
    positionToolCursor();
    _toolCursorEl.style.display = 'block';
}

function setCanvasCursorHidden(hidden)
{
    const view = canvas.app?.view;
    view?.classList?.toggle('la-mt-hide-cursor', hidden);
}

let _pickerCursorOn = false;
export function setPickerTargetCursor(on)
{
    if (on === _pickerCursorOn)
        return;
    _pickerCursorOn = on;
    const icon = on ? 'target' : desiredToolCursorIcon();
    setCanvasCursorHidden(!!icon);
    showToolCursor(!!icon, icon ?? 'ruler');
}

const CTRL_RULER_KEY = 'ctrlRulerMode';
const RULER_CURSOR_KEY = 'rulerToolCursor';
Hooks.once('init', () =>
{
    game.settings.register(MODULE_ID,CTRL_RULER_KEY, {
        scope: 'client',
        config: false,
        type: String,
        choices: {
            none: 'LA.settings.ctrlRulerMode.choices.none',
            tool: 'LA.settings.ctrlRulerMode.choices.tool',
            always: 'LA.settings.ctrlRulerMode.choices.always',
        },
        default: 'tool',
        onChange: () => refreshGlobalRulerDecoration(),
    });
    game.settings.register(MODULE_ID,RULER_CURSOR_KEY, {
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => refreshGlobalRulerDecoration(),
    });
});
// While a token drag is live, Ctrl belongs to Foundry's waypoint placement.
function tokenDragActive()
{
    return !!canvas.tokens?.preview?.children?.length;
}
function ctrlRulerMode()
{
    return getModuleSetting(CTRL_RULER_KEY, 'tool');
}
function targetCursorOn()
{
    return !!getModuleSetting(RULER_CURSOR_KEY, true);
}
function rulerCursorOn()
{
    return !!getModuleSetting(RULER_CURSOR_KEY, true);
}

const CTRL_RULER_HOLD_MS = 250;

// Global layer: cursor icon+sound for ruler ('always' mode) and targeting, open or not.
let _gCtrlHeld = false;
let _gPrevTool = null;
let _gDecoratedIcon = null;
const _gLastClient = { x: 0, y: 0 };

function desiredToolCursorIcon()
{
    if (game.activeTool === 'ruler' && rulerCursorOn())
        return sightlineModeActive() ? 'eye' : 'ruler';
    if (game.activeTool === 'target' && targetCursorOn())
        return 'target';
    return null;
}

function refreshGlobalRulerDecoration()
{
    const icon = desiredToolCursorIcon();
    if (icon === _gDecoratedIcon)
        return;
    _gDecoratedIcon = icon;
    playUiSound('toggle');
    setCanvasCursorHidden(icon !== null);
    showToolCursor(icon !== null, icon ?? 'ruler');
}

let _gCtrlTimer = null;

function cancelGlobalCtrlArm()
{
    clearTimeout(_gCtrlTimer);
    _gCtrlTimer = null;
}

function onGlobalCtrlKey(event)
{
    if (event.key !== 'Control')
    {
        if (event.type === 'keydown')
            cancelGlobalCtrlArm();
        return;
    }
    if (ctrlRulerMode() !== 'always')
        return;
    if (event.type === 'keyup')
    {
        cancelGlobalCtrlArm();
        if (!_gCtrlHeld)
            return;
        _gCtrlHeld = false;
        ui.controls?.activate({ tool: _gPrevTool || 'select' });
        _gPrevTool = null;
        return;
    }
    if (event.repeat || _gCtrlHeld || _gCtrlTimer || tokenDragActive() || isTypingTarget(event.target))
        return;
    _gCtrlTimer = setTimeout(() =>
    {
        _gCtrlTimer = null;
        if (tokenDragActive())
            return;
        _gCtrlHeld = true;
        _gPrevTool = game.activeTool;
        ui.controls?.activate({ tool: 'ruler' });
    }, CTRL_RULER_HOLD_MS);
}

function onGlobalWheel(event)
{
    if (event.ctrlKey)
        cancelGlobalCtrlArm();
}

function onGlobalCtrlBlur()
{
    cancelGlobalCtrlArm();
    if (!_gCtrlHeld)
        return;
    _gCtrlHeld = false;
    ui.controls?.activate({ tool: _gPrevTool || 'select' });
    _gPrevTool = null;
}

function onGlobalMove(event)
{
    _gLastClient.x = event.clientX;
    _gLastClient.y = event.clientY;
    if (_toolCursorShown)
        positionToolCursor();
}

let _globalRulerInited = false;
export function initGlobalCtrlRuler()
{
    if (_globalRulerInited)
        return;
    _globalRulerInited = true;
    injectStyles();
    document.addEventListener('keydown', onGlobalCtrlKey, true);
    document.addEventListener('keyup', onGlobalCtrlKey, true);
    document.addEventListener('mousemove', onGlobalMove, true);
    document.addEventListener('wheel', onGlobalWheel, { capture: true, passive: true });
    window.addEventListener('blur', onGlobalCtrlBlur);
    Hooks.on('activateSceneControls', () => refreshGlobalRulerDecoration());
    Hooks.on('lancer-automations.sightlineModeChanged', () => refreshGlobalRulerDecoration());
}

export { showToolCursor, setCanvasCursorHidden, tokenDragActive, ctrlRulerMode, CTRL_RULER_HOLD_MS };
