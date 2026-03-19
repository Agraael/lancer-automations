/* global canvas, PIXI, game, ui, $ */

import {
    isHexGrid, offsetToCube, cubeToOffset, cubeDistance,
    getHexesInRange, getHexCenter, pixelToOffset,
    getTokenCenterOffset, drawHexAt, getOccupiedOffsets,
    getMinGridDistance, getDistanceTokenToPoint, isColumnarHex, getHexVertices,
    snapTokenCenter, getOccupiedGridSpaces
} from "../grid-helpers.js";

import {
    _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard
} from "./cards.js";

/**
 * Convert a PixiJS pointer event's global screen position to canvas world coordinates.
 * Uses the full inverse world transform so it works correctly with isometric-perspective,
 * which adds skew components that the manual (tx/scale) decomposition ignores.
 * @param {PIXI.FederatedPointerEvent} event
 * @returns {{x: number, y: number}}
 */
export function pointerToWorld(event) {
    return canvas.stage.worldTransform.applyInverse(event.global);
}

export function drawRangeHighlight(casterToken, range, color = 0x00ff00, alpha = 0.2, includeSelf = false) {
    const highlight = new PIXI.Graphics();

    if (isHexGrid()) {
        const offsets = getOccupiedOffsets(casterToken);
        const hexesInRange = new Set();
        const selfHexes = new Set();

        if (!includeSelf) {
            for (const o of offsets) {
                const cube = offsetToCube(o.col, o.row);
                selfHexes.add(`${cube.q},${cube.r},${cube.s}`);
            }
        }

        for (const o of offsets) {
            const cube = offsetToCube(o.col, o.row);
            const inRange = getHexesInRange(cube, range);
            for (const h of inRange) {
                const key = `${h.q},${h.r},${h.s}`;
                if (!includeSelf && selfHexes.has(key))
                    continue;
                hexesInRange.add(key);
            }
        }

        highlight.lineStyle(2, color, 0.4);
        highlight.beginFill(color, alpha);

        for (const key of hexesInRange) {
            const [q, r, s] = key.split(',').map(Number);
            const offset = cubeToOffset({ q, r, s });
            drawHexAt(highlight, offset.col, offset.row);
        }

        highlight.endFill();
    } else {
        const gridSize = canvas.grid.size;
        const offsets = getOccupiedOffsets(casterToken);
        const squaresInRange = new Set();
        const selfSquares = new Set();

        if (!includeSelf) {
            for (const o of offsets) {
                selfSquares.add(`${o.col},${o.row}`);
            }
        }

        for (const o of offsets) {
            for (let dx = -range; dx <= range; dx++) {
                for (let dy = -range; dy <= range; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) <= range) {
                        const col = o.col + dx;
                        const row = o.row + dy;
                        const key = `${col},${row}`;
                        if (!includeSelf && selfSquares.has(key))
                            continue;
                        squaresInRange.add(key);
                    }
                }
            }
        }

        highlight.lineStyle(2, color, 0.7);
        highlight.beginFill(color, alpha);

        for (const key of squaresInRange) {
            const [col, row] = key.split(',').map(Number);
            const center = getHexCenter(col, row);
            highlight.drawRect(
                center.x - gridSize / 2,
                center.y - gridSize / 2,
                gridSize,
                gridSize
            );
        }

        highlight.endFill();
    }


    // Add to stage below tokens
    if (canvas.tokens?.parent) {
        canvas.tokens.parent.addChildAt(highlight, canvas.tokens.parent.getChildIndex(canvas.tokens));
    } else {
        canvas.stage.addChild(highlight);
    }
    return highlight;
}


/**
 * Draw a visual trace of a token's movement on the canvas.
 * @param {Token} token
 * @param {Object} originalEndPos
 * @param {Object|null} newEndPos
 * @returns {PIXI.Graphics}
 */
export function drawMovementTrace(token, originalEndPos, newEndPos = null) {
    const trace = new PIXI.Graphics();
    const centerStart = token.center;
    const gridSize = canvas.grid.size;

    const drawFootprint = (targetX, targetY, lineColor, fillColor) => {
        trace.lineStyle(3, lineColor, 0.8);
        trace.beginFill(fillColor, 0.3);
        if (isHexGrid()) {
            const offsets = getOccupiedOffsets(token, { x: targetX, y: targetY });
            for (const o of offsets) {
                drawHexAt(trace, o.col, o.row);
            }
        } else {
            trace.drawRect(targetX, targetY, token.document.width * gridSize, token.document.height * gridSize);
        }
        trace.endFill();
    };

    // Start Position
    drawFootprint(token.document.x, token.document.y, 0xffff00, 0xffff00);

    // Original End Position
    const originalColor = newEndPos ? 0xff0000 : 0xff6400;
    const centerOriginal = { x: originalEndPos.x + token.w/2, y: originalEndPos.y + token.h/2 };
    drawFootprint(originalEndPos.x, originalEndPos.y, originalColor, originalColor);

    // Line to Original End
    trace.lineStyle(4, 0xffffff, 0.5); // white fading line
    trace.moveTo(centerStart.x, centerStart.y);
    trace.lineTo(centerOriginal.x, centerOriginal.y);

    if (newEndPos) {
        // New End Position
        const centerNew = { x: newEndPos.x + token.w/2, y: newEndPos.y + token.h/2 };
        drawFootprint(newEndPos.x, newEndPos.y, 0xff6400, 0xff6400);

        // Line to New End
        trace.lineStyle(4, 0xffffff, 1);
        trace.moveTo(centerStart.x, centerStart.y);
        trace.lineTo(centerNew.x, centerNew.y);
    }

    if (canvas.tokens?.parent) {
        canvas.tokens.parent.addChildAt(trace, canvas.tokens.parent.getChildIndex(canvas.tokens));
    } else {
        canvas.stage.addChild(trace);
    }

    return trace;
}

