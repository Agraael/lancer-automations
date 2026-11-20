/* global game, canvas, $ */

import { clearMovementHistory } from '../interactive/combat.js';
import { modifyAction, restoreAction } from '../tools/action-economy.js';
import { activateCombatantSocket, deactivateCombatantSocket, modifyCombatantActivationsSocket } from '../socket.js';
import { playUiSound } from './sound.js';
import { localize, escapeHtml } from '../tools/string-utils.js';
import { deployableOwnerToken, movesOnItsOwn, billingToken } from '../interactive/deployable-owner.js';
import { ownReactionCounts } from '../combat/per-frequency-tags.js';
import { getDeployableIcon } from './item-helpers.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { TAPE_COLORS, combatantFor, revertLastAction } from './action-tape.js';
import { getMovementUsage } from '../movement/move-tracking.js';
import { actionCounts, actionExtrasUsed, extrasClearUpdate } from '../combat/action-extras.js';
import { getStatusLockedFields } from '../combat/action-limits.js';
import { getExternalSetting } from '../tools/settings-utils.js';

const ACTION_DEFS = [
    { key: 'protocol', icon: 'cci cci-protocol',                        label: 'LA.actionEconomy.protocol' },
    { key: 'move',     icon: 'mdi mdi-arrow-right-bold-hexagon-outline', label: 'LA.actionEconomy.move',     isMove: true },
    { key: 'full',     icon: 'mdi mdi-hexagon-slice-6',                  label: 'LA.actionEconomy.full' },
    { key: 'quick',    icon: 'mdi mdi-hexagon-slice-3',                  label: 'LA.actionEconomy.quick' },
    { key: 'reaction', icon: 'cci cci-reaction',                         label: 'LA.actionEconomy.reaction' },
    { key: 'free',     icon: 'cci cci-free-action',                      label: 'LA.actionEconomy.free' },
];

function toolBtn(icon, title, onClick, cls = '')
{
    const btn = $(htmlToElement(`<span${cls ? ` class="${cls}"` : ''} style="cursor:pointer;font-size:1.1em;line-height:1;display:flex;align-items:center;color:#888;transition:color 0.15s;" title="${title}"><i class="${icon}"></i></span>`));
    btn.on('mouseenter', () =>
    {
        playUiSound('statusHover'); btn.css('color', '#fff');
    });
    btn.on('mouseleave', () => btn.css('color', '#888'));
    btn.on('click', onClick);
    return btn;
}

function _canMod(actor)
{
    if (game.user.isGM)
        return true;
    if (actor?.isOwner)
        return true;
    return getExternalSetting(game.system.id, 'actionTracker')?.allowPlayers ?? false;
}

function actionIconContext(actor, token, isMyTurn, canClick)
{
    return {
        actor,
        token,
        isMyTurn,
        canClick,
        actions: actor.system?.action_tracker ?? {},
        counts: actionCounts(actor),
        freeLocked: getStatusLockedFields(actor).has('free'),
        freeUsed: !!actionExtrasUsed(actor).free,
    };
}

function actionIconEl(def, ctx)
{
    const { actor, token, isMyTurn, canClick, actions, counts, freeLocked, freeUsed } = ctx;
    const isFree = def.key === 'free';
    const actionValue = actions[def.key];
    const usage = def.isMove && isMyTurn ? getMovementUsage(token) : null;
    const moveLeft = usage ? Math.max(0, usage.cap - usage.used) : null;
    const count = counts[def.key];
    const extra = def.key === 'quick' ? counts.overcharge : 0;
    const isAvailable = isFree ? !freeLocked && !freeUsed : moveLeft !== null ? moveLeft > 0 : (def.isMove ? (actionValue > 0) : (count !== undefined ? count > 0 || extra > 0 : !!actionValue));
    const spentLabel = isFree && freeLocked ? 'LA.actionEconomy.forbidden' : 'LA.actionEconomy.spent';

    const state = def.isMove
        ? `${localize(def.label)}: ${moveLeft ?? actionValue ?? 0}`
        : `${localize(def.label)}: ${localize(isAvailable ? 'LA.actionEconomy.available' : spentLabel)}`;

    const extraHint = extra > 0 ? ` ${localize('LA.actionEconomy.overchargeQuick')}` : '';
    const tooltip = isFree && freeLocked ? state : `${state}. ${localize(count === undefined ? 'LA.actionEconomy.restoreHint' : 'LA.actionEconomy.addHint')}${extraHint}`;

    const clickable = canClick && moveLeft === null;
    const countPip = count > 0 ? `<span class="la-action-count">${count}</span>` : '';
    const extraPip = extra > 0 ? `<span class="la-action-extra">+${extra}</span>` : '';
    const moveStarted = !!usage && usage.used > usage.legStart && moveLeft > 0;
    const moveFill = moveStarted ? `--la-move-left:${Math.round((moveLeft / (usage.cap - usage.legStart)) * 100)}%;` : '';
    const icon = $(htmlToElement(`<span class="la-action-icon${moveStarted ? ' la-move-started' : ''}" data-action="${def.key}" style="cursor:${clickable ? 'pointer' : 'default'};font-size:1.3em;line-height:1;display:flex;align-items:center;color:${isAvailable ? TAPE_COLORS[def.key] : '#555'};opacity:${isAvailable ? 1 : 0.35};transition:filter 0.1s, opacity 0.15s;${moveFill}" title="${tooltip}"><i class="${def.icon}"></i>${countPip}${extraPip}</span>`));
    icon.on('mouseenter', () =>
    {
        playUiSound('statusHover'); icon.css({ filter: 'brightness(1.6)', opacity: 1 });
    });
    icon.on('mouseleave', () => icon.css({ filter: '', opacity: isAvailable ? 1 : 0.35 }));

    if (clickable)
    {
        icon.on('click', async () =>
        {
            if (isAvailable)
                await modifyAction(actor, def.key, true);
        });
        icon.on('contextmenu', async (event) =>
        {
            event.preventDefault();
            await restoreAction(actor, def.key);
        });
    }

    return icon;
}

