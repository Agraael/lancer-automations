const api = game.modules.get('lancer-automations')?.api;
if (!api?.openDeployableMenu) {
    return ui.notifications.error("lancer-automations module is required for deployable management.");
}

const token = canvas.tokens.controlled[0];
const actor = token?.actor;
if (!actor) {
    return ui.notifications.warn("No actor found. Select a token.");
}

await api.openDeployableMenu(actor);
