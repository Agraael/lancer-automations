/* global canvas, PIXI, game, ui, $ */

import {
    isHexGrid, offsetToCube, cubeToOffset, cubeDistance,
    getHexesInRange, getHexCenter, pixelToOffset,
    getTokenCenterOffset, drawHexAt, getOccupiedOffsets,
    getMinGridDistance, getDistanceTokenToPoint, isColumnarHex, getHexVertices,
    snapTokenCenter, getOccupiedGridSpaces
} from "./grid-helpers.js";


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

        highlight.lineStyle(2, color, 0.7);
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
    if (canvas.tokens && canvas.tokens.parent) {
        canvas.tokens.parent.addChildAt(highlight, canvas.tokens.parent.getChildIndex(canvas.tokens));
    } else {
        canvas.stage.addChild(highlight);
    }
    return highlight;
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
        let distPixels;
        if (canvas.grid.measurePath) {
            distPixels = canvas.grid.measurePath([pos1, pos2]).distance;
        } else {
            distPixels = canvas.grid.measureDistance(pos1, pos2);
        }
        return Math.round(distPixels / gridDistance);
    }
}

// --- Info Card Helpers (internal) ---

function _createInfoCard(type, opts) {
    const {
        title = type === "chooseToken" ? "SELECT TARGETS" : (type === "knockBack" ? "KNOCKBACK" : "PLACE ZONE"),
        icon = type === "chooseToken" ? "fas fa-crosshairs" : (type === "knockBack" ? "fas fa-arrow-right" : "fas fa-bullseye"),
        headerClass = "",
        description = "",
        range = null,
        count = 1,
        zoneType = "",
        zoneSize = 1,
        onConfirm = () => {},
        onCancel = () => {}
    } = opts;

    // Remove any existing info card
    $('.la-info-card').remove();

    // Build info row — Lancer-style labeled grid (like "Tier: +1 / Total: +1")
    let infoItems = [];
    if (range !== null) {
        infoItems.push(`<span style="white-space:nowrap"><b>Range:</b> ${range}</span>`);
    }
    if (count !== -1) {
        infoItems.push(`<span style="white-space:nowrap"><b>Count:</b> ${count}</span>`);
    } else {
        infoItems.push(`<span style="white-space:nowrap"><b>Count:</b> &infin;</span>`);
    }
    if (type === "placeZone") {
        if (zoneType) {
            infoItems.push(`<span style="white-space:nowrap"><b>Type:</b> ${zoneType}</span>`);
        }
        infoItems.push(`<span style="white-space:nowrap"><b>Size:</b> ${zoneSize}</span>`);
    }

    const infoRowHtml = infoItems.length > 0
        ? `<label class="flexrow la-info-row lancer-border-primary">${infoItems.join('  ')}</label>`
        : '';

    const descHtml = description
        ? `<div class="la-info-description">${description}</div>`
        : '';

    let dynamicHtml = "";
    if (type === "chooseToken") {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Selected Targets</h3>
            <div class="la-selected-targets" data-role="target-list">
                <div class="la-empty-state">No targets selected</div>
            </div>`;
    } else if (type === "knockBack") {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Tokens to Move</h3>
            <div class="la-knockback-list" data-role="knockback-list">
                <!-- Populated dynamically -->
            </div>`;
    } else {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Placed Zones</h3>
            <div class="la-placed-zones" data-role="zone-list">
                <div class="la-empty-state">No zones placed</div>
            </div>`;
    }

    const showConfirm = true;

    const html = `
    <div class="component grid-enforcement la-info-card" data-card-type="${type}">
        <div class="lancer lancer-hud window-content">
            <div class="lancer-header ${headerClass} medium">
                <i class="${icon} i--m i--light"></i>
                <span>${title}</span>
            </div>
            <div class="la-info-card-body">
                ${infoRowHtml}
                ${descHtml}
                ${dynamicHtml}
                <div class="dialog-buttons flexrow">
                    ${showConfirm ? `<button class="lancer-button lancer-secondary dialog-button submit default" data-action="confirm" type="button"><i class="fas fa-check"></i> Confirm</button>` : ''}
                    <button class="dialog-button cancel" data-action="cancel" type="button"><i class="fas fa-times"></i> Cancel</button>
                </div>
            </div>
        </div>
    </div>`;

    const container = $('#hudzone').length ? $('#hudzone') : $('body');
    container.append(html);
    const cardEl = $('.la-info-card').last();

    cardEl.find('[data-action="confirm"]').on('click', () => onConfirm());
    cardEl.find('[data-action="cancel"]').on('click', () => onCancel());

    // Slide up from bottom + fade in
    cardEl.css({ transform: 'translateY(30px)', opacity: 0 });
    cardEl.animate(
        { opacity: 1 },
        200,
        function () {
            $(this).css('transform', 'translateY(0)');
        }
    );
    // CSS transition handles the transform animation
    setTimeout(() => cardEl.css('transform', 'translateY(0)'), 10);

    return cardEl;
}

function _updateInfoCard(cardEl, type, data) {
    if (!cardEl || cardEl.length === 0)
        return;

    if (type === "chooseToken") {
        const listEl = cardEl.find('[data-role="target-list"]');
        listEl.empty();

        if (data.selectedTokens.size === 0) {
            listEl.html('<div class="la-empty-state">No targets selected</div>');
        } else {
            for (const token of data.selectedTokens) {
                const imgSrc = token.document.texture.src;
                const name = token.name;
                listEl.append(`
                    <div class="la-selected-target" data-token-id="${token.id}">
                        <img src="${imgSrc}" alt="${name}">
                        <span class="la-selected-target-name">${name}</span>
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                    </div>`);
            }

            listEl.find('.la-selected-target').on('click', function () {
                const tokenId = $(this).data('token-id');
                if (data.onDeselect)
                    data.onDeselect(tokenId);
            });
        }
    } else if (type === "placeZone") {
        const listEl = cardEl.find('[data-role="zone-list"]');
        listEl.empty();

        if (data.placedZones.length === 0) {
            listEl.html('<div class="la-empty-state">No zones placed</div>');
        } else {
            data.placedZones.forEach((zone, idx) => {
                const label = `Zone ${idx + 1}`;
                listEl.append(`
                    <div class="la-selected-target" data-zone-index="${idx}">
                        <i class="fas fa-bullseye" style="color:#991e2a; font-size:16px;"></i>
                        <span class="la-selected-target-name">${label}</span>
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                    </div>`);
            });

            listEl.find('.la-selected-target').on('click', function () {
                const zoneIdx = $(this).data('zone-index');
                if (data.onDeleteZone)
                    data.onDeleteZone(zoneIdx);
            });
        }
    } else if (type === "knockBack") {
        const listEl = cardEl.find('[data-role="knockback-list"]');
        listEl.empty();

        data.tokens.forEach((token, idx) => {
            const isMoved = data.moves.has(token.id);
            const isActive = idx === data.activeIndex;
            const statusClass = isMoved ? "la-kb-moved" : "la-kb-pending";
            const activeClass = isActive ? "la-kb-active" : "";
            const statusIcon = isMoved ? '<i class="fas fa-check" style="color:var(--lancer-color-green)"></i>' : '<i class="fas fa-arrow-right"></i>';

            const itemHtml = `
                <div class="la-knockback-item ${statusClass} ${activeClass}" data-token-index="${idx}">
                    <img src="${token.document.texture.src}" class="la-kb-img" style="width:24px; height:24px; object-fit:contain;">
                    <span class="la-kb-name">${token.name}</span>
                    <span class="la-kb-status">${statusIcon}</span>
                </div>`;
            listEl.append(itemHtml);
        });

        listEl.find('.la-knockback-item').on('click', function () {
            const idx = $(this).data('token-index');
            if (data.onSelectToken)
                data.onSelectToken(idx);
        });
    }
}

function _removeInfoCard(cardEl) {
    if (!cardEl || cardEl.length === 0)
        return;
    // Slide down + fade out
    cardEl.css('transform', 'translateY(30px)');
    cardEl.animate(
        { opacity: 0 },
        200,
        function () {
            $(this).remove();
        }
    );
}


export function chooseToken(casterToken, options = {}) {
    return new Promise((resolve) => {
        const {
            range = null,
            includeHidden = false,
            includeSelf = false,
            filter = null,
            count = 1,
            title,
            description = "",
            icon,
            headerClass = ""
        } = options;

        let rangeHighlight = null;
        const selectedTokens = new Set();
        const selectionHighlights = [];

        if (range !== null && casterToken) {
            rangeHighlight = drawRangeHighlight(casterToken, range, 0x888888, 0.3, includeSelf);
        }

        const cursorPreview = new PIXI.Graphics();
        canvas.stage.addChild(cursorPreview);

        const allTokens = canvas.tokens.placeables.filter(t => {
            if (!includeSelf && t.id === casterToken?.id)
                return false;
            if (!includeHidden && t.document.hidden)
                return false;
            if (filter && !filter(t))
                return false;
            return true;
        });

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
            canvas.stage.removeChild(cursorPreview);
            selectionHighlights.forEach(h => canvas.stage.removeChild(h.graphics));

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
            onConfirm: doConfirm,
            onCancel: doCancel
        });

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
                canvas.stage.removeChild(selectionHighlights[idx].graphics);
                selectionHighlights.splice(idx, 1);
            }
        };

        const drawCursorHighlight = (tx, ty) => {
            cursorPreview.clear();
            let isInRange = true;
            if (range !== null && casterToken) {
                const dist = getDistanceTokenToPoint({ x: tx, y: ty }, casterToken);
                isInRange = dist <= range;
            }

            let hoveredToken = null;
            if (isInRange) {
                hoveredToken = allTokens.find(token => {
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
            }

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
            const t = canvas.stage.worldTransform;
            const tx = ((event.data.global.x - t.tx) / canvas.stage.scale.x);
            const ty = ((event.data.global.y - t.ty) / canvas.stage.scale.y);
            drawCursorHighlight(tx, ty);
        };

        const clickHandler = (event) => {
            const t = canvas.stage.worldTransform;
            const tx = ((event.data.global.x - t.tx) / canvas.stage.scale.x);
            const ty = ((event.data.global.y - t.ty) / canvas.stage.scale.y);

            // Check range first
            if (range !== null && casterToken) {
                const dist = getDistanceTokenToPoint({ x: tx, y: ty }, casterToken);
                if (dist > range)
                    return; // Ignore clicks out of range
            }

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

        canvas.stage.on('pointermove', moveHandler);

        canvas.stage.on('click', clickHandler);
        canvas.stage.on('rightdown', abortHandler);
        document.addEventListener('keydown', keyHandler);
    });
}

/**
 * Place a Blast zone template on the map using Lancer's WeaponRangeTemplate
 * @param {Token} casterToken - The token placing the zone
 * @param {Object} options - Configuration options
 * @param {number} [options.range] - Maximum range in grid units (null = unlimited)
 * @param {number} [options.size=1] - Zone radius in grid units (Blast size)
 * @param {string} [options.type="Blast"] - Template type (Blast, Burst, Cone, Line)
 * @param {string} [options.fillColor="#ff6400"] - Fill color as hex string
 * @param {string} [options.texture] - Texture file path
 * @param {number} [options.count=1] - Number of zones to place. -1 for infinite.
 * @returns {Promise<Array<{x: number, y: number, template: MeasuredTemplate}>|null>} Zone positions and templates, or null if cancelled
 */
export function placeZone(casterToken, options = {}) {
    return new Promise(async (resolve) => {
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
        } = options;

        let rangeHighlight = null;
        const placedZones = [];
        let cancelled = false;
        let confirmed = false;

        // Draw range highlight if range is specified (low grey, very transparent)
        if (range !== null && casterToken) {
            rangeHighlight = drawRangeHighlight(casterToken, range, 0x888888, 0.3, false);
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

                // Use templatemacro's placeZone if available
                const templateMacroApi = game.modules.get('templatemacro')?.api;
                if (templateMacroApi?.placeZone) {
                    result = await templateMacroApi.placeZone(
                        options,
                        hooks
                    );
                } else {
                    // Fallback to Lancer's WeaponRangeTemplate
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

                // Re-check flags after blocking placeTemplate/placeZone call
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
                    // Check if final position is in range
                    if (range !== null && casterToken) {
                        const dist = getDistanceTokenToPoint({ x: result.x, y: result.y }, casterToken);
                        if (dist > range) {
                            await result.template.delete();
                            ui.notifications.warn("Target is out of range!");
                            continue; // Retry placement
                        }
                    }
                    placedZones.push(result);

                    // Build delete handler for zone list
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
    });
}

/**
 * Interactive tool to apply knockback to tokens.
 * @param {Array<Token>} tokens - List of tokens to knock back
 * @param {number} distance - Max knockback distance in grid units
 * @param {Object} options - UI options
 * @returns {Promise<Array<{token: Token, x: number, y: number}>|null>} List of moves or null if cancelled
 */
export function knockBackToken(tokens, distance, options = {}) {
    return new Promise((resolve) => {
        const {
            title = "KNOCKBACK",
            description = "Select destination for each token.",
            icon,
            headerClass = "",
            triggeringToken = null
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
                const result = [];
                const updates = [];
                const pushedActors = [];
                for (const [id, move] of moves.entries()) {
                    const t = tokenList.find(t => t.id === id);
                    if (t) {
                        const updateData = { x: move.x, y: move.y };
                        let startCenter, endCenterX, endCenterY;

                        if (game.modules.get("elevationruler")?.active) {
                            // Bypass elevationruler movement tracking by setting the flag manually
                            const history = t.document.getFlag("elevationruler", "movementHistory") || {};
                            const newHistory = { ...history, _freeMovementTrigger: foundry.utils.randomID() };
                            updateData["flags.elevationruler.movementHistory"] = newHistory;

                            // Capture start position (Center) before update
                            startCenter = { x: t.center.x, y: t.center.y, z: 0 };
                            // Calculate expected end position (Center)
                            endCenterX = move.x + (t.w / 2);
                            endCenterY = move.y + (t.h / 2);
                        }

                        updates.push(t.document.update(updateData).then(doc => {
                            if (game.modules.get("elevationruler")?.active) {
                                const tokenObj = doc.object;
                                if (tokenObj.elevationruler) {
                                    let history = tokenObj.elevationruler.measurementHistory;
                                    if (!history)
                                        history = tokenObj.elevationruler.measurementHistory = [];
                                    const last = history.at(-1);
                                    const lastIsCurrent = last && Math.abs(last.x - endCenterX) < 2 && Math.abs(last.y - endCenterY) < 2;

                                    if (!lastIsCurrent) {
                                        startCenter.cost = 0;
                                        const endCenter = { x: endCenterX, y: endCenterY, z: 0, cost: 0, freeMovement: true };
                                        history.push(startCenter, endCenter);
                                    } else {
                                        last.freeMovement = true;
                                        last.cost = 0;
                                    }
                                }
                            }
                            return doc;
                        }));
                        pushedActors.push(t.actor);
                    }
                }

                await Promise.all(updates);

                Hooks.callAll('lancer-automations.onKnockback', triggeringToken, distance, pushedActors);

                doCleanup();
                resolve(result);
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
            if (canvas.tokens && canvas.tokens.parent) {
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
                // Range is from the token's current position
                rangeHighlight = drawRangeHighlight(activeToken, distance, 0x888888, 0.3, true);
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
            const t = canvas.stage.worldTransform;
            const tx = ((event.data.global.x - t.tx) / canvas.stage.scale.x);
            const ty = ((event.data.global.y - t.ty) / canvas.stage.scale.y);

            const activeToken = tokenList[activeIndex];
            if (!activeToken)
                return;

            const snapped = snapTokenCenter(activeToken, {x: tx, y: ty});
            const snappedX = snapped.x;
            const snappedY = snapped.y;
            const gridSize = canvas.grid.size;

            // Check validity (distance)
            const dist = getDistanceTokenToPoint({ x: snappedX + activeToken.w/2, y: snappedY + activeToken.h/2 }, activeToken);
            const inRange = dist <= distance;

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
            const t = canvas.stage.worldTransform;
            const tx = ((event.data.global.x - t.tx) / canvas.stage.scale.x);
            const ty = ((event.data.global.y - t.ty) / canvas.stage.scale.y);

            const activeToken = tokenList[activeIndex];
            if (!activeToken)
                return;

            const snapped = snapTokenCenter(activeToken, {x: tx, y: ty});
            const snappedX = snapped.x;
            const snappedY = snapped.y;

            const dist = getDistanceTokenToPoint({ x: snappedX + activeToken.w/2, y: snappedY + activeToken.h/2 }, activeToken);
            if (dist > distance) {
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
                } else {

                }
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
    });
}


/**
 * Revert a token's movement to a specific position.
 * @param {Token} token - The token to revert
 * @param {Object} destination - {x, y} position to revert to. If null, does nothing.
 * @returns {Promise<void>}
 */
export async function revertMovement(token, destination = null) {
    if (!token)
        return;
    if (!destination)
        return;
    ui.error("Reverting movement not implemented yet.");
}
