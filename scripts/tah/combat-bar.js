/* global game, canvas, $ */

import { clearMovementHistory } from '../interactive/combat.js';
import { modifyAction, restoreAction } from '../tools/action-economy.js';
import { activateCombatantSocket, deactivateCombatantSocket, modifyCombatantActivationsSocket } from '../socket.js';
import { playUiSound } from './sound.js';
import { localize } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { TAPE_COLORS, combatantFor, revertLastAction } from './action-tape.js';
import { getMovementUsage } from '../movement/move-tracking.js';
import { actionCounts, extrasClearUpdate } from '../combat/action-extras.js';
import { getExternalSetting } from '../tools/settings-utils.js';

const ACTION_DEFS = [
    { key: 'protocol', icon: 'cci cci-protocol',                        label: 'LA.actionEconomy.protocol' },
    { key: 'move',     icon: 'mdi mdi-arrow-right-bold-hexagon-outline', label: 'LA.actionEconomy.move',     isMove: true },
    { key: 'full',     icon: 'mdi mdi-hexagon-slice-6',                  label: 'LA.actionEconomy.full' },
    { key: 'quick',    icon: 'mdi mdi-hexagon-slice-3',                  label: 'LA.actionEconomy.quick' },
    { key: 'reaction', icon: 'cci cci-reaction',                         label: 'LA.actionEconomy.reaction' },
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

/**
 * Build the combat actions bar element.
 * @param {Actor} actor
 * @param {Token} token
 * @returns {JQuery|null}
 */
export function buildCombatBar(actor, token)
{
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

    // Action icons
    const counts = actionCounts(actor);
    for (const def of ACTION_DEFS)
    {
        const actionValue = actions[def.key];
        const usage = def.isMove && isMyTurn ? getMovementUsage(token) : null;
        const moveLeft = usage ? Math.max(0, usage.cap - usage.used) : null;
        const count = counts[def.key];
        const isAvailable = moveLeft !== null ? moveLeft > 0 : (def.isMove ? (actionValue > 0) : (count !== undefined ? count > 0 : !!actionValue));
        const state = def.isMove
            ? `${localize(def.label)}: ${moveLeft ?? actionValue ?? 0}`
            : `${localize(def.label)}: ${localize(isAvailable ? 'LA.actionEconomy.available' : 'LA.actionEconomy.spent')}`;
        const tooltip = `${state}. ${localize(count === undefined ? 'LA.actionEconomy.restoreHint' : 'LA.actionEconomy.addHint')}`;

        const clickable = canClick && moveLeft === null;
        const countPip = count > 0 ? `<span class="la-action-count">${count}</span>` : '';
        const moveStarted = !!usage && usage.used > usage.legStart && moveLeft > 0;
        const moveFill = moveStarted ? `--la-move-left:${Math.round((moveLeft / (usage.cap - usage.legStart)) * 100)}%;` : '';
        const icon = $(htmlToElement(`<span class="la-action-icon${moveStarted ? ' la-move-started' : ''}" data-action="${def.key}" style="cursor:${clickable ? 'pointer' : 'default'};font-size:1.3em;line-height:1;display:flex;align-items:center;color:${isAvailable ? TAPE_COLORS[def.key] : '#555'};opacity:${isAvailable ? 1 : 0.35};transition:filter 0.1s, opacity 0.15s;${moveFill}" title="${tooltip}"><i class="${def.icon}"></i>${countPip}</span>`));
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
        bar.append(icon);
    }

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
