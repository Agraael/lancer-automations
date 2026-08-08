/*global game, Dialog, ChatMessage, canvas, CONST */

import {
    isHexGrid, offsetToCube, cubeToOffset,
    getHexesInRange, getHexCenter, drawHexAt,
    getOccupiedOffsets, getMinGridDistance
} from "../combat/grid-helpers.js";
import { hasReactionAvailable } from "../tools/misc-tools.js";
import { getActorMaxThreat } from "../tools/weapon-bonus-utils.js";

function getReactionNamesFromItems(items)
{
    const names = [];
    for (const item of items)
    {
        if (!item.system?.tags)
            continue;
        for (const tag of item.system.tags)
        {
            if (tag.lid === 'tg_reaction')
                names.push(item.name);
        }
    }
    return names;
}

function getReactionsOnMech(mech)
{
    const items = mech.items.filter(item => typeof item.system.tags !== 'undefined');
    const reactionNames = getReactionNamesFromItems(items);

    let pilot = game.actors.find(actor => actor.id === mech.system.pilot?.value._id);
    if (typeof pilot !== 'undefined')
        return reactionNames.concat(getReactionsOnPilot(pilot));
    else
        return reactionNames;
}

function getReactionsOnUnlinkedMech(token)
{
    const items = token.document.actor.items?.filter(item => item.system.tags !== undefined);
    return items ? getReactionNamesFromItems(items) : [];
}

function getReactionsOnPilot(pilot)
{
    const reactionNames = [];
    const items = pilot.items.filter(item => item.type === 'talent');
    for (const talent of items)
    {
        let curRank = talent.system.curr_rank;
        let talentRanks = talent.system.ranks;
        for (let j = 0; j < talentRanks.length; j++)
        {
            let actions = talentRanks[j].actions;
            for (const action of actions)
            {
                if (action.activation === 'Reaction')
                {
                    if (curRank > j)
                        reactionNames.push(`Talent: ${action.name}`);
                }
            }
        }
    }
    return reactionNames;
}

