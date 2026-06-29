/* global canvas, PIXI, game, ui, $, document, globalThis */

import {
    isHexGrid, getHexCenter,
    drawHexAt, getOccupiedOffsets,
    getDistanceTokenToPoint,
    snapTokenCenter, getOccupiedGridSpaces, getInRangeOffsets,
} from "../../combat/grid-helpers.js";
import { getHexGroundElevation } from "../../combat/terrain-utils.js";
import { keyCodesFor } from "../keybindings.js";

import {
    _queueCardUrgent, _createInfoCard, _updateInfoCard, _removeInfoCard,
} from "../cards.js";

import {
    pointerToWorld, addGraphicsBelowTokens, suppressTokenLayerClick, destroyGraphics,
    makeSafe, createCursorPreview, drawRangeHighlight, applyKnockbackMoves,
} from "../canvas-helpers.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";

export function knockBackToken(tokens, distance, options = {}) {
    const _title = options.title || 'KNOCKBACK';
    return _queueCardUrgent(() => new Promise((resolve) => {
        // reactive card: jumps any open mount-pick / weapon-pick card already in the queue.
        const {
            title = "KNOCKBACK",
            description = "Select destination for each token.",
            icon,
            headerClass = "",
            triggeringToken = null,
            actionName = "",
            item = null,
            asVoluntary = false
        } = options;

        if (!tokens || (Array.isArray(tokens) && tokens.length === 0)) {
            resolve([]);
            return;
        }

        // State
        const tokenList = Array.isArray(tokens) ? tokens : [tokens];
        let activeIndex = 0;
        const moves = new Map();

        // Visuals
        let rangeHighlight = null;
        const traces = new Map(); // tokenId -> Graphics
        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();

        // Auto elevation follows the terrain under the active token's destination; Q/E shifts an offset.
        let pendingElevationOffset = 0;
        let lastDest = null;
        const groundUnder = (tok, dest) => {
            const tAPI = globalThis.terrainHeightTools;
            if (!tAPI)
                return 0;
            let max = 0;
            for (const o of getOccupiedOffsets(tok, dest)) {
                const h = Number(getHexGroundElevation(o.col, o.row, tAPI)) || 0;
                if (h > max)
                    max = h;
            }
            return max;
        };
        const elevAtDest = (tok, dest) => groundUnder(tok, dest) + pendingElevationOffset;
        const elevStr = (e) => e > 0 ? `↑ ${e}` : e < 0 ? `↓ ${-e}` : `↕ 0`;
        const cursorElevLabel = new PIXI.Text('', {
            fontFamily: 'Arial', fontSize: Math.max(14, canvas.grid.size * 0.22),
            fill: 0xffffff, stroke: 0x000000, strokeThickness: 4, fontWeight: 'bold',
        });
        cursorElevLabel.anchor.set(0.5);
        cursorElevLabel.visible = false;
        canvas.stage.addChild(cursorElevLabel);
        const updateElevLabel = (tok, dest) => {
            const c = tok.getCenterPoint(dest);
            cursorElevLabel.text = elevStr(elevAtDest(tok, dest));
            cursorElevLabel.x = c.x;
            cursorElevLabel.y = c.y - canvas.grid.size * 0.45;
            cursorElevLabel.visible = true;
        };

        const restoreLayerClick = suppressTokenLayerClick();
        let safeMove, safeClick, safeAbort, safeKey;

        const doCleanup = () => {
            if (safeClick)
                canvas.stage.off('click', safeClick);
            if (safeAbort)
                canvas.stage.off('rightdown', safeAbort);
            if (safeMove)
                canvas.stage.off('pointermove', safeMove);
            if (safeKey)
                document.removeEventListener('keydown', safeKey, true);
            restoreLayerClick();

            disposeCursorPreview();
            destroyGraphics(cursorElevLabel);
            destroyGraphics(rangeHighlight);
            for (const g of traces.values())
                destroyGraphics(g);

            _removeInfoCard(cardEl);
            $(`head style#la-kb-styles`).remove();
        };

        // UI Card
        const cardEl = _createInfoCard("knockBack", {
            title,
            icon,
            headerClass,
            description,
            range: distance,
            count: tokenList.length,
            onConfirm: async () => {
                const moveList = [];
                for (const [id, move] of moves.entries()) {
                    const t = tokenList.find(t => t.id === id);
                    if (t) {
                        moveList.push({ tokenId: id, updateData: { x: move.x, y: move.y, elevation: move.elevation } });
                    }
                }

                if (game.user.isGM) {
                    await applyKnockbackMoves(moveList, triggeringToken, distance, actionName, item, { asVoluntary });
                } else {
                    game.socket.emit('module.lancer-automations', {
                        action: "moveTokens",
                        payload: {
                            moves: moveList,
                            triggeringTokenId: triggeringToken?.id || null,
                            distance,
                            actionName,
                            itemId: item?.id || null,
                            asVoluntary
                        }
                    });
                }

                doCleanup();
                resolve([]);
            },

            onCancel: () => {
                doCleanup();
                resolve(null);
            }
        });

        if ($('head style#la-kb-styles').length === 0) {
            $('head').append(`
                <style id="la-kb-styles">
                    .la-knockback-list {
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                        max-height: 200px;
                        overflow-y: auto;
                    }
                    .la-knockback-item {
                        display: flex;
                        align-items: center;
                        padding: 4px;
                        border-radius: 4px;
                        cursor: pointer;
                        background: rgba(0,0,0,0.1);
                        border: 1px solid transparent;
                    }
                    .la-knockback-item:hover {
                        background: rgba(0,0,0,0.2);
                    }
                    .la-knockback-item.la-kb-active {
                        border-color: var(--lancer-color-orange, #ff6400);
                        background: rgba(255, 100, 0, 0.1);
                    }
                    .la-knockback-item.la-kb-moved .la-kb-name {
                        text-decoration: line-through;
                        opacity: 0.7;
                    }
                    .la-kb-img {
                        width: 24px;
                        height: 24px;
                        margin-right: 8px;
                        border: 1px solid #000;
                    }
                    .la-kb-name {
                        flex: 1;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .la-kb-status {
                        width: 20px;
                        text-align: center;
                    }
                </style>
            `);
        }

        const drawTrace = (token, targetX, targetY) => {
            if (traces.has(token.id))
                destroyGraphics(traces.get(token.id));

            const trace = new PIXI.Graphics();
            const gridSize = canvas.grid.size;

            // Draw Original Position (Yellow)
            trace.lineStyle(2, 0xffff00, 0.8);
            trace.beginFill(0xffff00, 0.3);
            for (const o of getOccupiedOffsets(token)) {
                if (isHexGrid())
                    drawHexAt(trace, o.col, o.row);
                else {
                    const c = getHexCenter(o.col, o.row); trace.drawRect(c.x - gridSize / 2, c.y - gridSize / 2, gridSize, gridSize);
                }
            }
            trace.endFill();

            // Draw Target Position (Orange)
            trace.lineStyle(2, 0xff6400, 0.8);
            trace.beginFill(0xff6400, 0.3);
            for (const o of getOccupiedOffsets(token, { x: targetX, y: targetY })) {
                if (isHexGrid())
                    drawHexAt(trace, o.col, o.row);
                else {
                    const c = getHexCenter(o.col, o.row); trace.drawRect(c.x - gridSize / 2, c.y - gridSize / 2, gridSize, gridSize);
                }
            }
            trace.endFill();

            // Draw Line
            const centerStart = token.center;
            const centerEnd = { x: targetX + token.w/2, y: targetY + token.h/2 };
            trace.lineStyle(3, 0xffffff, 1);
            trace.moveTo(centerStart.x, centerStart.y);
            trace.lineTo(centerEnd.x, centerEnd.y);

            addGraphicsBelowTokens(trace);
            traces.set(token.id, trace);
        };

        const updateVisuals = () => {
            // 1. Range Highlight for ACTIVE token
            const activeToken = tokenList[activeIndex];
            if (activeToken) {
                destroyGraphics(rangeHighlight);
                // Range is from the token's current position (skip highlight if infinite)
                if (distance >= 0)
                    rangeHighlight = drawRangeHighlight(activeToken, distance, 0x888888, 0.1, true);
            }
        };

        const updateCard = () => {
            _updateInfoCard(cardEl, "knockBack", {
                tokens: tokenList,
                moves,
                activeIndex,
                onSelectToken: (idx) => {
                    activeIndex = idx;
                    updateCard();
                    updateVisuals();
                }
            });
        };


        // Handlers
        const moveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);

            const activeToken = tokenList[activeIndex];
            if (!activeToken)
                return;

            const snapped = snapTokenCenter(activeToken, {x: tx, y: ty});
            const snappedX = snapped.x;
            const snappedY = snapped.y;
            const gridSize = canvas.grid.size;

            // Check validity (distance; -1 = infinite)
            const dist = getDistanceTokenToPoint({ x: snappedX + activeToken.w/2, y: snappedY + activeToken.h/2 }, activeToken);
            const offsets = getOccupiedOffsets(activeToken, { x: snappedX, y: snappedY });
            if (offsets[0])
                playTargetingMove(offsets[0].col, offsets[0].row);
            const inRangeSet = distance < 0 ? null : getInRangeOffsets(activeToken, distance, { includeSelf: true });
            const inRange = distance < 0 || (dist <= distance && offsets.some(o => inRangeSet.has(`${o.col},${o.row}`)));

            // Check overlap
            const otherOccupied = getOccupiedGridSpaces([activeToken.id]);

            // Draw Cursor
            cursorPreview.clear();

            for (const o of offsets) {
                const key = `${o.col},${o.row}`;
                const isOverlapping = otherOccupied.has(key);

                // Color logic
                let color, alpha;
                if (!inRange) {
                    color = 0x555555; // Greyish for out of range
                    alpha = 0.5;
                } else if (isOverlapping) {
                    color = 0xff0000;
                    alpha = 0.6;
                } else {
                    color = 0x0088ff; // Blue valid
                    alpha = 0.4;
                }

                if (!inRange) {
                    color = 0xff0000;
                } else if (isOverlapping) {
                    color = 0xff0000;
                }

                cursorPreview.lineStyle(2, color, 0.8);
                cursorPreview.beginFill(color, alpha);
                if (isHexGrid()) {
                    drawHexAt(cursorPreview, o.col, o.row);
                } else {
                    const center = getHexCenter(o.col, o.row);
                    cursorPreview.drawRect(center.x - gridSize/2, center.y - gridSize/2, gridSize, gridSize);
                }
                cursorPreview.endFill();
            }
            lastDest = { x: snappedX, y: snappedY };
            updateElevLabel(activeToken, lastDest);
        };

        const clickHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);

            const activeToken = tokenList[activeIndex];
            if (!activeToken)
                return;

            const snapped = snapTokenCenter(activeToken, {x: tx, y: ty});
            const snappedX = snapped.x;
            const snappedY = snapped.y;

            const dist = getDistanceTokenToPoint({ x: snappedX + activeToken.w/2, y: snappedY + activeToken.h/2 }, activeToken);
            const dstOffsets = getOccupiedOffsets(activeToken, { x: snappedX, y: snappedY });
            const dstInRangeSet = distance < 0 ? null : getInRangeOffsets(activeToken, distance, { includeSelf: true });
            const dstInRange = distance < 0 || (dist <= distance && dstOffsets.some(o => dstInRangeSet.has(`${o.col},${o.row}`)));
            if (!dstInRange) {
                ui.notifications.warn("Destination is out of range!");
                return;
            }

            moves.set(activeToken.id, { x: snappedX, y: snappedY, elevation: elevAtDest(activeToken, { x: snappedX, y: snappedY }) });
            playUiSound('targetingConfirm');
            drawTrace(activeToken, snappedX, snappedY);

            let nextIndex = -1;
            for (let i = 1; i <= tokenList.length; i++) {
                const idx = (activeIndex + i) % tokenList.length;
                if (!moves.has(tokenList[idx].id)) {
                    nextIndex = idx;
                    break;
                }
            }

            if (nextIndex !== -1) {
                activeIndex = nextIndex;
            } else {
                activeIndex = (activeIndex + 1) % tokenList.length;
            }

            updateCard();
            updateVisuals();
        };

        const ascendKeys = keyCodesFor('elevationUp');
        const descendKeys = keyCodesFor('elevationDown');
        const keyHandler = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                doCleanup(); // Cancel
                resolve(null);
                return;
            }
            let step = 0;
            if (ascendKeys.has(event.code)) step = 1;
            else if (descendKeys.has(event.code)) step = -1;
            if (step === 0)
                return;
            // Swallow Q/E so it never changes the real token's elevation.
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            pendingElevationOffset += step;
            const tok = tokenList[activeIndex];
            if (tok && lastDest)
                updateElevLabel(tok, lastDest);
            playUiSound('targeting');
        };

        // Initialize
        updateVisuals();
        updateCard();

        const safe = makeSafe('knockBackToken', () => {
            try {
                doCleanup();
            } catch { /* */ }
            resolve([]);
        });
        safeMove = safe(moveHandler);
        safeClick = safe(clickHandler);
        safeKey = safe(keyHandler);
        canvas.stage.on('pointermove', safeMove);
        canvas.stage.on('click', safeClick);
        document.addEventListener('keydown', safeKey, true);
    }), _title);
}
