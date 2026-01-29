/*global game, Hooks, Dialog */

import { checkOverwatch, displayOverwatch, drawThreatDebug } from "./reaction.js";

function registerSettings() {
    game.settings.register('lancer-reactionChecker', 'reactionReminder', {
        name: 'Reaction Reminder',
        hint: 'Remind users they have reactions when a token is targeted.',
        scope: 'world',
        config: true,
        type: String,
        choices: {
            "c": "Chat Whisper",
            "p": "Pop-Up"
        },
        default: "p"
    });
}

function handleSocketEvent({ action, payload }) {
    if (action === 'overwatchAlert') {
        // Reconstruct reactors from IDs
        const reactorIds = payload.reactorIds;
        const reactors = reactorIds.map(id => canvas.tokens.get(id)).filter(t => t);
        if (reactors.length > 0) {
            const target = canvas.tokens.get(payload.targetId)?.document;
            if (target) {
                displayOverwatch(reactors, target);
            }
        }
    }
}

Hooks.on('init', () => {
    console.log('lancer-reactionChecker | Init');
    registerSettings();
});

Hooks.on('ready', () => {
    console.log('lancer-reactionChecker | Ready');
    game.modules.get('lancer-reactionChecker').api = {
        checkOverwatch,
        displayOverwatch,
        drawThreatDebug
    };
    game.socket.on('module.lancer-reactionChecker', handleSocketEvent);
});

Hooks.on('preUpdateToken', checkOverwatch);