function ownReactionIcon(token)
{
    const reaction = ownReactionCounts(token.actor);
    if (!reaction)
        return null;

    const { left, total } = reaction;
    const icon = $(htmlToElement(`<span class="la-action-icon" data-action="reaction" style="cursor:default;font-size:1.3em;line-height:1;display:flex;align-items:center;color:${left ? TAPE_COLORS.reaction : '#555'};opacity:${left ? 1 : 0.35};transition:filter 0.1s, opacity 0.15s;" title="${escapeHtml(`${reaction.name}: ${left}/${total}`)}"><i class="cci cci-reaction"></i></span>`));
    icon.on('mouseenter', () =>
    {
        playUiSound('statusHover'); icon.css({ filter: 'brightness(1.6)', opacity: 1 });
    });
    icon.on('mouseleave', () => icon.css({ filter: '', opacity: left ? 1 : 0.35 }));
    return icon;
}

function ownSegment(token)
{
    const icons = [];

    if (movesOnItsOwn(token))
    {
        const moveDef = ACTION_DEFS.find(def => def.isMove);
        icons.push(actionIconEl(moveDef, { actor: token.actor, token, isMyTurn: true, canClick: false, actions: {}, counts: {}, freeLocked: false, freeUsed: false }));
    }

    const reaction = billingToken(token) === token ? ownReactionIcon(token) : null;
    if (reaction)
        icons.push(reaction);
    if (!icons.length)
        return [];

    const glyph = getDeployableIcon({ type: token.actor?.system?.type });
    return [htmlToElement(`<span class="la-owner-self" style="mask-image:url('${glyph}');-webkit-mask-image:url('${glyph}');"></span>`), ...icons];
}

function buildOwnerBar(token)
{
    const ownerToken = deployableOwnerToken(token);
    const owner = ownerToken?.actor;
    const ownerCombatant = ownerToken ? combatantFor(ownerToken) : null;

    if (!owner || !ownerCombatant || !owner.system?.action_tracker)
        return null;

    const canClick = _canMod(owner);
    const isMyTurn = game.combat.combatant?.id === ownerCombatant.id;
    const bar = $(htmlToElement(`<div id="la-combat-bar" class="la-owner-bar"></div>`));
    const portrait = $(htmlToElement(`<span class="la-owner-portrait" title="${escapeHtml(ownerToken.name ?? owner.name)}"><img src="${escapeHtml(ownerToken.document?.texture?.src ?? owner.img)}" alt=""></span>`));
    let hovered = false;

    portrait.on('mouseenter', (event) =>
    {
        playUiSound('statusHover');
        if (ownerToken.destroyed || !ownerToken._canHover?.(game.user, event))
            return;
        ownerToken._onHoverIn(event, { hoverOutOthers: true });
        hovered = true;
    });
    portrait.on('mouseleave', (event) =>
    {
        if (hovered && !ownerToken.destroyed)
            ownerToken._onHoverOut(event);
        hovered = false;
    });
    portrait.on('click', (event) =>
    {
        if (ownerToken.destroyed || !ownerToken.isOwner)
            return;
        if (hovered)
            ownerToken._onHoverOut(event);
        hovered = false;
        ownerToken.control({ releaseOthers: true });
    });
    bar.append(portrait);

    const iconContext = actionIconContext(owner, ownerToken, isMyTurn, canClick);

    for (const def of ACTION_DEFS)
    {
        if (!def.isMove)
            bar.append(actionIconEl(def, iconContext));
    }

    const own = ownSegment(token);

    if (own.length)
    {
        bar.append(htmlToElement(`<span style="border-left:1px solid #555;height:20px;margin:0 3px;"></span>`));
        bar.append(...own);
    }

    if (canClick)
    {
        bar.append(htmlToElement(`<span style="border-left:1px solid #555;height:20px;margin:0 3px;"></span>`));
        bar.append(toolBtn('fas fa-step-backward', 'Revert Last Action', async () =>
        {
            await revertLastAction(ownerToken);
        }));
    }

    return bar;
}