export function getGridDistance(pos1, pos2) {
    if (isHexGrid()) {
        const offset1 = pixelToOffset(pos1.x, pos1.y);
        const offset2 = pixelToOffset(pos2.x, pos2.y);
        const cube1 = offsetToCube(offset1.col, offset1.row);
        const cube2 = offsetToCube(offset2.col, offset2.row);
        return cubeDistance(cube1, cube2);
    } else {
        const gridDistance = canvas.scene.grid.distance;
        const distPixels = canvas.grid.measurePath([pos1, pos2], {}).distance;
        return Math.round(distPixels / gridDistance);
    }
}


/**
 * Prompts the user to select one or more tokens on the canvas.
 * @param {Token} [casterToken] - The token from which to measure range
 * @param {Object} options - Configuration options
 * @param {number} [options.range=null] - Maximum grid distance for selection
 * @param {boolean} [options.includeHidden=false] - Whether to include hidden tokens
 * @param {boolean} [options.includeSelf=false] - Whether to include the casterToken
 * @param {Function} [options.filter=null] - Optional additional filter function
 * @param {Array<Token>} [options.selection=null] - Restrict selection to these tokens
 * @param {Array<Token>} [options.preSelected=[]] - Tokens initially selected
 * @param {number} [options.count=1] - Maximum number of tokens to select
 * @param {string} [options.title] - Card title
 * @param {string} [options.description=""] - Card description
 * @param {string} [options.icon] - Card icon class
 * @param {string} [options.headerClass=""] - Card header CSS class
 * @returns {Promise<Token[]|null>} Array of selected tokens or null if cancelled
 */
