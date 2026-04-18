/* global game, canvas, $ */

import { revertMovement, clearMovementHistory } from '../interactive/combat.js';

const ACTION_DEFS = [
    { key: 'protocol', icon: 'cci cci-protocol',                        color: '#00e5e5', label: 'Protocol' },
    { key: 'move',     icon: 'mdi mdi-arrow-right-bold-hexagon-outline', color: '#4caf50', label: 'Move',     isMove: true },
    { key: 'full',     icon: 'mdi mdi-hexagon-slice-6',                  color: '#ff9800', label: 'Full Action' },
    { key: 'quick',    icon: 'mdi mdi-hexagon-slice-3',                  color: '#ff9800', label: 'Quick Action' },
    { key: 'reaction', icon: 'cci cci-reaction',                         color: '#be51ed', label: 'Reaction' },
];

function _canMod() {
    if (game.user.isGM) {
        return true;
    }
    try {
        return game.settings.get(game.system.id, 'actionTracker')?.allowPlayers ?? false;
    } catch {
        return false;
    }
}

/**
 * Build the combat actions bar element.
 * @param {Actor} actor
 * @param {Token} token
 * @returns {JQuery|null}
 */
export function buildCombatBar(actor, token) {
    if (!game.combat?.active) {
        return null;
    }
    const combatant = game.combat.combatants.find(c => c.tokenId === token.document?.id);
    if (!combatant) {
        return null;
    }

    const actions = actor.system?.action_tracker;
    if (!actions) {
        return null;
    }

    const activations = /** @type {any} */ (combatant).activations ?? { max: 1, value: 0 };
    const isMyTurn = game.combat.combatant?.id === combatant.id;
    const canClick = _canMod();

    const bar = $(`<div id="la-combat-bar" style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:#111;border-left:3px solid var(--primary-color);min-height:30px;box-sizing:border-box;width:max-content;"></div>`);

    // Activation diamonds + end turn
    // When it's this token's turn, one spent slot becomes the end-turn icon
    const available = activations.value ?? 0;
    const max = activations.max ?? 1;
    let endTurnPlaced = false;
    for (let i = 0; i < max; i++) {
        const filled = i < available;

        // Replace the first spent diamond with end-turn button when active
        if (!filled && isMyTurn && !endTurnPlaced) {
            endTurnPlaced = true;
            const endBtn = $(`<span class="la-end-turn" style="cursor:pointer;font-size:1.3em;line-height:1;color:#c33;transition:color 0.15s;" title="End Turn"><i class="cci cci-deactivate"></i></span>`);
            endBtn.on('mouseenter', () => endBtn.css('color', '#ff5555'));
            endBtn.on('mouseleave', () => endBtn.css('color', '#c33'));
            endBtn.on('click', async () => {
                await game.combat.deactivateCombatant(combatant.id);
            });
            endBtn.on('contextmenu', async (ev) => {
                ev.preventDefault();
                await /** @type {any} */ (combatant).modifyCurrentActivations(1);
            });
            bar.append(endBtn);
            continue;
        }

        const diamond = $(`<span class="la-activation-pip" style="cursor:${canClick ? 'pointer' : 'default'};font-size:1.3em;line-height:1;color:${filled ? 'var(--primary-color)' : '#555'};opacity:${filled ? 1 : 0.4};transition:color 0.15s, opacity 0.15s;" title="${filled ? 'Activate (start turn)' : 'Right-click to restore'}"><i class="cci cci-activate"></i></span>`);
        if (canClick) {
            if (filled) {
                diamond.on('click', async () => {
                    await game.combat.activateCombatant(combatant.id);
                });
            }
            diamond.on('contextmenu', async (ev) => {
                ev.preventDefault();
                if (filled) {
                    await /** @type {any} */ (combatant).modifyCurrentActivations(-1);
                } else {
                    await /** @type {any} */ (combatant).modifyCurrentActivations(1);
                }
            });
        }
        bar.append(diamond);
    }

    // Separator
    bar.append($(`<span style="border-left:1px solid #555;height:20px;margin:0 3px;"></span>`));

    // Action icons
    for (const def of ACTION_DEFS) {
        const val = actions[def.key];
        const isAvailable = def.isMove ? (val > 0) : !!val;
        const tooltip = def.isMove
            ? `${def.label}: ${val ?? 0}`
            : `${def.label}: ${isAvailable ? 'Available' : 'Spent'}`;

        const icon = $(`<span class="la-action-icon" data-action="${def.key}" style="cursor:${canClick ? 'pointer' : 'default'};font-size:1.3em;line-height:1;display:flex;align-items:center;color:${isAvailable ? def.color : '#555'};opacity:${isAvailable ? 1 : 0.35};transition:color 0.15s, opacity 0.15s;" title="${tooltip}"><i class="${def.icon}"></i></span>`);

        if (canClick) {
            icon.on('click', async () => {
                if (def.isMove) {
                    const speed = actor.system?.speed ?? 0;
                    const newVal = val > 0 ? 0 : speed;
                    await actor.update({ [`system.action_tracker.${def.key}`]: newVal });
                } else {
                    await actor.update({ [`system.action_tracker.${def.key}`]: !val });
                }
            });
        }
        bar.append(icon);
    }

    // Reset button
    if (canClick) {
        bar.append($(`<span style="border-left:1px solid #555;height:20px;margin:0 3px;"></span>`));
        const resetBtn = $(`<span class="la-action-reset" style="cursor:pointer;font-size:1.1em;line-height:1;display:flex;align-items:center;color:#888;transition:color 0.15s;" title="Reset Actions"><i class="mdi mdi-restore"></i></span>`);
        resetBtn.on('mouseenter', () => resetBtn.css('color', '#fff'));
        resetBtn.on('mouseleave', () => resetBtn.css('color', '#888'));
        resetBtn.on('click', async () => {
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
        });
        bar.append(resetBtn);

        // Revert last movement
        const revertBtn = $(`<span style="cursor:pointer;font-size:1.1em;line-height:1;display:flex;align-items:center;color:#888;transition:color 0.15s;" title="Revert Last Move"><i class="fas fa-step-backward"></i></span>`);
        revertBtn.on('mouseenter', () => revertBtn.css('color', '#fff'));
        revertBtn.on('mouseleave', () => revertBtn.css('color', '#888'));
        revertBtn.on('click', async () => {
            await revertMovement(token);
        });
        bar.append(revertBtn);

        // Clear movement history
        const clearBtn = $(`<span style="cursor:pointer;font-size:1.1em;line-height:1;display:flex;align-items:center;color:#888;transition:color 0.15s;" title="Clear Movement History"><i class="fas fa-trash"></i></span>`);
        clearBtn.on('mouseenter', () => clearBtn.css('color', '#fff'));
        clearBtn.on('mouseleave', () => clearBtn.css('color', '#888'));
        clearBtn.on('click', async () => {
            await clearMovementHistory(token, false);
        });
        bar.append(clearBtn);
    }

    return bar;
}
