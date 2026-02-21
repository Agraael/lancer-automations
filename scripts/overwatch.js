/*global game, Dialog, ChatMessage, canvas, CONST */

import {
    isHexGrid, offsetToCube, cubeToOffset, cubeDistance,
    getHexesInRange, getHexCenter, drawHexAt,
    getOccupiedOffsets, getOccupiedCenters, getMinGridDistance,
    measureGridDistance
} from "./grid-helpers.js";

export { getMinGridDistance };

const THREAT_AURA_NAMES = ["Threat_detail", "Threat"];
const isThreatAura = (a) => THREAT_AURA_NAMES.includes(a.config.name);

function getDispositionData(t1, t2) {
    const tokenFactions = game.modules.get("token-factions")?.api;
    if (tokenFactions && typeof tokenFactions.getDisposition === 'function') {
        return { factionDisposition: tokenFactions.getDisposition(t1, t2) };
    }
    const { HOSTILE, SECRET, FRIENDLY, NEUTRAL } = CONST.TOKEN_DISPOSITIONS;
    const d1 = t1.document.disposition;
    const d2 = t2.document.disposition;
    return {
        is1Bad: d1 === HOSTILE || d1 === SECRET,
        is2Bad: d2 === HOSTILE || d2 === SECRET,
        is1Good: d1 === FRIENDLY || d1 === NEUTRAL,
        is2Good: d2 === FRIENDLY || d2 === NEUTRAL
    };
}

export function isFriendly(token1, token2) {
    const d = getDispositionData(token1, token2);
    if (d.factionDisposition !== undefined) {
        return d.factionDisposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    }
    return (d.is1Good && d.is2Good) || (d.is1Bad && d.is2Bad);
}

export function isHostile(reactor, mover) {
    const d = getDispositionData(reactor, mover);
    if (d.factionDisposition !== undefined) {
        const disp = d.factionDisposition;
        return disp === CONST.TOKEN_DISPOSITIONS.HOSTILE || disp === CONST.TOKEN_DISPOSITIONS.SECRET;
    }
    return (d.is1Good && d.is2Bad) || (d.is1Bad && d.is2Good);
}

export function checkOverwatchCondition(reactor, mover, startPos) {
    if (reactor.id === mover.id)
        return false;

    if (!isHostile(reactor, mover))
        return false;

    const reaction = reactor.actor?.system?.action_tracker?.reaction;
    if (!reaction || reaction <= 0)
        return false;

    const auraLayer = canvas.gaaAuraLayer;
    const manager = auraLayer?._auraManager;

    if (manager) {
        const auras = manager.getTokenAuras(reactor);
        const threatAura = auras.find(a => isThreatAura(a));

        if (threatAura) {
            return manager.isInside(mover, reactor, threatAura.config.id);
        }
    }

    const maxThreat = getActorMaxThreat(reactor.actor);
    const distanceStart = getMinGridDistance(mover, reactor, startPos);

    return distanceStart <= maxThreat;
}

