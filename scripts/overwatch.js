/*global game, Dialog, ChatMessage, canvas, CONST */

export function isFriendly(token1, token2) {
    const tokenFactions = game.modules.get("token-factions")?.api;
    if (tokenFactions && typeof tokenFactions.getDisposition === 'function') {
        const disposition = tokenFactions.getDisposition(token1, token2);
        const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
        return disposition === FRIENDLY;
    } else {
        const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
        const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;
        const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
        const NEUTRAL = CONST.TOKEN_DISPOSITIONS.NEUTRAL;

        const d1 = token1.document.disposition;
        const d2 = token2.document.disposition;

        const is1Bad = d1 === HOSTILE || d1 === SECRET;
        const is2Bad = d2 === HOSTILE || d2 === SECRET;
        const is1Good = d1 === FRIENDLY || d1 === NEUTRAL;
        const is2Good = d2 === FRIENDLY || d2 === NEUTRAL;

        return (is1Good && is2Good) || (is1Bad && is2Bad);
    }
}

export function isHostile(reactor, mover) {
    const tokenFactions = game.modules.get("token-factions")?.api;
    if (tokenFactions && typeof tokenFactions.getDisposition === 'function') {
        const disposition = tokenFactions.getDisposition(reactor, mover);
        const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
        const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;
        return disposition === HOSTILE || disposition === SECRET;
    } else {
        const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
        const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;
        const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
        const NEUTRAL = CONST.TOKEN_DISPOSITIONS.NEUTRAL;

        const isTargetBad = mover.document.disposition === HOSTILE || mover.document.disposition === SECRET;
        const isReactorBad = reactor.document.disposition === HOSTILE || reactor.document.disposition === SECRET;
        const isTargetFriendly = mover.document.disposition === FRIENDLY || mover.document.disposition === NEUTRAL;
        const isReactorFriendly = reactor.document.disposition === FRIENDLY || reactor.document.disposition === NEUTRAL;

        return (isReactorFriendly && isTargetBad) || (isReactorBad && isTargetFriendly);
    }
}

export function checkOverwatchCondition(reactor, mover, startPos) {
    if (reactor.id === mover.id) return false;

    if (!isHostile(reactor, mover)) return false;

    const reaction = reactor.actor?.system?.action_tracker?.reaction;
    if (!reaction || reaction <= 0) return false;

    const auraLayer = canvas.gaaAuraLayer;
    const manager = auraLayer?._auraManager;

    if (manager) {
        const auras = manager.getTokenAuras(reactor);
        const threatAura = auras.find(a => a.config.name === "Threat_detail" || a.config.name === "Threat");

        if (threatAura) {
            return manager.isInside(mover, reactor, threatAura.config.id);
        }
    }

    const maxThreat = getActorMaxThreat(reactor.actor);
    const distanceStart = getMinGridDistance(mover, reactor, startPos);

    return distanceStart <= maxThreat;
}

