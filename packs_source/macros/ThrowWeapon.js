const api = game.modules.get('lancer-automations')?.api;
if (!api?.openThrowMenu) {
    return ui.notifications.error("lancer-automations module is required for the throw menu.");
}

const token = canvas.tokens.controlled[0];
const actor = token?.actor;
if (!actor) {
    return ui.notifications.warn("No actor found. Select a token.");
}

await api.openThrowMenu(actor);
