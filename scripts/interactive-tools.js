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

const _cardDefaults = {
    chooseToken: { title: "SELECT TARGETS", icon: "fas fa-crosshairs" },
    knockBack:   { title: "KNOCKBACK",       icon: "fas fa-arrow-right" },
    placeToken:  { title: "PLACE TOKEN",     icon: "fas fa-user-plus" },
    placeZone:   { title: "PLACE ZONE",      icon: "fas fa-bullseye" },
    choiceCard:  { title: "CHOICE",          icon: "fas fa-list" },
    deploymentCard: { title: "DEPLOY",      icon: "cci cci-deployable" }
};

// --- Card queue: serialise all interactive cards so they never overwrite each other ---
let _cardQueue = Promise.resolve();
let _cardQueueTitles = []; // index 0 = active card, 1+ = pending

// --- GM-controlled choice cards ---
const _pendingGMChoices = new Map(); // cardId → { resolve, cardEl, choices, mode }

function _updatePendingBadge() {
    const pendingTitles = _cardQueueTitles.slice(1);
    const badge = $('.la-info-card .la-queue-badge');
    if (pendingTitles.length > 0) {
        const text = `+${pendingTitles.length}`;
        const tooltip = pendingTitles.join('\n');
        if (badge.length) {
            badge.text(text).attr('title', tooltip);
        } else {
            $('.la-info-card .lancer-header').append(
                `<span class="la-queue-badge" title="${tooltip}">${text}</span>`
            );
        }
    } else {
        badge.remove();
    }
}

function _queueCard(fn, title = '') {
    _cardQueueTitles.push(title);
    _updatePendingBadge(); // badge on currently visible card, if any
    const next = _cardQueue.then(() => {
        const promise = fn(); // card DOM created synchronously here
        _updatePendingBadge(); // badge on newly shown card
        return promise;
    });
    const _onCardDone = () => {
        _cardQueueTitles.shift();
        _updatePendingBadge();
    };
    _cardQueue = next.then(_onCardDone, _onCardDone);
    return next;
}