export async function checkOverwatch(token, distance, elevation, startPos, endPos) {
    if (!game.settings.get('lancer-reactionChecker', 'overwatchEnabled')) return;

    const movedToken = token;

    if (!movedToken.inCombat) return;

    const auraLayer = canvas.gaaAuraLayer;
    const manager = auraLayer?._auraManager;

    const potentialReactors = canvas.tokens.placeables.filter(t => {
        if (t.id === movedToken.id) return false;
        if (!t.actor) return false;
        if (!t.isOwner) return false;

        const reaction = t.actor.system.action_tracker?.reaction;
        if (!reaction || reaction <= 0) return false;

        const tokenFactions = game.modules.get("token-factions")?.api;
        if (tokenFactions && typeof tokenFactions.getDisposition === 'function') {
            const disposition = tokenFactions.getDisposition(t, movedToken);
            const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
            const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;
            if (disposition !== HOSTILE && disposition !== SECRET) {
                return false;
            }
        } else {
            const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
            const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;
            const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
            const NEUTRAL = CONST.TOKEN_DISPOSITIONS.NEUTRAL;

            const isTargetBad = movedToken.document.disposition === HOSTILE || movedToken.document.disposition === SECRET;
            const isReactorBad = t.document.disposition === HOSTILE || t.document.disposition === SECRET;

            const isTargetFriendly = movedToken.document.disposition === FRIENDLY || movedToken.document.disposition === NEUTRAL;
            const isReactorFriendly = t.document.disposition === FRIENDLY || t.document.disposition === NEUTRAL;

            if (!((isReactorFriendly && isTargetBad) || (isReactorBad && isTargetFriendly))) return false;
        }
        return true;
    });

    const triggeredReactors = [];

    for (const reactor of potentialReactors) {
        let isTriggered = false;

        if (manager) {
            const auras = manager.getTokenAuras(reactor);
            const threatAura = auras.find(a => a.config.name === "Threat_detail" || a.config.name === "Threat");

            if (threatAura) {
                const wasInside = manager.isInside(movedToken, reactor, threatAura.config.id);
                if (wasInside) {
                    isTriggered = true;
                }
            }
        }

        if (!isTriggered) {
            const hasGaaSupport = manager && manager.getTokenAuras(reactor).some(a => a.config.name === "Threat_detail" || a.config.name === "Threat");

            if (!hasGaaSupport) {
                const maxThreat = getActorMaxThreat(reactor.actor);
                const distanceStart = getMinGridDistance(movedToken, reactor, startPos);

                if (distanceStart <= maxThreat) {
                    isTriggered = true;
                }
            }
        }

        if (isTriggered) {
            triggeredReactors.push(reactor);
        }
    }

    if (triggeredReactors.length > 0) {
        const ownerMap = {};

        for (const reactor of triggeredReactors) {
            const owners = game.users.filter(u => u.active && reactor.document.testUserPermission(u, "OWNER"));
            for (const user of owners) {
                if (!ownerMap[user.id]) ownerMap[user.id] = [];
                ownerMap[user.id].push(reactor.id);
            }
        }

        for (const [userId, reactorIds] of Object.entries(ownerMap)) {
            if (userId === game.userId) {
                const myReactors = reactorIds.map(id => canvas.tokens.get(id));
                displayOverwatch(myReactors, movedToken.document);
            } else {
                game.socket.emit('module.lancer-reactionChecker', {
                    action: 'overwatchAlert',
                    payload: {
                        reactorIds: reactorIds,
                        targetId: movedToken.id
                    }
                });
            }
        }
    }
}

export function displayOverwatch(reactors, target) {
    let reactorItems = "";

    for (const reactor of reactors) {
        reactorItems += `
        <div class="lancer-list-item" data-token-id="${reactor.id}">
             <img src="${reactor.document.texture.src}" width="36" height="36" style="margin-right:10px; border: 1px solid #991e2a; border-radius: 4px; background: #000; cursor: pointer;">
             <div class="lancer-item-content">
                 <div class="lancer-item-name">${reactor.name}</div>
                 <div class="lancer-item-details">Started in Threat Range</div>
             </div>
        </div>`;
    }

    const html = `
    <div class="lancer-dialog-base">
        <div class="lancer-dialog-header">
             <div class="lancer-dialog-title">OVERWATCH OPPORTUNITY</div>
             <div class="lancer-dialog-subtitle">Target: ${target.name}</div>
        </div>

        <div class="lancer-list">
            ${reactorItems}
        </div>

        <div class="lancer-info-box">
             <i class="fas fa-crosshairs"></i>
             <span>Click a reactor to select and pan. You may immediately <strong>SKIRMISH</strong>.</span>
        </div>
    </div>
    `;

    const mode = game.settings.get('lancer-reactionChecker', 'reactionReminder');

    if (mode === 'p') {
        new Dialog({
            title: "Overwatch Alert",
            content: html,
            buttons: {
                ok: { label: "ACKNOWLEDGE" }
            },
            default: "ok",
            render: (htmlConfig) => {
                htmlConfig.find('.lancer-list-item').click((event) => {
                    const tokenId = event.currentTarget.dataset.tokenId;
                    const token = canvas.tokens.get(tokenId);
                    if (token) {
                        token.control({ releaseOthers: true });
                        canvas.animatePan({ x: token.x, y: token.y, duration: 250 });
                    }
                });
            }
        }, { top: 450, left: 150 }).render(true);
    } else if (mode === 'c') {
        ChatMessage.create({
            user: game.userId,
            content: html,
            whisper: [game.userId]
        });
    }
}