export async function checkOverwatch(document, change, options, userId)
{
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

    const potentialReactors = canvas.tokens.placeables.filter(token =>
    {
        if (token.id === movedToken.id)
            return false;
        if (!token.actor)
            return false;
        if (!token.isOwner)
            return false;

        if (!hasReactionAvailable(token))
            return false;

        const tokenFactions = game.modules.get("token-factions")?.api;
        if (tokenFactions && typeof tokenFactions.getDisposition === 'function')
        {
            const disposition = tokenFactions.getDisposition(token.actor, movedToken.actor);
            const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
            const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;
            if (disposition !== HOSTILE && disposition !== SECRET)
                return false;
        }
        else
        {
            const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
            const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;
            const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
            const NEUTRAL = CONST.TOKEN_DISPOSITIONS.NEUTRAL;

            const isTargetBad = movedToken.document.disposition === HOSTILE || movedToken.document.disposition === SECRET;
            const isReactorBad = token.document.disposition === HOSTILE || token.document.disposition === SECRET;

            const isTargetFriendly = movedToken.document.disposition === FRIENDLY || movedToken.document.disposition === NEUTRAL;
            const isReactorFriendly = token.document.disposition === FRIENDLY || token.document.disposition === NEUTRAL;

            if (!((isReactorFriendly && isTargetBad) || (isReactorBad && isTargetFriendly)))
                return false;
        }
        return true;
    });

    const triggeredReactors = [];

    for (const reactor of potentialReactors)
    {
        let isTriggered = false;

        if (manager)
        {
            const auras = manager.getTokenAuras(reactor);
            const threatAura = auras.find(aura => aura.config.name === "Threat_detail" || aura.config.name === "Threat");

            if (threatAura)
            {
                const wasInside = manager.isInside(movedToken, reactor, threatAura.config.id);
                if (wasInside)
                    isTriggered = true;
            }
        }

        if (!isTriggered)
        {
            const hasGaaSupport = manager && manager.getTokenAuras(reactor).some(aura => aura.config.name === "Threat_detail" || aura.config.name === "Threat");

            if (!hasGaaSupport)
            {
                const maxThreat = getActorMaxThreat(reactor.actor);
                const distanceStart = getMinGridDistance(movedToken, reactor);

                if (distanceStart <= maxThreat)
                    isTriggered = true;
            }
        }

        if (isTriggered)
            triggeredReactors.push(reactor);
    }

    if (triggeredReactors.length > 0)
    {
        const ownerMap = {};

        for (const reactor of triggeredReactors)
        {
            const owners = game.users.filter(user => user.active && reactor.document.testUserPermission(user, "OWNER"));
            for (const user of owners)
            {
                if (!ownerMap[user.id])
                    ownerMap[user.id] = [];
                ownerMap[user.id].push(reactor.id);
            }
        }

        for (const [userId, reactorIds] of Object.entries(ownerMap))
        {
            if (userId === game.userId)
            {
                const myReactors = reactorIds.map(id => canvas.tokens.get(id));
                displayOverwatch(myReactors, movedToken.document);
            }
            else
            {
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

export function displayOverwatch(reactors, target)
{
    let reactorItems = "";

    for (const reactor of reactors)
    {
        reactorItems += `
        <div class="lancer-list-item" data-token-id="${reactor.id}">
             <img src="${reactor.document.texture.src}" width="36" height="36" style="margin-right:10px; border: 1px solid var(--primary-color); border-radius: 4px; background: #000; cursor: pointer;">
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

    if (mode === 'p')
    {
        new Dialog({
            title: "Overwatch Alert",
            content: html,
            buttons: {
                ok: { label: "ACKNOWLEDGE" }
            },
            default: "ok",
            render: (dialogHtml) =>
            {
                dialogHtml.find('.lancer-list-item').click((event) =>
                {
                    const tokenId = event.currentTarget.dataset.tokenId;
                    const token = canvas.tokens.get(tokenId);
                    if (token)
                    {
                        token.control({ releaseOthers: true });
                        canvas.animatePan({ x: token.x, y: token.y, duration: 250 });
                    }
                });
            }
        }, { top: 450, left: 150, classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
    }
    else if (mode === 'c')
    {
        ChatMessage.create({
            author: game.userId,
            content: html,
            whisper: [game.userId]
        });
    }
}

export async function drawThreatDebug(token)
{
    if (!token)
        return;

    canvas.controls.debug.clear();

    const maxThreat = getActorMaxThreat(token.actor);

    ui.notifications.info(`Debug: Token Size ${token.document.width}x${token.document.height}, Max Threat: ${maxThreat}`);

    if (!isHexGrid())
    {
        ui.notifications.warn("Threat debug visualization currently only supports hex grids");
        return;
    }

    const footprintOffsets = getOccupiedOffsets(token);

    const footprintCubes = footprintOffsets.map(offset => ({
        ...offsetToCube(offset.col, offset.row),
        col: offset.col,
        row: offset.row
    }));

    const threatHexSet = new Set();
    const footprintSet = new Set();

    for (const fp of footprintCubes)
    {
        footprintSet.add(`${fp.col},${fp.row}`);

        const inRange = getHexesInRange(fp, maxThreat);
        for (const cube of inRange)
        {
            const offset = cubeToOffset(cube);
            threatHexSet.add(`${offset.col},${offset.row}`);
        }
    }

    canvas.controls.debug.lineStyle(2, 0x00FF00, 0.7);
    canvas.controls.debug.beginFill(0x00FF00, 0.15);

    for (const key of threatHexSet)
    {
        if (footprintSet.has(key))
            continue;

        const [col, row] = key.split(',').map(Number);
        drawHexAt(canvas.controls.debug, col, row);
    }

    canvas.controls.debug.endFill();

    canvas.controls.debug.lineStyle(3, 0xFF0000, 1);
    canvas.controls.debug.beginFill(0xFF0000, 0.25);

    for (const fp of footprintCubes)
        drawHexAt(canvas.controls.debug, fp.col, fp.row);

    canvas.controls.debug.endFill();

    canvas.controls.debug.lineStyle(0);
    canvas.controls.debug.beginFill(0xFF0000, 1);
    for (const fp of footprintCubes)
    {
        const center = getHexCenter(fp.col, fp.row);
        canvas.controls.debug.drawCircle(center.x, center.y, 5);
    }
    canvas.controls.debug.endFill();
}
