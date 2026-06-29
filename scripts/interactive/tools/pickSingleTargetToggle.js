/* global canvas, PIXI, game, document, window, performance */

import {
    isHexGrid, getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets,
} from "../../combat/grid-helpers.js";

import {
    pointerToWorld, suppressTokenLayerClick, makeSafe, createCursorPreview,
} from "../canvas-helpers.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";

// Cancel fn of the running picker (null when idle). Lets the launching button toggle it.
let _activeCancel = null;
export function isSingleTargetPickerActive() {
    return !!_activeCancel;
}
export function cancelSingleTargetPicker() {
    if (_activeCancel)
        _activeCancel();
}

// Placed shapes, stamped per click and cleared on a fresh pick. Not tied to targets.
let _persistG = null;
let _persistPulse = null;  // ticker breathing the alpha
export function clearSingleTargetShape() {
    if (_persistPulse) {
        canvas.app.ticker.remove(_persistPulse);
        _persistPulse = null;
    }
    if (_persistG) {
        if (_persistG.parent)
            _persistG.parent.removeChild(_persistG);
        _persistG.destroy();
        _persistG = null;
    }
}
// chooseToken's yellow, stamped on the clicked token.
function addSinglePersistShape(token) {
    if (!token)
        return;
    if (!_persistG) {
        _persistG = new PIXI.Graphics();
        canvas.stage.addChild(_persistG); // above tokens
        _persistPulse = () => {
            // detach if torn down (scene change), don't write to a dead object
            if (!_persistG || _persistG.destroyed) {
                canvas.app.ticker.remove(_persistPulse);
                _persistPulse = null;
                _persistG = null;
                return;
            }
            _persistG.alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
        };
        canvas.app.ticker.add(_persistPulse);
    }
    _persistG.lineStyle(4, 0xffd84a, 0.85);
    _persistG.beginFill(0xffd84a, 0.22);
    if (isHexGrid()) {
        for (const o of getOccupiedOffsets(token))
            drawHexAt(_persistG, o.col, o.row);
    } else {
        _persistG.drawRect(token.document.x, token.document.y, token.document.width * canvas.grid.size, token.document.height * canvas.grid.size);
    }
    _persistG.endFill();
}

/** Cardless single-target toggle picker. Click toggles game.user.targets and exits.
 *  Hold Shift to keep it open and target multiple tokens. */
