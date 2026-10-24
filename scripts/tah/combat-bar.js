/* global game, canvas, $ */

import { revertMovement, clearMovementHistory } from '../interactive/combat.js';
import { modifyAction } from '../tools/misc-tools.js';
import { activateCombatantSocket, deactivateCombatantSocket, modifyCombatantActivationsSocket } from '../socket.js';
import { playUiSound } from './sound.js';
import { localize } from '../tools/string-utils.js';
import { TAPE_COLORS, combatantFor } from './action-tape.js';

const ACTION_DEFS = [
    { key: 'protocol', icon: 'cci cci-protocol',                        label: 'LA.action.protocol' },
    { key: 'move',     icon: 'mdi mdi-arrow-right-bold-hexagon-outline', label: 'LA.action.move',     isMove: true },
    { key: 'full',     icon: 'mdi mdi-hexagon-slice-6',                  label: 'LA.action.full' },
    { key: 'quick',    icon: 'mdi mdi-hexagon-slice-3',                  label: 'LA.action.quick' },
    { key: 'reaction', icon: 'cci cci-reaction',                         label: 'LA.action.reaction' },
];

function toolBtn(icon, title, onClick, cls = '')
{
    const btn = $(`<span${cls ? ` class="${cls}"` : ''} style="cursor:pointer;font-size:1.1em;line-height:1;display:flex;align-items:center;color:#888;transition:color 0.15s;" title="${title}"><i class="${icon}"></i></span>`);
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
    try
    {
        return game.settings.get(game.system.id, 'actionTracker')?.allowPlayers ?? false;
    }
    catch
    {
        return false;
    }
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
    const bar = $(`<div id="la-combat-bar" style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:#111;border-left:3px solid var(--primary-color);min-height:30px;box-sizing:border-box;width:max-content;"></div>`);

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
            const endBtn = $(`<span class="la-end-turn" style="cursor:pointer;font-size:1.3em;line-height:1;color:var(--primary-color);transition:filter 0.15s;" title="End Turn"><i class="cci cci-deactivate"></i></span>`);
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

        const diamond = $(`<span class="la-activation-pip" style="cursor:${canClick ? 'pointer' : 'default'};font-size:1.3em;line-height:1;color:${filled ? 'var(--primary-color)' : '#555'};opacity:${filled ? 1 : 0.4};transition:filter 0.1s, opacity 0.15s;" title="${filled ? 'Activate (start turn)' : 'Right-click to restore'}"><i class="cci cci-activate"></i></span>`);
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
    bar.append($(`<span style="border-left:1px solid #555;height:20px;margin:0 3px;"></span>`));

    // Action icons
    for (const def of ACTION_DEFS)
    {
        const actionValue = actions[def.key];
        const isAvailable = def.isMove ? (actionValue > 0) : !!actionValue;
        const tooltip = def.isMove
            ? `${localize(def.label)}: ${actionValue ?? 0}`
            : `${localize(def.label)}: ${localize(isAvailable ? 'LA.action.available' : 'LA.action.spent')}`;

        const icon = $(`<span class="la-action-icon" data-action="${def.key}" style="cursor:${canClick ? 'pointer' : 'default'};font-size:1.3em;line-height:1;display:flex;align-items:center;color:${isAvailable ? TAPE_COLORS[def.key] : '#555'};opacity:${isAvailable ? 1 : 0.35};transition:filter 0.1s, opacity 0.15s;" title="${tooltip}"><i class="${def.icon}"></i></span>`);
        icon.on('mouseenter', () =>
        {
            playUiSound('statusHover'); icon.css({ filter: 'brightness(1.6)', opacity: 1 });
        });
        icon.on('mouseleave', () => icon.css({ filter: '', opacity: isAvailable ? 1 : 0.35 }));

        if (canClick)
        {
            icon.on('click', async () =>
            {
                await modifyAction(actor, def.key, !!actionValue);
            });
        }
        bar.append(icon);
    }

    // Reset button
    if (canClick)
    {
        bar.append($(`<span style="border-left:1px solid #555;height:20px;margin:0 3px;"></span>`));
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
                } }
            });
        }, 'la-action-reset'));

        // Revert last movement
        bar.append(toolBtn('fas fa-step-backward', 'Revert Last Move', async () =>
        {
            await revertMovement(token);
        }));

        // Clear movement history
        bar.append(toolBtn('fas fa-trash', 'Clear Movement History', async () =>
        {
            await clearMovementHistory(token, false);
        }));
    }

    return bar;
}
