import { pixelToOffset } from "../../combat/grid-helpers.js";
import {
    TG, pointerToWorld, suppressTokenInteraction, createPickerSession, createCursorPreview,
    createCtrlMarkIndicator, paintSingleMarkCursor, suppressEvent, showOverlapStackPicker, createTokenTether,
} from "../canvas-helpers.js";
import { createTokenMark } from "../target-shapes.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";
import { broadcastToolPresence, clearToolPresence } from "../presence.js";

let _activeCancel = null;

export function isCardlessTokenPickerActive()
{
    return !!_activeCancel;
}

export function cancelCardlessTokenPicker()
{
    _activeCancel?.();
}

function tokensAt(tokens, x, y)
{
    return tokens.filter(token =>
    {
        const bounds = token.bounds;
        return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    });
}

/**
 * Cardless token picker. A plain click replaces the selection and closes; Shift-click adds to it and
 * keeps going. Right click or Escape confirms what is marked. Never touches game.user.targets.
 * `linkFrom` tethers every pick back to those tokens, for reference picks like a duration origin.
 * @param {any} casterToken
 * @param {{includeSelf?: boolean, single?: boolean, preselected?: string[], markColor?: number, linkFrom?: any[]}} options
 * @returns {Promise<any[]>} picked tokens, in click order
 */
export function pickTokensCardless(casterToken = null, { includeSelf = true, single = false, preselected = [], markColor = TG.reference, linkFrom = [] } = {})
{
    playUiSound('targeting');
    return new Promise((resolve) =>
    {
        const allTokens = canvas.tokens.placeables.filter(token =>
        {
            if (!includeSelf && token.id === casterToken?.id)
                return false;
            if (token.document.hidden && !game.user.isGM)
                return false;
            return true;
        });

        /** @type {Map<string, {token: any, mark: any}>} */
        const picked = new Map();
        for (const id of preselected)
        {
            const token = allTokens.find(candidate => candidate.id === id);
            if (token)
                picked.set(id, { token, mark: createTokenMark(token, markColor) });
        }

        const anchors = linkFrom.filter(Boolean);
        const tether = anchors.length ? createTokenTether() : null;
        const refreshTether = (hoveredToken = null) =>
        {
            if (!tether)
                return;
            const ends = [...picked.values()].map(entry => entry.token);
            if (hoveredToken && !picked.has(hoveredToken.id))
                ends.push(hoveredToken);
            tether.setPairs(anchors.flatMap(anchor => ends.map(end => [anchor, end])));
        };
        refreshTether();

        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();
        let shiftHeld = game.keyboard?.isModifierActive?.('Shift') ?? false;
        let lastCursor = null;
        const indicator = createCtrlMarkIndicator({
            queryMarked: (x, y) =>
            {
                const here = tokensAt(allTokens, x, y);
                if (!here.length)
                    return null;
                return shiftHeld && !single && picked.has(here[0].id);
            },
            alwaysOn: true,
        });
        const onShiftKey = (event) =>
        {
            if (event.key !== 'Shift')
                return;
            shiftHeld = event.type === 'keydown';
            if (lastCursor)
                indicator.move(lastCursor.x, lastCursor.y);
        };
        document.addEventListener('keydown', onShiftKey, true);
        document.addEventListener('keyup', onShiftKey, true);

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
            clearToolPresence('tokenPick');
            for (const entry of picked.values())
                entry.mark.destroy();
            tether?.destroy();
            disposeCursorPreview();
            indicator.dispose();
            document.removeEventListener('keydown', onShiftKey, true);
            document.removeEventListener('keyup', onShiftKey, true);
            session.unbind();
            canvas.stage.off('rightdown', onRight);
            restoreTokenInteraction();
            closeStackPopup();
        };

        const finish = () =>
        {
            const tokens = [...picked.values()].map(entry => entry.token);
            doCleanup();
            resolve(tokens);
        };

        const unmark = (token) =>
        {
            picked.get(token.id)?.mark.destroy();
            picked.delete(token.id);
        };

        const pick = (token, keepOpen) =>
        {
            if (!keepOpen || single)
            {
                for (const entry of picked.values())
                    entry.mark.destroy();
                picked.clear();
                picked.set(token.id, { token, mark: createTokenMark(token, markColor) });
                playUiSound('tokenTarget');
                finish();
                return;
            }
            if (picked.has(token.id))
            {
                unmark(token);
                playUiSound('tokenUntarget');
                refreshTether();
                return;
            }
            picked.set(token.id, { token, mark: createTokenMark(token, markColor) });
            playUiSound('tokenTarget');
            refreshTether();
        };

        const moveHandler = (event) =>
        {
            const { x, y } = pointerToWorld(event);
            const { hoveredToken } = paintSingleMarkCursor(cursorPreview, x, y, { caster: casterToken, tokens: allTokens });
            shiftHeld = !!event?.data?.originalEvent?.shiftKey;
            lastCursor = { x, y };
            indicator.move(x, y);
            refreshTether(hoveredToken);
            const cell = pixelToOffset(x, y);
            if (hoveredToken)
                broadcastToolPresence('tokenPick', { tokens: [hoveredToken.id], relatedToken: casterToken });
            else
                broadcastToolPresence('tokenPick', { cells: [`${cell.col},${cell.row}`], relatedToken: casterToken });
            playTargetingMove(cell.col, cell.row);
        };

        const clickHandler = (event) =>
        {
            const originalEvent = event?.data?.originalEvent;
            const shift = !!originalEvent?.shiftKey;
            const { x, y } = pointerToWorld(event);
            const here = tokensAt(allTokens, x, y);
            if (!here.length)
                return;
            if (here.length === 1)
            {
                pick(here[0], shift);
                return;
            }
            closeStackPopup();
            closeStack = showOverlapStackPicker(here, (originalEvent?.clientX ?? 0) + 10, (originalEvent?.clientY ?? 0) + 10, {
                isSelected: (token) => picked.has(token.id),
                onPick: (token, stackEvent) => pick(token, !!stackEvent?.shiftKey),
            });
        };

        const onRight = (event) =>
        {
            suppressEvent(event?.data?.originalEvent ?? event);
            if (document.querySelector('.la-stack-picker'))
            {
                closeStackPopup();
                return;
            }
            finish();
        };

        const keyHandler = (event) =>
        {
            if (event.key !== 'Escape' && event.key !== 'Enter')
                return;
            suppressEvent(event);
            if (event.key === 'Escape' && document.querySelector('.la-stack-picker'))
            {
                closeStackPopup();
                return;
            }
            finish();
        };

        const session = createPickerSession('pickTokensCardless', () =>
        {
            try
            {
                doCleanup();
            }
            catch
            {
                void 0;
            }
            resolve([]);
        });
        _activeCancel = () =>
        {
            playUiSound('toggle');
            finish();
        };
        session.bind({ move: moveHandler, click: clickHandler, key: keyHandler });
        canvas.stage.on('rightdown', onRight);
    });
}
