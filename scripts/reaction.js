/*global game, Dialog, ChatMessage, canvas, CONST */

import {
    isHexGrid, offsetToCube, cubeToOffset,
    getHexesInRange, getHexCenter, drawHexAt,
    getOccupiedOffsets, getMinGridDistance
} from "./grid-helpers.js";

function getReactionNamesFromItems(items) {
    const names = [];
    for (const item of items) {
        if (!item.system?.tags)
            continue;
        for (const tag of item.system.tags) {
            if (tag.lid === 'tg_reaction')
                names.push(item.name);
        }
    }
    return names;
}

function getReactionsOnMech(mech) {
    const items = mech.items.filter(x => typeof x.system.tags != 'undefined');
    const response = getReactionNamesFromItems(items);

    let pilot = game.actors.find(x => x.id === mech.system.pilot?.value._id);
    if (typeof pilot !== 'undefined') {
        return response.concat(getReactionsOnPilot(pilot));
    } else {
        return response;
    }
}

function getReactionsOnUnlinkedMech(token) {
    const items = token.document.actor.items?.filter(x => typeof x.system.tags != 'undefined');
    return items ? getReactionNamesFromItems(items) : [];
}

function getReactionsOnPilot(pilot) {
    const response = [];
    const items = pilot.items.filter(x => x.type === 'talent');
    for (let i = 0; i < items.length; i++) {
        let curRank = items[i].system.curr_rank;
        let talentRanks = items[i].system.ranks;
        for (let j = 0; j < talentRanks.length; j++) {
            let actions = talentRanks[j].actions;
            for (const action of actions) {
                if (action.activation === 'Reaction') {
                    if (curRank > j) {
                        response.push(`Talent: ${action.name}`);
                    }
                }
            }
        }
    }
    return response;
}

export function displayReactions(actor, token) {
    let reactions = token.document.isLinked ?
        getReactionsOnMech(actor) :
        getReactionsOnUnlinkedMech(token);
    if (reactions.length > 0) {
        let html = `<h3>Someone has targeted ${actor.name}! Consider using your activations!</h3>`;
        html += "<ul>";
        for (let i = 0; i < reactions.length; i++) {
            html += `<li>${reactions[i]}</li>`;
        }
        html += "</ul>";
        if (game.settings.get('lancer-automations', 'reactionReminder') == 'p') {
            new Dialog({
                title: `Activation Reminder for ${actor.name}`,
                content: html,
                buttons: {
                    ok: {
                        label: "OK"
                    }
                }
            }).render(true);
        }
        if (game.settings.get('lancer-automations', 'reactionReminder') == 'c') {
            ChatMessage.create({
                user: game.userId,
                content: html,
                whisper: [game.userId]
            });
        }
    }
}

export async function checkOverwatch(document, change, options, userId) {
    const hasElevationChange = change.elevation !== undefined;
    const hasXChange = change.x !== undefined && Math.abs(change.x - document.x) >= 1;
    const hasYChange = change.y !== undefined && Math.abs(change.y - document.y) >= 1;

    if (!hasElevationChange && !hasXChange && !hasYChange)
        return;

    const movedToken = canvas.tokens.get(document.id);
    if (!movedToken)
        return;

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
            const disposition = tokenFactions.getDisposition(t.actor, movedToken.actor);
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
                const distanceStart = getMinGridDistance(movedToken, reactor);

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

function getActorMaxThreat(actor) {
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
