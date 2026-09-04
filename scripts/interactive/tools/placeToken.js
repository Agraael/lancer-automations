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
    TG,
    pointerToWorld, addGraphicsBelowTokens, suppressTokenInteraction, destroyGraphics,
    createPickerSession, createCursorPreview, drawRangeHighlight, isPulseLosEnabled, makePulseCellFilter,
    _groupCellsByDistance, _makeRangePulseTick, gridLineWidth, makeText,
    suppressEvent,
    teardownRangePulse,
    paintCellRegion, paintPerimeterGlow, _staticGridAlpha, resolveRangeGlow, RANGE_PULSE_STYLE, RANGE_GLOW,
} from "../canvas-helpers.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "../presence.js";
import { rangePulse, RANGE_PULSE_PRIORITY } from "../range-pulse-manager.js";

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
export function placeToken(options = {})
{
    const _title = options.title || 'PLACE TOKEN';
    return _queueCard(() => new Promise((resolve) =>
    {
        const {
            actor: actorInput = null,
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
            elevation = null,
            los: optLos = null
        } = /** @type {any} */ (options);
        // range/count are `let` so the card can edit them live.
        let range = /** @type {any} */ (options).range ?? null;
        let count = /** @type {any} */ (options).count ?? 1;
        let losOn = optLos === null ? true : !!optLos;
        const placeGlow = resolveRangeGlow(/** @type {any} */ (options).glow ?? /** @type {any} */ (options).glowColor, RANGE_GLOW.deploy);

        // Each entry: { actor, extraData, prototypeToken, texture }
        const actorEntries = [];
        if (Array.isArray(actorInput))
        {
            for (const item of actorInput)
            {
                const actor = item.actor || item;
                const itemExtraData = item.extraData || {};
                const merged = { ...defaultExtraData, ...itemExtraData, flags: { ...(defaultExtraData.flags || {}), ...(itemExtraData.flags || {}) } };
                const proto = actor.prototypeToken ? actor.prototypeToken.toObject() : {};
                actorEntries.push({
                    actor: actor,
                    extraData: merged,
                    prototypeToken: proto,
                    texture: merged.texture?.src ?? (proto.texture?.src || ""),
                    width: merged.width ?? proto.width ?? 1,
                    height: merged.height ?? proto.height ?? 1,
                    name: merged.name ?? proto.name ?? actor.name ?? "Token"
                });
            }
        }
        else if (actorInput)
        {
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
        }
        else
        {
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
        let refToken = (originToken && originToken.document.width === protoWidth && originToken.document.height === protoHeight)
            ? originToken
            : canvas.tokens.placeables.find(placed => placed.document.width === protoWidth && placed.document.height === protoHeight) || null;

        // No same-size token on the scene: synthesise one so large-token snapping and footprint still work.
        if (!refToken)
        {
            try
            {
                const refDoc = new CONFIG.Token.documentClass({
                    x: 0,
                    y: 0,
                    width: protoWidth,
                    height: protoHeight,
                    hexagonalShape: getActiveEntry().prototypeToken?.hexagonalShape ?? 0,
                    name: "__laDeployRef"
                }, { parent: canvas.scene });
                refToken = {
                    document: refDoc,
                    w: protoWidth * gridSize,
                    h: protoHeight * gridSize,
                    getSnappedPosition: (pos) => refDoc.getSnappedPosition({ x: pos.x, y: pos.y })
                };
            }
            catch (err)
            {
                console.warn("lancer-automations | placeToken: could not build synthetic reference token", err);
            }
        }

        const placements = [];

        let inRangeSet = null;
        const rebuildRangePulse = () =>
        {
            const originForRange = originToken ?? (originOffset ? getHexCenter(originOffset.col, originOffset.row) : null);
            if (range === null || !origin || !originForRange)
            {
                inRangeSet = null;
                rangePulse.clear('interactive:placeToken');
                return;
            }
            const losFilter = makePulseCellFilter(originToken ?? null, { los: losOn });
            inRangeSet = new Set(losFilter(getInRangeOffsets(originForRange, range, { includeSelf: true })));
            rangePulse.set('interactive:placeToken', {
                priority: RANGE_PULSE_PRIORITY.INTERACTIVE,
                build: () =>
                {
                    let rangeHighlight;
                    if (originToken)
                    {
                        rangeHighlight = drawRangeHighlight(originToken, range, TG.rangeFill, 0.1, false, {
                            glowColor: placeGlow,
                            lineColor: RANGE_PULSE_STYLE.lineColor,
                            lineAlpha: _staticGridAlpha(RANGE_PULSE_STYLE.staticLineAlpha),
                            los: losOn,
                        });
                    }
                    else
                    {
                        const highlightGraphics = new PIXI.Graphics();
                        paintCellRegion(highlightGraphics, inRangeSet, {
                            color: TG.rangeFill,
                            alpha: 0.1,
                            lineColor: RANGE_PULSE_STYLE.lineColor,
                            lineAlpha: _staticGridAlpha(RANGE_PULSE_STYLE.staticLineAlpha),
                        });
                        paintPerimeterGlow(highlightGraphics, inRangeSet, { glowColor: placeGlow });
                        addGraphicsBelowTokens(highlightGraphics);
                        rangeHighlight = highlightGraphics;
                    }
                    const pulseGraphic = new PIXI.Graphics();
                    addGraphicsBelowTokens(pulseGraphic);
                    const originOffsetsForPulse = originToken ? getOccupiedOffsets(originToken) : [originOffset];
                    const hexesByDist = _groupCellsByDistance(originOffsetsForPulse, inRangeSet);
                    const wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range, { originToken: originToken ?? null, glowColor: placeGlow, los: losOn });
                    canvas.app.ticker.add(wavePulse);
                    return () => teardownRangePulse(wavePulse, rangeHighlight, pulseGraphic);
                },
            });
        };
        rebuildRangePulse();

        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();

        // Auto elevation follows terrain under the cursor; Q/E offsets it, frozen onto each placed token.
        let autoElevation = true;
        let pendingElevationOffset = defaultElevation;
        let lastCursorOffset = null;
        let lastCursorColor = TG.inRange; // mirrors the live cursor's in-range/out-of-range colour
        const groundAt = (offset) =>
        {
            const terrainAPI = globalThis.terrainHeightTools;
            return terrainAPI ? (Number(getHexGroundElevation(offset.col, offset.row, terrainAPI)) || 0) : 0;
        };
        const elevAt = (offset) => (autoElevation ? groundAt(offset) : 0) + pendingElevationOffset;
        const cursorElevLabel = makeText('', {
            fontFamily: 'Arial',
            fontSize: Math.max(14, canvas.grid.size * 0.22),
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: gridLineWidth(4),
            fontWeight: 'bold',
        });
        cursorElevLabel.anchor.set(0.5);
        cursorElevLabel.visible = false;
        {
            const iso = getIsoProvider();
            if (iso)
            {
                cursorElevLabel.rotation = iso.reverseRotation;
                cursorElevLabel.skew.set(iso.reverseSkewX, iso.reverseSkewY);
                cursorElevLabel.scale.set(iso.counterScale, 1 / iso.counterScale);
            }
        }
        canvas.stage.addChild(cursorElevLabel).eventMode = 'none';

        const restoreTokenInteraction = suppressTokenInteraction();

        const getProtoOffsets = (centerCol, centerRow) =>
        {
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

        const checkInRange = (col, row) =>
        {
            if (range === null || !origin)
                return true;
            return inRangeSet ? inRangeSet.has(`${col},${row}`) : true;
        };

        const getSpawnPosition = (centerCol, centerRow) =>
        {
            const center = getHexCenter(centerCol, centerRow);
            if (refToken)
                return snapTokenCenter(refToken, center);
            return {
                x: center.x - (protoWidth * gridSize / 2),
                y: center.y - (protoHeight * gridSize / 2)
            };
        };

        const snapCursor = (tx, ty) =>
        {
            if (refToken)
            {
                const snapped = snapTokenCenter(refToken, { x: tx, y: ty });
                return pixelToOffset(snapped.x + refToken.w / 2, snapped.y + refToken.h / 2);
            }
            return pixelToOffset(tx, ty);
        };

        const drawOffsets = (graphics, offsets) =>
        {
            for (const offset of offsets)
            {
                if (isHexGrid())
                    drawHexAt(graphics, offset.col, offset.row);
                else
                {
                    const center = getHexCenter(offset.col, offset.row);
                    graphics.drawRect(center.x - gridSize / 2, center.y - gridSize / 2, gridSize, gridSize);
                }
            }
        };

        let stopPresenceBeat = /** @type {null | (() => void)} */ (null);
        const doCleanup = () =>
        {
            if (stopPresenceBeat)
                stopPresenceBeat();
            clearToolPresence('placeToken');
            disposeCursorPreview();
            destroyGraphics(cursorElevLabel);
            rangePulse.clear('interactive:placeToken');
            session.unbind();

            for (const placement of placements)
                destroyGraphics(placement.graphics);

            restoreTokenInteraction();
            if (cardEl)
                _removeInfoCard(cardEl);
        };

        const refreshCard = () =>
        {
            if (!cardEl)
                return;
            const warnings = {};
            placements.forEach((placement, idx) =>
            {
                if (placement.warning)
                    warnings[idx] = [placement.warning];
            });
            _updateInfoCard(cardEl, "placeToken", {
                placements,
                actorEntries,
                activeActorIndex,
                isMultiActor,
                warnings,
                autoElevation,
                onToggleAutoElevation: () =>
                {
                    autoElevation = !autoElevation;
                    if (lastCursorOffset)
                        drawCursorAt(lastCursorOffset);
                    refreshCard();
                },
                onSelectActor: (idx) =>
                {
                    activeActorIndex = idx;
                    refreshCard();
                },
                onDeletePlacement: (idx) =>
                {
                    const removed = placements.splice(idx, 1);
                    destroyGraphics(removed[0]?.graphics);
                    refreshCard();
                }
            });
        };

        const doConfirm = async () =>
        {
            const spawnedTokens = [];
            const allTokenData = [];
            for (const p of placements)
            {
                const entry = actorEntries[p.actorIndex ?? 0];
                const pos = getSpawnPosition(p.col, p.row);
                const tokenData = foundry.utils.mergeObject(
                    foundry.utils.deepClone(entry.prototypeToken || {}),
                    entry.extraData || {}
                );

                if (disposition !== null)
                    tokenData.disposition = disposition;
                if (team !== null)
                {
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
            if (game.user.isGM)
            {
                const created = await canvas.scene.createEmbeddedDocuments("Token", allTokenData);
                createdIds = created.map(doc => doc.id);
            }
            else
            {
                const requestId = foundry.utils.randomID();
                game.socket.emit('module.lancer-automations', {
                    action: "createTokens",
                    payload: { tokenDataArray: allTokenData, sceneId: canvas.scene.id, requestId }
                });
                createdIds = await new Promise((resolve) =>
                {
                    const handler = (data) =>
                    {
                        if (data.action === 'createTokensResponse' && data.payload.requestId === requestId)
                        {
                            game.socket.off('module.lancer-automations', handler);
                            resolve(data.payload.tokenIds);
                        }
                    };
                    game.socket.on('module.lancer-automations', handler);
                });
            }

            for (let i = 0; i < createdIds.length; i++)
            {
                const id = createdIds[i];
                const entry = actorEntries[placements[i]?.actorIndex ?? 0];
                const doc = canvas.scene.tokens.get(id);
                if (doc)
                {
                    spawnedTokens.push(doc);

                    if (globalThis.Sequencer)
                    {
                        const tokenObj = canvas.tokens.get(id);
                        if (tokenObj)
                        {
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
            showLosToggle: !!originToken && isPulseLosEnabled(),
            losOn,
            onToggleLos: (checked) =>
            {
                losOn = checked;
                rebuildRangePulse();
                for (const placement of placements)
                    placement.warning = checkInRange(placement.col, placement.row) ? null : 'Out of range (allowed)';
                if (lastCursorOffset)
                    drawCursorAt(lastCursorOffset);
                refreshCard();
                broadcastToolPresence('placeToken', presenceData());
            },
            onConfirm: doConfirm,
            onRangeChange: (newRange) =>
            {
                range = newRange;
                rebuildRangePulse();
                for (const placement of placements)
                    placement.warning = checkInRange(placement.col, placement.row) ? null : 'Out of range (allowed)';
                if (lastCursorOffset)
                    drawCursorAt(lastCursorOffset);
                refreshCard();
                broadcastToolPresence('placeToken', presenceData());
            },
            onCountChange: (newCount) =>
            {
                count = newCount;
                if (count !== -1 && placements.length > count)
                {
                    const removed = placements.splice(0, placements.length - count);
                    for (const placement of removed)
                        destroyGraphics(placement.graphics);
                }
                refreshCard();
                broadcastToolPresence('placeToken', presenceData());
            },
            onCancel: () =>
            {
                doCleanup();
                resolve(null);
            }
        });

        const drawPlacementMarker = (centerCol, centerRow, elev) =>
        {
            const container = new PIXI.Container();
            const graphics = new PIXI.Graphics();
            graphics.lineStyle(gridLineWidth(2), 0xff6400, 0.8);
            graphics.beginFill(0xff6400, 0.3);
            drawOffsets(graphics, getProtoOffsets(centerCol, centerRow));
            graphics.endFill();
            container.addChild(graphics);

            const center = getHexCenter(centerCol, centerRow);
            const label = makeText(elev > 0 ? `↑ ${elev}` : elev < 0 ? `↓ ${-elev}` : `↕ 0`, {
                fontFamily: 'Arial',
                fontSize: Math.max(14, gridSize * 0.22),
                fill: 0xffffff,
                stroke: 0x000000,
                strokeThickness: gridLineWidth(4),
                fontWeight: 'bold'
            });
            label.anchor.set(0.5);
            label.x = center.x;
            label.y = center.y - gridSize * 0.45;
            const iso = getIsoProvider();
            if (iso)
            {
                label.rotation = iso.reverseRotation;
                label.skew.set(iso.reverseSkewX, iso.reverseSkewY);
                label.scale.set(iso.counterScale, 1 / iso.counterScale);
            }
            container.addChild(label);
            container._labelText = label;

            addGraphicsBelowTokens(container);
            return container;
        };

        const formatElevation = (elev) => elev > 0 ? `↑ ${elev}` : elev < 0 ? `↓ ${-elev}` : `↕ 0`;
        // Presence: live cursor footprint (blue) + placed markers (yellow) + elevation labels.
        const presenceData = () =>
        {
            const placedCells = placements.flatMap(placement => getProtoOffsets(placement.col, placement.row).map(offset => `${offset.col},${offset.row}`));
            const labels = placements.map(p =>
            {
                const center = getHexCenter(p.col, p.row);
                return { x: center.x, y: center.y - gridSize * 0.45, text: formatElevation(p.elevation) };
            });
            const cells = lastCursorOffset
                ? getProtoOffsets(lastCursorOffset.col, lastCursorOffset.row).map(offset => `${offset.col},${offset.row}`)
                : [];
            if (cursorElevLabel.visible)
                labels.push({ x: cursorElevLabel.x, y: cursorElevLabel.y, text: cursorElevLabel.text });
            return { cells, placedCells, labels, tokens: [], placedColor: 0xff6400, cellColor: lastCursorColor, relatedToken: originToken };
        };
        const drawCursorAt = (offset) =>
        {
            const inRange = checkInRange(offset.col, offset.row);
            const color = inRange ? TG.inRange : TG.outOfRange;
            lastCursorColor = color;
            cursorPreview.clear();
            cursorPreview.lineStyle(gridLineWidth(2), color, 0.8);
            cursorPreview.beginFill(color, 0.4);
            drawOffsets(cursorPreview, getProtoOffsets(offset.col, offset.row));
            cursorPreview.endFill();
            const center = getHexCenter(offset.col, offset.row);
            cursorElevLabel.text = formatElevation(elevAt(offset));
            cursorElevLabel.x = center.x;
            cursorElevLabel.y = center.y - canvas.grid.size * 0.45;
            cursorElevLabel.visible = true;
            broadcastToolPresence('placeToken', presenceData());
        };

        const moveHandler = (event) =>
        {
            const { x: worldX, y: worldY } = pointerToWorld(event);
            const cursorOffset = snapCursor(worldX, worldY);
            lastCursorOffset = cursorOffset;
            playTargetingMove(cursorOffset.col, cursorOffset.row);
            drawCursorAt(cursorOffset);
        };

        const clickHandler = (event) =>
        {
            const { x: worldX, y: worldY } = pointerToWorld(event);

            const cursorOffset = snapCursor(worldX, worldY);

            // Re-placing on the same cell is a no-op; at the count cap, recycle the oldest marker (FIFO).
            if (placements.some(placement => placement.col === cursorOffset.col && placement.row === cursorOffset.row))
                return;
            if (count !== -1 && placements.length >= count)
            {
                const oldest = placements.shift();
                destroyGraphics(oldest?.graphics);
            }

            const elev = elevAt(cursorOffset);
            const warning = !checkInRange(cursorOffset.col, cursorOffset.row) ? 'Out of range (allowed)' : null;
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

            if (noCard && (count === -1 || placements.length >= count))
                doConfirm();
        };

        const ascendKeys = keyCodesFor('elevationUp');
        const descendKeys = keyCodesFor('elevationDown');
        const keyHandler = (event) =>
        {
            if (event.key === "Escape")
            {
                suppressEvent(event);
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
            suppressEvent(event);
            // Adjust the pending offset (next placement), not already-placed tokens.
            pendingElevationOffset += step;
            if (lastCursorOffset)
                drawCursorAt(lastCursorOffset);
            playUiSound('targeting');
        };

        refreshCard();

        const session = createPickerSession('placeToken', () =>
        {
            try
            {
                doCleanup();
            }
            catch
            { /* */ }
            resolve(null);
        });
        session.bind({ move: moveHandler, click: clickHandler, key: keyHandler });
        stopPresenceBeat = startToolHeartbeat('placeToken', presenceData);
    }), _title);
}