/**
 * Build the combat actions bar element.
 * @param {Actor} actor
 * @param {Token} token
 * @returns {JQuery|null}
 */
export function buildCombatBar(actor, token)
{
    if (actor?.type === 'deployable')
        return buildOwnerBar(token);

    const combatant = combatantFor(token);
    if (!combatant)
        return null;

    const actions = actor.system?.action_tracker;
    if (!actions)
        return null;

    const activations = /** @type {any} */ (combatant).activations ?? { max: 1, value: 0 };
    const isMyTurn = game.combat.combatant?.id === combatant.id;
    const canClick = _canMod(actor);

    if (!document.getElementById('la-combat-bar-styles'))
    {
        const style = document.createElement('style');
        style.id = 'la-combat-bar-styles';
        style.textContent = `
            @keyframes la-end-turn-pulse {
                0%, 100% { filter: brightness(1);   transform: scale(1);   }
                50%      { filter: brightness(1.7); transform: scale(1.15); }
            }
            .la-end-turn { animation: la-end-turn-pulse 1.4s ease-in-out infinite; }
            .la-end-turn:hover { animation: none; }
        `;
        document.head.appendChild(style);
    }

    const bar = $(htmlToElement(`<div id="la-combat-bar"></div>`));

    // Activation diamonds + end turn
    // When it's this token's turn, one spent slot becomes the end-turn icon
    const available = activations.value ?? 0;
    const max = activations.max ?? 1;
    let endTurnPlaced = false;

    for (let i = 0; i < max; i++)
    {
        const filled = i < available;

        // Replace the first spent diamond with end-turn button when active
        if (!filled && isMyTurn && !endTurnPlaced)
        {
            endTurnPlaced = true;
            const endBtn = $(htmlToElement(`<span class="la-end-turn" style="cursor:pointer;font-size:1.3em;line-height:1;color:var(--primary-color);transition:filter 0.15s;" title="End Turn"><i class="cci cci-deactivate"></i></span>`));
            endBtn.on('mouseenter', () =>
            {
                playUiSound('statusHover'); endBtn.css('filter', 'brightness(1.6)');
            });
            endBtn.on('mouseleave', () => endBtn.css('filter', ''));
            endBtn.on('click', async () =>
            {
                await deactivateCombatantSocket(game.combat, combatant);
            });
            endBtn.on('contextmenu', async (ev) =>
            {
                ev.preventDefault();
                await deactivateCombatantSocket(game.combat, combatant);
                await modifyCombatantActivationsSocket(game.combat, combatant, 1);
            });
            bar.append(endBtn);
            continue;
        }

        const diamond = $(htmlToElement(`<span class="la-activation-pip" style="cursor:${canClick ? 'pointer' : 'default'};font-size:1.3em;line-height:1;color:${filled ? 'var(--primary-color)' : '#555'};opacity:${filled ? 1 : 0.4};transition:filter 0.1s, opacity 0.15s;" title="${filled ? 'Activate (start turn)' : 'Right-click to restore'}"><i class="cci cci-activate"></i></span>`));
        diamond.on('mouseenter', () =>
        {
            playUiSound('statusHover'); diamond.css({ filter: 'brightness(1.6)', opacity: 1 });
        });
        diamond.on('mouseleave', () => diamond.css({ filter: '', opacity: filled ? 1 : 0.4 }));

        if (canClick)
        {
            if (filled)
            {
                diamond.on('click', async () =>
                {
                    await activateCombatantSocket(game.combat, combatant);
                });
            }

            diamond.on('contextmenu', async (ev) =>
            {
                ev.preventDefault();
                await modifyCombatantActivationsSocket(game.combat, combatant, filled ? -1 : 1);
            });
        }

        bar.append(diamond);
    }

    // Separator
    bar.append(htmlToElement(`<span style="border-left:1px solid #555;height:20px;margin:0 3px;"></span>`));

    const iconContext = actionIconContext(actor, token, isMyTurn, canClick);

    for (const def of ACTION_DEFS)
        bar.append(actionIconEl(def, iconContext));

    // Reset button
    if (canClick)
    {
        bar.append(htmlToElement(`<span style="border-left:1px solid #555;height:20px;margin:0 3px;"></span>`));
        bar.append(toolBtn('mdi mdi-restore', 'Reset Actions', async () =>
        {
            const speed = actor.system?.speed ?? 0;
            await actor.update({
                system: { action_tracker: {
                    protocol: true,
                    move: speed,
                    full: true,
                    quick: true,
                    reaction: true,
                } },
                ...extrasClearUpdate()
            }, /** @type {any} */ ({ laActionExtras: true }));
        }, 'la-action-reset'));

        bar.append(toolBtn('fas fa-step-backward', 'Revert Last Action', async () =>
        {
            await revertLastAction(token);
        }));

        // Clear movement history
        bar.append(toolBtn('fas fa-trash', 'Clear Movement History', async () =>
        {
            await clearMovementHistory(token, false);
        }));
    }

    return bar;
}