export function getActorMaxThreat(actor) {
    if (!actor) return 0;
    const actorType = actor.type;
    if (!["mech", "npc", "pilot"].includes(actorType)) return 0;

    let maxThreat = 1;

    const items = actor.items || [];
    for (const item of items) {
        if ((actorType === "mech" && item.type === "mech_weapon") ||
            (actorType === "npc" && item.type === "npc_feature") ||
            (actorType === "pilot" && item.type === "pilot_weapon")) {

            let ranges = [];

            if (item.system?.profiles) {
                for (const profile of item.system.profiles) {
                    if (profile.range) ranges.push(...profile.range);
                }
            }
            if (item.system?.range) ranges.push(...item.system.range);
            if (item.system?.active_profile?.range) ranges.push(...item.system.active_profile.range);

            for (const range of ranges) {
                if (range.type === "Threat") {
                    const val = parseInt(range.val);
                    if (!isNaN(val) && val > maxThreat) {
                        maxThreat = val;
                    }
                }
            }
        }
    }
    return maxThreat;
}

function isHexGrid() {
    const gridType = canvas.grid.type;
    return gridType >= 2 && gridType <= 5;
}

function isColumnarHex() {
    const gridType = canvas.grid.type;
    return gridType === 4 || gridType === 5;
}

function offsetToCube(col, row) {
    const gridType = canvas.grid.type;
    let q, r, s;

    switch (gridType) {
        case 2:
            q = col - Math.floor((row - (row & 1)) / 2);
            r = row;
            s = -q - r;
            break;
        case 3:
            q = col - Math.floor((row + (row & 1)) / 2);
            r = row;
            s = -q - r;
            break;
        case 4:
            q = col;
            r = row - Math.floor((col - (col & 1)) / 2);
            s = -q - r;
            break;
        case 5:
            q = col;
            r = row - Math.floor((col + (col & 1)) / 2);
            s = -q - r;
            break;
        default:
            q = col;
            r = row;
            s = 0;
    }

    return { q, r, s };
}

function cubeDistance(a, b) {
    return Math.max(
        Math.abs(a.q - b.q),
        Math.abs(a.r - b.r),
        Math.abs(a.s - b.s)
    );
}

function getHexesInRange(center, range) {
    const results = [];
    for (let q = -range; q <= range; q++) {
        for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
            const s = -q - r;
            results.push({
                q: center.q + q,
                r: center.r + r,
                s: center.s + s
            });
        }
    }
    return results;
}

function cubeToOffset(cube) {
    const gridType = canvas.grid.type;
    let col, row;

    switch (gridType) {
        case 2:
            col = cube.q + Math.floor((cube.r - (cube.r & 1)) / 2);
            row = cube.r;
            break;
        case 3:
            col = cube.q + Math.floor((cube.r + (cube.r & 1)) / 2);
            row = cube.r;
            break;
        case 4:
            col = cube.q;
            row = cube.r + Math.floor((cube.q - (cube.q & 1)) / 2);
            break;
        case 5:
            col = cube.q;
            row = cube.r + Math.floor((cube.q + (cube.q & 1)) / 2);
            break;
        default:
            col = cube.q;
            row = cube.r;
    }

    return { col, row };
}

function getHexCenter(col, row) {
    if (canvas.grid.getCenterPoint) {
        const p = canvas.grid.getCenterPoint({ i: row, j: col });
        return { x: p.x, y: p.y };
    } else {
        const [cx, cy] = canvas.grid.grid.getCenter(row, col);
        return { x: cx, y: cy };
    }
}

function pixelToOffset(x, y) {
    if (canvas.grid.getOffset) {
        const offset = canvas.grid.getOffset({ x, y });
        return { col: offset.j, row: offset.i };
    } else {
        const pos = canvas.grid.grid.getGridPositionFromPixels(x, y);
        return { col: pos[1], row: pos[0] };
    }
}

