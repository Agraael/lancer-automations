const api = game.modules.get('lancer-automations').api;
if (api?.openChoiceMenu) {
    await api.openChoiceMenu();
} else {
    ui.notifications.error("Lancer Automations API not found or outdated.");
}