export function chooseToken(casterToken, options = {}) {
    const _title = options.title || 'SELECT TARGETS';
    return _queueCard(() => new Promise((resolve) => {
        const {
            range = null,
            includeHidden = false,
            includeSelf = false,
            filter = null,
            selection = null,
            preSelected = [],
            count = 1,
            title,
            description = "",
            icon,
            headerClass = ""
        } = /** @type {any} */ (options);

        let selectionOnly = !!selection;

        let rangeHighlight = null;
        const selectedTokens = new Set();
        const selectionHighlights = [];

        if (range !== null && casterToken) {
            rangeHighlight = drawRangeHighlight(casterToken, range, 0x888888, 0.1, includeSelf);
        }

        const cursorPreview = new PIXI.Graphics();
        canvas.stage.addChild(cursorPreview);

        const selectionIds = selection ? new Set(selection.map(t => t.id)) : null;
        const selectionHighlightGraphics = [];
        if (selection) {
            for (const t of selection) {
                const hl = new PIXI.Graphics();
                hl.lineStyle(4, 0x00ff00, 0.8);
                hl.beginFill(0x00ff00, 0.2);
                if (isHexGrid()) {
                    const offsets = getOccupiedOffsets(t);
                    for (const off of offsets)
                        drawHexAt(hl, off.col, off.row);
                } else {
                    hl.drawRect(t.document.x, t.document.y, t.document.width * canvas.grid.size, t.document.height * canvas.grid.size);
                }
                hl.endFill();
                canvas.stage.addChild(hl);
                selectionHighlightGraphics.push(hl);
            }
        }

        const baseTokens = canvas.tokens.placeables.filter(t => {
            if (!includeSelf && t.id === casterToken?.id)
                return false;
            if (!includeHidden && t.document.hidden)
                return false;
            if (filter && !filter(t))
                return false;
            return true;
        });

        const getActiveTokens = () => {
            if (selectionOnly && selectionIds)
                return baseTokens.filter(t => selectionIds.has(t.id));
            return baseTokens;
        };
        let allTokens = getActiveTokens();

        const prevInteractive = canvas.tokens.interactiveChildren;
        canvas.tokens.interactiveChildren = false;

        const doCleanup = () => {
            canvas.stage.off('click', clickHandler);
            canvas.stage.off('rightdown', abortHandler);
            canvas.stage.off('pointermove', moveHandler);
            document.removeEventListener('keydown', keyHandler);
            if (rangeHighlight) {
                if (rangeHighlight.parent) {
                    rangeHighlight.parent.removeChild(rangeHighlight);
                }
                rangeHighlight.destroy();
            }
            if (cursorPreview) {
                if (cursorPreview.parent) {
                    cursorPreview.parent.removeChild(cursorPreview);
                }
                cursorPreview.destroy();
            }
            selectionHighlightGraphics.forEach(hl => {
                if (hl.parent) {
                    hl.parent.removeChild(hl);
                }
                hl.destroy();
            });
            selectionHighlights.forEach(h => {
                if (h.graphics.parent) {
                    h.graphics.parent.removeChild(h.graphics);
                }
                h.graphics.destroy();
            });

            canvas.tokens.interactiveChildren = prevInteractive;
            _removeInfoCard(cardEl);
        };

        const doConfirm = () => {
            doCleanup();
            if (selectedTokens.size > 0) {
                resolve(Array.from(selectedTokens));
            } else {
                resolve(null);
            }
        };

        const doCancel = () => {
            doCleanup();
            resolve(null);
        };

        const refreshCard = () => {
            _updateInfoCard(cardEl, "chooseToken", {
                selectedTokens,
                onDeselect: (tokenId) => {
                    const token = allTokens.find(t => t.id === tokenId);
                    if (token && selectedTokens.has(token)) {
                        selectedTokens.delete(token);
                        removeSelectionHighlight(token);
                        refreshCard();
                    }
                }
            });
        };

        const cardEl = _createInfoCard("chooseToken", {
            title,
            icon,
            headerClass,
            description,
            range,
            count,
            hasSelection: !!selection,
            onConfirm: doConfirm,
            onCancel: doCancel
        });

        if (selection) {
            cardEl.find('[data-role="selection-toggle"]').on('change', function () {
                selectionOnly = /** @type {HTMLInputElement} */ (this).checked;
                allTokens = getActiveTokens();
            });
        }

        const drawSelectionHighlight = (token) => {
            const highlight = new PIXI.Graphics();
            highlight.lineStyle(4, 0x00ffff, 0.8);
            highlight.beginFill(0x00ffff, 0.2);

            if (isHexGrid()) {
                const offsets = getOccupiedOffsets(token);
                for (const off of offsets) {
                    drawHexAt(highlight, off.col, off.row);
                }
            } else {
                highlight.drawRect(
                    token.document.x,
                    token.document.y,
                    token.document.width * canvas.grid.size,
                    token.document.height * canvas.grid.size
                );
            }

            highlight.endFill();
            canvas.stage.addChild(highlight);
            selectionHighlights.push({ tokenI: token.id, graphics: highlight });
        };

        const removeSelectionHighlight = (token) => {
            const idx = selectionHighlights.findIndex(h => h.tokenI === token.id);
            if (idx !== -1) {
                const g = selectionHighlights[idx].graphics;
                if (g.parent) {
                    g.parent.removeChild(g);
                }
                g.destroy();
                selectionHighlights.splice(idx, 1);
            }
        };

        const drawCursorHighlight = (tx, ty) => {
            cursorPreview.clear();

            // Check for a token under cursor first — supports tokens partially overlapping the range
            let hoveredToken = allTokens.find(token => {
                const bounds = token.bounds;
                if (tx >= bounds.left && tx <= bounds.right && ty >= bounds.top && ty <= bounds.bottom) {
                    if (range !== null && casterToken) {
                        const dist = getMinGridDistance(casterToken, token);
                        return dist <= range;
                    }
                    return true;
                }
                return false;
            }) || null;

            const hoveringValid = hoveredToken !== null;
            const color = hoveringValid ? 0x0088ff : 0xff0000;
            const alpha = 0.4;
            const gridSize = canvas.grid.size;

            cursorPreview.lineStyle(2, color, 0.8);
            cursorPreview.beginFill(color, alpha);

            if (hoveredToken) {

                if (isHexGrid()) {
                    const offsets = getOccupiedOffsets(hoveredToken);
                    for (const off of offsets) {
                        drawHexAt(cursorPreview, off.col, off.row);
                    }
                } else {
                    cursorPreview.drawRect(
                        hoveredToken.document.x,
                        hoveredToken.document.y,
                        hoveredToken.document.width * gridSize,
                        hoveredToken.document.height * gridSize
                    );
                }
            } else {
                const cursorOffset = pixelToOffset(tx, ty);
                if (isHexGrid()) {
                    drawHexAt(cursorPreview, cursorOffset.col, cursorOffset.row);
                } else {
                    const center = getHexCenter(cursorOffset.col, cursorOffset.row);
                    cursorPreview.drawRect(
                        center.x - gridSize / 2,
                        center.y - gridSize / 2,
                        gridSize,
                        gridSize
                    );
                }
            }

            cursorPreview.endFill();
        };

        const moveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            drawCursorHighlight(tx, ty);
        };

        const clickHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);

            // Find clicked token
            const clickedToken = allTokens.find(token => {
                const bounds = token.bounds;
                return tx >= bounds.left && tx <= bounds.right &&
                    ty >= bounds.top && ty <= bounds.bottom;
            });

            if (clickedToken) {
                // Verify the clicked token is in range
                if (range !== null && casterToken) {
                    const dist = getMinGridDistance(casterToken, clickedToken);
                    if (dist > range)
                        return;
                }

                if (selectedTokens.has(clickedToken)) {
                    // Deselect
                    selectedTokens.delete(clickedToken);
                    removeSelectionHighlight(clickedToken);
                    refreshCard();
                } else {
                    // Select — block if at max (unless count=1, swap instead)
                    if (count !== -1 && selectedTokens.size >= count) {
                        if (count === 1) {
                            // Swap: deselect old, select new
                            const oldToken = selectedTokens.values().next().value;
                            selectedTokens.delete(oldToken);
                            removeSelectionHighlight(oldToken);
                        } else {
                            ui.notifications.warn(`Maximum of ${count} targets already selected.`);
                            return;
                        }
                    }

                    selectedTokens.add(clickedToken);
                    drawSelectionHighlight(clickedToken);
                    refreshCard();
                }
            }
        };

        const abortHandler = (event) => {
            if (event.data.button === 2) { // Right click
                doConfirm();
            }
        };

        const keyHandler = (event) => {
            if (event.key === "Escape") {
                doCancel();
            }
        };

        // Apply pre-selected tokens (capped to count)
        if (preSelected.length > 0) {
            if (preSelected.length > count) {
                ui.notifications.warn(`chooseToken: ${preSelected.length} pre-selected tokens but count is ${count} — only the first ${count} will be used.`);
            }
            for (const t of preSelected.slice(0, count)) {
                if (!selectedTokens.has(t)) {
                    selectedTokens.add(t);
                    drawSelectionHighlight(t);
                }
            }
            refreshCard();
        }

        canvas.stage.on('pointermove', moveHandler);

        canvas.stage.on('click', clickHandler);
        canvas.stage.on('rightdown', abortHandler);
        document.addEventListener('keydown', keyHandler);
    }), _title);
}

/**
 * Place a template zone on the map using Lancer's WeaponRangeTemplate.
 * Delegates to templatemacro's `placeZone`, which supports three specialized zone types via options:
 *
 * **Dangerous zone** (triggers ENG check on entry/turn start, deals damage on failure):
 * ```js
 * placeZone(token, { size: 2, dangerous: { damageType: "kinetic", damageValue: 5 } });
 * ```
 *
 * **Status effect zone** (applies active effects to tokens inside):
 * ```js
 * placeZone(token, { size: 2, statusEffects: ["impaired", "lockon"] });
 * ```
 *
 * **Difficult terrain zone** (imposes movement penalty via ElevationRuler):
 * ```js
 * placeZone(token, { size: 2, difficultTerrain: { movementPenalty: 1, isFlatPenalty: true } });
 * ```
 *
 * @param {Token} casterToken - The token placing the zone
 * @param {Object} options - Configuration options
 * @param {number} [options.range] - Maximum range in grid units (null = unlimited)
 * @param {number} [options.size=1] - Zone radius in grid units (Blast size)
 * @param {string} [options.type="Blast"] - Template type (Blast, Burst, Cone, Line)
 * @param {string} [options.fillColor="#ff6400"] - Fill color as hex string
 * @param {string} [options.borderColor="#964611ff"] - Border color as hex string
 * @param {string} [options.texture] - Texture file path
 * @param {number} [options.count=1] - Number of zones to place. -1 for infinite.
 * @param {Object} [options.hooks={}] - templatemacro hooks (created, deleted, entered, left, turnStart, turnEnd, ...)
 * @param {Object} [options.dangerous] - Shortcut: `{ damageType, damageValue }` — triggers ENG check on entry/turn start
 * @param {string[]} [options.statusEffects] - Shortcut: array of status effect IDs to apply to tokens inside
 * @param {Object} [options.difficultTerrain] - Shortcut: `{ movementPenalty, isFlatPenalty }` — sets ElevationRuler movement cost
 * @param {string} [options.title] - Card title
 * @param {string} [options.description=""] - Card description
 * @param {string} [options.icon] - Card icon class
 * @param {string} [options.headerClass=""] - Card header CSS class
 * @returns {Promise<Array<{x: number, y: number, template: MeasuredTemplate}>|null>} Zone positions and templates, or null if cancelled
 */