function getOccupiedOffsets(token, overridePos = null) {
    const doc = token.document;
    const x = overridePos ? overridePos.x : doc.x;
    const y = overridePos ? overridePos.y : doc.y;
    const gridSize = canvas.grid.size;

    const centerX = x + (doc.width * gridSize / 2);
    const centerY = y + (doc.height * gridSize / 2);
    const centerOffset = pixelToOffset(centerX, centerY);

    if (doc.width <= 1 && doc.height <= 1) {
        return [centerOffset];
    }

    const offsets = [];
    const scanRadius = Math.ceil(Math.max(doc.width, doc.height));

    for (let di = -scanRadius; di <= scanRadius; di++) {
        for (let dj = -scanRadius; dj <= scanRadius; dj++) {
            const col = centerOffset.col + di;
            const row = centerOffset.row + dj;

            const center = getHexCenter(col, row);

            const localX = center.x - x;
            const localY = center.y - y;

            if (token.shape && token.shape.contains(localX, localY)) {
                offsets.push({ col, row });
            }
        }
    }

    if (offsets.length === 0) {
        offsets.push(centerOffset);
    }

    return offsets;
}

function getOccupiedCenters(token, overridePos = null) {
    const offsets = getOccupiedOffsets(token, overridePos);
    return offsets.map(o => getHexCenter(o.col, o.row));
}

export function getMinGridDistance(token1, token2, overridePos1 = null) {
    if (!isHexGrid()) {
        const centers1 = getOccupiedCenters(token1, overridePos1);
        const centers2 = getOccupiedCenters(token2);

        let minDist = Infinity;
        for (const c1 of centers1) {
            for (const c2 of centers2) {
                let dPixel;
                if (canvas.grid.measurePath) {
                    dPixel = canvas.grid.measurePath([c1, c2]).distance;
                } else {
                    dPixel = canvas.grid.measureDistance(c1, c2);
                }
                if (dPixel < minDist) minDist = dPixel;
            }
        }
        return Math.round(minDist / canvas.scene.grid.distance);
    }

    const offsets1 = getOccupiedOffsets(token1, overridePos1);
    const offsets2 = getOccupiedOffsets(token2);

    let minDist = Infinity;

    for (const o1 of offsets1) {
        const cube1 = offsetToCube(o1.col, o1.row);
        for (const o2 of offsets2) {
            const cube2 = offsetToCube(o2.col, o2.row);
            const dist = cubeDistance(cube1, cube2);
            if (dist < minDist) minDist = dist;
        }
    }

    return minDist;
}

export async function drawThreatDebug(token) {
    if (!token) return;

    canvas.controls.debug.clear();

    const maxThreat = getActorMaxThreat(token.actor);
    const gridSize = canvas.grid.size;

    ui.notifications.info(`Debug: Token Size ${token.document.width}x${token.document.height}, Max Threat: ${maxThreat}`);

    if (!isHexGrid()) {
        ui.notifications.warn("Threat debug visualization currently only supports hex grids");
        return;
    }

    const footprintOffsets = getOccupiedOffsets(token);

    const footprintCubes = footprintOffsets.map(o => ({
        ...offsetToCube(o.col, o.row),
        col: o.col,
        row: o.row
    }));

    const threatHexSet = new Set();
    const footprintSet = new Set();

    for (const fp of footprintCubes) {
        footprintSet.add(`${fp.col},${fp.row}`);

        const inRange = getHexesInRange(fp, maxThreat);
        for (const cube of inRange) {
            const offset = cubeToOffset(cube);
            threatHexSet.add(`${offset.col},${offset.row}`);
        }
    }

    canvas.controls.debug.lineStyle(2, 0x00FF00, 0.7);
    canvas.controls.debug.beginFill(0x00FF00, 0.15);

    for (const key of threatHexSet) {
        if (footprintSet.has(key)) continue;

        const [col, row] = key.split(',').map(Number);
        drawHexAt(col, row, gridSize);
    }

    canvas.controls.debug.endFill();

    canvas.controls.debug.lineStyle(3, 0xFF0000, 1);
    canvas.controls.debug.beginFill(0xFF0000, 0.25);

    for (const fp of footprintCubes) {
        drawHexAt(fp.col, fp.row, gridSize);
    }

    canvas.controls.debug.endFill();

    canvas.controls.debug.lineStyle(0);
    canvas.controls.debug.beginFill(0xFF0000, 1);
    for (const fp of footprintCubes) {
        const center = getHexCenter(fp.col, fp.row);
        canvas.controls.debug.drawCircle(center.x, center.y, 5);
    }
    canvas.controls.debug.endFill();
}

