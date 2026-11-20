import { MODULE_ID } from '../tools/constants.js';
import { addReinforcements, canUndoReinforcement, reinforcementClock, removeReinforcements, undoReinforcement } from './reinforcements.js';
import { clearMarkerSelection, selectMarkersIn, selectedMarkers } from './reinforcement-markers.js';

const TOKEN_LAYER = 'foundry.canvas.layers.TokenLayer.prototype';

let clipboard = [];
let copyCount = 0;
let markerCopy = -1;
let tokenCopy = -1;

function removeSelected()
{
    const picked = selectedMarkers();
    const byCombat = new Map();
    for (const { entry, combat } of picked)
        byCombat.set(combat, [...(byCombat.get(combat) ?? []), entry.id]);
    for (const [combat, ids] of byCombat)
        removeReinforcements(ids, combat);
    return picked.length > 0;
}

function copySelected(cut)
{
    const picked = selectedMarkers();
    if (!picked.length)
        return false;
    clipboard = picked.map(({ entry }) => foundry.utils.deepClone(entry));
    if (cut)
        removeSelected();
    return true;
}

function pasteClipboard(snap)
{
    const combat = game.combat;
    const scene = canvas.scene;
    if (!combat || !scene || !clipboard.length)
        return false;

    const anchor = clipboard.reduce((best, entry) => (entry.tokenData.y < best.tokenData.y || (entry.tokenData.y === best.tokenData.y && entry.tokenData.x < best.tokenData.x) ? entry : best), clipboard[0]);
    const doc = new CONFIG.Token.documentClass(anchor.tokenData, { parent: scene });
    const position = /** @type {any} */ (CONFIG.Token.objectClass)._getDropActorPosition(doc, canvas.mousePosition, { snap });
    const dx = position.x - anchor.tokenData.x;
    const dy = position.y - anchor.tokenData.y;
    const next = (combat.round ?? 0) + 1;

    const entries = clipboard.map((entry) =>
    {
        const copy = foundry.utils.deepClone(entry);
        copy.id = foundry.utils.randomID();
        copy.sceneId = scene.id;
        copy.tokenData.x += dx;
        copy.tokenData.y += dy;
        if (copy.clock && !reinforcementClock(copy))
            copy.clock = null;
        if (!copy.clock)
            copy.round = Math.max(copy.round, next);
        return copy;
    });

    addReinforcements(entries, combat);
    return true;
}

function onDeleteKey(wrapped, event)
{
    const removed = game.user.isGM && removeSelected();
    return wrapped(event) || removed;
}

function copyKey(layer, wrapped, event, cut)
{
    if (!game.user.isGM)
        return wrapped(event);

    copyCount++;
    const copied = copySelected(cut);
    if (copied)
        markerCopy = copyCount;
    if (copied && !layer.controlled.length)
        return true;
    tokenCopy = copyCount;
    return wrapped(event) || copied;
}

function onPasteKey(wrapped, event)
{
    if (!game.user.isGM)
        return wrapped(event);

    const pasted = markerCopy >= tokenCopy && pasteClipboard(!event.shiftKey);
    const handled = tokenCopy >= markerCopy && wrapped(event);
    return pasted || handled;
}

function onUndoKey(wrapped, event)
{
    if (!game.user.isGM || !canUndoReinforcement())
        return wrapped(event);
    undoReinforcement();
    return true;
}

function onSelectObjects(wrapped, rect = {}, options = {})
{
    const changed = wrapped(rect, options);
    const { x = 0, y = 0, width = 0, height = 0 } = rect;
    const added = selectMarkersIn(new PIXI.Rectangle(x, y, width, height), options.releaseOthers ?? true);
    return changed || added;
}

function onReleaseAll(wrapped, options)
{
    clearMarkerSelection();
    return wrapped(options);
}

export function initReinforcementSelect()
{
    libWrapper.register(MODULE_ID, `${TOKEN_LAYER}._onDeleteKey`, onDeleteKey, 'WRAPPER');
    libWrapper.register(MODULE_ID, `${TOKEN_LAYER}._onCopyKey`, function (wrapped, event)
    {
        return copyKey(this, wrapped, event, false);
    }, 'MIXED');
    libWrapper.register(MODULE_ID, `${TOKEN_LAYER}._onCutKey`, function (wrapped, event)
    {
        return copyKey(this, wrapped, event, true);
    }, 'MIXED');
    libWrapper.register(MODULE_ID, `${TOKEN_LAYER}._onPasteKey`, onPasteKey, 'MIXED');
    libWrapper.register(MODULE_ID, `${TOKEN_LAYER}._onUndoKey`, onUndoKey, 'MIXED');
    libWrapper.register(MODULE_ID, `${TOKEN_LAYER}.selectObjects`, onSelectObjects, 'WRAPPER');
    libWrapper.register(MODULE_ID, `${TOKEN_LAYER}.releaseAll`, onReleaseAll, 'WRAPPER');

    Hooks.on('controlToken', (_token, controlled) =>
    {
        if (controlled && !game.keyboard?.isModifierActive?.(/** @type {any} */ ('Shift')))
            clearMarkerSelection({ silent: true });
    });
}
