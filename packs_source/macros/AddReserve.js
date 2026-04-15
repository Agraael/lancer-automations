const token = canvas.tokens.controlled[0];

if (!token) {
    return ui.notifications.error("Select a pilot or mech token first.");
}

const api = game.modules.get('lancer-automations').api;
api.openAddReserveDialog(token);
