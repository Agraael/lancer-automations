const api = game.modules.get('lancer-automations')?.api;
if (!api?.pickupWeaponToken) {
    return ui.notifications.error("lancer-automations module is required for weapon pickup.");
}

const selectedTokens = canvas.tokens.controlled;
if (selectedTokens.length === 0) {
    return ui.notifications.warn("Please select your character's token first.");
}

await api.pickupWeaponToken(selectedTokens[0]);