export async function checkOverwatch(token, distance, elevation, startPos, endPos) {
    if (!game.settings.get('lancer-automations', 'overwatchEnabled'))
        return;

    const movedToken = token;

    if (!movedToken.inCombat)
        return;

    const auraLayer = canvas.gaaAuraLayer;
    const manager = auraLayer?._auraManager;

    const potentialReactors = canvas.tokens.placeables.filter(t => {
        if (t.id === movedToken.id)
            return false;
        if (!t.actor)
            return false;
        if (!t.isOwner)
            return false;

        const reaction = t.actor.system.action_tracker?.reaction;
        if (!reaction || reaction <= 0)
            return false;

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

            if (!((isReactorFriendly && isTargetBad) || (isReactorBad && isTargetFriendly)))
                return false;
        }
        return true;
    });

    const triggeredReactors = [];

    for (const reactor of potentialReactors) {
        let isTriggered = false;

        if (manager) {
            const auras = manager.getTokenAuras(reactor);
            const threatAura = auras.find(a => isThreatAura(a));

            if (threatAura) {
                const wasInside = manager.isInside(movedToken, reactor, threatAura.config.id);
                if (wasInside) {
                    isTriggered = true;
                }
            }
        }

        if (!isTriggered) {
            const hasGaaSupport = manager && manager.getTokenAuras(reactor).some(a => isThreatAura(a));

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
                if (!ownerMap[user.id])
                    ownerMap[user.id] = [];
                ownerMap[user.id].push(reactor.id);
            }
        }

        for (const [userId, reactorIds] of Object.entries(ownerMap)) {
            if (userId === game.userId) {
                const myReactors = reactorIds.map(id => canvas.tokens.get(id));
                displayOverwatch(myReactors, movedToken.document);
            } else {
                game.socket.emit('module.lancer-automations', {
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

    const mode = game.settings.get('lancer-automations', 'reactionReminder');

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
    if (!actor)
        return 0;
    const actorType = actor.type;
    if (!["mech", "npc", "pilot"].includes(actorType))
        return 0;

    let maxThreat = 1;

    const items = actor.items || [];
    for (const item of items) {
        if ((actorType === "mech" && item.type === "mech_weapon") ||
            (actorType === "npc" && item.type === "npc_feature") ||
            (actorType === "pilot" && item.type === "pilot_weapon")) {

            let ranges = [];

            if (item.system?.profiles) {
                for (const profile of item.system.profiles) {
                    if (profile.range)
                        ranges.push(...profile.range);
                }
            }
            if (item.system?.range)
                ranges.push(...item.system.range);
            if (item.system?.active_profile?.range)
                ranges.push(...item.system.active_profile.range);

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

export async function drawThreatDebug(token) {
    if (!token)
        return;

    canvas.controls.debug.clear();

    const maxThreat = getActorMaxThreat(token.actor);

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
        if (footprintSet.has(key))
            continue;

        const [col, row] = key.split(',').map(Number);
        drawHexAt(canvas.controls.debug, col, row);
    }

    canvas.controls.debug.endFill();

    canvas.controls.debug.lineStyle(3, 0xFF0000, 1);
    canvas.controls.debug.beginFill(0xFF0000, 0.25);

    for (const fp of footprintCubes) {
        drawHexAt(canvas.controls.debug, fp.col, fp.row);
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
                const dPixel = measureGridDistance(c1, c2);
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
            drawHexAt(canvas.controls.debug, o.col, o.row);
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
            drawHexAt(canvas.controls.debug, o.col, o.row);
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

export function canEngage(token1, token2) {
    if (!token1 || !token2)
        return false;

    if (token1.id === token2.id)
        return false;

    if (!token1.actor || !token2.actor)
        return false;

    // Must be hostile
    if (!isHostile(token1, token2))
        return false;

    // Deployables cannot engage or be engaged
    if (token1.actor.type === 'deployable' || token2.actor.type === 'deployable')
        return false;

    // Dead mechs cannot engage or be engaged
    if (token1.actor.system.structure?.value === 0 || token2.actor.system.structure?.value === 0)
        return false;

    const api = game.modules.get('lancer-automations')?.api;

    // Check statuses
    const checkStatus = (token, statusName) => {
        if (statusName === "hidden" && token.document.hidden)
            return true;

        if (api && api.findFlaggedEffectOnToken) {
            if (api.findFlaggedEffectOnToken(token, statusName))
                return true;
        }

        return token.actor.effects.some(e => e.statuses?.has(statusName) && !e.disabled);
    };

    const invalidStatuses = ["hidden", "disengage", "intangible"];

    for (const status of invalidStatuses) {
        if (checkStatus(token1, status) || checkStatus(token2, status))
            return false;
    }

    return true;
}

export async function updateAllEngagements() {
    if (!game.user.isGM)
        return;

    const api = game.modules.get('lancer-automations')?.api;

    if (!api)
        return;

    const allTokens = canvas.tokens.placeables;

    // Check who is currently flagged as engaged
    const currentlyEngaged = new Set(
        allTokens.filter(t => !!api.findFlaggedEffectOnToken(t, "lancer.statusIconsNames.engaged")).map(t => t.id)
    );

    const shouldBeEngaged = new Set();

    for (let i = 0; i < allTokens.length; i++) {
        const t1 = allTokens[i];

        for (let j = i + 1; j < allTokens.length; j++) {
            const t2 = allTokens[j];

            if (shouldBeEngaged.has(t1.id) && shouldBeEngaged.has(t2.id))
                continue;

            if (canEngage(t1, t2)) {
                if (getMinGridDistance(t1, t2) <= 1) {
                    shouldBeEngaged.add(t1.id);
                    shouldBeEngaged.add(t2.id);
                }
            }
        }
    }

    for (const token of allTokens) {
        const hasStatus = currentlyEngaged.has(token.id);
        const needsStatus = shouldBeEngaged.has(token.id);

        if (needsStatus && !hasStatus) {
            await api.applyFlaggedEffectToTokens({
                tokens: [token],
                effectNames: ["lancer.statusIconsNames.engaged"],
                notify: false,
                useTokenAsOrigin: false
            });
        } else if (!needsStatus && hasStatus) {
            await api.removeFlaggedEffectToTokens({
                tokens: [token],
                effectNames: ["lancer.statusIconsNames.engaged"],
                notify: false
            });
        }
    }
}
