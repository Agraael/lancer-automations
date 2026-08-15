/* global canvas, PIXI, game, document, window, performance */

import { pixelToOffset } from "../../combat/grid-helpers.js";

import {
    pointerToWorld, suppressTokenInteraction, createPickerSession, createCursorPreview, createMultiPlusIndicator, gridLineWidth,
    makeText, gridTextResolution, applyTargetInfoLabel, HIT_LABEL_STYLE, hitLabelFontSize, paintSingleMarkCursor,
    suppressEvent, showOverlapStackPicker,
} from "../canvas-helpers.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";
import { broadcastToolPresence, clearToolPresence } from "../presence.js";
import { syncTargetShapes } from "../target-shapes.js";

// Cancel fn of the running picker (null when idle). Lets the launching button toggle it.
let _activeCancel = null;
export function isSingleTargetPickerActive()
{
    return !!_activeCancel;
}
export function cancelSingleTargetPicker()
{
    if (_activeCancel)
        _activeCancel();
}

/** Cardless single-target toggle picker. Click toggles game.user.targets and exits.
 *  Hold Shift to keep it open and target multiple tokens. `single` forces exactly one target (no multi). */
export function pickSingleTargetToggle(casterToken = null, { includeSelf = false, single = false, hitChanceFor = null, range = null } = {})
{
    playUiSound('targeting');
    return new Promise((resolve) =>
    {
        syncTargetShapes(); // reconcile to current targets (keeps still-targeted shapes; no-op outside a session)
        const allTokens = canvas.tokens.placeables.filter(t =>
        {
            if (!includeSelf && t.id === casterToken?.id)
                return false;
            if (t.document.hidden && !game.user.isGM) // hidden tokens: GM-only
                return false;
            return true;
        });

        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();
        // No multi-target affordance in single mode (Shift can't add a second target here).
        const plus = single ? { move()
        {},
        dispose()
        {} } : createMultiPlusIndicator();

        let hitLabel = null;
        if (hitChanceFor)
        {
            hitLabel = makeText('', HIT_LABEL_STYLE);
            hitLabel.style.fontSize = hitLabelFontSize();
            hitLabel.anchor.set(0.5, 1);
            hitLabel.eventMode = 'none';
            hitLabel.visible = false;
            canvas.stage.addChild(hitLabel);
        }
        const updateHitLabels = (hoveredToken) =>
        {
            if (!hitLabel)
                return;
            const res = hoveredToken ? hitChanceFor(hoveredToken) : null;
            if (!res)
            {
                hitLabel.visible = false;
                return;
            }
            applyTargetInfoLabel(hitLabel, res);
            hitLabel.resolution = gridTextResolution();
            hitLabel.position.set(hoveredToken.center.x, hoveredToken.bounds.top - gridLineWidth(3));
            hitLabel.visible = true;
        };

        const restoreTokenInteraction = suppressTokenInteraction();

        let closeStack = null;
        const closeStackPopup = () =>
        {
            closeStack?.();
            closeStack = null;
        };

        const doCleanup = () =>
        {
            _activeCancel = null;
            clearToolPresence('singlePick');
            disposeCursorPreview();
            plus.dispose();
            if (hitLabel)
            {
                hitLabel.destroy();
                hitLabel = null;
            }
            session.unbind();
            restoreTokenInteraction();
            closeStackPopup();
        };

        const toggleTarget = (token, keepOpen = false) =>
        {
            const already = Array.from(game.user.targets ?? []).some(t => t.id === token.id);
            token.setTarget(!already, { releaseOthers: single }); // single: replace any other target
            playUiSound('targetingConfirm');
            if (keepOpen && !single)
                return; // Shift: keep targeting (disabled in single mode)
            doCleanup();
            resolve(token);
        };

        const drawCursorHighlight = (tx, ty) =>
        {
            const { hoveredToken } = paintSingleMarkCursor(cursorPreview, tx, ty, { caster: casterToken, range, tokens: allTokens });
            updateHitLabels(hoveredToken);
            if (hoveredToken)
                broadcastToolPresence('singlePick', { tokens: [hoveredToken.id], relatedToken: casterToken });
            else
            {
                const cursorCell = pixelToOffset(tx, ty);
                broadcastToolPresence('singlePick', { cells: [`${cursorCell.col},${cursorCell.row}`], relatedToken: casterToken });
            }
        };

        const moveHandler = (event) =>
        {
            const { x: tx, y: ty } = pointerToWorld(event);
            drawCursorHighlight(tx, ty);
            plus.move(!!event?.data?.originalEvent?.shiftKey, tx, ty);
            const o = pixelToOffset(tx, ty);
            playTargetingMove(o.col, o.row);
        };

        const isTokenTargeted = (token) => Array.from(game.user.targets ?? []).some(target => target.id === token.id);
        const showStackPicker = (tokens, screenX, screenY) =>
        {
            closeStackPopup();
            closeStack = showOverlapStackPicker(tokens, screenX, screenY, {
                isSelected: isTokenTargeted,
                onPick: (token, event) => toggleTarget(token, !!event.shiftKey),
            });
        };

        const clickHandler = (event) =>
        {
            const shift = !!event?.data?.originalEvent?.shiftKey;
            const { x: tx, y: ty } = pointerToWorld(event);
            const tokensHere = allTokens.filter(token =>
            {
                const b = token.bounds;
                return tx >= b.left && tx <= b.right && ty >= b.top && ty <= b.bottom;
            });
            if (tokensHere.length === 0)
                return;
            if (tokensHere.length === 1)
            {
                toggleTarget(tokensHere[0], shift);
                return;
            }
            const originalEvent = event?.data?.originalEvent;
            showStackPicker(tokensHere, (originalEvent?.clientX ?? 0) + 10, (originalEvent?.clientY ?? 0) + 10);
        };

        const keyHandler = (event) =>
        {
            if (event.key === 'Escape')
            {
                suppressEvent(event);
                if (document.querySelector('.la-stack-picker'))
                {
                    closeStackPopup();
                    return;
                }
                playUiSound('toggle');
                doCleanup();
                resolve(null);
            }
        };

        const session = createPickerSession('pickSingleTargetToggle', () =>
        {
            try
            {
                doCleanup();
            }
            catch
            { /* */ }
            resolve(null);
        });
        _activeCancel = () =>
        {
            playUiSound('toggle');
            doCleanup();
            resolve(null);
        };
        session.bind({ move: moveHandler, click: clickHandler, key: keyHandler });
    });
}