function _createInfoCard(type, opts) {
    const defaults = _cardDefaults[type] || { title: "INFO", icon: "fas fa-info" };
    const {
        title = defaults.title,
        icon = defaults.icon,
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

    let infoRowHtml = '';
    if (type !== "choiceCard" && type !== "deploymentCard") {
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
        if (infoItems.length > 0) {
            infoRowHtml = `<label class="flexrow la-info-row lancer-border-primary">${infoItems.join('  ')}</label>`;
        }
    }

    const descHtml = description
        ? `<div class="la-info-description">${description}</div>`
        : '';

    let dynamicHtml = "";
    if (type === "chooseToken") {
        const selectionCheckbox = opts.hasSelection ? `
            <label class="flexrow" style="gap:6px; align-items:center; margin-bottom:6px; cursor:pointer; font-size:12px;">
                <input type="checkbox" data-role="selection-toggle" checked style="margin:0;" />
                <span>Restrict to selection</span>
            </label>` : '';
        dynamicHtml = `
            ${selectionCheckbox}
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
    } else if (type === "placeToken") {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Tokens to Place</h3>
            <div class="la-placed-tokens" data-role="token-list">
                <div class="la-empty-state">No tokens placed</div>
            </div>`;
    } else if (type === "choiceCard") {
        const modeLabel = opts.mode === "and" ? "Complete All" : "Choose One";
        dynamicHtml = `
            ${opts.disabled ? '' : `<h3 class="la-section-header lancer-border-primary">${modeLabel}</h3>`}
            <div class="la-choice-list" data-role="choice-list"></div>`;
    } else if (type === "deploymentCard") {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Deployables</h3>
            <div class="la-deployment-list" data-role="deployment-list"></div>`;
    } else {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Placed Zones</h3>
            <div class="la-placed-zones" data-role="zone-list">
                <div class="la-empty-state">No zones placed</div>
            </div>`;
    }

    const showConfirm = type !== "choiceCard";

    const html = `
    <div class="component grid-enforcement la-info-card" data-card-type="${type}">
        <div class="lancer lancer-hud window-content">
            <div class="lancer-header ${headerClass} medium">
                <i class="${icon} i--m" style="color:#000;"></i>
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
    } else if (type === "placeToken") {
        const listEl = cardEl.find('[data-role="token-list"]');
        listEl.empty();

        if (data.placements.length === 0) {
            listEl.html('<div class="la-empty-state">No tokens placed</div>');
        } else {
            data.placements.forEach((placement, idx) => {
                const imgSrc = data.prototypeTexture || "";
                const imgHtml = imgSrc
                    ? `<img src="${imgSrc}" style="width:24px; height:24px; object-fit:contain; border:1px solid #000; margin-right:8px;">`
                    : `<i class="fas fa-user" style="color:#ff6400; font-size:16px; margin-right:8px;"></i>`;
                listEl.append(`
                    <div class="la-selected-target" data-placement-index="${idx}">
                        ${imgHtml}
                        <span class="la-selected-target-name">Token ${idx + 1}</span>
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                    </div>`);
            });

            listEl.find('.la-selected-target').on('click', function () {
                const idx = $(this).data('placement-index');
                if (data.onDeletePlacement)
                    data.onDeletePlacement(idx);
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

            let immovableIcon = "";
            const api = game.modules.get('lancer-automations')?.api;
            if (api?.findFlaggedEffectOnToken(token, "immovable")) {
                immovableIcon = '<i class="cci cci-immovable" title="Immovable" style="color:#ff6400; margin-left: 8px;"></i>';
            }

            const itemHtml = `
                <div class="la-knockback-item ${statusClass} ${activeClass}" data-token-index="${idx}">
                    <img src="${token.document.texture.src}" class="la-kb-img" style="width:24px; height:24px; object-fit:contain;">
                    <span class="la-kb-name" style="display:flex; align-items:center;">${token.name}${immovableIcon}</span>
                    <span class="la-kb-status">${statusIcon}</span>
                </div>`;
            listEl.append(itemHtml);
        });

        listEl.find('.la-knockback-item').on('click', function () {
            const idx = $(this).data('token-index');
            if (data.onSelectToken)
                data.onSelectToken(idx);
        });
    } else if (type === "choiceCard") {
        const listEl = cardEl.find('[data-role="choice-list"]');
        listEl.empty();

        data.choices.forEach((choice, idx) => {
            const isDone = data.chosenSet?.has(idx);
            const doneClass = isDone ? "la-choice-done" : "";
            const disabledClass = data.disabled ? "la-choice-disabled" : "";
            const iconHtml = choice.icon
                ? `<i class="${choice.icon}" style="font-size:16px; margin-right:8px;"></i>`
                : '';
            const statusHtml = isDone
                ? '<span class="la-choice-status"><i class="fas fa-check"></i></span>'
                : '';

            listEl.append(`
                <div class="la-choice-item ${doneClass} ${disabledClass}" data-choice-index="${idx}">
                    ${iconHtml}
                    <span class="la-choice-text">${choice.text}</span>
                    ${statusHtml}
                </div>`);
        });

        if (!data.disabled) {
            listEl.find('.la-choice-item:not(.la-choice-done)').on('click', function () {
                const idx = $(this).data('choice-index');
                if (data.onChoose)
                    data.onChoose(idx);
            });
        }
    } else if (type === "deploymentCard") {
        const listEl = cardEl.find('[data-role="deployment-list"]');
        listEl.empty();

        if (!data.deployables || data.deployables.length === 0) {
            listEl.html('<div class="la-empty-state">No deployables available</div>');
        } else {
            data.deployables.forEach((dep, idx) => {
                const disabledClass = dep.disabled ? "la-choice-done" : "";
                const imgHtml = dep.img
                    ? `<img src="${dep.img}" style="width:24px; height:24px; object-fit:contain; border:1px solid #000; margin-right:8px;">`
                    : `<i class="cci cci-deployable" style="font-size:16px; margin-right:8px;"></i>`;
                const usesHtml = dep.usesText
                    ? `<span style="font-size:0.8em; color:#ff6400; margin-left:auto; white-space:nowrap;"><i class="fas fa-battery-three-quarters"></i> ${dep.usesText}</span>`
                    : '';
                const chargesHtml = dep.chargesText
                    ? `<span style="font-size:0.8em; color:#4488ff; margin-left:${dep.usesText ? '6px' : 'auto'}; white-space:nowrap;"><i class="fas fa-bolt"></i> ${dep.chargesText}</span>`
                    : '';
                const badgeHtml = dep.fromCompendium
                    ? `<span style="font-size:0.65em; background:#ff6400; color:white; padding:1px 4px; border-radius:2px; margin-left:6px;">COMP</span>`
                    : '';

                listEl.append(`
                    <div class="la-choice-item ${disabledClass}" data-dep-index="${idx}" style="display:flex; align-items:center; gap:4px; cursor:${dep.disabled ? 'not-allowed' : 'pointer'};">
                        ${imgHtml}
                        <span class="la-choice-text" style="flex:1;">${dep.name}${badgeHtml}</span>
                        ${usesHtml}
                        ${chargesHtml}
                    </div>`);
            });

            listEl.find('.la-choice-item:not(.la-choice-done)').on('click', function () {
                const idx = $(this).data('dep-index');
                if (data.onDeploy)
                    data.onDeploy(idx);
            });
        }
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
        } = options;

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
                selectionOnly = this.checked;
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
        } = options;

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
            history.length = matchIndex + 1;
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
    }), _title);
}


/**
 * Interactive tool to place tokens on the map with visual preview.
 * @param {Object} options - Configuration options
 * @param {Actor} [options.actor=null] - The actor to link spawned tokens to
 * @param {Object} options.prototypeToken - Prototype token data (e.g. from actor.prototypeToken.toObject())
 * @param {number} [options.range=null] - Maximum placement range in grid units (null = unlimited)
 * @param {number} [options.count=1] - Number of tokens to place (-1 for infinite)
 * @param {Object} [options.extraData={}] - Extra data to inject into each spawned token document
 * @param {Token|{x:number,y:number}} [options.origin=null] - Origin point: a Token, or a pixel position (snapped to nearest hex, treated as size 1)
 * @param {Function} [options.onSpawn=null] - Async callback(newTokenDoc, originToken) called after each spawn
 * @param {string} [options.title] - Card title
 * @param {string} [options.description=""] - Card description
 * @param {string} [options.icon] - Card icon class
 * @param {string} [options.headerClass=""] - Card header CSS class
 * @param {boolean} [options.noCard=false] - Whether to skip rendering the card
 * @returns {Promise<Array<TokenDocument>|null>} Array of spawned token documents, or null if cancelled
 */
export function placeToken(options = {}) {
    const _title = options.title || 'PLACE TOKEN';
    return _queueCard(() => new Promise((resolve) => {
        const {
            actor = null,
            prototypeToken,
            range = null,
            count = 1,
            extraData = {},
            origin = null,
            onSpawn = null,
            title,
            description = "",
            icon,
            headerClass = "",
            noCard = false
        } = options;

        const originToken = (origin && origin.document) ? origin : null;
        const originOffset = (!originToken && origin)
            ? pixelToOffset(origin.x, origin.y)
            : null;

        const protoWidth = prototypeToken.width ?? 1;
        const protoHeight = prototypeToken.height ?? 1;
        const gridSize = canvas.grid.size;
        const protoTexture = prototypeToken.texture?.src || "";

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

                if (canvas.tokens && canvas.tokens.parent) {
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
                // Match drawRangeHighlight: min distance from any occupied cell of the origin token
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
                prototypeTexture: protoTexture,
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
                const pos = getSpawnPosition(p.col, p.row);
                const tokenData = {
                    ...prototypeToken,
                    ...extraData,
                    x: pos.x,
                    y: pos.y
                };
                if (actor)
                    tokenData.actorId = actor.id;
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

            for (const id of createdIds) {
                const doc = canvas.scene.tokens.get(id);
                if (doc) {
                    spawnedTokens.push(doc);

                    if (window.Sequencer) {
                        const tokenObj = canvas.tokens.get(id);
                        if (tokenObj) {
                            new Sequence()
                                .effect()
                                .file("jb2a.extras.tmfx.inpulse.circle.01.normal")
                                .atLocation(tokenObj)
                                .scale(protoWidth / 2)
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

            if (canvas.tokens && canvas.tokens.parent) {
                canvas.tokens.parent.addChildAt(graphics, canvas.tokens.parent.getChildIndex(canvas.tokens));
            } else {
                canvas.stage.addChild(graphics);
            }
            return graphics;
        };

        const moveHandler = (event) => {
            const t = canvas.stage.worldTransform;
            const tx = ((event.data.global.x - t.tx) / canvas.stage.scale.x);
            const ty = ((event.data.global.y - t.ty) / canvas.stage.scale.y);

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
            const t = canvas.stage.worldTransform;
            const tx = ((event.data.global.x - t.tx) / canvas.stage.scale.x);
            const ty = ((event.data.global.y - t.ty) / canvas.stage.scale.y);

            const cursorOffset = snapCursor(tx, ty);

            if (!checkInRange(cursorOffset.col, cursorOffset.row)) {
                ui.notifications.warn("Target is out of range!");
                return;
            }
            if (count !== -1 && placements.length >= count) {
                ui.notifications.warn(`Maximum of ${count} tokens already placed.`);
                return;
            }

            const graphics = drawPlacementMarker(cursorOffset.col, cursorOffset.row);
            placements.push({ col: cursorOffset.col, row: cursorOffset.row, graphics });
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


/**
 * Interactive choice card — presents a list of choices with callbacks.
 * @param {Object} options - Configuration options
 * @param {string} [options.mode="or"] - "or" (pick one, done) or "and" (pick all sequentially)
 * @param {Array<Object>} options.choices - Array of { text, icon?, callback, data? }
 * @param {string} [options.title] - Card title
 * @param {string} [options.description=""] - Card description
 * @param {string} [options.icon] - Card icon class
 * @param {string} [options.headerClass=""] - Card header CSS class
 * @returns {Promise<true|null>} true on completion, null if cancelled
 */
export function startChoiceCard(options = {}) {
    const _title = options.title || 'CHOICE';
    const {
        mode = "or",
        choices = [],
        title,
        description = "",
        icon,
        headerClass = "",
        gmControl = false
    } = options;

    if (gmControl && !game.user.isGM) {
        return _queueCard(() => new Promise((resolve) => {
            if (choices.length === 0) {
                resolve(true);
                return;
            }

            const cardId = foundry.utils.randomID();

            const cardEl = _createInfoCard("choiceCard", {
                title,
                icon,
                headerClass,
                description: (description ? description + '<br>' : '') + '<em style="color:#aaa;"><i class="fas fa-hourglass-half"></i> Waiting for GM...</em>',
                mode,
                disabled: true,
                onConfirm: () => {},
                onCancel: () => {}
            });

            _updateInfoCard(cardEl, "choiceCard", {
                choices,
                chosenSet: new Set(),
                disabled: true,
                onChoose: () => {}
            });

            _updatePendingBadge();

            _pendingGMChoices.set(cardId, { resolve, cardEl, choices, mode });

            game.socket.emit('module.lancer-automations', {
                action: 'choiceCardGMRequest',
                payload: {
                    cardId,
                    requestingUserId: game.user.id,
                    title,
                    description,
                    icon,
                    headerClass,
                    mode,
                    choices: choices.map(c => ({ text: c.text, icon: c.icon }))
                }
            });
        }), _title);
    }

    return _queueCard(() => new Promise(async (resolve) => {
        if (choices.length === 0) {
            resolve(true);
            return;
        }

        const chosenSet = new Set();

        // Show the card once and wait for a single pick or cancel.
        // Stays within the outer _queueCard slot — does NOT go through _queueCard itself.
        const _pickOne = () => new Promise((innerResolve) => {
            let dismissed = false;

            const doCleanup = () => {
                document.removeEventListener('keydown', keyHandler);
                _removeInfoCard(cardEl);
            };

            const cardEl = _createInfoCard("choiceCard", {
                title,
                icon,
                headerClass,
                description,
                mode,
                onConfirm: () => {},
                onCancel: () => {
                    dismissed = true;
                    doCleanup();
                    innerResolve(null);
                }
            });

            const keyHandler = (event) => {
                if (event.key === "Escape") {
                    dismissed = true;
                    doCleanup();
                    innerResolve(null);
                }
            };

            document.addEventListener('keydown', keyHandler);

            _updateInfoCard(cardEl, "choiceCard", {
                choices,
                chosenSet,
                onChoose: (idx) => {
                    if (dismissed)
                        return;
                    dismissed = true;
                    doCleanup(); // close card before callback
                    innerResolve(idx);
                }
            });

            // Re-apply pending badge since this card was created outside _queueCard
            _updatePendingBadge();
        });

        if (mode === "or") {
            // OR: single pick → release queue → run callback
            const idx = await _pickOne();
            if (idx === null) {
                resolve(null);
                return;
            }
            const choice = choices[idx];
            resolve(true); // release queue slot so callback's cards appear immediately
            if (choice.callback)
                await choice.callback(choice.data);

        } else {
            // AND: loop entirely within this queue slot until all choices are picked.
            // The OR card (or any other queued card) waits until the loop ends.
            while (chosenSet.size < choices.length) {
                const idx = await _pickOne();
                if (idx === null) {
                    resolve(null);
                    return;
                }
                chosenSet.add(idx);
                const choice = choices[idx];
                if (choice.callback)
                    await choice.callback(choice.data);
            }
            resolve(true);
        }
    }), _title);
}

/**
 * Called on the GM's client (via socket) to show a controlled choice card on behalf of a player.
 * When the GM picks or cancels, the result is sent back to the requesting user.
 */
export async function showGMControlledChoiceCard({ cardId, requestingUserId, title, description, icon, headerClass, mode, choices }) {
    await _queueCard(() => new Promise(async (resolve) => {
        const chosenSet = new Set();

        const _pickOne = () => new Promise((innerResolve) => {
            let dismissed = false;

            const doCleanup = () => {
                document.removeEventListener('keydown', keyHandler);
                _removeInfoCard(cardEl);
            };

            const cardEl = _createInfoCard("choiceCard", {
                title: `[GM] ${title}`,
                icon,
                headerClass,
                description: (description ? description + '<br>' : '') + '<em style="color:#aaa;">Controlling choice for player</em>',
                mode,
                onConfirm: () => {},
                onCancel: () => {
                    dismissed = true;
                    doCleanup();
                    innerResolve(null);
                }
            });

            const keyHandler = (event) => {
                if (event.key === "Escape") {
                    dismissed = true;
                    doCleanup();
                    innerResolve(null);
                }
            };

            document.addEventListener('keydown', keyHandler);

            _updateInfoCard(cardEl, "choiceCard", {
                choices,
                chosenSet,
                onChoose: (idx) => {
                    if (dismissed)
                        return;
                    dismissed = true;
                    doCleanup();
                    innerResolve(idx);
                }
            });

            _updatePendingBadge();
        });

        if (mode === "or") {
            const idx = await _pickOne();
            game.socket.emit('module.lancer-automations', {
                action: 'choiceCardGMResponse',
                payload: { cardId, requestingUserId, choiceIdx: idx }
            });
            resolve(true);
        } else {
            while (chosenSet.size < choices.length) {
                const idx = await _pickOne();
                if (idx === null) {
                    game.socket.emit('module.lancer-automations', {
                        action: 'choiceCardGMResponse',
                        payload: { cardId, requestingUserId, choiceIdx: null }
                    });
                    resolve(null);
                    return;
                }
                chosenSet.add(idx);
                game.socket.emit('module.lancer-automations', {
                    action: 'choiceCardGMResponse',
                    payload: { cardId, requestingUserId, choiceIdx: idx }
                });
            }
            resolve(true);
        }
    }), `[GM] ${title}`);
}

/**
 * Called on the player's client (via socket) to resolve a pending GM-controlled choice.
 */
export async function resolveGMChoiceCard(cardId, choiceIdx) {
    const pending = _pendingGMChoices.get(cardId);
    if (!pending)
        return;
    _pendingGMChoices.delete(cardId);
    _removeInfoCard(pending.cardEl);

    if (choiceIdx === null || choiceIdx === undefined) {
        pending.resolve(null);
        return;
    }

    const choice = pending.choices[choiceIdx];
    pending.resolve(true);
    if (choice?.callback)
        await choice.callback(choice.data);
}

/**
 * Deploy a weapon as a token on the ground using interactive placement.
 * Creates a "Template Throw" deployable actor if it doesn't exist, then uses placeToken for placement.
 * @param {Item} weapon - The weapon item to deploy
 * @param {Actor} ownerActor - The actor who owns the weapon
 * @param {Token} [originToken=null] - The token placing the weapon (used for range origin)
 * @param {Object} [options={}] - Extra options
 * @param {number} [options.range=1] - Placement range in grid units
 * @param {string} [options.title] - Card title override
 * @param {string} [options.description] - Card description override
 * @returns {Promise<Array<TokenDocument>|null>} Spawned token documents, or null if cancelled
 */
export async function deployWeaponToken(weapon, ownerActor, originToken = null, options = {}) {
    const {
        range = 1,
        title = "DEPLOY WEAPON",
        description = "",
        at = null
    } = options;

    const templateName = "Template Throw";
    let templateActor = game.actors.contents.find(a =>
        a.name === templateName && a.type === 'deployable'
    );

    if (!templateActor) {
        const LancerActor = game.lancer?.LancerActor || Actor;
        templateActor = await LancerActor.create({
            name: templateName,
            type: 'deployable',
            img: 'systems/lancer/assets/icons/white/melee.svg',
            system: {
                hp: { value: 5, max: 5, min: 0 },
                evasion: 5,
                edef: 5,
                armor: 0,
                size: 0.5,
                activations: 0
            },
            folder: null,
            ownership: { default: 0 },
            prototypeToken: {
                name: templateName,
                img: 'systems/lancer/assets/icons/white/melee.svg',
                width: 1,
                height: 1,
                displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
                displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
                disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
                bar1: { attribute: 'hp' }
            }
        });

        if (!templateActor) {
            ui.notifications.error("Failed to create Template Throw actor.");
            return null;
        }
    }

    let ownerName = ownerActor.name;
    if (ownerActor.is_mech?.() && ownerActor.system.pilot?.status === "resolved") {
        ownerName = ownerActor.system.pilot.value.system.callsign || ownerActor.system.pilot.value.name;
    }

    const protoToken = templateActor.prototypeToken.toObject();
    protoToken.name = weapon.name;

    const extraData = {
        actorData: { name: `${weapon.name} [${ownerName}]` },
        flags: {
            ...protoToken.flags,
            'lancer-automations': {
                thrownWeapon: true,
                weaponName: weapon.name,
                weaponId: weapon.id,
                ownerActorUuid: ownerActor.uuid,
                ownerName: ownerName
            }
        }
    };
    const result = await placeToken({
        actor: templateActor,
        prototypeToken: protoToken,
        range,
        count: 1,
        origin: at || originToken,
        title,
        description,
        icon: "fas fa-hammer",
        extraData,
        onSpawn: async () => {
            await weapon.update({ 'system.disabled': true });
        }
    });

    return result;
}

/**
 * Pick up a thrown weapon token from the scene. Shows a chooseToken card restricted
 * to the owner's thrown weapons. Re-enables the weapon and deletes the deployed token.
 * @param {Token} ownerToken - The token whose actor owns the thrown weapons
 * @returns {Promise<Object|null>} { weaponName, weaponId } or null if cancelled/none found
 */
export async function pickupWeaponToken(ownerToken) {
    if (!ownerToken?.actor) {
        ui.notifications.warn("No valid token selected.");
        return null;
    }

    const ownerActor = ownerToken.actor;
    const thrownTokens = canvas.tokens.placeables.filter(t => {
        const flags = t.document.flags?.['lancer-automations'];
        return flags?.thrownWeapon && flags?.ownerActorUuid === ownerActor.uuid;
    });

    if (thrownTokens.length === 0) {
        ui.notifications.warn("No thrown weapons found for this character.");
        return null;
    }

    const selected = await chooseToken(ownerToken, {
        count: 1,
        includeSelf: false,
        selection: thrownTokens,
        title: "PICK UP WEAPON",
        description: `${thrownTokens.length} thrown weapon(s) available.`,
        icon: "fas fa-hand"
    });

    if (!selected || selected.length === 0)
        return null;

    const pickedToken = selected[0];
    const flags = pickedToken.document?.flags?.['lancer-automations'] || pickedToken.flags?.['lancer-automations'];
    const weaponId = flags?.weaponId;
    const weaponName = flags?.weaponName || "Weapon";

    if (game.user.isGM) {
        const weapon = ownerActor.items.get(weaponId);
        if (weapon)
            await weapon.update({ 'system.disabled': false });
        await pickedToken.document.delete();
    } else {
        game.socket.emit('module.lancer-automations', {
            action: "pickupWeapon",
            payload: {
                sceneId: canvas.scene.id,
                tokenId: pickedToken.document?.id || pickedToken.id,
                weaponId,
                ownerActorUuid: ownerActor.uuid,
                weaponName
            }
        });
    }

    ui.notifications.info(`Picked up ${weaponName}.`);
    return { weaponName, weaponId };
}

/**
 * Resolve a deployable actor from either a direct reference or a LID string.
 * Searches actor folder (owned by the given actor) first, then compendiums.
 * @param {Actor|string} deployableOrLid - A deployable Actor or a LID string (e.g. "dep_turret")
 * @param {Actor} ownerActor - The actor that owns the deployable (used for folder search)
 * @returns {Promise<{deployable: Actor|null, source: string|null}>} The deployable and its source ('actor', 'compendium', or null)
 */
export async function resolveDeployable(deployableOrLid, ownerActor) {
    // If it's already an Actor, return directly
    if (deployableOrLid && typeof deployableOrLid !== 'string') {
        return { deployable: deployableOrLid, source: 'actor' };
    }

    const lid = deployableOrLid;
    if (!lid)
        return { deployable: null, source: null };

    // First, look in actor folder owned by this actor
    let deployable = game.actors.contents.find(a =>
        a.type === 'deployable' &&
        a.system?.lid === lid &&
        a.system?.owner?.id === ownerActor?.uuid
    );

    if (deployable) {
        return { deployable, source: 'actor' };
    }

    // If not found, search in compendiums
    for (const pack of game.packs.filter(p => p.documentName === 'Actor')) {
        const index = await pack.getIndex();
        const entry = index.find(e => e.system?.lid === lid);

        if (entry) {
            deployable = await pack.getDocument(entry._id);
            if (deployable && deployable.type === 'deployable') {
                return { deployable, source: 'compendium' };
            }
        }
    }

    return { deployable: null, source: null };
}

/**
 * Place a deployable token on the scene with interactive placement.
 * @param {Object} options
 * @param {Actor|string} options.deployable - A deployable Actor or LID string
 * @param {Actor} options.ownerActor - The actor that owns the deployable
 * @param {Object|null} [options.systemItem=null] - The system/item that grants the deployable (for use consumption)
 * @param {boolean} [options.consumeUse=false] - Whether to consume a use from systemItem
 * @param {boolean} [options.fromCompendium=false] - Whether the deployable is from a compendium (creates a new actor)
 * @param {number|null} [options.width=null] - Token width override (defaults to deployable.prototypeToken.width)
 * @param {number|null} [options.height=null] - Token height override (defaults to deployable.prototypeToken.height)
 * @param {number} [options.range=1] - Placement range (null for unlimited)
 * @param {number} [options.count=1] - Number of tokens to place (-1 for unlimited)
 * @param {Token|Object|null} [options.at=null] - Origin override for range measurement (token or {x,y} position). When null, uses ownerActor's active token.
 * @param {string} [options.title="DEPLOY"] - Card title
 * @param {string} [options.description=""] - Card description
 * @param {boolean} [options.noCard=false] - Whether to skip rendering the card
 * @returns {Promise<Object|null>} Placement result or null
 */
export async function placeDeployable(options = {}) {
    const {
        deployable: deployableOrLid,
        ownerActor,
        systemItem = null,
        consumeUse = false,
        fromCompendium = false,
        width = null,
        height = null,
        range = 1,
        at = null,
        count = 1,
        title = "DEPLOY",
        description = "",
        noCard = false
    } = options;

    if (!ownerActor) {
        ui.notifications.error("No owner actor specified.");
        return null;
    }

    // Resolve deployable
    const resolved = await resolveDeployable(deployableOrLid, ownerActor);
    let actualDeployable = resolved.deployable;
    const isFromCompendium = fromCompendium || resolved.source === 'compendium';

    if (!actualDeployable) {
        ui.notifications.error(`Deployable not found: ${deployableOrLid}`);
        return null;
    }

    // If from compendium, create a new actor first
    if (isFromCompendium) {
        const actorData = actualDeployable.toObject();

        let ownerName = ownerActor.name;
        if (ownerActor.is_mech?.() && ownerActor.system.pilot?.status === "resolved") {
            ownerName = ownerActor.system.pilot.value.system.callsign || ownerActor.system.pilot.value.name;
        }

        actorData.system.owner = ownerActor.uuid;
        actorData.name = `${actualDeployable.name} [${ownerName}]`;
        actorData.folder = ownerActor.folder?.id;
        actorData.ownership = foundry.utils.duplicate(ownerActor.ownership);

        const LancerActor = game.lancer?.LancerActor || Actor;
        actualDeployable = await LancerActor.create(actorData);
        if (!actualDeployable) {
            ui.notifications.error("Failed to create deployable actor.");
            return null;
        }
        ui.notifications.info(`Created ${actorData.name}`);
    }

    // Determine token dimensions
    const tokenWidth = width ?? actualDeployable.prototypeToken?.width ?? 1;
    const tokenHeight = height ?? actualDeployable.prototypeToken?.height ?? 1;

    // Build prototype token data
    const protoToken = actualDeployable.prototypeToken.toObject();
    protoToken.width = tokenWidth;
    protoToken.height = tokenHeight;

    // Determine origin
    const originToken = at || ownerActor.getActiveTokens()?.[0] || null;

    let ownerName = ownerActor.name;
    if (ownerActor.is_mech?.() && ownerActor.system.pilot?.status === "resolved") {
        ownerName = ownerActor.system.pilot.value.system.callsign || ownerActor.system.pilot.value.name;
    }

    const extraData = {
        actorData: { name: `${actualDeployable.name}` },
        flags: {
            ...protoToken.flags,
            'lancer-automations': {
                deployedItem: true,
                deployableName: actualDeployable.name,
                deployableId: actualDeployable.id,
                ownerActorUuid: ownerActor.uuid,
                ownerName: ownerName,
                systemItemId: systemItem?.id || null
            }
        }
    };

    const result = await placeToken({
        actor: actualDeployable,
        prototypeToken: protoToken,
        range,
        count,
        origin: originToken,
        title,
        description,
        icon: "cci cci-deployable",
        extraData,
        noCard: noCard,
        onSpawn: async () => {
            if (consumeUse && systemItem) {
                const uses = systemItem.system?.uses;
                if (uses && typeof uses.value === 'number') {
                    const minUses = uses.min ?? 0;
                    const newUses = Math.max(uses.value - 1, minUses);
                    await systemItem.update({ "system.uses.value": newUses });
                    ui.notifications.info(`${systemItem.name} used. ${newUses} uses remaining.`);
                }
            }
        }
    });

    return result;
}

/**
 * Find a deployable by LID and place it interactively using placeDeployable.
 * @param {Actor} actor - The owner actor
 * @param {string} deployableLid - The LID of the deployable
 * @param {Object|null} parentItem - The item that grants the deployable (for use consumption)
 * @param {boolean} consumeUse - Whether to consume a use from parentItem
 */
export async function deployDeployable(actor, deployableLid, parentItem, consumeUse) {
    await placeDeployable({
        deployable: deployableLid,
        ownerActor: actor,
        systemItem: parentItem,
        consumeUse: consumeUse ?? false,
    });
}

/**
 * Show a deployment card for a specific item's deployables. Clicking a deployable
 * triggers placeDeployable with noCard. The card stays open until the user confirms or cancels.
 * @param {Object} options
 * @param {Actor} options.actor - The owner actor
 * @param {Object} options.item - The system/frame item that has deployables
 * @param {Array} [options.deployableOptions=[]] - Per-index options overrides for placeDeployable. e.g. [{ range: 3, count: 2 }, { range: 1 }]
 * @returns {Promise<boolean>} true if confirmed, null if cancelled
 */
export function beginDeploymentCard(options = {}) {
    const _title = options.item?.name || 'DEPLOY';
    return _queueCard(() => new Promise(async (resolve) => {
        const {
            actor,
            item,
            deployableOptions = []
        } = options;

        if (!actor || !item) {
            ui.notifications.warn("Actor and item are required.");
            resolve(null);
            return;
        }

        // Determine deployable LIDs from the item
        const isFrameCore = item.type === 'frame';
        const deployablesArray = isFrameCore
            ? item.system?.core_system?.deployables || []
            : item.system?.deployables || [];

        if (deployablesArray.length === 0) {
            ui.notifications.warn(`No deployables found on ${item.name}.`);
            resolve(null);
            return;
        }

        // Resolve all deployables (each array entry is separate, duplicates allowed)
        const deployables = [];
        for (let i = 0; i < deployablesArray.length; i++) {
            const lid = deployablesArray[i];
            const { deployable, source } = await resolveDeployable(lid, actor);
            const idxOpts = deployableOptions[i] || {};
            const depCount = idxOpts.count || 1;

            if (deployable) {
                deployables.push({
                    lid,
                    index: i,
                    deployable,
                    source,
                    name: deployable.name,
                    displayName: depCount > 1 ? `${deployable.name} (x${depCount})` : deployable.name,
                    img: deployable.img,
                    fromCompendium: source === 'compendium',
                    opts: idxOpts
                });
            } else {
                deployables.push({
                    lid,
                    index: i,
                    deployable: null,
                    source: null,
                    name: `Not found: ${lid}`,
                    displayName: `Not found: ${lid}`,
                    img: 'icons/svg/hazard.svg',
                    fromCompendium: false,
                    notFound: true,
                    opts: idxOpts
                });
            }
        }

        // Compute uses and charges info
        let uses, hasUses, noUsesLeft;
        if (isFrameCore) {
            uses = null;
            hasUses = false;
            noUsesLeft = false;
        } else {
            uses = item.system?.uses;
            hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
            noUsesLeft = hasUses && uses.value <= 0;
        }

        const charges = item.system?.derived?.mm_charges || item.system?.charges;
        const hasCharges = charges && typeof charges.max === 'number' && charges.max > 0;

        const buildCardData = () => {
            const currentUses = hasUses ? item.system.uses : null;
            const currentNoUsesLeft = hasUses && currentUses.value <= 0;
            const currentCharges = hasCharges ? (item.system?.derived?.mm_charges || item.system?.charges) : null;

            return deployables.map(dep => ({
                name: dep.displayName,
                img: dep.img,
                fromCompendium: dep.fromCompendium,
                disabled: dep.notFound || currentNoUsesLeft,
                usesText: hasUses ? `${currentUses.value}/${currentUses.max}` : '',
                chargesText: hasCharges ? `${currentCharges.value}/${currentCharges.max}` : ''
            }));
        };

        let cancelled = false;

        const doCleanup = () => {
            document.removeEventListener('keydown', keyHandler);
            _removeInfoCard(cardEl);
        };

        const refreshCard = () => {
            _updateInfoCard(cardEl, "deploymentCard", {
                deployables: buildCardData(),
                onDeploy: async (idx) => {
                    if (cancelled)
                        return;
                    const dep = deployables[idx];
                    if (!dep || dep.notFound || !dep.deployable)
                        return;

                    cardEl.hide();
                    await placeDeployable({
                        deployable: dep.deployable,
                        ownerActor: actor,
                        systemItem: item,
                        consumeUse: hasUses,
                        fromCompendium: dep.fromCompendium,
                        range: 1,
                        noCard: true,
                        title: `DEPLOY ${dep.name}`,
                        description: "",
                        ...dep.opts
                    });
                    if (cancelled)
                        return;
                    cardEl.show();
                    refreshCard();
                }
            });
        };

        const cardEl = _createInfoCard("deploymentCard", {
            title: item.name,
            icon: "cci cci-deployable",
            headerClass: "",
            description: "",
            onConfirm: () => {
                doCleanup();
                resolve(true);
            },
            onCancel: () => {
                cancelled = true;
                doCleanup();
                resolve(null);
            }
        });

        const keyHandler = (event) => {
            if (event.key === "Escape") {
                cancelled = true;
                doCleanup();
                resolve(null);
            }
        };

        document.addEventListener('keydown', keyHandler);
        refreshCard();
    }), _title);
}

/**
 * Open a dialog menu showing all deployables available to an actor.
 * Allows selecting and deploying them with unlimited range.
 * @param {Actor} actor - The actor whose deployables to show
 * @returns {Promise<void>}
 */
export async function openDeployableMenu(actor) {
    if (!actor) {
        ui.notifications.warn("No actor specified.");
        return;
    }

    // Get all systems with deployables from the mech
    const systemsWithDeployables = actor.items.filter(item =>
        item.system?.deployables &&
        Array.isArray(item.system.deployables) &&
        item.system.deployables.length > 0
    );

    // Also check for deployables in frame core_system
    const framesWithCoreDeployables = actor.items.filter(item =>
        item.type === 'frame' &&
        item.system?.core_system?.deployables &&
        Array.isArray(item.system.core_system.deployables) &&
        item.system.core_system.deployables.length > 0
    );

    const allSystemsWithDeployables = [...systemsWithDeployables, ...framesWithCoreDeployables];

    if (allSystemsWithDeployables.length === 0) {
        ui.notifications.warn(`No systems with deployables found for ${actor.name}.`);
        return;
    }

    // Build deployable items list
    const items = [];

    for (const system of allSystemsWithDeployables) {
        const isFrameCore = system.type === 'frame';
        const deployablesArray = isFrameCore ? system.system.core_system.deployables : system.system.deployables;

        let uses, hasUses, noUsesLeft;
        if (isFrameCore) {
            uses = null;
            hasUses = false;
            noUsesLeft = false;
        } else {
            uses = system.system.uses;
            hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
            noUsesLeft = hasUses && uses.value <= 0;
        }

        for (const lid of deployablesArray) {
            const { deployable, source } = await resolveDeployable(lid, actor);

            if (deployable) {
                const usesText = hasUses ? `${uses.value}/${uses.max}` : '';
                const isFromCompendium = source === 'compendium';
                const systemDisplayName = isFrameCore ? `${system.name} - Core System` : system.name;
                items.push({
                    id: `${system.id}_${lid}`,
                    systemId: system.id,
                    deployableId: deployable.id,
                    deployableLid: lid,
                    systemName: systemDisplayName,
                    deployableName: deployable.name,
                    deployableImg: deployable.img,
                    deployableData: deployable,
                    usesText: usesText,
                    disabled: noUsesLeft,
                    hasUses: hasUses,
                    fromCompendium: isFromCompendium,
                    tokenWidth: deployable.prototypeToken?.width || 1,
                    tokenHeight: deployable.prototypeToken?.height || 1
                });
            } else {
                const systemDisplayName = isFrameCore ? `${system.name} - Core System` : system.name;
                items.push({
                    id: `${system.id}_${lid}`,
                    systemId: system.id,
                    deployableId: null,
                    deployableLid: lid,
                    systemName: systemDisplayName,
                    deployableName: `Not found: ${lid}`,
                    deployableImg: 'icons/svg/hazard.svg',
                    usesText: '',
                    disabled: true,
                    hasUses: false,
                    notFound: true,
                    fromCompendium: false,
                    tokenWidth: 1,
                    tokenHeight: 1
                });
            }
        }
    }

    if (items.length === 0) {
        ui.notifications.warn(`No deployables available for ${actor.name}.`);
        return;
    }

    let selectedId = items.find(i => !i.disabled)?.id;
    const isGM = game.user.isGM;
    const content = `
        <style>
            .lancer-items-grid {
                grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: 10px;
                max-height: 60vh;
                overflow-y: auto;
            }
            .lancer-item-card {
                min-height: 50px;
                padding: 8px 10px;
                padding-top: 20px;
                position: relative;
                overflow: hidden;
            }
            .lancer-item-card.disabled {
                opacity: 0.5;
                cursor: not-allowed;
                border-color: #888;
                background-color: #00000030;
            }
            .lancer-item-card.disabled:hover {
                border-color: #888;
                box-shadow: none;
            }
            .lancer-item-header {
                display: flex;
                align-items: flex-start;
                gap: 6px;
                margin-bottom: 4px;
            }
            .lancer-item-icon {
                width: 32px;
                height: 32px;
                min-width: 32px;
                object-fit: cover;
                border-radius: 3px;
                flex-shrink: 0;
            }
            .lancer-item-name {
                flex: 1;
                font-weight: bold;
                word-wrap: break-word;
                overflow-wrap: break-word;
                line-height: 1.1;
                font-size: 0.95em;
            }
            .lancer-item-system {
                font-size: 0.8em;
                opacity: 0.7;
                margin-top: 1px;
                font-style: italic;
                display: flex;
                align-items: center;
                gap: 3px;
            }
            .lancer-item-uses {
                font-size: 0.8em;
                color: #ff6400;
                margin-top: 1px;
                display: flex;
                align-items: center;
                gap: 3px;
            }
            .lancer-item-not-found {
                color: #ff4444;
                font-style: italic;
            }
            .lancer-item-badge {
                position: absolute;
                top: 6px;
                right: 6px;
                background: #ff6400;
                color: white;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 0.7em;
                font-weight: bold;
                text-transform: uppercase;
            }
            .lancer-item-generate {
                margin-top: 3px;
                padding: 2px 6px;
                background: #991e2a;
                color: white;
                border: none;
                border-radius: 2px;
                cursor: pointer;
                font-size: 0.7em;
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 2px;
            }
            .lancer-item-generate:hover:not(:disabled) {
                background: #b5242f;
            }
            .lancer-item-generate:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                background: #555;
            }
            .lancer-item-note {
                font-size: 0.65em;
                color: #aaa;
                font-style: italic;
                margin-top: 1px;
            }
        </style>
        <div class="lancer-dialog-base">
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">DEPLOY SYSTEM ITEMS</div>
                <div class="lancer-dialog-subtitle">Select a deployable to place on the battlefield.</div>
            </div>
            <div class="lancer-items-grid">
                ${items.map(item => `
                    <div class="lancer-item-card ${item.disabled ? 'disabled' : ''} ${item.id === selectedId ? 'selected' : ''}"
                         data-item-id="${item.id}"
                         title="${item.disabled ? (item.notFound ? 'Deployable not found' : 'No uses remaining') : item.deployableName}">
                        ${item.fromCompendium ? '<div class="lancer-item-badge">Compendium</div>' : ''}
                        <div class="lancer-item-header">
                            <img src="${item.deployableImg}" class="lancer-item-icon" />
                            <div class="lancer-item-name ${item.notFound ? 'lancer-item-not-found' : ''}">
                                ${item.deployableName}
                            </div>
                        </div>
                        <div class="lancer-item-system">
                            <i class="cci cci-system i--sm"></i> ${item.systemName}
                        </div>
                        ${item.usesText ? `<div class="lancer-item-uses"><i class="fas fa-battery-three-quarters"></i> ${item.usesText}</div>` : ''}
                        ${item.fromCompendium ? `
                            <button class="lancer-item-generate" data-item-id="${item.id}" ${!isGM ? 'disabled' : ''}>
                                ${isGM ? '<i class="fas fa-plus"></i> Generate' : '<i class="fas fa-lock"></i> GM Only'}
                            </button>
                            ${!isGM ? '<div class="lancer-item-note">GM must create</div>' : ''}
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    const dialog = new Dialog({
        title: "Deploy System Items",
        content: content,
        buttons: {
            deploy: {
                icon: '<i class="cci cci-deployable"></i>',
                label: "Deploy",
                callback: async () => {
                    const item = items.find(i => i.id === selectedId);
                    if (!item || item.disabled || !item.deployableId) {
                        return;
                    }
                    const system = actor.items.get(item.systemId);

                    await placeDeployable({
                        deployable: item.fromCompendium ? item.deployableData : game.actors.get(item.deployableId),
                        ownerActor: actor,
                        systemItem: system,
                        consumeUse: item.hasUses,
                        fromCompendium: item.fromCompendium,
                        width: item.tokenWidth,
                        height: item.tokenHeight,
                        range: null,
                        at: null,
                        title: `DEPLOY ${item.deployableName}`,
                        description: ""
                    });
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "deploy",
        render: (html) => {
            html.find('.lancer-item-card:not(.disabled)').on('click', function () {
                html.find('.lancer-item-card').removeClass('selected');
                $(this).addClass('selected');
                selectedId = $(this).data('item-id');
            });
            html.find('.lancer-item-card:not(.disabled)').on('dblclick', function () {
                selectedId = $(this).data('item-id');
                html.closest('.dialog').find('.dialog-button.deploy').click();
            });

            // Handle Generate button
            html.find('.lancer-item-generate').on('click', async function (e) {
                e.stopPropagation();
                const itemId = $(this).data('item-id');
                const item = items.find(i => i.id === itemId);

                if (!item || !item.deployableData || !game.user.isGM) {
                    return;
                }

                const actorData = item.deployableData.toObject();

                let ownerName = actor.name;
                if (actor.is_mech?.() && actor.system.pilot?.status === "resolved") {
                    ownerName = actor.system.pilot.value.system.callsign || actor.system.pilot.value.name;
                }

                actorData.system.owner = actor.uuid;
                actorData.name = `${item.deployableName} [${ownerName}]`;
                actorData.folder = actor.folder?.id;
                actorData.ownership = foundry.utils.duplicate(actor.ownership);

                const LancerActor = game.lancer?.LancerActor || Actor;
                const newActor = await LancerActor.create(actorData);
                if (newActor) {
                    ui.notifications.info(`Created ${actorData.name}`);
                    item.deployableId = newActor.id;
                    item.deployableData = newActor;
                    item.fromCompendium = false;

                    const card = html.find(`.lancer-item-card[data-item-id="${itemId}"]`);
                    card.find('.lancer-item-badge').remove();
                    card.find('.lancer-item-generate').remove();
                    card.find('.lancer-item-note').remove();
                }
            });
        }
    }, {
        width: 680,
        height: "auto"
    });

    dialog.render(true);
}

/**
 * Recall (pick up) a deployed deployable from the scene. Shows a chooseToken card
 * restricted to tokens deployed by the owner. Deployables WITHOUT system.recall are
 * highlighted in red as a warning. Deletes the token on recall.
 * @param {Token} ownerToken - The token whose actor owns the deployables
 * @returns {Promise<Object|null>} { deployableName, deployableId } or null if cancelled/none found
 */
export async function recallDeployable(ownerToken) {
    if (!ownerToken?.actor) {
        ui.notifications.warn("No valid token selected.");
        return null;
    }

    const ownerActor = ownerToken.actor;
    const deployedTokens = canvas.tokens.placeables.filter(t => {
        const flags = t.document.flags?.['lancer-automations'];
        return flags?.deployedItem && flags?.ownerActorUuid === ownerActor.uuid;
    });

    if (deployedTokens.length === 0) {
        ui.notifications.warn("No deployed items found for this character.");
        return null;
    }

    // Check which tokens have system.recall on their actor and apply red highlights
    const recallHighlights = [];
    for (const token of deployedTokens) {
        const tokenActor = token.actor;
        if (!tokenActor?.system?.recall) {
            const hl = new PIXI.Graphics();
            hl.lineStyle(2, 0xff4444, 0.8);
            hl.beginFill(0xff4444, 0.25);
            if (isHexGrid()) {
                const offsets = getOccupiedOffsets(token);
                for (const o of offsets) {
                    drawHexAt(hl, o.col, o.row);
                }
            } else {
                const gridSize = canvas.grid.size;
                hl.drawRect(token.document.x, token.document.y,
                    token.document.width * gridSize, token.document.height * gridSize);
            }
            hl.endFill();
            if (canvas.tokens?.parent) {
                canvas.tokens.parent.addChildAt(hl, canvas.tokens.parent.getChildIndex(canvas.tokens));
            } else {
                canvas.stage.addChild(hl);
            }
            recallHighlights.push(hl);
        }
    }

    const selected = await chooseToken(ownerToken, {
        count: 1,
        includeSelf: false,
        selection: deployedTokens,
        title: "RECALL DEPLOYABLE",
        description: `${deployedTokens.length} deployed item(s) available. Red highlights indicate deployables with Recall.`,
        icon: "fas fa-hand"
    });

    // Clean up recall highlights
    for (const hl of recallHighlights) {
        hl.destroy({ children: true });
    }

    if (!selected || selected.length === 0)
        return null;

    const pickedToken = selected[0];
    const flags = pickedToken.document?.flags?.['lancer-automations'] || pickedToken.flags?.['lancer-automations'];
    const deployableName = flags?.deployableName || "Deployable";
    const deployableId = flags?.deployableId;

    if (game.user.isGM) {
        await pickedToken.document.delete();
    } else {
        game.socket.emit('module.lancer-automations', {
            action: "recallDeployable",
            payload: {
                sceneId: canvas.scene.id,
                tokenId: pickedToken.document?.id || pickedToken.id,
                ownerActorUuid: ownerActor.uuid,
                deployableName
            }
        });
    }

    ui.notifications.info(`Recalled ${deployableName}.`);
    return { deployableName, deployableId };
}

/**
 * Opens a dialog to select and throw a weapon.
 * @param {Actor} [actor] - The actor throwing the weapon. Defaults to the character of the first controlled token.
 */
export async function openThrowMenu(actor) {
    const controlled = canvas.tokens.controlled;
    const activeActor = actor || controlled[0]?.actor;

    if (!activeActor) {
        ui.notifications.warn("No actor found. Select a token or provide an actor.");
        return;
    }

    const token = activeActor.getActiveTokens()?.[0] || controlled[0];

    // Filter weapons with the "Throw" tag
    const throwWeapons = activeActor.items.filter(item => {
        if (item.type === 'mech_weapon') {
            const profiles = item.system?.profiles ?? [];
            const activeProfileIndex = item.system?.selected_profile_index ?? 0;
            const activeProfile = profiles[activeProfileIndex];
            if (!activeProfile)
                return false;
            const tags = activeProfile.tags ?? [];
            return tags.some(tag => tag.id === 'tg_thrown' || tag.lid === 'tg_thrown' || (typeof tag === 'string' && tag.toLowerCase().includes('throw')));
        } else if (item.type === 'npc_feature' && item.system?.type === 'Weapon') {
            const tags = item.system?.tags ?? [];
            return tags.some(tag => tag.id === 'tg_thrown' || tag.lid === 'tg_thrown' || (typeof tag === 'string' && tag.toLowerCase().includes('throw')));
        }
        return false;
    });

    if (throwWeapons.length === 0) {
        ui.notifications.warn(`No throwable weapons found for ${activeActor.name}.`);
        return;
    }

    const items = throwWeapons.map(weapon => {
        const uses = weapon.system?.uses;
        const hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
        const noUsesLeft = hasUses && uses.value <= 0;
        const isDestroyed = weapon.system?.destroyed ?? false;
        const isLoaded = weapon.type === 'mech_weapon' ? (weapon.system?.loaded ?? true) : true;

        let damageText = '';
        if (weapon.type === 'mech_weapon') {
            const profiles = weapon.system?.profiles ?? [];
            const activeProfileIndex = weapon.system?.selected_profile_index ?? 0;
            const activeProfile = profiles[activeProfileIndex];
            if (activeProfile?.damage) {
                damageText = activeProfile.damage.map(d => `${d.val} ${d.type}`).join(' + ');
            }
        } else if (weapon.type === 'npc_feature') {
            const tier = activeActor.system?.tier ?? 1;
            const tierIndex = Math.max(0, Math.min(2, tier - 1));
            const damages = weapon.system?.damage?.[tierIndex] ?? [];
            if (damages.length > 0) {
                damageText = damages.map(d => `${d.val} ${d.type}`).join(' + ');
            }
        }

        return {
            id: weapon.id,
            name: weapon.name,
            img: weapon.img,
            weaponData: weapon,
            damageText: damageText,
            usesText: hasUses ? `${uses.value}/${uses.max}` : '',
            disabled: noUsesLeft || isDestroyed || !isLoaded || weapon.system?.disabled,
        };
    });

    let selectedId = items.find(i => !i.disabled)?.id;
    const content = `
        <style>
            .lancer-items-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; max-height: 60vh; overflow-y: auto; }
            .lancer-item-card { min-height: 50px; padding: 8px 10px; padding-top: 20px; position: relative; overflow: hidden; border: 1px solid #7a7971; border-radius: 4px; background: rgba(0, 0, 0, 0.1); cursor: pointer; }
            .lancer-item-card.disabled { opacity: 0.5; cursor: not-allowed; border-color: #888; background-color: #00000030; }
            .lancer-item-card.selected { border-color: #ff6400; box-shadow: 0 0 5px #ff6400; }
            .lancer-item-header { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 4px; }
            .lancer-item-icon { width: 32px; height: 32px; min-width: 32px; object-fit: cover; border-radius: 3px; border: none; }
            .lancer-item-name { flex: 1; font-weight: bold; font-size: 0.95em; line-height: 1.2; }
            .lancer-item-damage { font-size: 0.85em; color: #444; margin-top: 2px; display: flex; align-items: center; gap: 3px; font-weight: bold; }
        </style>
        <div class="lancer-dialog-base">
            <div class="lancer-dialog-header" style="margin-bottom: 10px;">
                <div class="lancer-dialog-title" style="font-weight: bold; font-size: 1.2em;">THROW WEAPON</div>
                <div class="lancer-dialog-subtitle" style="font-style: italic; font-size: 0.9em; color: #666;">Select a throwable weapon to attack with.</div>
            </div>
            <div class="lancer-items-grid" style="display: grid;">
                ${items.map(item => `
                    <div class="lancer-item-card ${item.disabled ? 'disabled' : ''} ${item.id === selectedId ? 'selected' : ''}" data-item-id="${item.id}">
                        <div class="lancer-item-header">
                            <img src="${item.img}" class="lancer-item-icon" />
                            <div class="lancer-item-name">${item.name}</div>
                        </div>
                        ${item.damageText ? `<div class="lancer-item-damage"><i class="cci cci-damage"></i> ${item.damageText}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    new Dialog({
        title: "Throw Weapon",
        content: content,
        buttons: {
            throw: {
                icon: '<i class="cci cci-weapon-range"></i>',
                label: "Throw",
                callback: async () => {
                    const item = items.find(i => i.id === selectedId);
                    if (!item || item.disabled)
                        return;
                    const weapon = item.weaponData;
                    const api = game.modules.get('lancer-automations')?.api;
                    if (api?.beginThrowWeaponFlow) {
                        await api.beginThrowWeaponFlow(weapon);
                    } else if (weapon.beginWeaponAttackFlow) {
                        await weapon.beginWeaponAttackFlow(true);
                        if (api?.deployWeaponToken) {
                            await api.deployWeaponToken(weapon, activeActor, token);
                        }
                    }
                }
            },
            cancel: { label: "Cancel" }
        },
        default: "throw",
        render: (html) => {
            html.find('.lancer-item-card:not(.disabled)').on('click', function () {
                html.find('.lancer-item-card').removeClass('selected');
                $(this).addClass('selected');
                selectedId = $(this).data('item-id');
            });
            html.find('.lancer-item-card:not(.disabled)').on('dblclick', function () {
                selectedId = $(this).data('item-id');
                html.closest('.dialog').find('.dialog-button.throw').click();
            });
        }
    }, { width: 400 }).render(true);
}

/**
 * Revert a token's movement to the previous position in history or a specific destination.
 * @param {Token} token - The token to revert
 * @param {Object} [destination=null] - Optional destination to move to if elevationruler is not active.
 * @returns {Promise<boolean>} - True if history is clean (0 or 1 point remain), false otherwise.
 */
export async function revertMovement(token, destination = null) {
    if (!token)
        return true;

    // Helper to calculate distance
    const getDist = (p1, p2) => {
        let d = 0;
        if (canvas.grid.measurePath) {
            d = canvas.grid.measurePath([p1, p2]).distance;
        } else {
            d = canvas.grid.measureDistance(p1, p2);
        }
        return Math.round(d / canvas.scene.grid.distance);
    };

    if (game.modules.get("elevationruler")?.active) {
        const history = token.elevationruler?.measurementHistory;
        if (history && history.length >= 2) {
            const currentPos = { x: token.document.x, y: token.document.y };
            const newLastPoint = history[history.length - 2];
            const updates = {};

            const topLeft = {
                x: newLastPoint.x - (token.w * 0.5),
                y: newLastPoint.y - (token.h * 0.5)
            };
            const snappedPos = token.getSnappedPosition(topLeft);
            updates.x = snappedPos.x;
            updates.y = snappedPos.y;
            updates.elevation = CONFIG.GeometryLib.utils.pixelsToGridUnits(newLastPoint.z);

            const dist = getDist(currentPos, {x: updates.x, y: updates.y});
            await token.document.update(updates, { isUndo: true });
            game.modules.get("lancer-automations")?.api?.undoMoveData(token.id, dist);

            const newHistory = token.elevationruler?.measurementHistory;
            return !newHistory || newHistory.length < 2;
        } else {
            await token.document.unsetFlag("elevationruler", "movementHistory");
            if (token.elevationruler) {
                token.elevationruler.measurementHistory = [];
            }
            ui.notifications.info("Movement history cleared.");
            return true;
        }
    } else if (destination) {
        const currentPos = { x: token.document.x, y: token.document.y };
        const dist = getDist(currentPos, destination);

        await token.document.update(destination, { isUndo: true });
        game.modules.get("lancer-automations")?.api?.undoMoveData(token.id, dist);
        return true;
    }
    return true;
}

/**
 * Clear movement history for tokens.
 * @param {Token|Token[]} tokens - Token or list of tokens to clear
 * @param {boolean} [revert=false] - Whether to also revert movement visually
 */
export async function clearMovementHistory(tokens, revert = false) {
    const tokenList = Array.isArray(tokens) ? tokens : [tokens];
    if (tokenList.length === 0)
        return;

    const elevationRulerActive = game.modules.get("elevationruler")?.active;
    if (!elevationRulerActive) {
        ui.notifications.warn("Elevation Ruler module is not active. Movement history cannot be cleared.");
        return;
    }

    for (const token of tokenList) {
        if (revert) {
            while (true) {
                const isClean = await revertMovement(token);
                if (isClean)
                    break;
                await new Promise(r => setTimeout(r, 500));
            }
        }

        await token.document.unsetFlag("elevationruler", "movementHistory");
        if (token.elevationruler) {
            token.elevationruler.measurementHistory = [];
        }
        const lancerAutomations = game.modules.get('lancer-automations');
        if (lancerAutomations?.api?.clearMoveData) {
            lancerAutomations.api.clearMoveData(token.document.id);
        }
    }

    const tokenNames = tokenList.map(t => t.name).join(", ");
    ui.notifications.info(`Movement history cleared for: ${tokenNames}.`);
}