function drawHexAt(col, row, gridSize) {
    const center = getHexCenter(col, row);

    if (canvas.grid.getShape) {
        const shape = canvas.grid.getShape();
        if (shape && shape.points) {
            const translatedPoints = [];
            for (let i = 0; i < shape.points.length; i += 2) {
                translatedPoints.push(shape.points[i] + center.x);
                translatedPoints.push(shape.points[i + 1] + center.y);
            }
            canvas.controls.debug.drawPolygon(translatedPoints);
            return;
        }
    }

    canvas.controls.debug.drawCircle(center.x, center.y, gridSize / 3);
}

export function getTokenDistance(token1, token2) {
    return getMinGridDistance(token1, token2);
}

export async function drawDistanceDebug() {
    const controlled = canvas.tokens.controlled;

    if (controlled.length !== 2) {
        ui.notifications.warn("Select exactly 2 tokens to measure distance.");
        return;
    }

    const [token1, token2] = controlled;

    canvas.controls.debug.clear();

    const distance = getMinGridDistance(token1, token2);

    const offsets1 = getOccupiedOffsets(token1);
    const offsets2 = getOccupiedOffsets(token2);

    let closestPair = { c1: null, c2: null, dist: Infinity };

    if (isHexGrid()) {
        for (const o1 of offsets1) {
            const cube1 = offsetToCube(o1.col, o1.row);
            for (const o2 of offsets2) {
                const cube2 = offsetToCube(o2.col, o2.row);
                const d = cubeDistance(cube1, cube2);
                if (d < closestPair.dist) {
                    closestPair = {
                        c1: getHexCenter(o1.col, o1.row),
                        c2: getHexCenter(o2.col, o2.row),
                        dist: d
                    };
                }
            }
        }
    } else {
        const centers1 = getOccupiedCenters(token1);
        const centers2 = getOccupiedCenters(token2);
        for (const c1 of centers1) {
            for (const c2 of centers2) {
                let dPixel;
                if (canvas.grid.measurePath) {
                    dPixel = canvas.grid.measurePath([c1, c2]).distance;
                } else {
                    dPixel = canvas.grid.measureDistance(c1, c2);
                }
                if (dPixel < closestPair.dist) {
                    closestPair = { c1, c2, dist: dPixel };
                }
            }
        }
        closestPair.dist = Math.round(closestPair.dist / canvas.scene.grid.distance);
    }

    const gridSize = canvas.grid.size;

    canvas.controls.debug.lineStyle(2, 0x0066FF, 0.5);
    canvas.controls.debug.beginFill(0x0066FF, 0.15);
    for (const o of offsets1) {
        if (isHexGrid()) {
            drawHexAt(o.col, o.row, gridSize);
        } else {
            const center = getHexCenter(o.col, o.row);
            canvas.controls.debug.drawRect(center.x - gridSize / 2, center.y - gridSize / 2, gridSize, gridSize);
        }
    }
    canvas.controls.debug.endFill();

    canvas.controls.debug.lineStyle(2, 0xFF6600, 0.5);
    canvas.controls.debug.beginFill(0xFF6600, 0.15);
    for (const o of offsets2) {
        if (isHexGrid()) {
            drawHexAt(o.col, o.row, gridSize);
        } else {
            const center = getHexCenter(o.col, o.row);
            canvas.controls.debug.drawRect(center.x - gridSize / 2, center.y - gridSize / 2, gridSize, gridSize);
        }
    }
    canvas.controls.debug.endFill();

    if (closestPair.c1 && closestPair.c2) {
        canvas.controls.debug.lineStyle(4, 0xFFFF00, 1);
        canvas.controls.debug.moveTo(closestPair.c1.x, closestPair.c1.y);
        canvas.controls.debug.lineTo(closestPair.c2.x, closestPair.c2.y);

        canvas.controls.debug.lineStyle(0);
        canvas.controls.debug.beginFill(0xFFFF00, 1);
        canvas.controls.debug.drawCircle(closestPair.c1.x, closestPair.c1.y, 6);
        canvas.controls.debug.drawCircle(closestPair.c2.x, closestPair.c2.y, 6);
        canvas.controls.debug.endFill();
    }

    ui.notifications.info(`Distance: ${distance} spaces (${token1.name} ↔ ${token2.name})`);

    return distance;
}