export function pickSingleTargetToggle(casterToken = null, { includeSelf = false } = {}) {
    return new Promise((resolve) => {
        clearSingleTargetShape(); // fresh pick clears old shapes
        const allTokens = canvas.tokens.placeables.filter(t => {
            if (!includeSelf && t.id === casterToken?.id)
                return false;
            if (t.document.hidden)
                return false;
            return true;
        });

        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();

        const prevInteractive = canvas.tokens.interactiveChildren;
        canvas.tokens.interactiveChildren = false;
        const restoreLayerClick = suppressTokenLayerClick();

        let safeMove, safeClick, safeAbort, safeKey;
        let stackPopupEl = null;
        let stackOutsideHandler = null;
        const closeStackPopup = () => {
            if (stackPopupEl) {
                stackPopupEl.remove();
                stackPopupEl = null;
            }
            if (stackOutsideHandler) {
                document.removeEventListener('pointerdown', stackOutsideHandler, true);
                stackOutsideHandler = null;
            }
        };

        const doCleanup = () => {
            _activeCancel = null;
            disposeCursorPreview();
            if (safeClick)
                canvas.stage.off('click', safeClick);
            if (safeAbort)
                canvas.stage.off('rightdown', safeAbort);
            if (safeMove)
                canvas.stage.off('pointermove', safeMove);
            if (safeKey)
                document.removeEventListener('keydown', safeKey, true);
            canvas.tokens.interactiveChildren = prevInteractive;
            restoreLayerClick();
            closeStackPopup();
        };

        const toggleTarget = (token, keepOpen = false) => {
            const already = Array.from(game.user.targets ?? []).some(t => t.id === token.id);
            token.setTarget(!already, { releaseOthers: false });
            playUiSound('targetingConfirm');
            addSinglePersistShape(token);
            if (keepOpen)
                return; // Shift: keep targeting
            doCleanup();
            resolve(token);
        };

        const drawCursorHighlight = (tx, ty) => {
            cursorPreview.clear();
            const hoveredToken = allTokens.find(token => {
                const b = token.bounds;
                return tx >= b.left && tx <= b.right && ty >= b.top && ty <= b.bottom;
            }) || null;
            const color = hoveredToken ? 0x0088ff : 0xff0000;
            const gridSize = canvas.grid.size;
            cursorPreview.lineStyle(2, color, 0.8);
            cursorPreview.beginFill(color, 0.4);
            if (hoveredToken) {
                if (isHexGrid()) {
                    for (const off of getOccupiedOffsets(hoveredToken))
                        drawHexAt(cursorPreview, off.col, off.row);
                } else {
                    cursorPreview.drawRect(
                        hoveredToken.document.x,
                        hoveredToken.document.y,
                        hoveredToken.document.width * gridSize,
                        hoveredToken.document.height * gridSize
                    );
                }
            } else {
                const cur = pixelToOffset(tx, ty);
                if (isHexGrid()) {
                    drawHexAt(cursorPreview, cur.col, cur.row);
                } else {
                    const c = getHexCenter(cur.col, cur.row);
                    cursorPreview.drawRect(c.x - gridSize / 2, c.y - gridSize / 2, gridSize, gridSize);
                }
            }
            cursorPreview.endFill();
        };

        const moveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            drawCursorHighlight(tx, ty);
            const o = pixelToOffset(tx, ty);
            playTargetingMove(o.col, o.row);
        };

        const showStackPicker = (tokens, screenX, screenY) => {
            closeStackPopup();
            const el = document.createElement('div');
            el.className = 'la-stack-picker';
            el.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;z-index:10000;background:#1c1c1c;border:2px solid #ff6400;border-radius:4px;padding:4px;min-width:160px;max-height:300px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-family:Signika,sans-serif;`;
            for (const token of tokens) {
                const isTargeted = Array.from(game.user.targets ?? []).some(t => t.id === token.id);
                const row = document.createElement('div');
                row.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;border-radius:3px;${isTargeted ? 'background:rgba(255,100,0,0.25);' : ''}`;
                row.innerHTML = `
                    <img src="${token.document.texture.src}" style="width:24px;height:24px;object-fit:contain;border:1px solid #555;border-radius:2px;background:#000;">
                    <span style="color:#fff;font-size:0.9em;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${token.name}</span>
                    ${isTargeted ? '<i class="fas fa-check" style="color:#5cff5c;"></i>' : ''}`;
                row.addEventListener('mouseenter', () => {
                    row.style.background = 'rgba(255,100,0,0.4)';
                });
                row.addEventListener('mouseleave', () => {
                    row.style.background = isTargeted ? 'rgba(255,100,0,0.25)' : 'transparent';
                });
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const keep = !!e.shiftKey;
                    toggleTarget(token, keep);
                    if (keep)
                        closeStackPopup();
                });
                el.appendChild(row);
            }
            document.body.appendChild(el);
            stackPopupEl = el;
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth)
                el.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
            if (r.bottom > window.innerHeight)
                el.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
            stackOutsideHandler = (e) => {
                if (stackPopupEl && !stackPopupEl.contains(/** @type {Node} */ (e.target)))
                    closeStackPopup();
            };
            setTimeout(() => document.addEventListener('pointerdown', stackOutsideHandler, true), 0);
        };

        const clickHandler = (event) => {
            const shift = !!event?.data?.originalEvent?.shiftKey;
            const { x: tx, y: ty } = pointerToWorld(event);
            const tokensHere = allTokens.filter(token => {
                const b = token.bounds;
                return tx >= b.left && tx <= b.right && ty >= b.top && ty <= b.bottom;
            });
            if (tokensHere.length === 0)
                return;
            if (tokensHere.length === 1) {
                toggleTarget(tokensHere[0], shift);
                return;
            }
            const oe = event?.data?.originalEvent;
            showStackPicker(tokensHere, (oe?.clientX ?? 0) + 10, (oe?.clientY ?? 0) + 10);
        };

        const keyHandler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (stackPopupEl) {
                    closeStackPopup();
                    return;
                }
                doCleanup();
                resolve(null);
            }
        };

        const safe = makeSafe('pickSingleTargetToggle', () => {
            try {
                doCleanup();
            } catch { /* */ }
            resolve(null);
        });
        _activeCancel = () => {
            doCleanup();
            resolve(null);
        };
        safeMove = safe(moveHandler);
        safeClick = safe(clickHandler);
        safeKey = safe(keyHandler);
        canvas.stage.on('pointermove', safeMove);
        canvas.stage.on('click', safeClick);
        document.addEventListener('keydown', safeKey, true);
    });
}