export function placeZone(casterToken, options = {}) {
    const _title = options.title || 'PLACE ZONE';
    return _queueCard(() => new Promise(async (resolve) => {
        const {
            range = null,
            size = 1,
            type = "Blast",
            fillColor = "#ff6400",
            borderColor = "#964611ff",
            texture = null,
            hooks = {},
            count = 1,
            title,
            description = "",
            icon,
            headerClass = ""
        } = /** @type {any} */ (options);

        let rangeHighlight = null;
        const placedZones = [];
        let cancelled = false;
        let confirmed = false;

        // Draw range highlight if range is specified (low grey, very transparent)
        if (range !== null && casterToken) {
            rangeHighlight = drawRangeHighlight(casterToken, range, 0x888888, 0.1, false);
        }

        const doCleanup = () => {
            if (rangeHighlight) {
                if (rangeHighlight.parent) {
                    rangeHighlight.parent.removeChild(rangeHighlight);
                }
                rangeHighlight.destroy();
            }
            _removeInfoCard(cardEl);
        };

        const cardEl = _createInfoCard("placeZone", {
            title,
            icon,
            headerClass,
            description,
            range,
            count,
            zoneType: type,
            zoneSize: size,
            relatedToken: casterToken,
            onConfirm: () => {
                confirmed = true;
            },
            onCancel: () => {
                cancelled = true;
            }
        });

        try {
            let keepPlacing = true;
            let placementsLeft = count;

            while (keepPlacing) {
                // Check confirm/cancel flags (set by card buttons between placements)
                if (cancelled) {
                    // Delete all placed zones on cancel
                    for (const zone of placedZones) {
                        try {
                            await zone.template.delete();
                        } catch (_) {
                            // ignore
                        }
                    }
                    doCleanup();
                    resolve(null);
                    return;
                }
                if (confirmed) {
                    doCleanup();
                    resolve(placedZones);
                    return;
                }

                let result = null;
                const templateMacroApi = game.modules.get('templatemacro')?.api;
                if (templateMacroApi?.placeZone) {
                    result = await templateMacroApi.placeZone(
                        options,
                        hooks
                    );
                } else {
                    const templatePreview = game.lancer.canvas.WeaponRangeTemplate.fromRange({
                        type: type,
                        val: size
                    });

                    const template = await templatePreview.placeTemplate();

                    if (template) {
                        const updateData = { fillColor, borderColor };
                        if (texture)
                            updateData.texture = texture;
                        await template.update(updateData);

                        result = { x: template.x, y: template.y, template };
                    }
                }

                if (cancelled) {
                    if (result?.template) {
                        try {
                            await result.template.delete();
                        } catch (_) {
                            // ignore
                        }
                    }
                    for (const zone of placedZones) {
                        try {
                            await zone.template.delete();
                        } catch (_) {
                            // ignore
                        }
                    }
                    doCleanup();
                    resolve(null);
                    return;
                }
                if (confirmed) {
                    doCleanup();
                    resolve(placedZones);
                    return;
                }

                if (result?.template) {
                    if (range !== null && casterToken) {
                        const dist = getDistanceTokenToPoint({ x: result.x, y: result.y }, casterToken);
                        if (dist > range) {
                            await result.template.delete();
                            ui.notifications.warn("Target is out of range!");
                            continue; // Retry placement
                        }
                    }
                    placedZones.push(result);

                    const refreshZoneCard = () => {
                        _updateInfoCard(cardEl, "placeZone", {
                            placedZones,
                            onDeleteZone: async (idx) => {
                                const removed = placedZones.splice(idx, 1);
                                if (removed[0]?.template) {
                                    try {
                                        await removed[0].template.delete();
                                    } catch (_) {
                                        // ignore
                                    }
                                }
                                refreshZoneCard();
                            }
                        });
                    };
                    refreshZoneCard();

                    if (count !== -1) {
                        placementsLeft--;
                        if (placementsLeft <= 0) {
                            keepPlacing = false;
                        }
                    }

                    if (keepPlacing) {
                        // Small delay to ensure UI resets between placements
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } else {
                    // User cancelled via template placement (right-click/ESC during template drag)
                    keepPlacing = false;
                }
            }

            // Wait for user to click Confirm or Cancel
            while (!confirmed && !cancelled) {
                await new Promise(r => setTimeout(r, 100));
            }

            if (cancelled) {
                for (const zone of placedZones) {
                    try {
                        await zone.template.delete();
                    } catch (_) {
                        // ignore
                    }
                }
                doCleanup();
                resolve(null);
                return;
            }

            doCleanup();
            resolve(placedZones);
        } catch (e) {
            console.error(e);
            doCleanup();
            resolve(placedZones.length > 0 ? placedZones : null);
        }
    }), _title);
}

/**
 * Safely cancels a ruler drag in progress by removing the aborted destination from elevationruler measurement history.
 * Should be called synchronously within a preUpdateToken hook.
 * @param {Token} token
 */
export function cancelRulerDrag(token, moveInfo = null) {
    if (!game.modules.get("elevationruler")?.active)
        return;
    const history = token.elevationruler?.measurementHistory;

    if (history && history.length >= 1) {
        // Find the most recent waypoint in history that matches the token's exact current position.
        // elevationruler's history stores bounding center coordinates (x, y) for waypoints.
        const center = token.getCenterPoint({ x: token.document.x, y: token.document.y });
        // Find the last index that matches the current center (-1 if not found)
        const matchIndex = history.findLastIndex(pt =>
            Math.abs(pt.x - center.x) < 2 && Math.abs(pt.y - center.y) < 2
        );

        if (matchIndex !== -1) {
            // Truncate the history down to the matched point (inclusive)
            // This natively strips all 'future' queued waypoints from a multi-segment drag
            history.length = matchIndex;
        } else {
            // Fallback for when current position isn't explicitly in history
            history.pop();
        }
    }
}

/**
 * Interactive tool to apply knockback to tokens.
 * @param {Array<Token>} tokens - List of tokens to knock back
 * @param {number} distance - Max knockback distance in grid units
 * @param {Object} options - UI options
 * @param {string} [options.title="KNOCKBACK"] - Card title
 * @param {string} [options.description] - Card description
 * @param {string} [options.icon] - Card icon class
 * @param {string} [options.headerClass=""] - Card header CSS class
 * @param {Token} [options.triggeringToken=null] - Token triggering the knockback
 * @param {string} [options.actionName=""] - Name of the action
 * @param {Item} [options.item=null] - Item used for knockback
 * @returns {Promise<Array<{token: Token, x: number, y: number}>|null>} List of moves or null if cancelled
 */
/**
 * Apply token moves with elevationruler integration. Used by knockBackToken and socket handler.
 * @param {Array<{tokenId: string, updateData: {x: number, y: number}}>} moveList
 * @param {Token|null} triggeringToken
 * @param {number} distance
 */
export async function applyKnockbackMoves(moveList, triggeringToken, distance, actionName = "", item = null) {
    if (!triggeringToken)
        console.warn("lancer-automations | applyKnockbackMoves called without a triggeringToken. Reactions using triggerSelf will not work correctly.");

    const updates = [];
    const pushedActors = [];

    for (const { tokenId, updateData } of moveList) {
        const t = canvas.tokens.get(tokenId);
        if (!t)
            continue;

        let startCenter, endCenter, cost = 0;

        if (game.modules.get("elevationruler")?.active) {
            startCenter = t.getCenterPoint({ x: t.document.x, y: t.document.y });
            const bboxCenter = t.getCenterPoint({ x: updateData.x, y: updateData.y });
            endCenter = canvas.grid.getCenterPoint(bboxCenter);
            cost = getDistanceTokenToPoint(bboxCenter, t);
        }

        updates.push(t.document.update(updateData).then(async (doc) => {
            if (game.modules.get("elevationruler")?.active) {
                const tokenObj = doc.object;
                if (!tokenObj.elevationruler) {
                    tokenObj.elevationruler = {};
                }

                if (tokenObj.elevationruler) {
                    let history = tokenObj.elevationruler.measurementHistory;
                    if (!history) {
                        history = tokenObj.elevationruler.measurementHistory = [];
                    }

                    const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
                    const elevation = t.document.elevation ?? 0;
                    const zValue = gridUnitsToPixels(elevation);

                    const last = history.at(-1);
                    let addedNative = false;

                    if (last && Math.abs(last.x - endCenter.x) < 2 && Math.abs(last.y - endCenter.y) < 2) {
                        addedNative = true;
                        last.x = endCenter.x;
                        last.y = endCenter.y;
                        last.freeMovement = true;
                        last.cost = cost;
                        if (last.z === undefined)
                            last.z = zValue;
                        if (last.teleport === undefined)
                            last.teleport = false;
                    }

                    if (!addedNative) {
                        const startPt = { ...startCenter, z: zValue, teleport: false, cost: 0 };
                        const endPt = { ...endCenter, z: zValue, teleport: false, cost: cost, freeMovement: true };
                        history.push(startPt, endPt);
                    }
                }
            }
            return doc;
        }));
        pushedActors.push(t.actor);
    }

    await Promise.all(updates);
    await game.modules.get('lancer-automations').api.handleTrigger('onKnockback', { triggeringToken, range: distance, pushedActors, actionName, item });
}

export function knockBackToken(tokens, distance, options = {}) {
    const _title = options.title || 'KNOCKBACK';
    return _queueCard(() => new Promise((resolve) => {
        const {
            title = "KNOCKBACK",
            description = "Select destination for each token.",
            icon,
            headerClass = "",
            triggeringToken = null,
            actionName = "",
            item = null
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
        const cursorPreview = new PIXI.Graphics();

        canvas.stage.addChild(cursorPreview);

        const doCleanup = () => {
            canvas.stage.off('click', clickHandler);
            canvas.stage.off('rightdown', abortHandler);
            canvas.stage.off('pointermove', moveHandler);
            document.removeEventListener('keydown', keyHandler);

            if (rangeHighlight) {
                if (rangeHighlight.parent)
                    rangeHighlight.parent.removeChild(rangeHighlight);
                rangeHighlight.destroy();
            }
            if (cursorPreview.parent)
                cursorPreview.parent.removeChild(cursorPreview);
            cursorPreview.destroy();

            for (const g of traces.values()) {
                if (g.parent)
                    g.parent.removeChild(g);
                g.destroy();
            }

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
                        moveList.push({ tokenId: id, updateData: { x: move.x, y: move.y } });
                    }
                }

                if (game.user.isGM) {
                    await applyKnockbackMoves(moveList, triggeringToken, distance, actionName, item);
                } else {
                    game.socket.emit('module.lancer-automations', {
                        action: "moveTokens",
                        payload: {
                            moves: moveList,
                            triggeringTokenId: triggeringToken?.id || null,
                            distance,
                            actionName,
                            itemId: item?.id || null
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
            if (traces.has(token.id)) {
                const oldG = traces.get(token.id);
                if (oldG.parent)
                    oldG.parent.removeChild(oldG);
                oldG.destroy();
            }

            const trace = new PIXI.Graphics();
            const gridSize = canvas.grid.size;

            // Draw Original Position (Yellow)
            trace.lineStyle(2, 0xffff00, 0.8);
            trace.beginFill(0xffff00, 0.3);
            if (isHexGrid()) {
                const offsets = getOccupiedOffsets(token);
                for (const o of offsets)
                    drawHexAt(trace, o.col, o.row);
            } else {
                trace.drawRect(token.document.x, token.document.y, token.document.width * gridSize, token.document.height * gridSize);
            }
            trace.endFill();

            // Draw Target Position (Orange)
            trace.lineStyle(2, 0xff6400, 0.8);
            trace.beginFill(0xff6400, 0.3);

            if (isHexGrid()) {
                const offsets = getOccupiedOffsets(token, { x: targetX, y: targetY });
                for (const o of offsets)
                    drawHexAt(trace, o.col, o.row);
            } else {
                trace.drawRect(targetX, targetY, token.document.width * gridSize, token.document.height * gridSize);
            }
            trace.endFill();

            // Draw Line
            const centerStart = token.center;
            const centerEnd = { x: targetX + token.w/2, y: targetY + token.h/2 };
            trace.lineStyle(3, 0xffffff, 1);
            trace.moveTo(centerStart.x, centerStart.y);
            trace.lineTo(centerEnd.x, centerEnd.y);

            // Add to stage below tokens
            if (canvas.tokens?.parent) {
                canvas.tokens.parent.addChildAt(trace, canvas.tokens.parent.getChildIndex(canvas.tokens));
            } else {
                canvas.stage.addChild(trace);
            }
            traces.set(token.id, trace);
        };

        const updateVisuals = () => {
            // 1. Range Highlight for ACTIVE token
            const activeToken = tokenList[activeIndex];
            if (activeToken) {
                if (rangeHighlight) {
                    if (rangeHighlight.parent)
                        rangeHighlight.parent.removeChild(rangeHighlight);
                    rangeHighlight.destroy();
                }
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
            const inRange = distance < 0 || dist <= distance;

            // Check overlap
            const otherOccupied = getOccupiedGridSpaces([activeToken.id]);
            const offsets = getOccupiedOffsets(activeToken, { x: snappedX, y: snappedY });

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
            if (distance >= 0 && dist > distance) {
                ui.notifications.warn("Destination is out of range!");
                return;
            }

            moves.set(activeToken.id, { x: snappedX, y: snappedY });
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

        const abortHandler = (event) => {
            if (event.data.button === 2) {

                if (moves.has(tokenList[activeIndex].id)) {
                    moves.delete(tokenList[activeIndex].id);
                    if (traces.has(tokenList[activeIndex].id)) {
                        const t = traces.get(tokenList[activeIndex].id);
                        t.destroy();
                        traces.delete(tokenList[activeIndex].id);
                    }
                    updateCard();
                    updateVisuals();
                } else { /* empty */ }
            }
        };

        const keyHandler = (event) => {
            if (event.key === "Escape") {
                doCleanup(); // Cancel
                resolve(null);
            }
        };

        // Initialize
        updateVisuals();
        updateCard();

        canvas.stage.on('pointermove', moveHandler);
        canvas.stage.on('click', clickHandler);
        canvas.stage.on('rightdown', abortHandler);
        document.addEventListener('keydown', keyHandler);
    }), _title);
}


/**
 * Interactive tool to place tokens on the map with visual preview.
 * @param {Object} options - Configuration options
 * @param {Actor|Array<Actor>|Array<{actor:Actor, extraData?:Object}>} [options.actor=null] - The actor(s) to place.
 *   Single Actor: places that actor's token. Array of Actors or {actor, extraData} objects: shows an actor selector
 *   in the card, allowing the user to pick which actor to place at each click.
 * @param {number} [options.range=null] - Maximum placement range in grid units (null = unlimited)
 * @param {number} [options.count=1] - Total number of tokens to place (-1 for infinite)
 * @param {Object} [options.extraData={}] - Default overrides for spawned token data (e.g. name, width, height).
 *   Applied to all actors unless overridden per-entry. Flags are shallow-merged with the actor's prototype token flags.
 * @param {Token|{x:number,y:number}} [options.origin=null] - Origin point: a Token, or a pixel position
 * @param {Function} [options.onSpawn=null] - Async callback(newTokenDoc, originToken) called after each spawn
 * @param {string} [options.title] - Card title
 * @param {string} [options.description=""] - Card description
 * @param {string} [options.icon] - Card icon class
 * @param {string} [options.headerClass=""] - Card header CSS class
 * @param {boolean} [options.noCard=false] - Whether to skip rendering the card
 * @param {number|null} [options.disposition=null] - Token disposition override
 * @param {string|null} [options.team=null] - Token faction team override
 * @returns {Promise<Array<TokenDocument>|null>} Array of spawned token documents, or null if cancelled
 */
export function placeToken(options = {}) {
    const _title = options.title || 'PLACE TOKEN';
    return _queueCard(() => new Promise((resolve) => {
        const {
            actor: actorInput = null,
            range = null,
            count = 1,
            extraData: defaultExtraData = {},
            origin = null,
            onSpawn = null,
            title,
            description = "",
            icon,
            headerClass = "",
            noCard = false,
            disposition = null,
            team = null
        } = /** @type {any} */ (options);

        // --- Normalize actor input into actorEntries ---
        // Each entry: { actor, extraData, prototypeToken, texture }
        const actorEntries = [];
        if (Array.isArray(actorInput)) {
            for (const item of actorInput) {
                const a = item.actor || item;
                const ed = item.extraData || {};
                const merged = { ...defaultExtraData, ...ed, flags: { ...(defaultExtraData.flags || {}), ...(ed.flags || {}) } };
                const proto = a.prototypeToken ? a.prototypeToken.toObject() : {};
                actorEntries.push({
                    actor: a,
                    extraData: merged,
                    prototypeToken: proto,
                    texture: merged.texture?.src ?? (proto.texture?.src || ""),
                    width: merged.width ?? proto.width ?? 1,
                    height: merged.height ?? proto.height ?? 1,
                    name: merged.name ?? proto.name ?? a.name ?? "Token"
                });
            }
        } else if (actorInput) {
            const proto = actorInput.prototypeToken ? actorInput.prototypeToken.toObject() : {};
            actorEntries.push({
                actor: actorInput,
                extraData: defaultExtraData,
                prototypeToken: proto,
                texture: defaultExtraData.texture?.src ?? (proto.texture?.src || ""),
                width: defaultExtraData.width ?? proto.width ?? 1,
                height: defaultExtraData.height ?? proto.height ?? 1,
                name: defaultExtraData.name ?? proto.name ?? actorInput.name ?? "Token"
            });
        } else {
            // No actor — empty proto
            actorEntries.push({
                actor: null,
                extraData: defaultExtraData,
                prototypeToken: {},
                texture: defaultExtraData.texture?.src || "",
                width: defaultExtraData.width ?? 1,
                height: defaultExtraData.height ?? 1,
                name: defaultExtraData.name ?? "Token"
            });
        }

        const isMultiActor = actorEntries.length > 1;
        let activeActorIndex = 0;

        const getActiveEntry = () => actorEntries[activeActorIndex];

        const originToken = (origin?.document) ? origin : null;
        const originOffset = (!originToken && origin)
            ? pixelToOffset(origin.x, origin.y)
            : null;

        // Use the first entry's dimensions for preview (all entries should be similar size for hex snapping)
        const protoWidth = getActiveEntry().width;
        const protoHeight = getActiveEntry().height;
        const gridSize = canvas.grid.size;

        // Reference token with matching dimensions for pixel-perfect hex shapes
        const refToken = (originToken && originToken.document.width === protoWidth && originToken.document.height === protoHeight)
            ? originToken
            : canvas.tokens.placeables.find(t => t.document.width === protoWidth && t.document.height === protoHeight) || null;

        const placements = [];
        let rangeHighlight = null;

        if (range !== null && origin) {
            if (originToken) {
                rangeHighlight = drawRangeHighlight(originToken, range, 0x888888, 0.1, false);
            } else if (originOffset) {
                const hl = new PIXI.Graphics();
                hl.lineStyle(2, 0x888888, 0.3);
                hl.beginFill(0x888888, 0.1);

                if (isHexGrid()) {
                    const originCube = offsetToCube(originOffset.col, originOffset.row);
                    for (const h of getHexesInRange(originCube, range)) {
                        const offset = cubeToOffset(h);
                        drawHexAt(hl, offset.col, offset.row);
                    }
                } else {
                    for (let dx = -range; dx <= range; dx++) {
                        for (let dy = -range; dy <= range; dy++) {
                            if (Math.max(Math.abs(dx), Math.abs(dy)) <= range) {
                                const center = getHexCenter(originOffset.col + dx, originOffset.row + dy);
                                hl.drawRect(center.x - gridSize / 2, center.y - gridSize / 2, gridSize, gridSize);
                            }
                        }
                    }
                }

                hl.endFill();

                if (canvas.tokens?.parent) {
                    canvas.tokens.parent.addChildAt(hl, canvas.tokens.parent.getChildIndex(canvas.tokens));
                } else {
                    canvas.stage.addChild(hl);
                }
                rangeHighlight = hl;
            }
        }

        const cursorPreview = new PIXI.Graphics();
        canvas.stage.addChild(cursorPreview);

        const prevInteractive = canvas.tokens.interactiveChildren;
        canvas.tokens.interactiveChildren = false;

        const getProtoOffsets = (centerCol, centerRow) => {
            if (protoWidth <= 1 && protoHeight <= 1)
                return [{ col: centerCol, row: centerRow }];

            const center = getHexCenter(centerCol, centerRow);
            const overridePos = {
                x: center.x - (protoWidth * gridSize / 2),
                y: center.y - (protoHeight * gridSize / 2)
            };
            if (refToken)
                return getOccupiedOffsets(refToken, overridePos);
            return [{ col: centerCol, row: centerRow }];
        };

        const checkInRange = (col, row) => {
            if (range === null || !origin)
                return true;
            if (originToken) {
                const targetCube = offsetToCube(col, row);
                return getOccupiedOffsets(originToken).some(o =>
                    cubeDistance(offsetToCube(o.col, o.row), targetCube) <= range
                );
            }
            if (isHexGrid()) {
                return cubeDistance(
                    offsetToCube(originOffset.col, originOffset.row),
                    offsetToCube(col, row)
                ) <= range;
            }
            return Math.max(Math.abs(col - originOffset.col), Math.abs(row - originOffset.row)) <= range;
        };

        const getSpawnPosition = (centerCol, centerRow) => {
            const center = getHexCenter(centerCol, centerRow);
            if (refToken)
                return snapTokenCenter(refToken, center);
            return {
                x: center.x - (protoWidth * gridSize / 2),
                y: center.y - (protoHeight * gridSize / 2)
            };
        };

        const snapCursor = (tx, ty) => {
            if (refToken) {
                const snapped = snapTokenCenter(refToken, { x: tx, y: ty });
                return pixelToOffset(snapped.x + refToken.w / 2, snapped.y + refToken.h / 2);
            }
            return pixelToOffset(tx, ty);
        };

        const drawOffsets = (graphics, offsets) => {
            for (const o of offsets) {
                if (isHexGrid()) {
                    drawHexAt(graphics, o.col, o.row);
                } else {
                    const center = getHexCenter(o.col, o.row);
                    graphics.drawRect(center.x - gridSize / 2, center.y - gridSize / 2, gridSize, gridSize);
                }
            }
        };

        const doCleanup = () => {
            canvas.stage.off('click', clickHandler);
            canvas.stage.off('rightdown', rightHandler);
            canvas.stage.off('pointermove', moveHandler);
            document.removeEventListener('keydown', keyHandler);

            if (rangeHighlight) {
                if (rangeHighlight.parent)
                    rangeHighlight.parent.removeChild(rangeHighlight);
                rangeHighlight.destroy();
            }
            if (cursorPreview.parent)
                cursorPreview.parent.removeChild(cursorPreview);
            cursorPreview.destroy();

            for (const p of placements) {
                if (p.graphics?.parent)
                    p.graphics.parent.removeChild(p.graphics);
                p.graphics?.destroy();
            }

            canvas.tokens.interactiveChildren = prevInteractive;
            if (cardEl)
                _removeInfoCard(cardEl);
        };

        const refreshCard = () => {
            if (!cardEl)
                return;
            _updateInfoCard(cardEl, "placeToken", {
                placements,
                actorEntries,
                activeActorIndex,
                isMultiActor,
                onSelectActor: (idx) => {
                    activeActorIndex = idx;
                    refreshCard();
                },
                onDeletePlacement: (idx) => {
                    const removed = placements.splice(idx, 1);
                    if (removed[0]?.graphics) {
                        if (removed[0].graphics.parent)
                            removed[0].graphics.parent.removeChild(removed[0].graphics);
                        removed[0].graphics.destroy();
                    }
                    refreshCard();
                }
            });
        };

        const doConfirm = async () => {
            const spawnedTokens = [];
            const allTokenData = [];
            for (const p of placements) {
                const entry = actorEntries[p.actorIndex ?? 0];
                const pos = getSpawnPosition(p.col, p.row);
                const tokenData = foundry.utils.mergeObject(
                    foundry.utils.deepClone(entry.prototypeToken || {}),
                    entry.extraData || {}
                );

                if (disposition !== null) {
                    tokenData.disposition = disposition;
                }
                if (team !== null) {
                    tokenData.flags = tokenData.flags || {};
                    tokenData.flags['token-factions'] = tokenData.flags['token-factions'] || {};
                    tokenData.flags['token-factions'].team = team;
                }

                tokenData.x = pos.x;
                tokenData.y = pos.y;
                if (entry.actor)
                    tokenData.actorId = entry.actor.id;
                allTokenData.push(tokenData);
            }

            let createdIds;
            if (game.user.isGM) {
                const created = await canvas.scene.createEmbeddedDocuments("Token", allTokenData);
                createdIds = created.map(d => d.id);
            } else {
                const requestId = foundry.utils.randomID();
                game.socket.emit('module.lancer-automations', {
                    action: "createTokens",
                    payload: { tokenDataArray: allTokenData, sceneId: canvas.scene.id, requestId }
                });
                createdIds = await new Promise((res) => {
                    const handler = (data) => {
                        if (data.action === 'createTokensResponse' && data.payload.requestId === requestId) {
                            game.socket.off('module.lancer-automations', handler);
                            res(data.payload.tokenIds);
                        }
                    };
                    game.socket.on('module.lancer-automations', handler);
                });
            }

            for (let i = 0; i < createdIds.length; i++) {
                const id = createdIds[i];
                const entry = actorEntries[placements[i]?.actorIndex ?? 0];
                const doc = canvas.scene.tokens.get(id);
                if (doc) {
                    spawnedTokens.push(doc);

                    if (globalThis.Sequencer) {
                        const tokenObj = canvas.tokens.get(id);
                        if (tokenObj) {
                            new Sequence()
                                .effect()
                                .file("jb2a.extras.tmfx.inpulse.circle.01.normal")
                                .atLocation(tokenObj)
                                .scale(entry.width / 2)
                                .play();
                        }
                    }

                    if (onSpawn)
                        await onSpawn(doc, originToken);
                }
            }

            doCleanup();
            resolve(spawnedTokens);
        };

        const cardEl = noCard ? null : _createInfoCard("placeToken", {
            title,
            icon,
            headerClass,
            description,
            range,
            count,
            isMultiActor,
            relatedToken: originToken,
            onConfirm: doConfirm,
            onCancel: () => {
                doCleanup();
                resolve(null);
            }
        });

        const drawPlacementMarker = (centerCol, centerRow) => {
            const graphics = new PIXI.Graphics();
            graphics.lineStyle(2, 0xff6400, 0.8);
            graphics.beginFill(0xff6400, 0.3);
            drawOffsets(graphics, getProtoOffsets(centerCol, centerRow));
            graphics.endFill();

            if (canvas.tokens?.parent) {
                canvas.tokens.parent.addChildAt(graphics, canvas.tokens.parent.getChildIndex(canvas.tokens));
            } else {
                canvas.stage.addChild(graphics);
            }
            return graphics;
        };

        const moveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);

            const cursorOffset = snapCursor(tx, ty);
            const inRange = checkInRange(cursorOffset.col, cursorOffset.row);
            const color = inRange ? 0x0088ff : 0xff0000;

            cursorPreview.clear();
            cursorPreview.lineStyle(2, color, 0.8);
            cursorPreview.beginFill(color, 0.4);
            drawOffsets(cursorPreview, getProtoOffsets(cursorOffset.col, cursorOffset.row));
            cursorPreview.endFill();
        };

        const clickHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);

            const cursorOffset = snapCursor(tx, ty);

            if (!checkInRange(cursorOffset.col, cursorOffset.row))
                ui.notifications.warn("Target is out of range!");

            if (count !== -1 && placements.length >= count) {
                ui.notifications.warn(`Maximum of ${count} tokens already placed.`);
                return;
            }

            const graphics = drawPlacementMarker(cursorOffset.col, cursorOffset.row);
            placements.push({ col: cursorOffset.col, row: cursorOffset.row, graphics, actorIndex: activeActorIndex });
            refreshCard();

            if (noCard && (count === -1 || placements.length >= count)) {
                doConfirm();
            }
        };

        const rightHandler = (event) => {
            if (event.data.button === 2 && placements.length > 0) {
                const removed = placements.pop();
                if (removed.graphics?.parent)
                    removed.graphics.parent.removeChild(removed.graphics);
                removed.graphics?.destroy();
                refreshCard();
            }
        };

        const keyHandler = (event) => {
            if (event.key === "Escape") {
                doCleanup();
                resolve(null);
            }
        };

        refreshCard();

        canvas.stage.on('pointermove', moveHandler);
        canvas.stage.on('click', clickHandler);
        canvas.stage.on('rightdown', rightHandler);
        document.addEventListener('keydown', keyHandler);
    }), _title);
}
