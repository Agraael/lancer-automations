/* global canvas, PIXI, game, ui, Sequence, document, globalThis */

import {
    isHexGrid, getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets,
    snapTokenCenter, getInRangeOffsets,
} from "../../combat/grid-helpers.js";
import { getHexGroundElevation } from "../../combat/terrain-utils.js";
import { getIsoProvider } from "../../setup/iso-settings.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";
import { keyCodesFor } from "../keybindings.js";

import {
    _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard,
} from "../cards.js";

import {
    pointerToWorld, addGraphicsBelowTokens, suppressTokenLayerClick, destroyGraphics,
    makeSafe, createCursorPreview, drawRangeHighlight,
    _groupCellsByDistance, _makeRangePulseTick,
} from "../canvas-helpers.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "../presence.js";

/**
 * Interactive tool to place tokens on the map with visual preview.
 * @param {Object} options - Configuration options
 * @param {Actor|Array<Actor>|Array<{actor:Actor, extraData?:Object}>} [options.actor=null] - The actor(s) to place.
 * @param {number} [options.range=null] - Maximum placement range in grid units (null = unlimited)
 * @param {number} [options.count=1] - Total number of tokens to place (-1 for infinite)
 * @param {Object} [options.extraData={}] - Default overrides for spawned token data.
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
            team = null,
            elevation = null
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
            // No actor: empty proto
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
        const defaultElevation = (typeof elevation === 'number') ? elevation : 0;

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

        const pulseGraphic = new PIXI.Graphics();
        addGraphicsBelowTokens(pulseGraphic);
        let wavePulse = null;

        let inRangeSet = null;
        if (range !== null && origin) {
            const originForRange = originToken ?? (originOffset ? getHexCenter(originOffset.col, originOffset.row) : null);
            if (originForRange) {
                inRangeSet = getInRangeOffsets(originForRange, range, { includeSelf: true });
                if (originToken) {
                    rangeHighlight = drawRangeHighlight(originToken, range, 0x888888, 0.1, false);
                } else {
                    const hl = new PIXI.Graphics();
                    hl.lineStyle(2, 0x888888, 0.3);
                    hl.beginFill(0x888888, 0.1);
                    for (const key of inRangeSet) {
                        const [col, row] = key.split(',').map(Number);
                        if (isHexGrid()) {
                            drawHexAt(hl, col, row);
                        } else {
                            const center = getHexCenter(col, row);
                            hl.drawRect(center.x - gridSize / 2, center.y - gridSize / 2, gridSize, gridSize);
                        }
                    }
                    hl.endFill();
                    addGraphicsBelowTokens(hl);
                    rangeHighlight = hl;
                }

                const originOffsetsForPulse = originToken ? getOccupiedOffsets(originToken) : [originOffset];
                const hexesByDist = _groupCellsByDistance(originOffsetsForPulse, inRangeSet);
                wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range);
                canvas.app.ticker.add(wavePulse);
            }
        }

        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();

        // Auto elevation follows terrain under the cursor; Q/E offsets it, frozen onto each placed token.
        let autoElevation = true;
        let pendingElevationOffset = defaultElevation;
        let lastCursorOffset = null;
        let lastCursorColor = 0x0088ff; // mirrors the live cursor's in-range/out-of-range colour
        const groundAt = (offset) => {
            const tAPI = globalThis.terrainHeightTools;
            return tAPI ? (Number(getHexGroundElevation(offset.col, offset.row, tAPI)) || 0) : 0;
        };
        const elevAt = (offset) => (autoElevation ? groundAt(offset) : 0) + pendingElevationOffset;
        const cursorElevLabel = new PIXI.Text('', {
            fontFamily: 'Arial', fontSize: Math.max(14, canvas.grid.size * 0.22),
            fill: 0xffffff, stroke: 0x000000, strokeThickness: 4, fontWeight: 'bold',
        });
        cursorElevLabel.anchor.set(0.5);
        cursorElevLabel.visible = false;
        {
            const iso = getIsoProvider();
            if (iso) {
                cursorElevLabel.rotation = iso.reverseRotation;
                cursorElevLabel.skew.set(iso.reverseSkewX, iso.reverseSkewY);
                cursorElevLabel.scale.set(iso.counterScale, 1 / iso.counterScale);
            }
        }
        canvas.stage.addChild(cursorElevLabel);

        const prevInteractive = canvas.tokens.interactiveChildren;
        canvas.tokens.interactiveChildren = false;
        const restoreLayerClick = suppressTokenLayerClick();

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
            return inRangeSet ? inRangeSet.has(`${col},${row}`) : true;
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

        let safeMove, safeClick, safeRight, safeKey;
        let stopPresenceBeat = /** @type {null | (() => void)} */ (null);
        const doCleanup = () => {
            if (stopPresenceBeat)
                stopPresenceBeat();
            clearToolPresence('placeToken');
            disposeCursorPreview();
            destroyGraphics(cursorElevLabel);
            if (wavePulse)
                canvas.app.ticker.remove(wavePulse);
            if (safeClick)
                canvas.stage.off('click', safeClick);
            if (safeRight)
                canvas.stage.off('rightdown', safeRight);
            if (safeMove)
                canvas.stage.off('pointermove', safeMove);
            if (safeKey)
                document.removeEventListener('keydown', safeKey, true);

            destroyGraphics(rangeHighlight);
            destroyGraphics(pulseGraphic);
            for (const p of placements)
                destroyGraphics(p.graphics);

            canvas.tokens.interactiveChildren = prevInteractive;
            restoreLayerClick();
            if (cardEl)
                _removeInfoCard(cardEl);
        };

        const refreshCard = () => {
            if (!cardEl)
                return;
            const warnings = {};
            placements.forEach((p, idx) => {
                if (p.warning)
                    warnings[idx] = [p.warning];
            });
            _updateInfoCard(cardEl, "placeToken", {
                placements,
                actorEntries,
                activeActorIndex,
                isMultiActor,
                warnings,
                autoElevation,
                onToggleAutoElevation: () => {
                    autoElevation = !autoElevation;
                    if (lastCursorOffset)
                        drawCursorAt(lastCursorOffset);
                    refreshCard();
                },
                onSelectActor: (idx) => {
                    activeActorIndex = idx;
                    refreshCard();
                },
                onDeletePlacement: (idx) => {
                    const removed = placements.splice(idx, 1);
                    destroyGraphics(removed[0]?.graphics);
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
                tokenData.elevation = (typeof p.elevation === 'number') ? p.elevation : defaultElevation;
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

        const drawPlacementMarker = (centerCol, centerRow, elev) => {
            const container = new PIXI.Container();
            const graphics = new PIXI.Graphics();
            graphics.lineStyle(2, 0xff6400, 0.8);
            graphics.beginFill(0xff6400, 0.3);
            drawOffsets(graphics, getProtoOffsets(centerCol, centerRow));
            graphics.endFill();
            container.addChild(graphics);

            const center = getHexCenter(centerCol, centerRow);
            const label = new PIXI.Text(elev > 0 ? `↑ ${elev}` : elev < 0 ? `↓ ${-elev}` : `↕ 0`, {
                fontFamily: 'Arial',
                fontSize: Math.max(14, gridSize * 0.22),
                fill: 0xffffff,
                stroke: 0x000000,
                strokeThickness: 4,
                fontWeight: 'bold'
            });
            label.anchor.set(0.5);
            label.x = center.x;
            label.y = center.y - gridSize * 0.45;
            const iso = getIsoProvider();
            if (iso) {
                label.rotation = iso.reverseRotation;
                label.skew.set(iso.reverseSkewX, iso.reverseSkewY);
                label.scale.set(iso.counterScale, 1 / iso.counterScale);
            }
            container.addChild(label);
            container._labelText = label;

            addGraphicsBelowTokens(container);
            return container;
        };

        const elevStr = (e) => e > 0 ? `↑ ${e}` : e < 0 ? `↓ ${-e}` : `↕ 0`;
        // Presence: live cursor footprint (blue) + placed markers (yellow) + elevation labels.
        const presenceData = () => {
            const placedCells = placements.flatMap(p => getProtoOffsets(p.col, p.row).map(o => `${o.col},${o.row}`));
            const labels = placements.map(p => {
                const c = getHexCenter(p.col, p.row);
                return { x: c.x, y: c.y - gridSize * 0.45, text: elevStr(p.elevation) };
            });
            const cells = lastCursorOffset
                ? getProtoOffsets(lastCursorOffset.col, lastCursorOffset.row).map(o => `${o.col},${o.row}`)
                : [];
            if (cursorElevLabel.visible)
                labels.push({ x: cursorElevLabel.x, y: cursorElevLabel.y, text: cursorElevLabel.text });
            return { cells, placedCells, labels, tokens: [], placedColor: 0xff6400, cellColor: lastCursorColor, relatedToken: originToken };
        };
        const drawCursorAt = (offset) => {
            const inRange = checkInRange(offset.col, offset.row);
            const color = inRange ? 0x0088ff : 0xff0000;
            lastCursorColor = color;
            cursorPreview.clear();
            cursorPreview.lineStyle(2, color, 0.8);
            cursorPreview.beginFill(color, 0.4);
            drawOffsets(cursorPreview, getProtoOffsets(offset.col, offset.row));
            cursorPreview.endFill();
            const c = getHexCenter(offset.col, offset.row);
            cursorElevLabel.text = elevStr(elevAt(offset));
            cursorElevLabel.x = c.x;
            cursorElevLabel.y = c.y - canvas.grid.size * 0.45;
            cursorElevLabel.visible = true;
            broadcastToolPresence('placeToken', presenceData());
        };

        const moveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            const cursorOffset = snapCursor(tx, ty);
            lastCursorOffset = cursorOffset;
            playTargetingMove(cursorOffset.col, cursorOffset.row);
            drawCursorAt(cursorOffset);
        };

        const clickHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);

            const cursorOffset = snapCursor(tx, ty);

            if (count !== -1 && placements.length >= count) {
                ui.notifications.warn(`Maximum of ${count} tokens already placed.`);
                return;
            }

            const warning = !checkInRange(cursorOffset.col, cursorOffset.row) ? 'Out of range' : null;
            const elev = elevAt(cursorOffset);
            const graphics = drawPlacementMarker(cursorOffset.col, cursorOffset.row, elev);
            placements.push({
                col: cursorOffset.col,
                row: cursorOffset.row,
                graphics,
                actorIndex: activeActorIndex,
                warning,
                elevation: elev
            });
            playUiSound('targetingConfirm');
            refreshCard();
            broadcastToolPresence('placeToken', presenceData());

            if (noCard && (count === -1 || placements.length >= count)) {
                doConfirm();
            }
        };

        const ascendKeys = keyCodesFor('elevationUp');
        const descendKeys = keyCodesFor('elevationDown');
        const keyHandler = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                doCleanup();
                resolve(null);
                return;
            }
            let step = 0;
            if (ascendKeys.has(event.code))
                step = 1;
            else if (descendKeys.has(event.code))
                step = -1;
            if (step === 0)
                return;
            // Always swallow the key so it can't reach Foundry's controlled-token elevation handler.
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            // Adjust the pending offset (next placement), not already-placed tokens.
            pendingElevationOffset += step;
            if (lastCursorOffset)
                drawCursorAt(lastCursorOffset);
            playUiSound('targeting');
        };

        refreshCard();

        const safe = makeSafe('placeToken', () => {
            try {
                doCleanup();
            } catch { /* */ }
            resolve(null);
        });
        safeMove = safe(moveHandler);
        safeClick = safe(clickHandler);
        safeKey = safe(keyHandler);
        canvas.stage.on('pointermove', safeMove);
        canvas.stage.on('click', safeClick);
        document.addEventListener('keydown', safeKey, true);
        stopPresenceBeat = startToolHeartbeat('placeToken', presenceData);
    }), _title);
}
